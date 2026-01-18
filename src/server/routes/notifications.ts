import { Hono } from "hono";
import { z } from "zod";
import { getSlackClient } from "../../integrations/slack/client.js";
import { getTeamsClient } from "../../integrations/teams/client.js";
import { getHistoryStore } from "../../storage/index.js";

const InvestigationNotificationSchema = z.object({
  investigationId: z.string(),
  channel: z.string().optional(),
  includeDetails: z.boolean().default(true),
});

const AlertNotificationSchema = z.object({
  name: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  message: z.string(),
  source: z.string().optional(),
  channel: z.string().optional(),
});

const CustomMessageSchema = z.object({
  text: z.string(),
  channel: z.string().optional(),
});

export function createNotificationRoutes() {
  const app = new Hono();

  // Send investigation summary to Slack
  app.post("/slack/investigation", async (c) => {
    try {
      const slackClient = getSlackClient();
      if (!slackClient) {
        return c.json({ error: "Slack not configured" }, 400);
      }

      const body = await c.req.json();
      const parsed = InvestigationNotificationSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.errors }, 400);
      }

      const { investigationId, channel, includeDetails } = parsed.data;
      const historyStore = getHistoryStore();
      const investigation = await historyStore.get(investigationId);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      const message = slackClient.buildInvestigationMessage({
        id: investigation.id,
        title: investigation.incident.title,
        status: investigation.status,
        summary: investigation.result?.summary,
        severity: investigation.incident.severity,
        rootCause: includeDetails ? investigation.result?.rootCause : undefined,
        recommendations: includeDetails
          ? investigation.result?.recommendations?.map((r) => r.action)
          : undefined,
      });

      if (channel) {
        message.channel = channel;
      }

      const result = await slackClient.sendMessage(message);

      if (result.ok) {
        return c.json({ success: true, ts: result.ts, channel: result.channel });
      } else {
        return c.json({ error: result.error || "Failed to send message" }, 500);
      }
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Send alert to Slack
  app.post("/slack/alert", async (c) => {
    try {
      const slackClient = getSlackClient();
      if (!slackClient) {
        return c.json({ error: "Slack not configured" }, 400);
      }

      const body = await c.req.json();
      const parsed = AlertNotificationSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.errors }, 400);
      }

      const message = slackClient.buildAlertMessage({
        ...parsed.data,
        timestamp: new Date(),
      });

      if (parsed.data.channel) {
        message.channel = parsed.data.channel;
      }

      const result = await slackClient.sendMessage(message);

      if (result.ok) {
        return c.json({ success: true, ts: result.ts });
      } else {
        return c.json({ error: result.error || "Failed to send message" }, 500);
      }
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Send custom message to Slack
  app.post("/slack/message", async (c) => {
    try {
      const slackClient = getSlackClient();
      if (!slackClient) {
        return c.json({ error: "Slack not configured" }, 400);
      }

      const body = await c.req.json();
      const parsed = CustomMessageSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.errors }, 400);
      }

      const result = await slackClient.sendMessage({
        text: parsed.data.text,
        channel: parsed.data.channel,
      });

      if (result.ok) {
        return c.json({ success: true, ts: result.ts });
      } else {
        return c.json({ error: result.error || "Failed to send message" }, 500);
      }
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Send investigation summary to Teams
  app.post("/teams/investigation", async (c) => {
    try {
      const teamsClient = getTeamsClient();
      if (!teamsClient) {
        return c.json({ error: "Teams not configured" }, 400);
      }

      const body = await c.req.json();
      const parsed = InvestigationNotificationSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.errors }, 400);
      }

      const { investigationId, includeDetails } = parsed.data;
      const historyStore = getHistoryStore();
      const investigation = await historyStore.get(investigationId);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      const message = teamsClient.buildInvestigationMessage({
        id: investigation.id,
        title: investigation.incident.title,
        status: investigation.status,
        summary: investigation.result?.summary,
        severity: investigation.incident.severity,
        rootCause: includeDetails ? investigation.result?.rootCause : undefined,
        recommendations: includeDetails
          ? investigation.result?.recommendations?.map((r) => r.action)
          : undefined,
      });

      const success = await teamsClient.sendMessage(message);

      if (success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: "Failed to send message" }, 500);
      }
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Send alert to Teams
  app.post("/teams/alert", async (c) => {
    try {
      const teamsClient = getTeamsClient();
      if (!teamsClient) {
        return c.json({ error: "Teams not configured" }, 400);
      }

      const body = await c.req.json();
      const parsed = AlertNotificationSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.errors }, 400);
      }

      const message = teamsClient.buildAlertMessage({
        ...parsed.data,
        timestamp: new Date(),
      });

      const success = await teamsClient.sendMessage(message);

      if (success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: "Failed to send message" }, 500);
      }
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  return app;
}
