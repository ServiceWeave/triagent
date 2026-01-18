import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";

const execAsync = promisify(exec);

// Store pending approvals with expiration
const pendingApprovals = new Map<string, {
  action: RemediationAction;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}>();

interface RemediationAction {
  type: "restart_pod" | "scale_deployment" | "rollback_deployment" | "delete_resource" | "apply_config";
  target: {
    kind: string;
    name: string;
    namespace: string;
  };
  parameters?: Record<string, unknown>;
}

function generateApprovalToken(): string {
  return randomBytes(16).toString("hex");
}

function getRiskLevel(action: RemediationAction): "low" | "medium" | "high" | "critical" {
  switch (action.type) {
    case "restart_pod":
      return "low";
    case "scale_deployment":
      return "medium";
    case "rollback_deployment":
      return "medium";
    case "delete_resource":
      return action.target.kind.toLowerCase() === "pod" ? "medium" : "high";
    case "apply_config":
      return "high";
    default:
      return "critical";
  }
}

function getActionDescription(action: RemediationAction): string {
  const target = `${action.target.kind}/${action.target.name} in ${action.target.namespace}`;

  switch (action.type) {
    case "restart_pod":
      return `Restart pod ${target}`;
    case "scale_deployment":
      const replicas = action.parameters?.replicas || "?";
      return `Scale ${target} to ${replicas} replicas`;
    case "rollback_deployment":
      const revision = action.parameters?.revision || "previous";
      return `Rollback ${target} to ${revision} revision`;
    case "delete_resource":
      return `Delete ${target}`;
    case "apply_config":
      return `Apply configuration to ${target}`;
    default:
      return `Unknown action on ${target}`;
  }
}

