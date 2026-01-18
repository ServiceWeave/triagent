import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AIProvider } from "../config.js";

export interface CodebaseEntry {
  name: string;
  path: string;
}

export interface ClusterConfig {
  name: string;
  context: string;
  kubeConfigPath?: string;
  environment?: "development" | "staging" | "production";
}

export interface PrometheusConfig {
  url: string;
  auth?: { token: string };
}

export interface GrafanaConfig {
  url: string;
  apiKey: string;
}

export interface ElasticsearchConfig {
  url: string;
  index: string;
  auth?: { apiKey: string };
}

export interface LokiConfig {
  url: string;
}

export interface CloudWatchConfig {
  region: string;
  logGroupPrefix?: string;
}

export interface SlackConfig {
  webhookUrl: string;
  botToken?: string;
  defaultChannel?: string;
}

export interface TeamsConfig {
  webhookUrl: string;
}

export interface RunbookConfig {
  paths: string[];
  gitRepos?: string[];
}

export interface CostAnalysisConfig {
  provider?: "aws" | "gcp" | "azure";
  hourlyRates?: {
    cpu: number;
    memory: number;
    storage: number;
  };
  businessImpact?: {
    revenuePerMinute?: number;
  };
}

export interface StoredConfig {
  aiProvider?: AIProvider;
  aiModel?: string;
  apiKey?: string;
  baseUrl?: string;
  webhookPort?: number;
  codebasePath?: string; // Deprecated: use codebasePaths instead
  codebasePaths?: CodebaseEntry[];
  kubeConfigPath?: string;

  // Phase 1: Foundation
  historyRetentionDays?: number;
  clusters?: ClusterConfig[];
  activeCluster?: string;

  // Phase 2: Observability
  prometheus?: PrometheusConfig;
  grafana?: GrafanaConfig;
  logProvider?: "elasticsearch" | "loki" | "cloudwatch";
  elasticsearch?: ElasticsearchConfig;
  loki?: LokiConfig;
  cloudwatch?: CloudWatchConfig;

  // Phase 3: Operations
  runbooks?: RunbookConfig;

  // Phase 4: Communication & Cost
  notifications?: {
    slack?: SlackConfig;
    teams?: TeamsConfig;
  };
  costAnalysis?: CostAnalysisConfig;
}

const CONFIG_DIR = join(homedir(), ".config", "triagent");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const TRIAGENT_MD_FILE = join(CONFIG_DIR, "TRIAGENT.md");
const RUNBOOK_MD_FILE = join(CONFIG_DIR, "RUNBOOK.md");

export async function getConfigPath(): Promise<string> {
  return CONFIG_FILE;
}

export async function getTriagentMdPath(): Promise<string> {
  return TRIAGENT_MD_FILE;
}

export async function loadTriagentMd(): Promise<string | null> {
  try {
    const content = await readFile(TRIAGENT_MD_FILE, "utf-8");
    return content.trim();
  } catch {
    return null;
  }
}

export async function loadRunbookMd(): Promise<string | null> {
  try {
    const content = await readFile(RUNBOOK_MD_FILE, "utf-8");
    return content.trim();
  } catch {
    return null;
  }
}

export async function getRunbookMdPath(): Promise<string> {
  return RUNBOOK_MD_FILE;
}

export async function loadStoredConfig(): Promise<StoredConfig> {
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function saveStoredConfig(config: StoredConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function setConfigValue(key: keyof StoredConfig, value: string | number): Promise<void> {
  const config = await loadStoredConfig();
  (config as Record<string, string | number>)[key] = value;
  await saveStoredConfig(config);
}

export async function getConfigValue(key: keyof StoredConfig): Promise<StoredConfig[keyof StoredConfig]> {
  const config = await loadStoredConfig();
  return config[key];
}

export async function deleteConfigValue(key: keyof StoredConfig): Promise<void> {
  const config = await loadStoredConfig();
  delete config[key];
  await saveStoredConfig(config);
}

export async function listConfig(): Promise<StoredConfig> {
  return loadStoredConfig();
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}
