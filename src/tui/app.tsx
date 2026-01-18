/* @jsxImportSource @opentui/solid */
import { render } from "@opentui/solid";
import { createSignal, For, Show, onMount, createMemo, type JSX, type Accessor } from "solid-js";
import { createTextAttributes, SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";
import "opentui-spinner/solid";
import { createPulse } from "opentui-spinner";
import { exec } from "child_process";
import { promisify } from "util";
import { getDebuggerAgent, buildIncidentPrompt } from "../mastra/index.js";
import type { IncidentInput } from "../mastra/agents/debugger.js";
import { approvalStore } from "../mastra/tools/approval-store.js";
import { ToastProvider, toast, toastSuccess, toastError, toastWarning, toastInfo } from "./components/toast.js";
import { ApprovalDialogProvider, useApprovalDialog, type RiskLevel } from "./components/approval-dialog.js";
import { StyledSpan } from "./components/styled-span.js";

const execAsync = promisify(exec);

const ATTR_DIM = createTextAttributes({ dim: true });

// Markdown syntax highlighting theme (matching opencode's approach)
const MARKDOWN_SYNTAX_THEME: ThemeTokenStyle[] = [
  // Headings - cyan and bold
  { scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: "cyan", bold: true } },
  // Bold/strong - white and bold
  { scope: ["markup.strong"], style: { foreground: "white", bold: true } },
  // Italic/emphasis - white and italic
  { scope: ["markup.italic"], style: { foreground: "white", italic: true } },
  // Inline code - yellow
  { scope: ["markup.raw", "markup.raw.block"], style: { foreground: "yellow" } },
  // Block quotes - gray and italic
  { scope: ["markup.quote"], style: { foreground: "gray", italic: true } },
  // Lists - gray
  { scope: ["markup.list", "markup.list.unchecked", "markup.list.checked"], style: { foreground: "gray" } },
  // Links - cyan with underline
  { scope: ["markup.link", "markup.link.url"], style: { foreground: "cyan", underline: true } },
  { scope: ["markup.link.label", "markup.link.bracket.close"], style: { foreground: "blue" } },
  // Strikethrough - dim
  { scope: ["markup.strikethrough"], style: { foreground: "gray", dim: true } },
  // Code block labels (language names)
  { scope: ["label"], style: { foreground: "gray", dim: true } },
  // Punctuation
  { scope: ["punctuation.special", "punctuation.delimiter"], style: { foreground: "gray" } },
  // Escape sequences
  { scope: ["string.escape"], style: { foreground: "magenta" } },
];

// Create the SyntaxStyle instance for markdown
const markdownSyntaxStyle = SyntaxStyle.fromTheme(MARKDOWN_SYNTAX_THEME);

// Pending approval state for HITL
interface PendingApprovalState {
  approvalId: string;
  command: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  selectedOption: number; // 0 = approve, 1 = reject
}

// MarkdownText component using opentui's code component with tree-sitter syntax highlighting
// This matches opencode's approach to markdown rendering
function MarkdownText(props: { content: string; streaming?: boolean }): JSX.Element {
  return (
    <code
      filetype="markdown"
      content={props.content.trim()}
      syntaxStyle={markdownSyntaxStyle}
      conceal={true}
      drawUnstyledText={false}
      streaming={props.streaming ?? false}
      fg="white"
    />
  );
}

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

type AppStatus = "idle" | "investigating" | "awaiting_approval" | "complete" | "error";

const ATTR_BOLD = createTextAttributes({ bold: true });

// Risk level color mapping
function getRiskColor(risk: PendingApprovalState["riskLevel"]): string {
  switch (risk) {
    case "low": return "green";
    case "medium": return "yellow";
    case "high": return "red";
    case "critical": return "magenta";
  }
}