async function executeAction(action: RemediationAction): Promise<{ success: boolean; output: string }> {
  const { type, target, parameters } = action;
  const { kind, name, namespace } = target;

  let command: string;

  switch (type) {
    case "restart_pod":
      if (kind.toLowerCase() === "pod") {
        command = `kubectl delete pod ${name} -n ${namespace}`;
      } else if (kind.toLowerCase() === "deployment") {
        command = `kubectl rollout restart deployment/${name} -n ${namespace}`;
      } else {
        command = `kubectl rollout restart ${kind.toLowerCase()}/${name} -n ${namespace}`;
      }
      break;

    case "scale_deployment":
      const replicas = parameters?.replicas || 1;
      command = `kubectl scale ${kind.toLowerCase()}/${name} -n ${namespace} --replicas=${replicas}`;
      break;

    case "rollback_deployment":
      if (parameters?.revision) {
        command = `kubectl rollout undo ${kind.toLowerCase()}/${name} -n ${namespace} --to-revision=${parameters.revision}`;
      } else {
        command = `kubectl rollout undo ${kind.toLowerCase()}/${name} -n ${namespace}`;
      }
      break;

    case "delete_resource":
      command = `kubectl delete ${kind.toLowerCase()} ${name} -n ${namespace}`;
      break;

    case "apply_config":
      // For apply, the config should be provided in parameters
      if (!parameters?.config) {
        return { success: false, output: "No config provided for apply action" };
      }
      // This would need to write to a temp file and apply
      return { success: false, output: "Apply config not yet implemented" };

    default:
      return { success: false, output: `Unknown action type: ${type}` };
  }

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
    return {
      success: true,
      output: stdout + (stderr ? `\nWarnings: ${stderr}` : ""),
    };
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export const remediationTool = createTool({
  id: "remediation",
  description: `Execute remediation actions on Kubernetes resources with approval workflow.
Use this tool to:
- Suggest fixes based on diagnosis
- Execute approved remediation actions
- Rollback changes if needed

IMPORTANT: All destructive actions require user approval. The workflow is:
1. Call with operation="suggest" to propose an action
2. User reviews and approves (generates approval token)
3. Call with operation="execute" and the approval token

Available action types:
- restart_pod: Restart a pod (or rollout restart for deployments)
- scale_deployment: Change replica count
- rollback_deployment: Rollback to previous or specific revision
- delete_resource: Delete a resource (use with caution)`,
  inputSchema: z.object({
    operation: z.enum(["suggest", "execute", "rollback", "status"]).describe(
      "Operation: suggest (propose action), execute (run with approval), rollback (undo last action), status (check pending approvals)"
    ),
    action: z.object({
      type: z.enum(["restart_pod", "scale_deployment", "rollback_deployment", "delete_resource", "apply_config"]).describe("Type of remediation action"),
      target: z.object({
        kind: z.string().describe("Kubernetes resource kind (Pod, Deployment, etc.)"),
        name: z.string().describe("Resource name"),
        namespace: z.string().describe("Resource namespace"),
      }),
      parameters: z.record(z.unknown()).optional().describe("Action-specific parameters (e.g., replicas, revision)"),
    }).optional().describe("The remediation action to perform"),
    approvalToken: z.string().optional().describe("Approval token for executing actions"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    requiresApproval: z.boolean().optional(),
    approvalId: z.string().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { operation, action, approvalToken } = context;

    try {
      switch (operation) {
        case "suggest": {
          if (!action) {
            return {
              success: false,
              data: "",
              error: "Action is required for suggest operation",
            };
          }

          const riskLevel = getRiskLevel(action);
          const description = getActionDescription(action);
          const token = generateApprovalToken();
          const approvalId = randomBytes(8).toString("hex");

          // Store pending approval (expires in 10 minutes)
          pendingApprovals.set(approvalId, {
            action,
            token,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            createdAt: new Date(),
          });

          const riskEmoji = {
            low: "🟢",
            medium: "🟡",
            high: "🟠",
            critical: "🔴",
          }[riskLevel];

          return {
            success: true,
            data: `Suggested remediation action:

${riskEmoji} Risk Level: ${riskLevel.toUpperCase()}

Action: ${description}
Target: ${action.target.kind}/${action.target.name} in namespace ${action.target.namespace}
${action.parameters ? `Parameters: ${JSON.stringify(action.parameters)}` : ""}

To execute this action, approve it and call remediation with:
- operation: "execute"
- approvalToken: "${token}"

Approval ID: ${approvalId}
Expires: 10 minutes`,
            requiresApproval: true,
            approvalId,
            riskLevel,
          };
        }

        case "execute": {
          if (!approvalToken) {
            return {
              success: false,
              data: "",
              error: "Approval token is required to execute actions",
            };
          }

          // Find the pending approval with this token
          let foundApproval: { action: RemediationAction; approvalId: string } | null = null;

          for (const [approvalId, approval] of pendingApprovals) {
            if (approval.token === approvalToken) {
              if (new Date() > approval.expiresAt) {
                pendingApprovals.delete(approvalId);
                return {
                  success: false,
                  data: "",
                  error: "Approval token has expired. Please suggest the action again.",
                };
              }
              foundApproval = { action: approval.action, approvalId };
              break;
            }
          }

          if (!foundApproval) {
            return {
              success: false,
              data: "",
              error: "Invalid approval token. Please suggest the action first.",
            };
          }

          // Execute the action
          const result = await executeAction(foundApproval.action);

          // Remove the used approval
          pendingApprovals.delete(foundApproval.approvalId);

          if (result.success) {
            return {
              success: true,
              data: `✅ Action executed successfully:

${getActionDescription(foundApproval.action)}

Output:
${result.output}`,
            };
          } else {
            return {
              success: false,
              data: "",
              error: `Action failed: ${result.output}`,
            };
          }
        }

        case "rollback": {
          if (!action) {
            return {
              success: false,
              data: "",
              error: "Action with target is required for rollback",
            };
          }

          // For rollback, we create a rollback action
          const rollbackAction: RemediationAction = {
            type: "rollback_deployment",
            target: action.target,
            parameters: action.parameters,
          };

          const result = await executeAction(rollbackAction);

          if (result.success) {
            return {
              success: true,
              data: `✅ Rollback executed:

${getActionDescription(rollbackAction)}

Output:
${result.output}`,
            };
          } else {
            return {
              success: false,
              data: "",
              error: `Rollback failed: ${result.output}`,
            };
          }
        }

        case "status": {
          const pending = Array.from(pendingApprovals.entries())
            .filter(([, a]) => new Date() < a.expiresAt)
            .map(([id, a]) => ({
              id,
              action: getActionDescription(a.action),
              risk: getRiskLevel(a.action),
              expiresIn: Math.round((a.expiresAt.getTime() - Date.now()) / 1000 / 60),
            }));

          if (pending.length === 0) {
            return {
              success: true,
              data: "No pending approval requests",
            };
          }

          const lines = ["Pending approval requests:\n"];
          for (const p of pending) {
            lines.push(`ID: ${p.id}`);
            lines.push(`  Action: ${p.action}`);
            lines.push(`  Risk: ${p.risk}`);
            lines.push(`  Expires in: ${p.expiresIn} minutes\n`);
          }

          return {
            success: true,
            data: lines.join("\n"),
          };
        }

        default:
          return { success: false, data: "", error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      return {
        success: false,
        data: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
