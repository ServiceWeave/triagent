import type { LokiConfig } from "../../cli/config.js";

export interface LokiQueryResult {
  status: "success" | "error";
  data: {
    resultType: "streams" | "matrix" | "vector";
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>;
    }>;
  };
}

export interface LokiLogEntry {
  timestamp: string;
  message: string;
  labels: Record<string, string>;
}

export class LokiClient {
  private baseUrl: string;

  constructor(config: LokiConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
  }

  private async request<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Loki API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async query(options: {
    query: string;
    limit?: number;
    start?: string;
    end?: string;
    direction?: "forward" | "backward";
  }): Promise<LokiLogEntry[]> {
    const { query, limit = 100, start, end, direction = "backward" } = options;

    const params: Record<string, string> = {
      query,
      limit: String(limit),
      direction,
    };

    if (start) {
      params.start = this.toNanoTimestamp(start);
    }
    if (end) {
      params.end = this.toNanoTimestamp(end);
    }

    const result = await this.request<LokiQueryResult>("/loki/api/v1/query_range", params);

    const entries: LokiLogEntry[] = [];
    for (const stream of result.data.result) {
      for (const [timestamp, message] of stream.values) {
        entries.push({
          timestamp: this.fromNanoTimestamp(timestamp),
          message,
          labels: stream.stream,
        });
      }
    }

    // Sort by timestamp
    entries.sort((a, b) => {
      if (direction === "backward") {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    return entries;
  }

  async tail(options: {
    query: string;
    limit?: number;
    delayFor?: number;
  }): Promise<LokiLogEntry[]> {
    const { query, limit = 100, delayFor = 0 } = options;

    const params: Record<string, string> = {
      query,
      limit: String(limit),
    };

    if (delayFor > 0) {
      params.delay_for = String(delayFor);
    }

    const result = await this.request<LokiQueryResult>("/loki/api/v1/tail", params);

    const entries: LokiLogEntry[] = [];
    for (const stream of result.data.result) {
      for (const [timestamp, message] of stream.values) {
        entries.push({
          timestamp: this.fromNanoTimestamp(timestamp),
          message,
          labels: stream.stream,
        });
      }
    }

    return entries;
  }

  async getLabels(): Promise<string[]> {
    const result = await this.request<{ status: string; data: string[] }>("/loki/api/v1/labels");
    return result.data;
  }

  async getLabelValues(label: string): Promise<string[]> {
    const result = await this.request<{ status: string; data: string[] }>(
      `/loki/api/v1/label/${label}/values`
    );
    return result.data;
  }

  async getSeries(match: string[]): Promise<Array<Record<string, string>>> {
    const url = new URL(`${this.baseUrl}/loki/api/v1/series`);
    for (const m of match) {
      url.searchParams.append("match[]", m);
    }

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Loki API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { status: string; data: Array<Record<string, string>> };
    return result.data;
  }

  private toNanoTimestamp(time: string): string {
    // If already a nanosecond timestamp
    if (/^\d{19}$/.test(time)) {
      return time;
    }
    // Convert ISO string or relative time to nanoseconds
    const date = this.parseTime(time);
    return String(date.getTime() * 1_000_000);
  }

  private fromNanoTimestamp(nano: string): string {
    const ms = parseInt(nano, 10) / 1_000_000;
    return new Date(ms).toISOString();
  }

  private parseTime(time: string): Date {
    // Check for relative time like "1h", "30m", "2d"
    const match = time.match(/^(\d+)([smhdw])$/);
    if (match) {
      const [, amount, unit] = match;
      const now = new Date();
      const ms = parseInt(amount, 10) * {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
      }[unit as "s" | "m" | "h" | "d" | "w"]!;
      return new Date(now.getTime() - ms);
    }

    return new Date(time);
  }

  formatLogs(logs: LokiLogEntry[]): string {
    const lines: string[] = [];
    for (const log of logs) {
      const pod = log.labels.pod || log.labels.instance || "";
      const namespace = log.labels.namespace || "";
      const level = log.labels.level || "";

      const levelStr = level ? `[${level.toUpperCase()}]` : "";
      const source = namespace && pod ? `${namespace}/${pod}` : (pod || namespace);
      const prefix = [log.timestamp, levelStr, source].filter(Boolean).join(" ");
      lines.push(`${prefix}: ${log.message}`);
    }
    return lines.join("\n");
  }
}

// Singleton instance
let lokiClient: LokiClient | null = null;

export function getLokiClient(): LokiClient | null {
  return lokiClient;
}

export function initLokiClient(config?: LokiConfig): LokiClient | null {
  if (config) {
    lokiClient = new LokiClient(config);
  }
  return lokiClient;
}
