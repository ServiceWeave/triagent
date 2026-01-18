import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getRunbookIndexer } from "../../storage/runbook-index.js";
import { readFile } from "fs/promises";

export const runbookTool = createTool({
  id: "runbook",
  description: `Search and retrieve runbooks and SOPs (Standard Operating Procedures).
Use this tool to:
- Find relevant runbooks by symptoms or keywords
- Look up established procedures for common issues
- Get step-by-step remediation guides

Runbooks are indexed from configured paths and searched using TF-IDF similarity.
Configure runbook paths in triagent config.`,
  inputSchema: z.object({
    operation: z.enum(["search", "get", "list", "index"]).describe(
      "Operation: search (find by query), get (read specific runbook), list (show all), index (re-index runbooks)"
    ),
    query: z.string().optional().describe("Search query for finding runbooks"),
    symptoms: z.array(z.string()).optional().describe("List of symptoms to match against runbooks"),
    tags: z.array(z.string()).optional().describe("Filter runbooks by tags"),
    runbookId: z.string().optional().describe("Specific runbook ID to retrieve"),
    limit: z.number().default(5).describe("Maximum number of results to return"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    runbooks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      tags: z.array(z.string()),
      excerpt: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (async ({ operation, query, symptoms, tags, runbookId, limit }: any) => {

    try {
      const indexer = getRunbookIndexer();

      switch (operation) {
        case "search": {
          let results;

          if (symptoms && symptoms.length > 0) {
            results = indexer.searchBySymptoms(symptoms, limit);
          } else if (query) {
            results = indexer.search(query, limit);
          } else if (tags && tags.length > 0) {
            results = indexer.getByTags(tags).slice(0, limit);
          } else {
            return {
              success: false,
              data: "",
              error: "Query, symptoms, or tags required for search",
            };
          }

          if (results.length === 0) {
            return {
              success: true,
              data: "No matching runbooks found",
              runbooks: [],
            };
          }

          const lines: string[] = [`Found ${results.length} runbook(s):\n`];
          const runbooks = results.map((r) => {
            const excerpt = r.content.slice(0, 200).replace(/\n/g, " ") + "...";
            lines.push(`📖 ${r.title}`);
            lines.push(`   Path: ${r.path}`);
            lines.push(`   Tags: ${r.tags.join(", ") || "none"}`);
            lines.push(`   ${excerpt}\n`);

            return {
              id: r.id,
              title: r.title,
              path: r.path,
              tags: r.tags,
              excerpt,
            };
          });

          return {
            success: true,
            data: lines.join("\n"),
            runbooks,
          };
        }

        case "get": {
          if (!runbookId) {
            return {
              success: false,
              data: "",
              error: "runbookId is required for get operation",
            };
          }

          // Decode the runbook ID to get the path
          const path = Buffer.from(runbookId, "base64").toString("utf-8");

          try {
            const content = await readFile(path, "utf-8");
            return {
              success: true,
              data: content,
            };
          } catch {
            return {
              success: false,
              data: "",
              error: `Runbook not found at path: ${path}`,
            };
          }
        }

        case "list": {
          const stats = indexer.getStats();

          if (stats.totalRunbooks === 0) {
            return {
              success: true,
              data: "No runbooks indexed. Configure runbook paths and run 'index' operation.",
              runbooks: [],
            };
          }

          // Get all runbooks (with optional tag filter)
          let allRunbooks = tags && tags.length > 0
            ? indexer.getByTags(tags)
            : indexer.search("*", 100); // Get all via broad search

          // If broad search returns nothing, the index might be empty or need different approach
          if (allRunbooks.length === 0) {
            allRunbooks = indexer.searchBySymptoms(["error", "issue", "problem"], 100);
          }

          const lines: string[] = [
            `Runbook Index Stats:`,
            `  Total runbooks: ${stats.totalRunbooks}`,
            `  Last indexed: ${stats.lastIndexed.toISOString()}`,
            `\nRunbooks:\n`,
          ];

          const runbooks = allRunbooks.slice(0, limit).map((r) => {
            lines.push(`📖 ${r.title}`);
            lines.push(`   Tags: ${r.tags.join(", ") || "none"}`);

            return {
              id: r.id,
              title: r.title,
              path: r.path,
              tags: r.tags,
            };
          });

          return {
            success: true,
            data: lines.join("\n"),
            runbooks,
          };
        }

        case "index": {
          return {
            success: true,
            data: "Runbook indexing should be triggered via CLI or startup. Use 'triagent config' to set runbook paths.",
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
  }) as any,
});
