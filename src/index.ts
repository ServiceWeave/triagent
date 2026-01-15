#!/usr/bin/env bun
// Load solid JSX plugin before any TSX imports
import { plugin } from "bun";
import solidPlugin from "@opentui/solid/bun-plugin";
plugin(solidPlugin);

import { loadConfig } from "./config.js";
import { initSandboxFromConfig } from "./sandbox/bashlet.js";
import { createMastraInstance, buildIncidentPrompt, getDebuggerAgent } from "./mastra/index.js";
import { startWebhookServer } from "./server/webhook.js";
import {
  loadStoredConfig,
  saveStoredConfig,
  getConfigPath,
  maskApiKey,
  type StoredConfig,
} from "./cli/config.js";
import type { AIProvider } from "./config.js";

interface CliArgs {
  command: "run" | "config";
  configAction?: "set" | "get" | "list" | "path";
  configKey?: string;
  configValue?: string;
  webhookOnly: boolean;
  incident: string | null;
  help: boolean;
  host: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    command: "run",
    webhookOnly: false,
    incident: null,
    help: false,
    host: false,
  };

  // Check for config subcommand
  if (args[0] === "config") {
    result.command = "config";
    result.configAction = args[1] as "set" | "get" | "list" | "path";
    result.configKey = args[2];
    result.configValue = args[3];
    return result;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--webhook-only" || arg === "-w") {
      result.webhookOnly = true;
    } else if (arg === "--incident" || arg === "-i") {
      result.incident = args[++i] || null;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--host") {
      result.host = true;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
🚨 TRIAGENT - AI Kubernetes Debugging Agent

USAGE:
  triagent [OPTIONS]
  triagent config <action> [key] [value]

OPTIONS:
  -h, --help          Show this help message
  -w, --webhook-only  Run only the webhook server (no TUI)
  -i, --incident      Direct incident input (runs once and exits)
      --host          Run commands on host machine (no sandbox)

CONFIG COMMANDS:
  triagent config set <key> <value>  Set a configuration value
  triagent config get <key>          Get a configuration value
  triagent config list               List all configuration values
  triagent config path               Show config file path

CONFIG KEYS:
  aiProvider     - AI provider (openai, anthropic, google)
  aiModel        - Model ID (e.g., gpt-4o, claude-sonnet-4-20250514)
  apiKey         - API key for the provider
  baseUrl        - Custom API base URL (for proxies or local models)
  webhookPort    - Webhook server port (default: 3000)
  codebasePath   - Path to codebase (default: ./)
  kubeConfigPath - Kubernetes config path (default: ~/.kube)

MODES:
  Interactive (default):
    Run with no arguments to start the interactive TUI.
    Enter incident descriptions and see real-time debugging output.

  Webhook Server:
    Use --webhook-only to start an HTTP server that accepts
    incident webhooks from alerting systems.

    Endpoints:
      POST /webhook/incident  - Submit an incident
      GET  /investigations/:id - Get investigation results
      GET  /health            - Health check

  Direct Input:
    Use --incident "description" for one-shot debugging.
    Example: triagent --incident "checkout pods crashing"

ENVIRONMENT VARIABLES:
  AI_PROVIDER              - AI provider (openai, anthropic, google)
  AI_MODEL                 - Model ID (e.g., gpt-4o, claude-3-5-sonnet)
  AI_BASE_URL              - Custom API base URL (for proxies or local models)
  OPENAI_API_KEY          - OpenAI API key
  ANTHROPIC_API_KEY       - Anthropic API key
  GOOGLE_GENERATIVE_AI_API_KEY - Google AI API key
  WEBHOOK_PORT            - Webhook server port (default: 3000)
  CODEBASE_PATH           - Path to codebase (default: ./)
  KUBE_CONFIG_PATH        - Kubernetes config path (default: ~/.kube)

EXAMPLES:
  # Interactive TUI mode
  triagent

  # Webhook server mode
  triagent --webhook-only

  # Direct incident investigation
  triagent -i "API gateway returning 503 errors"

  # Submit via curl (webhook mode)
  curl -X POST http://localhost:3000/webhook/incident \\
    -H "Content-Type: application/json" \\
    -d '{"title": "API Error", "description": "checkout not working", "severity": "critical"}'
`);
}

async function runDirectIncident(description: string): Promise<void> {
  console.log("🚨 TRIAGENT - Direct Investigation Mode\n");
  console.log(`Incident: ${description}\n`);
  console.log("Starting investigation...\n");
  console.log("─".repeat(60) + "\n");

  const agent = getDebuggerAgent();
  const prompt = buildIncidentPrompt({
    title: "Direct Investigation",
    description,
  });

  try {
    const stream = await agent.stream(prompt, {
      maxSteps: 20,
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          const toolCall = toolCalls[0];
          const toolName = "toolName" in toolCall ? toolCall.toolName : "tool";
          const args = "args" in toolCall ? toolCall.args : {};
          console.log(`\n[Tool: ${toolName}]`);
          if (args && typeof args === "object" && "command" in args) {
            console.log(`$ ${args.command}`);
          }
          console.log();
        }
      },
    });

    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }

    console.log("\n\n" + "─".repeat(60));
    console.log("✅ Investigation complete");
  } catch (error) {
    console.error("\n❌ Investigation failed:", error);
    process.exit(1);
  }
}

async function handleConfigCommand(args: CliArgs): Promise<void> {
  const validKeys: (keyof StoredConfig)[] = [
    "aiProvider",
    "aiModel",
    "apiKey",
    "baseUrl",
    "webhookPort",
    "codebasePath",
    "kubeConfigPath",
  ];

  switch (args.configAction) {
    case "set": {
      if (!args.configKey || args.configValue === undefined) {
        console.error("Usage: triagent config set <key> <value>");
        process.exit(1);
      }
      if (!validKeys.includes(args.configKey as keyof StoredConfig)) {
        console.error(`Invalid key: ${args.configKey}`);
        console.error(`Valid keys: ${validKeys.join(", ")}`);
        process.exit(1);
      }
      const config = await loadStoredConfig();
      let value: string | number = args.configValue;
      if (args.configKey === "webhookPort") {
        value = parseInt(args.configValue, 10);
      }
      (config as Record<string, string | number>)[args.configKey] = value;
      await saveStoredConfig(config);
      console.log(`✅ Set ${args.configKey}`);
      break;
    }
    case "get": {
      if (!args.configKey) {
        console.error("Usage: triagent config get <key>");
        process.exit(1);
      }
      const config = await loadStoredConfig();
      const value = config[args.configKey as keyof StoredConfig];
      if (value === undefined) {
        console.log(`${args.configKey}: (not set)`);
      } else if (args.configKey === "apiKey") {
        console.log(`${args.configKey}: ${maskApiKey(String(value))}`);
      } else {
        console.log(`${args.configKey}: ${value}`);
      }
      break;
    }
    case "list": {
      const config = await loadStoredConfig();
      console.log("Current configuration:\n");
      for (const key of validKeys) {
        const value = config[key];
        if (value === undefined) {
          console.log(`  ${key}: (not set)`);
        } else if (key === "apiKey") {
          console.log(`  ${key}: ${maskApiKey(String(value))}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      }
      break;
    }
    case "path": {
      const path = await getConfigPath();
      console.log(path);
      break;
    }
    default:
      console.error("Usage: triagent config <set|get|list|path> [key] [value]");
      process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Handle config command
  if (args.command === "config") {
    await handleConfigCommand(args);
    process.exit(0);
  }

  // Load configuration
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error("❌ Configuration error:", error);
    console.error("\nRun 'triagent config set apiKey <your-key>' to configure.");
    console.error("Or set environment variables (see --help for details).");
    process.exit(1);
  }

  // Initialize sandbox and Mastra
  try {
    initSandboxFromConfig(config, args.host);
    createMastraInstance(config);
    if (args.host) {
      console.log("⚠️  Running in host mode (no sandbox)\n");
    }
  } catch (error) {
    console.error("❌ Initialization error:", error);
    process.exit(1);
  }

  // Run in appropriate mode
  if (args.webhookOnly) {
    // Webhook server mode
    await startWebhookServer(config.webhookPort);
  } else if (args.incident) {
    // Direct incident mode
    await runDirectIncident(args.incident);
  } else {
    // Interactive TUI mode
    console.log("Starting Triagent TUI...\n");
    // Dynamic import to ensure solid plugin is loaded first
    const { runTUI } = await import("./tui/app.jsx");
    const tui = await runTUI();

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      tui.shutdown();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      tui.shutdown();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
