/* @jsxImportSource @opentui/solid */
import { render } from "@opentui/solid";
import { createSignal, onMount, type JSX } from "solid-js";
import { exec } from "child_process";
import { promisify } from "util";
import { getDebuggerAgent, buildIncidentPrompt } from "../mastra/index.js";
import type { IncidentInput } from "../mastra/agents/debugger.js";
import { approvalStore } from "../mastra/tools/approval-store.js";
import { ToastProvider, toastSuccess, toastError, toastWarning, toastInfo } from "./components/toast.js";
import { ApprovalDialogProvider, useApprovalDialog } from "./components/approval-dialog.js";
import { Header } from "./components/header.js";
import { MessagesPanel, type Message } from "./components/messages-panel.js";
import { Editor } from "./components/editor.js";
import { StatusBar } from "./components/status-bar.js";
import { type AppStatus, type RiskLevel } from "./theme/index.js";
import { loadConfig } from "../config.js";

const execAsync = promisify(exec);

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

function buildDisplayCommand(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  const a = args as Record<string, unknown>;

  switch (toolName) {
    case "cli":
      return "command" in a ? String(a.command) : undefined;

    case "git": {
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
      return "command" in a ? String(a.command) : undefined;
  }
}

// Pending approval state for HITL
interface PendingApprovalState {
  approvalId: string;
  command: string;
  riskLevel: RiskLevel;
  selectedOption: number;
}

function AppContent() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [conversationHistory, setConversationHistory] = createSignal<ConversationMessage[]>([]);
  const [status, setStatus] = createSignal<AppStatus>("idle");
  const [currentTool, setCurrentTool] = createSignal<string | null>(null);
  const [inputValue, setInputValue] = createSignal("");
  const [kubeContext, setKubeContext] = createSignal<string>("loading...");
  const [modelName, setModelName] = createSignal<string>("loading...");

  // HITL approval state
  const [pendingApproval, setPendingApproval] = createSignal<PendingApprovalState | null>(null);

  // Approval dialog hook
  const { showApproval } = useApprovalDialog();

  // Fetch kubectl context and config on mount
  onMount(async () => {
    // Load kubectl context
    try {
      const { stdout } = await execAsync("kubectl config current-context");
      setKubeContext(stdout.trim());
    } catch {
      setKubeContext("not connected");
    }

    // Load model name from config
    try {
      const config = await loadConfig();
      setModelName(config.aiModel);
    } catch {
      setModelName("unknown");
    }
  });

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

  const handleApprovalDecision = async (approved: boolean) => {
    const approval = pendingApproval();
    if (!approval) return;

    if (approved) {
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

      addMessage({
        role: "user",
        content: `Approved: ${approval.command}`,
      });
      toastSuccess("Command approved");

      setPendingApproval(null);
      const approvalMessage = `User approved the command. The approval token is: ${token}. Please execute the command: ${approval.command} with approvalToken: "${token}"`;

      setConversationHistory((prev) => [
        ...prev,
        { role: "user", content: approvalMessage },
      ]);

      setStatus("investigating");
      continueWithApproval(approvalMessage);
    } else {
      approvalStore.reject(approval.approvalId);
      addMessage({
        role: "user",
        content: `Rejected: ${approval.command}`,
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

  // Handle approval using dialog overlay
  const handleApprovalRequest = async (approvalData: PendingApprovalState) => {
    setPendingApproval(approvalData);
    setStatus("awaiting_approval");

    const approved = await showApproval({
      command: approvalData.command,
      riskLevel: approvalData.riskLevel,
      description: `This ${approvalData.riskLevel}-risk operation requires your approval.`,
    });

    await handleApprovalDecision(approved);
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
            const toolCallChunk = toolCalls[0] as { payload?: { toolName?: string; args?: unknown } };
            const toolName = toolCallChunk?.payload?.toolName ?? "tool";
            const args = toolCallChunk?.payload?.args ?? {};

            const command = buildDisplayCommand(toolName, args);

            addMessage({
              role: "tool",
              content: command ? `$ ${command}` : `Executing ${toolName}...`,
              toolName,
              command,
            });
            // Note: Tool is already complete when onStepFinish fires
          }

          if (toolResults && toolResults.length > 0) {
            for (const toolResult of toolResults) {
              const tr = toolResult as any;
              const data = tr?.payload?.result ?? tr?.result ?? tr;

              if (data?.requiresApproval && data?.approvalId) {
                handleApprovalRequest({
                  approvalId: data.approvalId,
                  command: data.command || "unknown command",
                  riskLevel: (data.riskLevel as RiskLevel) || "medium",
                  selectedOption: 0,
                });
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
    setCurrentTool(null);
    toastInfo("Investigation started", incident.title);

    addMessage({
      role: "user",
      content: incident.description,
    });

    const isFirstMessage = conversationHistory().length === 0;
    const userContent = isFirstMessage
      ? buildIncidentPrompt(incident)
      : incident.description;

    const prompt = formatHistoryAsPrompt(conversationHistory(), userContent);

    setConversationHistory((prev) => [
      ...prev,
      { role: "user", content: userContent },
    ]);

    try {
      const agent = getDebuggerAgent();
      let assistantContent = "";

      const stream = await agent.stream(prompt, {
        maxSteps: 20,
        onStepFinish: (stepResult) => {
          const { toolCalls, toolResults } = stepResult;

          if (toolCalls && toolCalls.length > 0) {
            const toolCallChunk = toolCalls[0] as { payload?: { toolName?: string; args?: unknown } };
            const toolName = toolCallChunk?.payload?.toolName ?? "tool";
            const args = toolCallChunk?.payload?.args ?? {};

            const command = buildDisplayCommand(toolName, args);

            addMessage({
              role: "tool",
              content: command ? `$ ${command}` : `Executing ${toolName}...`,
              toolName,
              command,
            });
            // Note: Tool is already complete when onStepFinish fires
          }

          if (toolResults && toolResults.length > 0) {
            for (const toolResult of toolResults) {
              const tr = toolResult as any;
              const data = tr?.payload?.result ?? tr?.result ?? tr;

              if (data?.requiresApproval && data?.approvalId) {
                handleApprovalRequest({
                  approvalId: data.approvalId,
                  command: data.command || "unknown command",
                  riskLevel: (data.riskLevel as RiskLevel) || "medium",
                  selectedOption: 0,
                });
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
        toastSuccess("Investigation complete");
      }
      setCurrentTool(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
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

  const handleApprovalInput = (value: string) => {
    if (value.toLowerCase() === "y") {
      handleApprovalDecision(true);
    } else if (value.toLowerCase() === "n") {
      handleApprovalDecision(false);
    }
  };

  const handleApprovalKeyDown = (key: { name: string }) => {
    const approval = pendingApproval();
    if (!approval) return;

    if (key.name === "up" || key.name === "down") {
      setPendingApproval({ ...approval, selectedOption: approval.selectedOption === 0 ? 1 : 0 });
    } else if (key.name === "return") {
      handleApprovalDecision(approval.selectedOption === 0);
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Header
        status={status()}
        currentTool={currentTool()}
        kubeContext={kubeContext()}
        modelName={modelName()}
      />

      {/* Messages Panel */}
      <MessagesPanel
        messages={messages()}
        status={status()}
      />

      {/* Editor */}
      <Editor
        status={status()}
        value={inputValue()}
        onInput={handleInput}
        onSubmit={handleSubmit}
        onApprovalInput={handleApprovalInput}
        onApprovalKeyDown={handleApprovalKeyDown}
      />

      {/* Status Bar */}
      <StatusBar
        status={status()}
        messageCount={messages().length}
      />
    </box>
  );
}

function App() {
  return (
    <ToastProvider>
      <ApprovalDialogProvider>
        <AppContent />
      </ApprovalDialogProvider>
    </ToastProvider>
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
      process.exit(0);
    },
    handleWebhookIncident: async (incident: IncidentInput) => {
      return "Webhook incident handling not yet implemented in TUI mode";
    },
  };
}

// Export Message type for use in other components
export type { Message } from "./components/messages-panel.js";
