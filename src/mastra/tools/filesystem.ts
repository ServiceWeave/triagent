import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readFile, listDir, execCommand } from "../../sandbox/bashlet.js";

const ALLOWED_OPERATIONS = ["read", "list", "search"] as const;

const FilesystemInputSchema = z.object({
  operation: z.enum(ALLOWED_OPERATIONS).describe("The file operation to perform"),
  path: z
    .string()
    .describe(
      "File or directory path relative to /workspace (the mounted codebase)"
    ),
  pattern: z
    .string()
    .optional()
    .describe("Search pattern for 'search' operation (grep-compatible regex)"),
  maxLines: z
    .number()
    .optional()
    .describe("Maximum lines to return for read operation (default: 500)"),
});

// Output type (no schema validation to allow error returns)
interface FilesystemOutput {
  success: boolean;
  content?: string;
  entries?: string[];
  error?: string;
}

function sanitizePath(path: string): string {
  // Ensure path stays within /workspace
  const cleanPath = path
    .replace(/\.\./g, "") // Remove parent directory references
    .replace(/^\/+/, "") // Remove leading slashes
    .replace(/\/+/g, "/"); // Normalize multiple slashes

  return `/workspace/${cleanPath}`;
}

export const filesystemTool = createTool({
  id: "filesystem",
  description: `Read files and list directories in the codebase.
Available operations:
- read: Read file contents (max 500 lines by default)
- list: List directory contents
- search: Search for pattern in files using grep

All paths are relative to the codebase root (/workspace).
Examples:
- Read a file: { operation: "read", path: "src/index.ts" }
- List directory: { operation: "list", path: "src/api" }
- Search for pattern: { operation: "search", path: "src", pattern: "async function" }
- Read with line limit: { operation: "read", path: "package.json", maxLines: 100 }`,

  inputSchema: FilesystemInputSchema,

  execute: async (inputData): Promise<FilesystemOutput> => {
    const { operation, path, pattern, maxLines = 500 } = inputData;
    const safePath = sanitizePath(path);

    try {
      switch (operation) {
        case "read": {
          const content = await readFile(safePath);
          const lines = content.split("\n");
          const truncated =
            lines.length > maxLines
              ? lines.slice(0, maxLines).join("\n") +
                `\n\n... [Truncated: showing ${maxLines} of ${lines.length} lines]`
              : content;

          return {
            success: true,
            content: truncated,
          };
        }

        case "list": {
          const entries = await listDir(safePath);
          return {
            success: true,
            entries,
          };
        }

        case "search": {
          if (!pattern) {
            return {
              success: false,
              error: "Pattern is required for search operation",
            };
          }

          // Use grep for searching
          const grepCommand = `grep -rn "${pattern.replace(/"/g, '\\"')}" "${safePath}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" | head -100`;

          const result = await execCommand(grepCommand);

          if (result.exitCode !== 0 && result.exitCode !== 1) {
            // grep returns 1 when no matches found
            return {
              success: false,
              error: result.stderr || "Search failed",
            };
          }

          return {
            success: true,
            content:
              result.stdout || "No matches found",
          };
        }

        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
