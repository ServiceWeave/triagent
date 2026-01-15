/** @jsxImportSource @opentui/solid */
import { render } from "@opentui/solid";
import { createSignal, For, Show, onMount } from "solid-js";
import { createTextAttributes } from "@opentui/core";
import "opentui-spinner/solid";
import { getDebuggerAgent, buildIncidentPrompt } from "../mastra/index.js";
import type { IncidentInput } from "../mastra/agents/debugger.js";

interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  toolName?: string;
  command?: string;
}

// Conversation history for multi-turn debugging
interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function formatHistoryAsPrompt(history: ConversationMessage[], newMessage: string): string {
  if (history.length === 0) {
    return newMessage;
  }

  const historyText = history
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `Previous conversation:\n${historyText}\n\nUser: ${newMessage}`;
}

type AppStatus = "idle" | "investigating" | "complete" | "error";

const ATTR_DIM = createTextAttributes({ dim: true });
const ATTR_BOLD = createTextAttributes({ bold: true });

function buildDisplayCommand(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  const a = args as Record<string, unknown>;

  switch (toolName) {
    case "cli":
      // CLI tool has direct command
      return "command" in a ? String(a.command) : undefined;

    case "git": {
      // Build git command: git <command> [args...] [path]
      if (!("command" in a)) return undefined;
      const parts = ["git", String(a.command)];
      if ("args" in a && Array.isArray(a.args)) {
        parts.push(...a.args.map(String));
      }
      if ("path" in a && a.path) {
        parts.push(String(a.path));
      }
      return parts.join(" ");
    }

    case "filesystem": {
      // Build filesystem display: <operation> <path> [pattern]
      if (!("operation" in a)) return undefined;
      const op = String(a.operation);
      const path = "path" in a ? String(a.path) : "";
      if (op === "search" && "pattern" in a) {
        return `grep "${a.pattern}" ${path}`;
      }
      if (op === "read") {
        return `cat ${path}`;
      }
      if (op === "list") {
        return `ls ${path}`;
      }
      return `${op} ${path}`;
    }

    default:
      // Fallback: try to use command if it exists
      return "command" in a ? String(a.command) : undefined;
  }
}

