import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execCommand } from "../../sandbox/bashlet.js";

const ALLOWED_COMMANDS = ["get", "describe", "logs", "top", "events"] as const;

const KubectlInputSchema = z.object({
  command: z.enum(ALLOWED_COMMANDS).describe("The kubectl command to run"),
  resource: z
    .string()
    .optional()
    .describe(
      "Resource type (e.g., pods, deployments, services, configmaps, secrets)"
    ),
  name: z.string().optional().describe("Specific resource name"),
  namespace: z
    .string()
    .optional()
    .describe("Kubernetes namespace (defaults to current context namespace)"),
  flags: z
    .array(z.string())
    .optional()
    .describe(
      "Additional flags (e.g., ['-o', 'yaml'], ['--tail', '100'], ['-l', 'app=myapp'])"
    ),
});

// Output type (no schema validation to allow error returns)
interface KubectlOutput {
  success: boolean;
  output: string;
  error?: string;
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

export const kubectlTool = createTool({
  id: "kubectl",
  description: `Execute kubectl commands to inspect Kubernetes resources.
Available commands: ${ALLOWED_COMMANDS.join(", ")}.
Use this to get information about pods, deployments, services, logs, and cluster events.
Examples:
- Get all pods: { command: "get", resource: "pods", flags: ["-A"] }
- Get pod logs: { command: "logs", name: "my-pod", namespace: "default", flags: ["--tail", "100"] }
- Describe deployment: { command: "describe", resource: "deployment", name: "my-app" }
- Get events: { command: "events", namespace: "production", flags: ["--sort-by", ".lastTimestamp"] }`,

  inputSchema: KubectlInputSchema,

  execute: async (inputData): Promise<KubectlOutput> => {
    const { command, resource, name, namespace, flags } = inputData;

    // Build kubectl command
    const parts = ["kubectl", command];

    if (resource) {
      parts.push(resource);
    }

    if (name) {
      parts.push(name);
    }

    if (namespace) {
      parts.push("-n", namespace);
    }

    if (flags && flags.length > 0) {
      parts.push(...flags);
    }

    const fullCommand = parts.join(" ");

    try {
      const result = await execCommand(fullCommand);

      if (result.exitCode !== 0) {
        return {
          success: false,
          output: "",
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
