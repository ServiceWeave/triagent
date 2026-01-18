import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getElasticsearchClient } from "../../integrations/elasticsearch/client.js";
import { getLokiClient } from "../../integrations/loki/client.js";

export const logsTool = createTool({
  id: "logs",
  description: `Search and aggregate logs from centralized log systems (Elasticsearch or Loki).
Use this tool for:
- Searching logs beyond kubectl retention
- Cross-pod log correlation
- Historical log analysis
- Log aggregation and statistics

The query syntax depends on the configured log provider:
- Elasticsearch: Lucene query syntax (e.g., "error AND pod:myapp*")
- Loki: LogQL syntax (e.g., '{namespace="production"} |= "error"')`,
  inputSchema: z.object({
    operation: z.enum(["search", "tail", "aggregate"]).describe(
      "Operation: search (query logs), tail (recent logs), aggregate (group by field)"
    ),
    query: z.string().describe(
      "Search query. For ES use Lucene syntax, for Loki use LogQL"
    ),
    timeRange: z.object({
      start: z.string().describe("Start time (ISO 8601 or relative like '1h')"),
      end: z.string().optional().describe("End time (ISO 8601, 'now', or omit for current)"),
    }).optional().describe("Time range for search"),
    limit: z.number().default(100).describe("Maximum number of logs to return"),
    aggregateField: z.string().optional().describe("Field to aggregate by (for aggregate operation)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { operation, query, timeRange, limit, aggregateField } = context;

    try {
      const esClient = getElasticsearchClient();
      const lokiClient = getLokiClient();

      // Determine which client to use
      const client = esClient || lokiClient;
      const clientType = esClient ? "elasticsearch" : lokiClient ? "loki" : null;

      if (!client) {
        return {
          success: false,
          data: "",
          error: "No log provider configured. Set elasticsearch or loki in config.",
        };
      }

      switch (operation) {
        case "search": {
          if (clientType === "elasticsearch") {
            const logs = await esClient!.search({
              query,
              timeRange: timeRange ? {
                start: parseRelativeTime(timeRange.start),
                end: timeRange.end ? parseRelativeTime(timeRange.end) : undefined,
              } : undefined,
              limit,
            });

            return {
              success: true,
              data: logs.length > 0 ? esClient!.formatLogs(logs) : "No logs found",
              count: logs.length,
            };
          } else {
            const logs = await lokiClient!.query({
              query,
              start: timeRange?.start,
              end: timeRange?.end,
              limit,
            });

            return {
              success: true,
              data: logs.length > 0 ? lokiClient!.formatLogs(logs) : "No logs found",
              count: logs.length,
            };
          }
        }

        case "tail": {
          if (clientType === "elasticsearch") {
            // For ES, tail is just search with latest logs
            const logs = await esClient!.search({
              query,
              limit,
              sort: "desc",
            });

            return {
              success: true,
              data: logs.length > 0 ? esClient!.formatLogs(logs) : "No recent logs",
              count: logs.length,
            };
          } else {
            const logs = await lokiClient!.tail({
              query,
              limit,
            });

            return {
              success: true,
              data: logs.length > 0 ? lokiClient!.formatLogs(logs) : "No recent logs",
              count: logs.length,
            };
          }
        }

        case "aggregate": {
          if (!aggregateField) {
            return {
              success: false,
              data: "",
              error: "aggregateField is required for aggregate operation",
            };
          }

          if (clientType === "elasticsearch") {
            const aggregations = await esClient!.aggregate({
              query,
              field: aggregateField,
              timeRange: timeRange ? {
                start: parseRelativeTime(timeRange.start),
                end: timeRange.end ? parseRelativeTime(timeRange.end) : undefined,
              } : undefined,
            });

            const lines = [`Aggregation by ${aggregateField}:\n`];
            for (const agg of aggregations) {
              lines.push(`  ${agg.key}: ${agg.count} logs`);
            }

            return {
              success: true,
              data: lines.join("\n"),
              count: aggregations.length,
            };
          } else {
            // Loki doesn't have native aggregations, use label cardinality
            const series = await lokiClient!.getSeries([query]);
            const counts = new Map<string, number>();

            for (const s of series) {
              const value = s[aggregateField] || "unknown";
              counts.set(value, (counts.get(value) || 0) + 1);
            }

            const lines = [`Aggregation by ${aggregateField}:\n`];
            for (const [key, count] of counts) {
              lines.push(`  ${key}: ${count} streams`);
            }

            return {
              success: true,
              data: lines.join("\n"),
              count: counts.size,
            };
          }
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

function parseRelativeTime(timeStr: string): string {
  if (timeStr === "now") {
    return new Date().toISOString();
  }

  // If it's already ISO format, return as-is
  if (timeStr.includes("T") || timeStr.includes("-")) {
    return timeStr;
  }

  // Parse relative time like "1h", "30m", "2d"
  const match = timeStr.match(/^(\d+)([smhdw])$/);
  if (!match) {
    return timeStr;
  }

  const [, amount, unit] = match;
  const now = new Date();
  const ms = parseInt(amount, 10) * {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }[unit as "s" | "m" | "h" | "d" | "w"]!;

  return new Date(now.getTime() - ms).toISOString();
}
