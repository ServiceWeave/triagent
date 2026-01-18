import type { SlackConfig } from "../../cli/config.js";

export interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  thread_ts?: string;
}

export interface SlackBlock {
  type: "section" | "divider" | "header" | "context" | "actions";
  text?: { type: "mrkdwn" | "plain_text"; text: string };
  fields?: Array<{ type: "mrkdwn" | "plain_text"; text: string }>;
  elements?: SlackBlockElement[];
  accessory?: SlackBlockElement;
}

export interface SlackBlockElement {
  type: "button" | "static_select" | "image" | "mrkdwn" | "plain_text";
  text?: { type: "plain_text" | "mrkdwn"; text: string; emoji?: boolean };
  action_id?: string;
  url?: string;
  value?: string;
  style?: "primary" | "danger";
  image_url?: string;
  alt_text?: string;
}

export interface SlackAttachment {
  color?: string;
  fallback?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  footer?: string;
  ts?: number;
}

export interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

export class SlackClient {
  private webhookUrl: string;
  private botToken?: string;
  private defaultChannel?: string;

  constructor(config: SlackConfig) {
    this.webhookUrl = config.webhookUrl;
    this.botToken = config.botToken;
    this.defaultChannel = config.defaultChannel;
  }

  async sendWebhook(message: SlackMessage): Promise<boolean> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  async sendMessage(message: SlackMessage): Promise<SlackResponse> {
    if (!this.botToken) {
      // Fall back to webhook
      const success = await this.sendWebhook(message);
      return { ok: success };
    }

    const channel = message.channel || this.defaultChannel;
    if (!channel) {
      return { ok: false, error: "No channel specified" };
    }

    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          ...message,
          channel,
        }),
      });

      return await response.json() as SlackResponse;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async updateMessage(channel: string, ts: string, message: SlackMessage): Promise<SlackResponse> {
    if (!this.botToken) {
      return { ok: false, error: "Bot token required for message updates" };
    }

    try {
      const response = await fetch("https://slack.com/api/chat.update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          ...message,
          channel,
          ts,
        }),
      });

      return await response.json() as SlackResponse;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  buildInvestigationMessage(investigation: {
    id: string;
    title: string;
    status: string;
    summary?: string;
    severity?: string;
    rootCause?: string;
    recommendations?: string[];
    url?: string;
  }): SlackMessage {
    const statusEmoji = {
      pending: "⏳",
      running: "🔄",
      completed: "✅",
      failed: "❌",
    }[investigation.status] || "❓";

    const severityColor = {
      critical: "#dc3545",
      warning: "#ffc107",
      info: "#17a2b8",
    }[investigation.severity || "info"] || "#6c757d";

    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `${statusEmoji} Investigation: ${investigation.title}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Status:*\n${investigation.status}` },
          { type: "mrkdwn", text: `*ID:*\n\`${investigation.id}\`` },
        ],
      },
    ];

    if (investigation.summary) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${investigation.summary}` },
      });
    }

    if (investigation.rootCause) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Root Cause:*\n${investigation.rootCause}` },
      });
    }

    if (investigation.recommendations && investigation.recommendations.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recommendations:*\n${investigation.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
        },
      });
    }

    if (investigation.url) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Details", emoji: true },
            url: investigation.url,
          },
        ],
      });
    }

    return {
      text: `Investigation ${investigation.status}: ${investigation.title}`,
      blocks,
      attachments: [
        {
          color: severityColor,
          fallback: investigation.summary || investigation.title,
        },
      ],
    };
  }

  buildAlertMessage(alert: {
    name: string;
    severity: string;
    message: string;
    source?: string;
    timestamp?: Date;
  }): SlackMessage {
    const severityEmoji = {
      critical: "🔴",
      warning: "🟡",
      info: "🔵",
    }[alert.severity] || "⚪";

    const severityColor = {
      critical: "#dc3545",
      warning: "#ffc107",
      info: "#17a2b8",
    }[alert.severity] || "#6c757d";

    return {
      text: `${severityEmoji} Alert: ${alert.name}`,
      attachments: [
        {
          color: severityColor,
          fallback: alert.message,
          title: `${severityEmoji} ${alert.name}`,
          text: alert.message,
          fields: [
            { title: "Severity", value: alert.severity.toUpperCase(), short: true },
            { title: "Source", value: alert.source || "Unknown", short: true },
          ],
          footer: "Triagent",
          ts: Math.floor((alert.timestamp || new Date()).getTime() / 1000),
        },
      ],
    };
  }
}

// Singleton instance
let slackClient: SlackClient | null = null;

export function getSlackClient(): SlackClient | null {
  return slackClient;
}

export function initSlackClient(config?: SlackConfig): SlackClient | null {
  if (config) {
    slackClient = new SlackClient(config);
  }
  return slackClient;
}
