#!/usr/bin/env bun
import { loadConfig } from "./config.js";
import { initSandboxFromConfig } from "./sandbox/bashlet.js";
import { createMastraInstance, buildIncidentPrompt, getDebuggerAgent } from "./mastra/index.js";
import { runTUI } from "./tui/app.jsx";
import { startWebhookServer } from "./server/webhook.js";

interface CliArgs {
  webhookOnly: boolean;
  incident: string | null;
  help: boolean;
  host: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    webhookOnly: false,
    incident: null,
    help: false,
    host: false,
  };

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

OPTIONS:
  -h, --help          Show this help message
  -w, --webhook-only  Run only the webhook server (no TUI)
  -i, --incident      Direct incident input (runs once and exits)
      --host          Run commands on host machine (no sandbox)

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
          console.log(`\n[Tool: ${toolName}]\n`);
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

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("❌ Configuration error:", error);
    console.error("\nMake sure you have set up your .env file with API keys.");
    console.error("See .env.example for required variables.");
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
