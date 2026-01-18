import { mkdir, readFile, writeFile, readdir, unlink, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type {
  InvestigationHistory,
  HistoryQueryOptions,
  HistoryStats,
  InvestigationEvent,
  ToolCallRecord,
} from "./types.js";

const HISTORY_DIR = join(homedir(), ".config", "triagent", "history");

export class InvestigationHistoryStore {
  private historyDir: string;
  private retentionDays: number;

  constructor(retentionDays: number = 30) {
    this.historyDir = HISTORY_DIR;
    this.retentionDays = retentionDays;
  }

  async init(): Promise<void> {
    await mkdir(this.historyDir, { recursive: true });
    await this.cleanupOldRecords();
  }

  private getFilePath(id: string): string {
    return join(this.historyDir, `${id}.json`);
  }

  async save(investigation: InvestigationHistory): Promise<void> {
    await mkdir(this.historyDir, { recursive: true });
    const filePath = this.getFilePath(investigation.id);
    const serialized = JSON.stringify(investigation, (key, value) => {
      if (value instanceof Date) {
        return { __type: "Date", value: value.toISOString() };
      }
      return value;
    }, 2);
    await writeFile(filePath, serialized, "utf-8");
  }

  async get(id: string): Promise<InvestigationHistory | null> {
    try {
      const filePath = this.getFilePath(id);
      const content = await readFile(filePath, "utf-8");
      return this.deserialize(content);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(id);
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(options: HistoryQueryOptions = {}): Promise<InvestigationHistory[]> {
    const {
      limit = 50,
      offset = 0,
      status,
      cluster,
      tags,
      startDate,
      endDate,
      searchQuery,
    } = options;

    try {
      const files = await readdir(this.historyDir);
      const investigations: InvestigationHistory[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const content = await readFile(join(this.historyDir, file), "utf-8");
        const investigation = this.deserialize(content);

        // Apply filters
        if (status && investigation.status !== status) continue;
        if (cluster && investigation.cluster !== cluster) continue;
        if (tags && tags.length > 0) {
          const hasAllTags = tags.every((tag) =>
            investigation.tags?.includes(tag)
          );
          if (!hasAllTags) continue;
        }
        if (startDate && investigation.startedAt < startDate) continue;
        if (endDate && investigation.startedAt > endDate) continue;
        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase();
          const matchesTitle = investigation.incident.title
            .toLowerCase()
            .includes(searchLower);
          const matchesDescription = investigation.incident.description
            .toLowerCase()
            .includes(searchLower);
          if (!matchesTitle && !matchesDescription) continue;
        }

        investigations.push(investigation);
      }

      // Sort by startedAt descending
      investigations.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

      // Apply pagination
      return investigations.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }

  async getStats(): Promise<HistoryStats> {
    const investigations = await this.list({ limit: 10000 });
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats: HistoryStats = {
      total: investigations.length,
      byStatus: {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
      },
      byCluster: {},
      averageDuration: 0,
      last24Hours: 0,
      last7Days: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;

    for (const inv of investigations) {
      stats.byStatus[inv.status]++;

      if (inv.cluster) {
        stats.byCluster[inv.cluster] = (stats.byCluster[inv.cluster] || 0) + 1;
      }

      if (inv.startedAt >= oneDayAgo) {
        stats.last24Hours++;
      }
      if (inv.startedAt >= sevenDaysAgo) {
        stats.last7Days++;
      }

      if (inv.completedAt && inv.startedAt) {
        totalDuration += inv.completedAt.getTime() - inv.startedAt.getTime();
        completedCount++;
      }
    }

    if (completedCount > 0) {
      stats.averageDuration = totalDuration / completedCount;
    }

    return stats;
  }

  async addEvent(
    investigationId: string,
    event: Omit<InvestigationEvent, "id" | "timestamp">
  ): Promise<void> {
    const investigation = await this.get(investigationId);
    if (!investigation) return;

    const newEvent: InvestigationEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    investigation.events.push(newEvent);
    await this.save(investigation);
  }

  async addToolCall(
    investigationId: string,
    toolCall: Omit<ToolCallRecord, "id" | "timestamp">
  ): Promise<void> {
    const investigation = await this.get(investigationId);
    if (!investigation) return;

    const newToolCall: ToolCallRecord = {
      ...toolCall,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    investigation.toolCalls.push(newToolCall);
    await this.save(investigation);
  }

  async updateStatus(
    investigationId: string,
    status: InvestigationHistory["status"],
    result?: InvestigationHistory["result"],
    rawResult?: string,
    error?: string
  ): Promise<void> {
    const investigation = await this.get(investigationId);
    if (!investigation) return;

    investigation.status = status;
    if (status === "completed" || status === "failed") {
      investigation.completedAt = new Date();
    }
    if (result) {
      investigation.result = result;
    }
    if (rawResult) {
      investigation.rawResult = rawResult;
    }
    if (error) {
      investigation.error = error;
    }

    await this.save(investigation);
  }

  private async cleanupOldRecords(): Promise<void> {
    try {
      const files = await readdir(this.historyDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = join(this.historyDir, file);
        const fileStat = await stat(filePath);

        if (fileStat.mtime < cutoffDate) {
          await unlink(filePath);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private deserialize(content: string): InvestigationHistory {
    return JSON.parse(content, (key, value) => {
      if (value && typeof value === "object" && value.__type === "Date") {
        return new Date(value.value);
      }
      return value;
    });
  }
}

// Singleton instance
let historyStore: InvestigationHistoryStore | null = null;

export function getHistoryStore(retentionDays?: number): InvestigationHistoryStore {
  if (!historyStore) {
    historyStore = new InvestigationHistoryStore(retentionDays);
  }
  return historyStore;
}

export async function initHistoryStore(retentionDays?: number): Promise<InvestigationHistoryStore> {
  const store = getHistoryStore(retentionDays);
  await store.init();
  return store;
}
