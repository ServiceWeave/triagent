import type { PrometheusConfig } from "../../cli/config.js";

export interface PrometheusQueryResult {
  status: "success" | "error";
  data?: {
    resultType: "vector" | "matrix" | "scalar" | "string";
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
  error?: string;
  errorType?: string;
}

export interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: "firing" | "pending" | "inactive";
  activeAt: string;
  value: string;
}

export interface PrometheusTarget {
  labels: Record<string, string>;
  scrapePool: string;
  scrapeUrl: string;
  health: "up" | "down" | "unknown";
  lastScrape: string;
  lastError: string;
}

export class PrometheusClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(config: PrometheusConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.authToken = config.auth?.token;
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Prometheus API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async query(query: string, time?: string): Promise<PrometheusQueryResult> {
    const params: Record<string, string> = { query };
    if (time) {
      params.time = time;
    }
    return this.request<PrometheusQueryResult>("/api/v1/query", params);
  }

  async queryRange(
    query: string,
    start: string,
    end: string,
    step: string
  ): Promise<PrometheusQueryResult> {
    return this.request<PrometheusQueryResult>("/api/v1/query_range", {
      query,
      start,
      end,
      step,
    });
  }

  async getAlerts(): Promise<{ alerts: PrometheusAlert[] }> {
    const response = await this.request<{
      status: string;
      data: { alerts: PrometheusAlert[] };
    }>("/api/v1/alerts");
    return response.data;
  }

  async getTargets(): Promise<{ activeTargets: PrometheusTarget[] }> {
    const response = await this.request<{
      status: string;
      data: { activeTargets: PrometheusTarget[] };
    }>("/api/v1/targets");
    return response.data;
  }

  async getRules(): Promise<{ groups: Array<{ name: string; rules: unknown[] }> }> {
    const response = await this.request<{
      status: string;
      data: { groups: Array<{ name: string; rules: unknown[] }> };
    }>("/api/v1/rules");
    return response.data;
  }

  async getMetadata(metric?: string): Promise<Record<string, unknown[]>> {
    const params: Record<string, string> = {};
    if (metric) {
      params.metric = metric;
    }
    const response = await this.request<{
      status: string;
      data: Record<string, unknown[]>;
    }>("/api/v1/metadata", params);
    return response.data;
  }

  formatQueryResult(result: PrometheusQueryResult): string {
    if (result.status !== "success" || !result.data) {
      return `Error: ${result.error || "Unknown error"}`;
    }

    const lines: string[] = [];
    for (const item of result.data.result) {
      const labels = Object.entries(item.metric)
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");

      if (item.value) {
        const [timestamp, value] = item.value;
        lines.push(`{${labels}} => ${value} @${new Date(timestamp * 1000).toISOString()}`);
      } else if (item.values) {
        lines.push(`{${labels}}:`);
        for (const [timestamp, value] of item.values.slice(-5)) {
          lines.push(`  ${new Date(timestamp * 1000).toISOString()}: ${value}`);
        }
      }
    }

    return lines.join("\n") || "No data";
  }
}

// Singleton instance
let prometheusClient: PrometheusClient | null = null;

export function getPrometheusClient(): PrometheusClient | null {
  return prometheusClient;
}

export function initPrometheusClient(config?: PrometheusConfig): PrometheusClient | null {
  if (config) {
    prometheusClient = new PrometheusClient(config);
  }
  return prometheusClient;
}
