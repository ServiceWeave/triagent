import type { IncidentInput, InvestigationResult } from "../mastra/agents/debugger.js";

export interface InvestigationEvent {
  id: string;
  timestamp: Date;
  type: "tool_call" | "alert" | "k8s_event" | "log_entry" | "user_action";
  source: string;
  data: Record<string, unknown>;
}

export interface InvestigationHistory {
  id: string;
  incident: IncidentInput;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  result?: InvestigationResult;
  rawResult?: string;
  error?: string;
  cluster?: string;
  events: InvestigationEvent[];
  toolCalls: ToolCallRecord[];
  tags?: string[];
}

export interface ToolCallRecord {
  id: string;
  timestamp: Date;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  duration?: number;
  error?: string;
}

export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  status?: InvestigationHistory["status"];
  cluster?: string;
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
  searchQuery?: string;
}

export interface HistoryStats {
  total: number;
  byStatus: Record<InvestigationHistory["status"], number>;
  byCluster: Record<string, number>;
  averageDuration: number;
  last24Hours: number;
  last7Days: number;
}

export interface RunbookEntry {
  id: string;
  path: string;
  title: string;
  content: string;
  tags: string[];
  symptoms: string[];
  lastModified: Date;
  tfidfVector?: Record<string, number>;
}

export interface RunbookIndex {
  entries: RunbookEntry[];
  vocabulary: string[];
  idfValues: Record<string, number>;
  lastIndexed: Date;
}
