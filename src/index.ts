#!/usr/bin/env bun
// Load solid JSX plugin before any TSX imports
import "@opentui/solid/preload";

import { loadConfig } from "./config.js";
import { initSandboxFromConfig } from "./sandbox/bashlet.js";
import { createMastraInstance, buildIncidentPrompt, getDebuggerAgent } from "./mastra/index.js";
import { startWebhookServer } from "./server/webhook.js";
import {
  loadStoredConfig,
  saveStoredConfig,
  getConfigPath,
  maskApiKey,
  mergeConfigFromFile,
  type StoredConfig,
} from "./cli/config.js";
import type { AIProvider } from "./config.js";

interface CliArgs {
  command: "run" | "config" | "cluster";
  configAction?: "set" | "get" | "list" | "path" | "load";
  configKey?: string;
  configValue?: string;
  configFilePath?: string;
  clusterAction?: "add" | "remove" | "list" | "use" | "status";
  clusterName?: string;
  clusterContext?: string;
  clusterKubeConfig?: string;
  clusterEnvironment?: string;
  webhookOnly: boolean;
  incident: string | null;
  help: boolean;
  host: boolean;
  remote: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    command: "run",
    webhookOnly: false,
    incident: null,
    help: false,
    host: false,
    remote: null,
  };

  // Check for config subcommand
  if (args[0] === "config") {
    result.command = "config";
    result.configAction = args[1] as "set" | "get" | "list" | "path" | "load";
    if (result.configAction === "load") {
      result.configFilePath = args[2];
    } else {
      result.configKey = args[2];
      result.configValue = args[3];
    }
    return result;
  }

  // Check for cluster subcommand
  if (args[0] === "cluster") {
    result.command = "cluster";
    result.clusterAction = args[1] as "add" | "remove" | "list" | "use" | "status";

    // Parse cluster sub-command arguments
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--name" || arg === "-n") {
        result.clusterName = args[++i];
      } else if (arg === "--context" || arg === "-c") {
        result.clusterContext = args[++i];
      } else if (arg === "--kubeconfig" || arg === "-k") {
        result.clusterKubeConfig = args[++i];
      } else if (arg === "--environment" || arg === "-e") {
        result.clusterEnvironment = args[++i];
      } else if (!arg.startsWith("-")) {
        // Positional argument - cluster name
        result.clusterName = arg;
      }
    }
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
    } else if (arg === "--remote" || arg === "-r") {
      result.remote = args[++i] || null;
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
  triagent cluster <action> [options]

OPTIONS:
  -h, --help          Show this help message
  -w, --webhook-only  Run only the webhook server (no TUI)
  -i, --incident      Direct incident input (runs once and exits)
      --host          Run commands on host machine (no sandbox)
  -r, --remote        Run commands on remote server via SSH (user@host)

CONFIG COMMANDS:
  triagent config set <key> <value>  Set a configuration value
  triagent config get <key>          Get a configuration value
  triagent config list               List all configuration values
  triagent config path               Show config file path
  triagent config load <file>        Load configuration from a JSON file

CONFIG KEYS:
  aiProvider     - AI provider (openai, anthropic, google)
  aiModel        - Model ID (e.g., gpt-4o, claude-sonnet-4-20250514)
  apiKey         - API key for the provider
  baseUrl        - Custom API base URL (for proxies or local models)
  webhookPort    - Webhook server port (default: 3000)
  codebasePath   - Path to codebase (default: ./) - for single codebase
  kubeConfigPath - Kubernetes config path (default: ~/.kube)

  For multiple codebases, edit ~/.config/triagent/config.json directly:
    "codebasePaths": [
      { "name": "frontend", "path": "/path/to/frontend" },
      { "name": "backend", "path": "/path/to/backend" }
    ]
  Each codebase will be mounted at /workspace/<name> in the sandbox.

CLUSTER COMMANDS:
  triagent cluster add <name> --context <ctx>  Add a cluster
  triagent cluster remove <name>               Remove a cluster
  triagent cluster list                        List all clusters
  triagent cluster use <name>                  Set active cluster
  triagent cluster status [name]               Check cluster status

CLUSTER OPTIONS:
  -n, --name         Cluster name
  -c, --context      Kubernetes context name
  -k, --kubeconfig   Path to kubeconfig file
  -e, --environment  Environment (development, staging, production)

MODES:
  Interactive (default):
    Run with no arguments to start the interactive TUI.
    Enter incident descriptions and see real-time debugging output.

  Webhook Server:
    Use --webhook-only to start an HTTP server that accepts
    incident webhooks from alerting systems.

    Endpoints:
      POST /webhook/incident   - Submit an incident
      GET  /investigations/:id - Get investigation results
      GET  /history            - List investigation history
      GET  /history/:id        - Get investigation details
      GET  /history/stats      - Get investigation statistics
      GET  /health             - Health check

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

  # Run commands on a remote server via SSH
  triagent --remote user@debug-container.local

  # Multi-cluster management
  triagent cluster add prod --context prod-cluster -e production
  triagent cluster use prod
  triagent cluster status

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

import { initClusterManager, getClusterManager } from "./integrations/kubernetes/multi-cluster.js";
import type { ClusterConfig } from "./cli/config.js";

/** Parse remote target string: user@host[:port] */
function parseRemoteTarget(target: string): { user: string; host: string; port?: number } {
  let user = "root";
  let host = target;
  let port: number | undefined;

  if (target.includes("@")) {
    [user, host] = target.split("@");
  }
  if (host.includes(":")) {
    const parts = host.split(":");
    host = parts[0];
    port = parseInt(parts[1], 10);
  }

  return { user, host, port };
}

async function handleClusterCommand(args: CliArgs): Promise<void> {
  const config = await loadStoredConfig();
  const clusterManager = initClusterManager(config.clusters, config.activeCluster);

  switch (args.clusterAction) {
    case "add": {
      if (!args.clusterName) {
        console.error("Usage: triagent cluster add <name> --context <context>");
        process.exit(1);
      }
      const context = args.clusterContext || args.clusterName;
      const newCluster: ClusterConfig = {
        name: args.clusterName,
        context,
        kubeConfigPath: args.clusterKubeConfig,
        environment: args.clusterEnvironment as ClusterConfig["environment"],
      };

      await clusterManager.addCluster(newCluster);

      // Save to config
      config.clusters = config.clusters || [];
      config.clusters.push(newCluster);
      await saveStoredConfig(config);

      console.log(`✅ Added cluster: ${args.clusterName} (context: ${context})`);
      break;
    }
    case "remove": {
      if (!args.clusterName) {
        console.error("Usage: triagent cluster remove <name>");
        process.exit(1);
      }

      const removed = await clusterManager.removeCluster(args.clusterName);
      if (!removed) {
        console.error(`Cluster not found: ${args.clusterName}`);
        process.exit(1);
      }

      // Remove from config
      config.clusters = config.clusters?.filter((c) => c.name !== args.clusterName);
      if (config.activeCluster === args.clusterName) {
        config.activeCluster = undefined;
      }
      await saveStoredConfig(config);

      console.log(`✅ Removed cluster: ${args.clusterName}`);
      break;
    }
    case "list": {
      const clusters = clusterManager.listClusters();
      if (clusters.length === 0) {
        console.log("No clusters configured.");
        console.log("\nDiscover available contexts:");
        const discovered = await clusterManager.discoverClusters();
        if (discovered.length > 0) {
          console.log("\nAvailable Kubernetes contexts:");
          for (const c of discovered) {
            console.log(`  - ${c.context} (${c.server})`);
          }
          console.log("\nAdd a cluster with: triagent cluster add <name> --context <context>");
        } else {
          console.log("No Kubernetes contexts found.");
        }
      } else {
        console.log("Configured clusters:\n");
        for (const c of clusters) {
          const active = c.isActive ? " (active)" : "";
          const env = c.environment ? ` [${c.environment}]` : "";
          console.log(`  ${c.name}${active}${env}`);
          console.log(`    context: ${c.context}`);
          if (c.kubeConfigPath) {
            console.log(`    kubeconfig: ${c.kubeConfigPath}`);
          }
        }
      }
      break;
    }
    case "use": {
      if (!args.clusterName) {
        console.error("Usage: triagent cluster use <name>");
        process.exit(1);
      }

      const success = await clusterManager.setActiveCluster(args.clusterName);
      if (!success) {
        console.error(`Cluster not found: ${args.clusterName}`);
        process.exit(1);
      }

      // Save to config
      config.activeCluster = args.clusterName;
      await saveStoredConfig(config);

      console.log(`✅ Active cluster set to: ${args.clusterName}`);
      break;
    }
    case "status": {
      const clusterName = args.clusterName;
      if (clusterName) {
        const status = await clusterManager.checkClusterStatus(clusterName);
        console.log(`Cluster: ${status.name}`);
        console.log(`  Connected: ${status.connected ? "✅ Yes" : "❌ No"}`);
        if (status.connected) {
          console.log(`  Version: ${status.version}`);
          console.log(`  Nodes: ${status.nodeCount}`);
        }
        if (status.error) {
          console.log(`  Error: ${status.error}`);
        }
      } else {
        const clusters = clusterManager.listClusters();
        if (clusters.length === 0) {
          console.log("No clusters configured.");
        } else {
          console.log("Cluster status:\n");
          for (const c of clusters) {
            const status = await clusterManager.checkClusterStatus(c.name);
            const active = c.isActive ? " (active)" : "";
            const connected = status.connected ? "✅" : "❌";
            console.log(`  ${connected} ${c.name}${active}`);
            if (status.connected) {
              console.log(`      v${status.version}, ${status.nodeCount} nodes`);
            } else if (status.error) {
              console.log(`      Error: ${status.error}`);
            }
          }
        }
      }
      break;
    }
    default:
      console.error("Usage: triagent cluster <add|remove|list|use|status> [options]");
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
    case "load": {
      if (!args.configFilePath) {
        console.error("Usage: triagent config load <file>");
        process.exit(1);
      }
      try {
        const mergedConfig = await mergeConfigFromFile(args.configFilePath);
        console.log(`✅ Configuration loaded from ${args.configFilePath}`);
        console.log("\nMerged configuration:");
        for (const [key, value] of Object.entries(mergedConfig)) {
          if (value === undefined) continue;
          if (key === "apiKey") {
            console.log(`  ${key}: ${maskApiKey(String(value))}`);
          } else if (typeof value === "object") {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.error(`❌ File not found: ${args.configFilePath}`);
        } else if (error instanceof SyntaxError) {
          console.error(`❌ Invalid JSON in file: ${args.configFilePath}`);
        } else {
          console.error(`❌ Failed to load config: ${error}`);
        }
        process.exit(1);
      }
      break;
    }
    default:
      console.error("Usage: triagent config <set|get|list|path|load> [key] [value]");
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

  // Handle cluster command
  if (args.command === "cluster") {
    await handleClusterCommand(args);
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

  // Validate mutually exclusive options
  if (args.host && args.remote) {
    console.error("❌ Cannot use --host and --remote together");
    process.exit(1);
  }

  // Initialize sandbox and Mastra
  try {
    const sandboxOptions: {
      useHost?: boolean;
      backend?: "docker" | "ssh";
      ssh?: { host: string; user: string; port?: number };
    } = {};
    if (args.host) {
      sandboxOptions.useHost = true;
    } else if (args.remote) {
      const { user, host, port } = parseRemoteTarget(args.remote);
      sandboxOptions.backend = "ssh";
      sandboxOptions.ssh = { host, user, port };
    }

    await initSandboxFromConfig(config, sandboxOptions);
    await createMastraInstance(config);

    if (args.host) {
      console.log("⚠️  Running in host mode (no sandbox)\n");
    } else if (args.remote) {
      const { getRemoteInfo } = await import("./sandbox/bashlet.js");
      const info = getRemoteInfo();
      console.log(`🌐 Running in remote mode: ${args.remote}`);
      console.log(`   Workspace: ${info?.workdir} (session: ${info?.sessionId})\n`);
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
