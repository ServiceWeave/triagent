import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getPrometheusClient } from "../../integrations/prometheus/client.js";
import { getGrafanaClient } from "../../integrations/grafana/client.js";

export const prometheusTool = createTool({
  id: "prometheus",
  description: `Query Prometheus metrics and alerts. Use this tool to:
- Query current metric values with PromQL
- Query metric ranges over time
- Get active alerts
- Check scrape targets health

Example queries:
- CPU usage: container_cpu_usage_seconds_total{pod=~"myapp.*"}
- Memory: container_memory_usage_bytes{namespace="production"}
- Request rate: rate(http_requests_total[5m])
- Error rate: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`,
  inputSchema: z.object({
    operation: z.enum(["query", "query_range", "alerts", "targets", "dashboards"]).describe(
      "Operation: query (instant), query_range (time series), alerts (active alerts), targets (scrape health), dashboards (Grafana dashboards)"
    ),
    query: z.string().optional().describe("PromQL query for query/query_range operations"),
    start: z.string().optional().describe("Start time for query_range (ISO 8601 or relative like '1h')"),
    end: z.string().optional().describe("End time for query_range (ISO 8601 or 'now')"),
    step: z.string().optional().describe("Step interval for query_range (e.g., '1m', '5m')"),
    dashboardSearch: z.string().optional().describe("Search term for Grafana dashboards"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { operation, query, start, end, step, dashboardSearch } = context;

    try {
      const prometheusClient = getPrometheusClient();
      const grafanaClient = getGrafanaClient();

      switch (operation) {
        case "query": {
          if (!prometheusClient) {
            return {
              success: false,
              data: "",
              error: "Prometheus not configured. Set prometheus.url in config.",
            };
          }
          if (!query) {
            return { success: false, data: "", error: "Query is required for 'query' operation" };
          }
          const result = await prometheusClient.query(query);
          return {
            success: result.status === "success",
            data: prometheusClient.formatQueryResult(result),
            error: result.error,
          };
        }

        case "query_range": {
          if (!prometheusClient) {
            return {
              success: false,
              data: "",
              error: "Prometheus not configured. Set prometheus.url in config.",
            };
          }
          if (!query || !start || !end) {
            return {
              success: false,
              data: "",
              error: "Query, start, and end are required for 'query_range' operation",
            };
          }

          // Convert relative times to ISO format
          const startTime = parseRelativeTime(start);
          const endTime = end === "now" ? new Date().toISOString() : parseRelativeTime(end);
          const stepInterval = step || "1m";

          const result = await prometheusClient.queryRange(query, startTime, endTime, stepInterval);
          return {
            success: result.status === "success",
            data: prometheusClient.formatQueryResult(result),
            error: result.error,
          };
        }

        case "alerts": {
          if (!prometheusClient) {
            return {
              success: false,
              data: "",
              error: "Prometheus not configured. Set prometheus.url in config.",
            };
          }
          const alertsData = await prometheusClient.getAlerts();
          const alerts = alertsData.alerts || [];

          if (alerts.length === 0) {
            return { success: true, data: "No active alerts" };
          }

          const lines: string[] = [`Active alerts (${alerts.length}):\n`];
          for (const alert of alerts) {
            const labels = Object.entries(alert.labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(", ");
            lines.push(`[${alert.state.toUpperCase()}] {${labels}}`);
            if (alert.annotations.summary) {
              lines.push(`  Summary: ${alert.annotations.summary}`);
            }
            if (alert.annotations.description) {
              lines.push(`  Description: ${alert.annotations.description}`);
            }
            lines.push("");
          }

          return { success: true, data: lines.join("\n") };
        }

        case "targets": {
          if (!prometheusClient) {
            return {
              success: false,
              data: "",
              error: "Prometheus not configured. Set prometheus.url in config.",
            };
          }
          const targetsData = await prometheusClient.getTargets();
          const targets = targetsData.activeTargets || [];

          const grouped = new Map<string, typeof targets>();
          for (const target of targets) {
            const pool = target.scrapePool;
            if (!grouped.has(pool)) {
              grouped.set(pool, []);
            }
            grouped.get(pool)!.push(target);
          }

          const lines: string[] = [`Scrape targets (${targets.length} total):\n`];
          for (const [pool, poolTargets] of grouped) {
            const upCount = poolTargets.filter((t) => t.health === "up").length;
            lines.push(`${pool}: ${upCount}/${poolTargets.length} up`);
            for (const target of poolTargets) {
              const icon = target.health === "up" ? "✓" : "✗";
              lines.push(`  ${icon} ${target.scrapeUrl}`);
              if (target.lastError) {
                lines.push(`    Error: ${target.lastError}`);
              }
            }
            lines.push("");
          }

          return { success: true, data: lines.join("\n") };
        }

        case "dashboards": {
          if (!grafanaClient) {
            return {
              success: false,
              data: "",
              error: "Grafana not configured. Set grafana.url and grafana.apiKey in config.",
            };
          }
          const dashboards = await grafanaClient.searchDashboards(dashboardSearch);

          if (dashboards.length === 0) {
            return { success: true, data: "No dashboards found" };
          }

          const lines: string[] = [`Found ${dashboards.length} dashboards:\n`];
          for (const dash of dashboards) {
            const tags = dash.tags.length > 0 ? ` [${dash.tags.join(", ")}]` : "";
            const folder = dash.folderTitle ? ` (${dash.folderTitle})` : "";
            lines.push(`- ${dash.title}${folder}${tags}`);
            lines.push(`  URL: ${grafanaClient.getDashboardUrl(dash.uid)}`);
          }

          return { success: true, data: lines.join("\n") };
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
