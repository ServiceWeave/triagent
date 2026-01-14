import { z } from "zod";
import { resolve } from "path";
import { homedir } from "os";
import { loadStoredConfig, type StoredConfig } from "./cli/config.js";

const AIProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type AIProvider = z.infer<typeof AIProviderSchema>;

const ConfigSchema = z.object({
  aiProvider: AIProviderSchema,
  aiModel: z.string().min(1),
  apiKey: z.string().min(1),
  webhookPort: z.number().int().positive().default(3000),
  codebasePath: z.string().min(1).default("./"),
  kubeConfigPath: z.string().min(1).default("~/.kube"),
});

export type Config = z.infer<typeof ConfigSchema>;

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

function getApiKey(provider: AIProvider, stored: StoredConfig): string {
  // Check stored config first, then env vars
  if (stored.apiKey) return stored.apiKey;

  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || "";
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  }
}

export async function loadConfig(): Promise<Config> {
  const stored = await loadStoredConfig();

  const provider = (process.env.AI_PROVIDER || stored.aiProvider || "anthropic") as AIProvider;

  const rawConfig = {
    aiProvider: provider,
    aiModel: process.env.AI_MODEL || stored.aiModel || getDefaultModel(provider),
    apiKey: getApiKey(provider, stored),
    webhookPort: parseInt(process.env.WEBHOOK_PORT || String(stored.webhookPort || 3000), 10),
    codebasePath: expandPath(process.env.CODEBASE_PATH || stored.codebasePath || "./"),
    kubeConfigPath: expandPath(process.env.KUBE_CONFIG_PATH || stored.kubeConfigPath || "~/.kube"),
  };

  const result = ConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

function getDefaultModel(provider: AIProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o";
    case "anthropic":
      return "claude-3-5-sonnet-20241022";
    case "google":
      return "gemini-1.5-pro";
  }
}

export function getModelConfig(config: Config) {
  const { aiProvider, aiModel } = config;

  switch (aiProvider) {
    case "openai":
      return {
        provider: "openai" as const,
        model: aiModel,
      };
    case "anthropic":
      return {
        provider: "anthropic" as const,
        model: aiModel,
      };
    case "google":
      return {
        provider: "google" as const,
        model: aiModel,
      };
  }
}
