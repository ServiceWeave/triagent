import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execCommand } from "../../sandbox/bashlet.js";

interface CliOutput {
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

export const cliTool = createTool({
  id: "cli",
  description: `Execute shell commands in the sandbox environment.
Use this to run any CLI commands including kubectl, grep, awk, jq, curl, etc.
Supports pipes and command chaining.

Examples:
- List all pods: kubectl get pods -A
- Find pods by name: kubectl get pods -A | grep inventory
- Get logs with filtering: kubectl logs deployment/myapp -n prod --tail 100 | grep -i error
- Check resource usage: kubectl top pods -n default
- Describe and search: kubectl describe pod mypod | grep -A5 "Events"
- JSON processing: kubectl get pods -o json | jq '.items[].metadata.name'`,

  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
  }),

  execute: async ({ command }): Promise<CliOutput> => {
    try {
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
