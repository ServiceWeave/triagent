import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execCommand } from "../../sandbox/bashlet.js";
import { approvalStore, type PendingApproval } from "./approval-store.js";

interface CliOutput {
  success: boolean;
  output: string;
  error?: string;
  requiresApproval?: boolean;
  command?: string;
  // Token-based approval fields
  approvalId?: string;
  riskLevel?: PendingApproval["riskLevel"];
}

// Write command patterns that require user approval
const WRITE_COMMAND_PATTERNS = [
  // Kubernetes write operations
  /\bkubectl\s+(delete|apply|create|patch|edit|replace|set|label|annotate|taint|cordon|uncordon|drain)\b/i,
  /\bkubectl\s+rollout\s+(restart|undo|pause|resume)\b/i,
  /\bkubectl\s+scale\b/i,
  /\bkubectl\s+exec\b.*\s+--\s+.*(rm|mv|cp|chmod|chown|kill|pkill|shutdown|reboot|dd|mkfs|fdisk)\b/i,

  // Git write operations
  /\bgit\s+(commit|push|merge|rebase|reset|checkout|stash|tag|branch\s+-[dD]|cherry-pick|revert|am|pull)\b/i,

  // File system write operations
  /\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln)\s+/i,
  /\b(cat|echo|printf)\s+.*[>|]/, // Redirects
  /\btee\s+/i,
  /\bsed\s+-i/i, // In-place sed

  // Package managers
  /\b(apt|apt-get|yum|dnf|brew|npm|yarn|pip|cargo)\s+(install|remove|uninstall|update|upgrade)\b/i,

  // Service management
  /\b(systemctl|service)\s+(start|stop|restart|enable|disable)\b/i,

  // Docker/container write operations
  /\bdocker\s+(rm|rmi|stop|kill|prune|system\s+prune)\b/i,
  /\bdocker-compose\s+(down|rm|stop)\b/i,

  // Helm write operations
  /\bhelm\s+(install|upgrade|uninstall|delete|rollback)\b/i,
];

function isWriteCommand(command: string): boolean {
  return WRITE_COMMAND_PATTERNS.some(pattern => pattern.test(command));
}

function filterSensitiveData(output: string): string {
  // Redact potential secrets, tokens, and passwords
  return output
    .replace(
      /(password|secret|token|key|credential)[\s:=]+["']?[^\s"'\n]+["']?/gi,
      "$1: [REDACTED]"
    )
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, "[REDACTED CERTIFICATE/KEY]");
}

export const cliTool = createTool({
  id: "cli",
  description: `Execute shell commands in the sandbox environment.
Use this to run any CLI commands including kubectl, grep, awk, jq, curl, etc.
Supports pipes and command chaining.

IMPORTANT: Write/modify commands require user approval before execution.
The tool will detect write operations and pause for confirmation.

Examples:
- List all pods: kubectl get pods -A
- Find pods by name: kubectl get pods -A | grep inventory
- Get logs with filtering: kubectl logs deployment/myapp -n prod --tail 100 | grep -i error
- Check resource usage: kubectl top pods -n default
- Describe and search: kubectl describe pod mypod | grep -A5 "Events"
- JSON processing: kubectl get pods -o json | jq '.items[].metadata.name'`,

  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    approvalToken: z.string().optional().describe("Approval token from user confirmation. Required for write operations."),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
    requiresApproval: z.boolean().optional(),
    command: z.string().optional(),
    approvalId: z.string().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  }),

  execute: async (inputData): Promise<CliOutput> => {
    const { command, approvalToken } = inputData;

    try {
      // Check if this is a write command
      if (isWriteCommand(command)) {
        // If token provided, validate it
        if (approvalToken) {
          const isValid = approvalStore.validateToken(command, approvalToken);
          if (!isValid) {
            // Invalid or expired token - request new approval
            const pending = approvalStore.requestApproval(command);
            return {
              success: false,
              output: "",
              requiresApproval: true,
              command: command,
              approvalId: pending.id,
              riskLevel: pending.riskLevel,
              error: `⚠️ APPROVAL TOKEN INVALID OR EXPIRED\n\nCommand: ${command}\nRisk Level: ${pending.riskLevel.toUpperCase()}\nApproval ID: ${pending.id}\n\nPlease wait for user to approve this operation. A new approval token will be provided.`,
            };
          }
          // Token valid - proceed with execution
        } else {
          // No token - request approval
          const pending = approvalStore.requestApproval(command);
          return {
            success: false,
            output: "",
            requiresApproval: true,
            command: command,
            approvalId: pending.id,
            riskLevel: pending.riskLevel,
            error: `⚠️ WRITE OPERATION DETECTED - APPROVAL REQUIRED\n\nCommand: ${command}\nRisk Level: ${pending.riskLevel.toUpperCase()}\nApproval ID: ${pending.id}\n\nThis command will modify state. Waiting for user approval...`,
          };
        }
      }

      const result = await execCommand(command);

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: result.stdout ? filterSensitiveData(result.stdout) : "",
          error: result.stderr || `Command failed with exit code ${result.exitCode}`,
        };
      }

      return {
        success: true,
        output: filterSensitiveData(result.stdout),
        error: result.stderr ? filterSensitiveData(result.stderr) : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