function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [conversationHistory, setConversationHistory] = createSignal<ConversationMessage[]>([]);
  const [status, setStatus] = createSignal<AppStatus>("idle");
  const [currentTool, setCurrentTool] = createSignal<string | null>(null);
  const [inputValue, setInputValue] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const addMessage = (msg: Omit<Message, "id" | "timestamp">) => {
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      },
    ]);
  };

  const investigate = async (incident: IncidentInput) => {
    setStatus("investigating");
    setError(null);
    setCurrentTool(null);

    // Add user message to UI
    addMessage({
      role: "user",
      content: incident.description,
    });

    // Build prompt: use full incident prompt for first message, include history for follow-ups
    const isFirstMessage = conversationHistory().length === 0;
    const userContent = isFirstMessage
      ? buildIncidentPrompt(incident)
      : incident.description;

    // Format prompt with conversation history
    const prompt = formatHistoryAsPrompt(conversationHistory(), userContent);

    // Add user message to conversation history
    setConversationHistory((prev) => [
      ...prev,
      { role: "user", content: userContent },
    ]);

    try {
      const agent = getDebuggerAgent();

      let assistantContent = "";

      // Send the formatted prompt to the agent
      const stream = await agent.stream(prompt, {
        maxSteps: 20,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls && toolCalls.length > 0) {
            const toolCall = toolCalls[0] as { payload?: { toolName?: string; args?: unknown } };
            const payload = toolCall.payload;
            const toolName = payload?.toolName ?? "tool";
            const args = payload?.args ?? {};

            // Build display command based on tool type
            const command = buildDisplayCommand(toolName, args);

            setCurrentTool(toolName);
            addMessage({
              role: "tool",
              content: command ? `$ ${command}` : `Executing ${toolName}...`,
              toolName,
              command,
            });
          }
        },
      });

      for await (const chunk of stream.textStream) {
        assistantContent += chunk;
      }

      // Add assistant response to UI
      addMessage({
        role: "assistant",
        content: assistantContent,
      });

      // Add assistant response to conversation history
      setConversationHistory((prev) => [
        ...prev,
        { role: "assistant", content: assistantContent },
      ]);

      setStatus("complete");
      setCurrentTool(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setStatus("error");
      addMessage({
        role: "assistant",
        content: `Error: ${errorMsg}`,
      });
    }
  };

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (status() === "investigating") return;

    setInputValue("");
    investigate({
      title: "Manual Investigation",
      description: trimmed,
    });
  };

  const handleInput = (value: string) => {
    setInputValue(value);
  };

  const getStatusColor = (): string => {
    switch (status()) {
      case "investigating":
        return "yellow";
      case "complete":
        return "green";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };

  const getStatusText = (): string => {
    switch (status()) {
      case "investigating":
        return currentTool() ? `Running: ${currentTool()}` : "Investigating...";
      case "complete":
        return "Complete";
      case "error":
        return "Error";
      default:
        return "Ready";
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box
        borderStyle="single"
        borderColor="red"
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg="red" attributes={ATTR_BOLD}>
          TRIAGENT
        </text>
        <text fg="gray">Kubernetes Debugging Agent</text>
        <text fg={getStatusColor()} attributes={ATTR_BOLD}>
          [{getStatusText()}]
        </text>
      </box>

      {/* Messages Area */}
      <scrollbox
        flexGrow={1}
        borderStyle="single"
        borderColor="gray"
        paddingLeft={1}
        paddingRight={1}
        stickyScroll
        stickyStart="bottom"
      >
        <box flexDirection="column" gap={1}>
          <Show
            when={messages().length > 0}
            fallback={
              <box paddingTop={2} paddingBottom={2}>
                <text fg="gray" attributes={ATTR_DIM}>
                  Enter an incident description to start investigating...
                </text>
              </box>
            }
          >
            <For each={messages()}>
              {(msg) => (
                <box flexDirection="column" marginBottom={1}>
                  <Show when={msg.role === "user"}>
                    <box flexDirection="row" gap={1}>
                      <text fg="cyan" attributes={ATTR_BOLD}>
                        You:
                      </text>
                      <text fg="white">{msg.content}</text>
                    </box>
                  </Show>
                  <Show when={msg.role === "tool"}>
                    <box flexDirection="row" gap={1} alignItems="center">
                      <Show
                        when={status() === "investigating" && msg.id === messages().filter(m => m.role === "tool").at(-1)?.id}
                        fallback={<text fg="green">✓</text>}
                      >
                        <spinner name="dots" color="blue" />
                      </Show>
                      <text fg="blue" attributes={ATTR_DIM}>
                        [{msg.toolName}]
                      </text>
                      <text fg="gray" attributes={ATTR_DIM}>
                        {msg.content}
                      </text>
                    </box>
                  </Show>
                  <Show when={msg.role === "assistant"}>
                    <box flexDirection="column">
                      <text fg="green" attributes={ATTR_BOLD}>
                        Triagent:
                      </text>
                      <text fg="white" wrapMode="word">
                        {msg.content}
                      </text>
                    </box>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </box>
      </scrollbox>

      {/* Input Area */}
      <box
        borderStyle="single"
        borderColor={status() === "investigating" ? "yellow" : "cyan"}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        gap={1}
      >
        <text fg="cyan" attributes={ATTR_BOLD}>
          {">"}
        </text>
        <input
          flexGrow={1}
          focused={true}
          value={inputValue()}
          onInput={handleInput}
          onSubmit={handleSubmit}
          placeholder={
            status() === "investigating"
              ? "Investigating..."
              : "Describe the incident..."
          }
          textColor="white"
          placeholderColor="gray"
          focusedTextColor="white"
          focusedBackgroundColor="#1a1a1a"
        />
      </box>

      {/* Footer */}
      <box
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg="gray" attributes={ATTR_DIM}>
          Press Enter to submit | Ctrl+C to quit
        </text>
        <text fg="gray" attributes={ATTR_DIM}>
          {messages().length} messages
        </text>
      </box>
    </box>
  );
}

export interface TUIHandle {
  shutdown: () => void;
  handleWebhookIncident: (incident: IncidentInput) => Promise<string>;
}

export async function runTUI(): Promise<TUIHandle> {
  await render(() => <App />);

  return {
    shutdown: () => {
      // The render function handles cleanup
      process.exit(0);
    },
    handleWebhookIncident: async (incident: IncidentInput) => {
      // For webhook mode, we'd need to integrate differently
      // This is a placeholder for now
      return "Webhook incident handling not yet implemented in TUI mode";
    },
  };
}
