import { Hono } from "hono";
import { serve } from "bun";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  getDebuggerAgent,
  buildIncidentPrompt,
  type IncidentInput,
} from "../mastra/index.js";
import { createHistoryRoutes } from "./routes/history.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { getHistoryStore, type InvestigationHistory } from "../storage/index.js";

const IncidentRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["critical", "warning", "info"]).optional(),
  labels: z.record(z.string()).optional(),
});

interface Investigation {
  id: string;
  incident: IncidentInput;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
}

const investigations = new Map<string, Investigation>();

export function createWebhookServer() {
  const app = new Hono();
  const historyStore = getHistoryStore();

  // Mount history routes
  app.route("/history", createHistoryRoutes());

  // Mount notification routes
  app.route("/notifications", createNotificationRoutes());

  // Health check
  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Submit incident for investigation
  app.post("/webhook/incident", async (c) => {
    try {
      const body = await c.req.json();
      const parsed = IncidentRequestSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(
          {
            error: "Invalid request",
            details: parsed.error.errors,
          },
          400
        );
      }

      const incident = parsed.data;
      const investigationId = randomUUID();

      const investigation: Investigation = {
        id: investigationId,
        incident,
        status: "pending",
        startedAt: new Date(),
      };

      investigations.set(investigationId, investigation);

      // Start investigation in background
      runInvestigation(investigationId).catch((error) => {
        console.error(`Investigation ${investigationId} failed:`, error);
      });

      return c.json(
        {
          investigationId,
          status: "pending",
          message: "Investigation started",
        },
        202
      );
    } catch (error) {
      return c.json(
        {
          error: "Internal server error",
          message: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  });

  // Get investigation status/result
  app.get("/investigations/:id", (c) => {
    const id = c.req.param("id");
    const investigation = investigations.get(id);

    if (!investigation) {
      return c.json({ error: "Investigation not found" }, 404);
    }

    return c.json({
      id: investigation.id,
      status: investigation.status,
      incident: investigation.incident,
      startedAt: investigation.startedAt.toISOString(),
      completedAt: investigation.completedAt?.toISOString(),
      result: investigation.result,
      error: investigation.error,
    });
  });

  // List recent investigations
  app.get("/investigations", (c) => {
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const recent = Array.from(investigations.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((inv) => ({
        id: inv.id,
        status: inv.status,
        title: inv.incident.title,
        severity: inv.incident.severity,
        startedAt: inv.startedAt.toISOString(),
        completedAt: inv.completedAt?.toISOString(),
      }));

    return c.json({ investigations: recent });
  });

  return app;
}

async function runInvestigation(id: string): Promise<void> {
  const investigation = investigations.get(id);
  if (!investigation) return;

  investigation.status = "running";

  // Create persistent history record
  const historyStore = getHistoryStore();
  const historyRecord: InvestigationHistory = {
    id,
    incident: investigation.incident,
    status: "running",
    startedAt: investigation.startedAt,
    events: [],
    toolCalls: [],
  };
  await historyStore.save(historyRecord);

  try {
    const agent = getDebuggerAgent();
    const prompt = buildIncidentPrompt(investigation.incident);

    console.log(`[Investigation ${id}] Starting...`);
    console.log(`[Investigation ${id}] Incident: ${investigation.incident.title}`);

    const response = await agent.generate([
      { role: "user", content: prompt },
    ], {
      maxSteps: 20,
      onStepFinish: async ({ toolCalls }) => {
        if (toolCalls && toolCalls.length > 0) {
          const toolCall = toolCalls[0];
          const toolName = "toolName" in toolCall ? String(toolCall.toolName) : "tool";
          const args = "args" in toolCall ? toolCall.args : {};
          console.log(`[Investigation ${id}] Tool: ${toolName}`);
          if (args && typeof args === "object" && "command" in args) {
            console.log(`[Investigation ${id}] $ ${args.command}`);
          }

          // Record tool call in history
          await historyStore.addToolCall(id, {
            toolName,
            args: args as Record<string, unknown>,
          });
        }
      },
    });

    investigation.status = "completed";
    investigation.completedAt = new Date();
    investigation.result = response.text;

    // Update history with completion
    await historyStore.updateStatus(id, "completed", undefined, response.text);

    console.log(`[Investigation ${id}] Completed`);
  } catch (error) {
    investigation.status = "failed";
    investigation.completedAt = new Date();
    investigation.error = error instanceof Error ? error.message : String(error);

    // Update history with failure
    await historyStore.updateStatus(id, "failed", undefined, undefined, investigation.error);

    console.error(`[Investigation ${id}] Failed:`, investigation.error);
  }
}

export async function startWebhookServer(port: number): Promise<void> {
  const app = createWebhookServer();

  console.log(`🚨 Triagent webhook server starting on port ${port}...`);

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`✅ Webhook server running at http://localhost:${port}`);
  console.log(`   POST /webhook/incident - Submit an incident`);
  console.log(`   GET  /investigations/:id - Get investigation status`);
  console.log(`   GET  /investigations - List recent investigations`);
  console.log(`   GET  /health - Health check`);
}