function getRiskEmoji(risk: PendingApprovalState["riskLevel"]): string {
  switch (risk) {
    case "low": return "🟢";
    case "medium": return "🟡";
    case "high": return "🟠";
    case "critical": return "🔴";
  }
}

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
  const [kubeContext, setKubeContext] = createSignal<string>("loading...");

  // Fetch kubectl context on mount
  onMount(async () => {
    try {
      const { stdout } = await execAsync("kubectl config current-context");
      setKubeContext(stdout.trim());
    } catch {
      setKubeContext("not connected");
    }
  });

  // HITL approval state
  const [pendingApproval, setPendingApproval] = createSignal<PendingApprovalState | null>(null);

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

  // Handle approval selection (Y/N or arrow keys)
  const handleApprovalKey = (key: string) => {
    const approval = pendingApproval();
    if (!approval) return;

    if (key === "ArrowUp" || key === "ArrowDown") {
      // Toggle selection
      setPendingApproval({ ...approval, selectedOption: approval.selectedOption === 0 ? 1 : 0 });
    } else if (key === "Enter") {
      // Submit selection
      const approved = approval.selectedOption === 0;
      handleApprovalDecision(approved);
    } else if (key === "y" || key === "Y") {
      // Quick approve
      handleApprovalDecision(true);
    } else if (key === "n" || key === "N") {
      // Quick reject
      handleApprovalDecision(false);
    }
  };

  const handleApprovalDecision = async (approved: boolean) => {
    const approval = pendingApproval();
    if (!approval) return;

    if (approved) {
      // Get approval token from store
      const token = approvalStore.approve(approval.approvalId);
      if (!token) {
        addMessage({
          role: "assistant",
          content: "Approval expired. Please try the operation again.",
        });
        setPendingApproval(null);
        setStatus("complete");
        toastWarning("Approval expired", "Please retry the operation");
        return;
      }

      // Add approval message to UI
      addMessage({
        role: "user",
        content: `✓ Approved: ${approval.command}`,
      });
      toastSuccess("Command approved");

      // Continue the agent with the approval token
      setPendingApproval(null);
      const approvalMessage = `User approved the command. The approval token is: ${token}. Please execute the command: ${approval.command} with approvalToken: "${token}"`;

      // Add to conversation history
      setConversationHistory((prev) => [
        ...prev,
        { role: "user", content: approvalMessage },
      ]);

      // Continue investigation with the approval
      setStatus("investigating");
      continueWithApproval(approvalMessage);
    } else {
      // Reject
      approvalStore.reject(approval.approvalId);
      addMessage({
        role: "user",
        content: `✗ Rejected: ${approval.command}`,
      });
      addMessage({
        role: "assistant",
        content: "Command rejected by user. How would you like to proceed?",
      });
      setPendingApproval(null);
      setStatus("complete");
      toastWarning("Command rejected");
    }
  };

  const continueWithApproval = async (message: string) => {
    try {
      const agent = getDebuggerAgent();
      let assistantContent = "";

      const prompt = formatHistoryAsPrompt(conversationHistory(), message);

      const stream = await agent.stream(prompt, {
        maxSteps: 20,
        onStepFinish: ({ toolCalls, toolResults }) => {
          if (toolCalls && toolCalls.length > 0) {
            // Mastra wraps tool calls: toolCall.payload contains the actual data
            const toolCallChunk = toolCalls[0] as { payload?: { toolName?: string; args?: unknown } };
            const toolName = toolCallChunk?.payload?.toolName ?? "tool";
            const args = toolCallChunk?.payload?.args ?? {};

            const command = buildDisplayCommand(toolName, args);

            setCurrentTool(toolName);
            addMessage({
              role: "tool",
              content: command ? `$ ${command}` : `Executing ${toolName}...`,
              toolName,
              command,
            });
          }

          // Check for approval requirement
          if (toolResults && toolResults.length > 0) {
            for (const toolResult of toolResults) {
              // Mastra wraps results: toolResult.payload.result contains the actual data
              const tr = toolResult as any;
              const data = tr?.payload?.result ?? tr?.result ?? tr;

              if (data?.requiresApproval && data?.approvalId) {
                setPendingApproval({
                  approvalId: data.approvalId,
                  command: data.command || "unknown command",
                  riskLevel: (data.riskLevel as PendingApprovalState["riskLevel"]) || "medium",
                  selectedOption: 0, // Default to approve
                });
                setStatus("awaiting_approval");
              }
            }
          }
        },
      });

      for await (const chunk of stream.textStream) {
        assistantContent += chunk;
      }

      if (status() !== "awaiting_approval") {
        addMessage({
          role: "assistant",
          content: assistantContent,
        });

        setConversationHistory((prev) => [
          ...prev,
          { role: "assistant", content: assistantContent },
        ]);

        setStatus("complete");
        toastSuccess("Command executed");
      }
      setCurrentTool(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setStatus("error");
      toastError("Execution failed", errorMsg);
      addMessage({
        role: "assistant",
        content: `Error: ${errorMsg}`,
      });
    }
  };

  const investigate = async (incident: IncidentInput) => {
    setStatus("investigating");
    setError(null);
    setCurrentTool(null);
    toastInfo("Investigation started", incident.title);

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
        onStepFinish: (stepResult) => {
          const { toolCalls, toolResults } = stepResult;

          if (toolCalls && toolCalls.length > 0) {
            // Mastra wraps tool calls: toolCall.payload contains the actual data
            const toolCallChunk = toolCalls[0] as { payload?: { toolName?: string; args?: unknown } };
            const toolName = toolCallChunk?.payload?.toolName ?? "tool";
            const args = toolCallChunk?.payload?.args ?? {};

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

          // Check for approval requirement in tool results
          if (toolResults && toolResults.length > 0) {
            for (const toolResult of toolResults) {
              // Mastra wraps results: toolResult.payload.result contains the actual data
              const tr = toolResult as any;
              const data = tr?.payload?.result ?? tr?.result ?? tr;

              if (data?.requiresApproval && data?.approvalId) {
                setPendingApproval({
                  approvalId: data.approvalId,
                  command: data.command || "unknown command",
                  riskLevel: (data.riskLevel as PendingApprovalState["riskLevel"]) || "medium",
                  selectedOption: 0, // Default to approve
                });
                setStatus("awaiting_approval");
              }
            }
          }
        },
      });

      for await (const chunk of stream.textStream) {
        assistantContent += chunk;
      }

      // Only add response and set complete if not awaiting approval
      if (status() !== "awaiting_approval") {
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
        toastSuccess("Investigation complete");
      }
      setCurrentTool(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setStatus("error");
      toastError("Investigation failed", errorMsg);
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
      case "awaiting_approval":
        return "red";
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
      case "awaiting_approval":
        return "Awaiting Approval";
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
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={2}>
            <text fg="red" attributes={ATTR_BOLD}>
              ☸
            </text>
            <text fg="red" attributes={ATTR_BOLD}>
              TRIAGENT
            </text>
          </box>
          <text fg={getStatusColor()} attributes={ATTR_BOLD}>
            [{getStatusText()}]
          </text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg="gray">Kubernetes Debugging Agent</text>
          <text fg="cyan">
            cluster: {kubeContext()}
          </text>
        </box>
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
                        when={(status() === "investigating" || status() === "awaiting_approval") && msg.id === messages().filter(m => m.role === "tool").at(-1)?.id}
                        fallback={<text fg="green">✓</text>}
                      >
                        <Show when={status() === "awaiting_approval"} fallback={<spinner name="dots" color={createPulse(["cyan", "blue", "magenta"], 200)} />}>
                          <text fg="yellow">⏸</text>
                        </Show>
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
                      <MarkdownText content={msg.content} />
                    </box>
                  </Show>
                </box>
              )}
            </For>

            {/* Approval prompt - Claude Code style */}
            <Show when={pendingApproval()}>
              {(approval: Accessor<PendingApprovalState>) => (
                <box
                  flexDirection="column"
                  borderStyle="single"
                  borderColor={getRiskColor(approval().riskLevel)}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  marginTop={1}
                >
                  {/* Header */}
                  <box flexDirection="row" gap={1} marginBottom={1}>
                    <text fg={getRiskColor(approval().riskLevel)}>
                      {getRiskEmoji(approval().riskLevel)}
                    </text>
                    <text fg="white" attributes={ATTR_BOLD}>
                      Write Operation Requires Approval
                    </text>
                    <text fg="gray" attributes={ATTR_DIM}>
                      ({approval().riskLevel} risk)
                    </text>
                  </box>

                  {/* Command */}
                  <box flexDirection="column" marginBottom={1}>
                    <text fg="cyan" attributes={ATTR_BOLD}>Command:</text>
                    <text fg="yellow">{approval().command}</text>
                  </box>

                  {/* Options */}
                  <box flexDirection="column" gap={1}>
                    <box flexDirection="row" gap={1}>
                      <text fg={approval().selectedOption === 0 ? "green" : "gray"}>
                        {approval().selectedOption === 0 ? "●" : "○"}
                      </text>
                      <text
                        fg={approval().selectedOption === 0 ? "green" : "white"}
                        attributes={approval().selectedOption === 0 ? ATTR_BOLD : undefined}
                      >
                        Yes, execute this command
                      </text>
                    </box>
                    <box flexDirection="row" gap={1}>
                      <text fg={approval().selectedOption === 1 ? "red" : "gray"}>
                        {approval().selectedOption === 1 ? "●" : "○"}
                      </text>
                      <text
                        fg={approval().selectedOption === 1 ? "red" : "white"}
                        attributes={approval().selectedOption === 1 ? ATTR_BOLD : undefined}
                      >
                        No, cancel this operation
                      </text>
                    </box>
                  </box>

                  {/* Instructions */}
                  <text fg="gray" attributes={ATTR_DIM} marginTop={1}>
                    Use ↑↓ to select, Enter to confirm, or press Y/N
                  </text>
                </box>
              )}
            </Show>
          </Show>
        </box>
      </scrollbox>

      {/* Input Area */}
      <Show
        when={status() === "awaiting_approval"}
        fallback={
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
        }
      >
        {/* Approval mode input */}
        <box
          borderStyle="single"
          borderColor="red"
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          gap={1}
        >
          <text fg="red" attributes={ATTR_BOLD}>
            ?
          </text>
          <input
            flexGrow={1}
            focused={true}
            value=""
            onInput={(value) => {
              // Handle Y/N keys
              if (value.toLowerCase() === "y") {
                handleApprovalDecision(true);
              } else if (value.toLowerCase() === "n") {
                handleApprovalDecision(false);
              }
            }}
            onKeyDown={(key) => {
              // KeyEvent has a 'name' property
              if (key.name === "up" || key.name === "down") {
                const approval = pendingApproval();
                if (approval) {
                  setPendingApproval({ ...approval, selectedOption: approval.selectedOption === 0 ? 1 : 0 });
                }
              } else if (key.name === "return") {
                const approval = pendingApproval();
                if (approval) {
                  handleApprovalDecision(approval.selectedOption === 0);
                }
              }
            }}
            placeholder="Press Y to approve, N to reject, or use ↑↓ and Enter"
            textColor="white"
            placeholderColor="gray"
            focusedTextColor="white"
            focusedBackgroundColor="#1a1a1a"
          />
        </box>
      </Show>

      {/* Footer */}
      <box
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Show
          when={status() === "awaiting_approval"}
          fallback={
            <text fg="gray" attributes={ATTR_DIM}>
              Press Enter to submit | Ctrl+C to quit
            </text>
          }
        >
          <text fg="yellow" attributes={ATTR_BOLD}>
            ⚠ Approval required: Y/N or ↑↓ + Enter
          </text>
        </Show>
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
  await render(() => (
    <ToastProvider>
      <ApprovalDialogProvider>
        <App />
      </ApprovalDialogProvider>
    </ToastProvider>
  ));

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
