import type { ElasticsearchConfig } from "../../cli/config.js";

export interface ESSearchResult {
  hits: {
    total: { value: number; relation: string };
    hits: Array<{
      _index: string;
      _id: string;
      _source: Record<string, unknown>;
      sort?: unknown[];
    }>;
  };
  aggregations?: Record<string, unknown>;
}

export interface ESLogEntry {
  timestamp: string;
  message: string;
  level?: string;
  pod?: string;
  namespace?: string;
  container?: string;
  [key: string]: unknown;
}

export class ElasticsearchClient {
  private baseUrl: string;
  private index: string;
  private apiKey?: string;

  constructor(config: ElasticsearchConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.index = config.index;
    this.apiKey = config.auth?.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options?: Omit<RequestInit, 'body'> & { body?: unknown }
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `ApiKey ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Elasticsearch API error: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async search(options: {
    query: string;
    timeRange?: { start: string; end?: string };
    limit?: number;
    sort?: "asc" | "desc";
  }): Promise<ESLogEntry[]> {
    const { query, timeRange, limit = 100, sort = "desc" } = options;

    const must: unknown[] = [
      {
        query_string: {
          query,
          default_field: "message",
        },
      },
    ];

    if (timeRange) {
      const range: Record<string, string> = { gte: timeRange.start };
      if (timeRange.end) {
        range.lte = timeRange.end;
      }
      must.push({
        range: {
          "@timestamp": range,
        },
      });
    }

    const body = {
      query: {
        bool: { must },
      },
      size: limit,
      sort: [{ "@timestamp": { order: sort } }],
    };

    const result = await this.request<ESSearchResult>(`/${this.index}/_search`, {
      method: "POST",
      body,
    });

    return result.hits.hits.map((hit) => {
      const source = hit._source as Record<string, unknown>;
      const k8s = source.kubernetes as Record<string, unknown> | undefined;
      const k8sPod = k8s?.pod as Record<string, unknown> | undefined;
      const k8sContainer = k8s?.container as Record<string, unknown> | undefined;
      return {
        timestamp: (source["@timestamp"] as string) || new Date().toISOString(),
        message: (source.message as string) || JSON.stringify(source),
        level: source.level as string | undefined,
        pod: (k8sPod?.name || source.pod) as string | undefined,
        namespace: (k8s?.namespace || source.namespace) as string | undefined,
        container: (k8sContainer?.name || source.container) as string | undefined,
        ...source,
      };
    });
  }

  async aggregate(options: {
    query: string;
    field: string;
    timeRange?: { start: string; end?: string };
    interval?: string;
  }): Promise<Array<{ key: string; count: number }>> {
    const { query, field, timeRange, interval = "1m" } = options;

    const must: unknown[] = [
      {
        query_string: {
          query,
          default_field: "message",
        },
      },
    ];

    if (timeRange) {
      const range: Record<string, string> = { gte: timeRange.start };
      if (timeRange.end) {
        range.lte = timeRange.end;
      }
      must.push({
        range: {
          "@timestamp": range,
        },
      });
    }

    const body = {
      query: {
        bool: { must },
      },
      size: 0,
      aggs: {
        by_field: {
          terms: { field, size: 50 },
        },
        over_time: {
          date_histogram: {
            field: "@timestamp",
            fixed_interval: interval,
          },
        },
      },
    };

    const result = await this.request<{
      aggregations: {
        by_field: { buckets: Array<{ key: string; doc_count: number }> };
        over_time: { buckets: Array<{ key_as_string: string; doc_count: number }> };
      };
    }>(`/${this.index}/_search`, {
      method: "POST",
      body,
    });

    return result.aggregations.by_field.buckets.map((bucket) => ({
      key: bucket.key,
      count: bucket.doc_count,
    }));
  }

  formatLogs(logs: ESLogEntry[]): string {
    const lines: string[] = [];
    for (const log of logs) {
      const level = log.level ? `[${log.level.toUpperCase()}]` : "";
      const source = log.pod ? `${log.namespace}/${log.pod}` : "";
      const prefix = [log.timestamp, level, source].filter(Boolean).join(" ");
      lines.push(`${prefix}: ${log.message}`);
    }
    return lines.join("\n");
  }
}

// Singleton instance
let esClient: ElasticsearchClient | null = null;

export function getElasticsearchClient(): ElasticsearchClient | null {
  return esClient;
}

export function initElasticsearchClient(config?: ElasticsearchConfig): ElasticsearchClient | null {
  if (config) {
    esClient = new ElasticsearchClient(config);
  }
  return esClient;
}
