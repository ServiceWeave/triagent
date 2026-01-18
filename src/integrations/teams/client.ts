import type { TeamsConfig } from "../../cli/config.js";

export interface TeamsMessage {
  "@type": "MessageCard";
  "@context": "http://schema.org/extensions";
  themeColor?: string;
  summary: string;
  sections?: TeamsSection[];
  potentialAction?: TeamsAction[];
}

export interface TeamsSection {
  activityTitle?: string;
  activitySubtitle?: string;
  activityImage?: string;
  facts?: Array<{ name: string; value: string }>;
  markdown?: boolean;
  text?: string;
}

export interface TeamsAction {
  "@type": "OpenUri" | "ActionCard" | "HttpPOST";
  name: string;
  targets?: Array<{ os: string; uri: string }>;
  inputs?: TeamsInput[];
  actions?: TeamsAction[];
  target?: string;
  body?: string;
}

export interface TeamsInput {
  "@type": "TextInput" | "MultichoiceInput";
  id: string;
  title: string;
  isMultiline?: boolean;
  isRequired?: boolean;
  choices?: Array<{ display: string; value: string }>;
}

export class TeamsClient {
  private webhookUrl: string;

  constructor(config: TeamsConfig) {
    this.webhookUrl = config.webhookUrl;
  }

  async sendMessage(message: TeamsMessage): Promise<boolean> {
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

  buildInvestigationMessage(investigation: {
    id: string;
    title: string;
    status: string;
    summary?: string;
    severity?: string;
    rootCause?: string;
    recommendations?: string[];
    url?: string;
  }): TeamsMessage {
    const statusEmoji = {
      pending: "⏳",
      running: "🔄",
      completed: "✅",
      failed: "❌",
    }[investigation.status] || "❓";

    const themeColor = {
      critical: "dc3545",
      warning: "ffc107",
      info: "17a2b8",
      completed: "28a745",
      failed: "dc3545",
    }[investigation.severity || investigation.status] || "6c757d";

    const facts: Array<{ name: string; value: string }> = [
      { name: "Status", value: `${statusEmoji} ${investigation.status}` },
      { name: "ID", value: investigation.id },
    ];

    if (investigation.severity) {
      facts.push({ name: "Severity", value: investigation.severity.toUpperCase() });
    }

    const sections: TeamsSection[] = [
      {
        activityTitle: `Investigation: ${investigation.title}`,
        activitySubtitle: `Status: ${investigation.status}`,
        facts,
        markdown: true,
      },
    ];

    if (investigation.summary) {
      sections.push({
        text: `**Summary:** ${investigation.summary}`,
        markdown: true,
      });
    }

    if (investigation.rootCause) {
      sections.push({
        text: `**Root Cause:** ${investigation.rootCause}`,
        markdown: true,
      });
    }

    if (investigation.recommendations && investigation.recommendations.length > 0) {
      const recText = investigation.recommendations
        .map((r, i) => `${i + 1}. ${r}`)
        .join("\n\n");
      sections.push({
        text: `**Recommendations:**\n\n${recText}`,
        markdown: true,
      });
    }

    const actions: TeamsAction[] = [];
    if (investigation.url) {
      actions.push({
        "@type": "OpenUri",
        name: "View Details",
        targets: [{ os: "default", uri: investigation.url }],
      });
    }

    return {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor,
      summary: `Investigation ${investigation.status}: ${investigation.title}`,
      sections,
      potentialAction: actions.length > 0 ? actions : undefined,
    };
  }

  buildAlertMessage(alert: {
    name: string;
    severity: string;
    message: string;
    source?: string;
    timestamp?: Date;
  }): TeamsMessage {
    const severityEmoji = {
      critical: "🔴",
      warning: "🟡",
      info: "🔵",
    }[alert.severity] || "⚪";

    const themeColor = {
      critical: "dc3545",
      warning: "ffc107",
      info: "17a2b8",
    }[alert.severity] || "6c757d";

    return {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor,
      summary: `${severityEmoji} Alert: ${alert.name}`,
      sections: [
        {
          activityTitle: `${severityEmoji} ${alert.name}`,
          activitySubtitle: alert.source || "Triagent",
          facts: [
            { name: "Severity", value: alert.severity.toUpperCase() },
            { name: "Time", value: (alert.timestamp || new Date()).toISOString() },
          ],
          text: alert.message,
          markdown: true,
        },
      ],
    };
  }
}

// Singleton instance
let teamsClient: TeamsClient | null = null;

export function getTeamsClient(): TeamsClient | null {
  return teamsClient;
}

export function initTeamsClient(config?: TeamsConfig): TeamsClient | null {
  if (config) {
    teamsClient = new TeamsClient(config);
  }
  return teamsClient;
}
