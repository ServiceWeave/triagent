import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { execCommand } from "../../sandbox/bashlet.js";

const ALLOWED_COMMANDS = ["log", "diff", "show", "blame"] as const;

const GitInputSchema = z.object({
  command: z.enum(ALLOWED_COMMANDS).describe("The git command to run (read-only)"),
  args: z
    .array(z.string())
    .optional()
    .describe(
      "Command arguments (e.g., ['--oneline', '-n', '20'] for log, ['HEAD~5..HEAD'] for diff)"
    ),
  path: z.string().optional().describe("File or directory path to operate on"),
});

// Output type (no schema validation to allow error returns)
interface GitOutput {
  success: boolean;
  output: string;
  error?: string;
}

export const gitTool = createTool({
  id: "git",
  description: `Execute read-only git commands to analyze repository history and changes.
Available commands: ${ALLOWED_COMMANDS.join(", ")}.
Use this to investigate recent changes that might have caused issues.
Examples:
- Recent commits: { command: "log", args: ["--oneline", "-n", "20"] }
- Changes in last 5 commits: { command: "diff", args: ["HEAD~5..HEAD"] }
- Show specific commit: { command: "show", args: ["abc123"] }
- Blame a file: { command: "blame", path: "src/app.ts" }
- Log for specific file: { command: "log", args: ["-p", "-n", "5", "--"], path: "src/api/handler.ts" }`,

  inputSchema: GitInputSchema,

  execute: async (inputData): Promise<GitOutput> => {
    const { command, args, path } = inputData;

    // Build git command
    const parts = ["git", command];

    if (args && args.length > 0) {
      parts.push(...args);
    }

    if (path) {
      // Ensure path separator for git commands that need it
      if (command === "log" && !args?.includes("--")) {
        parts.push("--");
      }
      parts.push(path);
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
        output: result.stdout,
        error: result.stderr || undefined,
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
