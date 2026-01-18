import type { GrafanaConfig } from "../../cli/config.js";

export interface GrafanaDashboard {
  id: number;
  uid: string;
  title: string;
  url: string;
  tags: string[];
  folderTitle?: string;
}

export interface GrafanaAnnotation {
  id: number;
  dashboardId: number;
  panelId: number;
  time: number;
  timeEnd?: number;
  text: string;
  tags: string[];
}

export interface GrafanaAlert {
  id: number;
  uid: string;
  title: string;
  state: "alerting" | "pending" | "ok" | "paused" | "no_data";
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export class GrafanaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: GrafanaConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit & { params?: Record<string, string> }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };

    const response = await fetch(url.toString(), {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    if (!response.ok) {
      throw new Error(`Grafana API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async searchDashboards(query?: string, tags?: string[]): Promise<GrafanaDashboard[]> {
    const params: Record<string, string> = { type: "dash-db" };
    if (query) {
      params.query = query;
    }
    if (tags && tags.length > 0) {
      params.tag = tags.join(",");
    }

    return this.request<GrafanaDashboard[]>("/api/search", { params });
  }

  async getDashboard(uid: string): Promise<{
    dashboard: Record<string, unknown>;
    meta: Record<string, unknown>;
  }> {
    return this.request(`/api/dashboards/uid/${uid}`);
  }

  async getAnnotations(options?: {
    from?: number;
    to?: number;
    dashboardId?: number;
    tags?: string[];
  }): Promise<GrafanaAnnotation[]> {
    const params: Record<string, string> = {};
    if (options?.from) {
      params.from = String(options.from);
    }
    if (options?.to) {
      params.to = String(options.to);
    }
    if (options?.dashboardId) {
      params.dashboardId = String(options.dashboardId);
    }
    if (options?.tags && options.tags.length > 0) {
      params.tags = options.tags.join(",");
    }

    return this.request<GrafanaAnnotation[]>("/api/annotations", { params });
  }

  async createAnnotation(annotation: {
    dashboardId?: number;
    panelId?: number;
    time: number;
    timeEnd?: number;
    text: string;
    tags?: string[];
  }): Promise<{ id: number; message: string }> {
    return this.request("/api/annotations", {
      method: "POST",
      body: JSON.stringify(annotation),
    });
  }

  async getAlerts(): Promise<GrafanaAlert[]> {
    return this.request<GrafanaAlert[]>("/api/alerting/alerts");
  }

  async getAlertRules(): Promise<{ rules: unknown[] }> {
    return this.request("/api/ruler/grafana/api/v1/rules");
  }

  async getDatasources(): Promise<Array<{
    id: number;
    uid: string;
    name: string;
    type: string;
    url: string;
  }>> {
    return this.request("/api/datasources");
  }

  async queryDatasource(
    datasourceUid: string,
    query: Record<string, unknown>
  ): Promise<unknown> {
    return this.request("/api/ds/query", {
      method: "POST",
      body: JSON.stringify({
        queries: [{ ...query, datasourceId: datasourceUid }],
      }),
    });
  }

  getDashboardUrl(uid: string): string {
    return `${this.baseUrl}/d/${uid}`;
  }

  getPanelUrl(dashboardUid: string, panelId: number, options?: {
    from?: string;
    to?: string;
  }): string {
    let url = `${this.baseUrl}/d/${dashboardUid}?viewPanel=${panelId}`;
    if (options?.from) {
      url += `&from=${options.from}`;
    }
    if (options?.to) {
      url += `&to=${options.to}`;
    }
    return url;
  }
}

// Singleton instance
let grafanaClient: GrafanaClient | null = null;

export function getGrafanaClient(): GrafanaClient | null {
  return grafanaClient;
}

export function initGrafanaClient(config?: GrafanaConfig): GrafanaClient | null {
  if (config) {
    grafanaClient = new GrafanaClient(config);
  }
  return grafanaClient;
}
