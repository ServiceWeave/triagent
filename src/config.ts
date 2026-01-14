import { z } from "zod";
import { resolve } from "path";
import { homedir } from "os";

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

function getApiKey(provider: AIProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY || "";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || "";
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
  }
}

export function loadConfig(): Config {
  const provider = (process.env.AI_PROVIDER || "anthropic") as AIProvider;

  const rawConfig = {
    aiProvider: provider,
    aiModel: process.env.AI_MODEL || getDefaultModel(provider),
    apiKey: getApiKey(provider),
    webhookPort: parseInt(process.env.WEBHOOK_PORT || "3000", 10),
    codebasePath: expandPath(process.env.CODEBASE_PATH || "./"),
    kubeConfigPath: expandPath(process.env.KUBE_CONFIG_PATH || "~/.kube"),
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
