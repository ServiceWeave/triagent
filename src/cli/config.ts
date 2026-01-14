import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AIProvider } from "../config.js";

export interface StoredConfig {
  aiProvider?: AIProvider;
  aiModel?: string;
  apiKey?: string;
  webhookPort?: number;
  codebasePath?: string;
  kubeConfigPath?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "triagent");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export async function getConfigPath(): Promise<string> {
  return CONFIG_FILE;
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

export async function getConfigValue(key: keyof StoredConfig): Promise<string | number | undefined> {
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
