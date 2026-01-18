/* @jsxImportSource @opentui/solid */
import { For, Show, type JSX } from "solid-js";
import { createTextAttributes } from "@opentui/core";
import type { InvestigationEvent, ToolCallRecord } from "../../storage/types.js";

const ATTR_DIM = createTextAttributes({ dim: true });
const ATTR_BOLD = createTextAttributes({ bold: true });

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: "tool_call" | "alert" | "k8s_event" | "log_entry" | "user_action";
  title: string;
  details?: string;
  severity?: "critical" | "warning" | "info" | "success";
}

interface TimelineProps {
  events: TimelineEvent[];
  maxHeight?: number;
  showTimestamps?: boolean;
}

function getSeverityColor(severity?: TimelineEvent["severity"]): string {
  switch (severity) {
    case "critical":
      return "red";
    case "warning":
      return "yellow";
    case "success":
      return "green";
    case "info":
    default:
      return "blue";
  }
}

function getEventIcon(type: TimelineEvent["type"]): string {
  switch (type) {
    case "tool_call":
      return "⚙";
    case "alert":
      return "🔔";
    case "k8s_event":
      return "☸";
    case "log_entry":
      return "📝";
    case "user_action":
      return "👤";
    default:
      return "•";
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  } else if (diffMin < 60) {
    return `${diffMin}m ago`;
  } else if (diffHour < 24) {
    return `${diffHour}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export function Timeline(props: TimelineProps): JSX.Element {
  const showTimestamps = props.showTimestamps ?? true;

  return (
    <box flexDirection="column" gap={0}>
      <Show
        when={props.events.length > 0}
        fallback={
          <text fg="gray" attributes={ATTR_DIM}>
            No events to display
          </text>
        }
      >
        <For each={props.events}>
          {(event, index) => {
            const color = getSeverityColor(event.severity);
            const icon = getEventIcon(event.type);
            const isLast = index() === props.events.length - 1;

            return (
              <box flexDirection="row" gap={1}>
                {/* Timeline line */}
                <box flexDirection="column" width={3} alignItems="center">
                  <text fg={color}>{icon}</text>
                  <Show when={!isLast}>
                    <text fg="gray" attributes={ATTR_DIM}>│</text>
                  </Show>
                </box>

                {/* Event content */}
                <box flexDirection="column" flexGrow={1}>
                  <box flexDirection="row" gap={1}>
                    <text fg={color} attributes={ATTR_BOLD}>
                      {event.title}
                    </text>
                    <Show when={showTimestamps}>
                      <text fg="gray" attributes={ATTR_DIM}>
                        ({formatRelativeTime(event.timestamp)})
                      </text>
                    </Show>
                  </box>
                  <Show when={event.details}>
                    <text fg="gray" attributes={ATTR_DIM}>
                      {event.details}
                    </text>
                  </Show>
                </box>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}

// Helper to convert investigation events to timeline events
export function investigationEventsToTimeline(
  events: InvestigationEvent[],
  toolCalls: ToolCallRecord[]
): TimelineEvent[] {
  const timelineEvents: TimelineEvent[] = [];

  // Add tool calls
  for (const tc of toolCalls) {
    timelineEvents.push({
      id: tc.id,
      timestamp: tc.timestamp,
      type: "tool_call",
      title: `Tool: ${tc.toolName}`,
      details: tc.args?.command ? `$ ${tc.args.command}` : undefined,
      severity: tc.error ? "warning" : "success",
    });
  }

  // Add investigation events
  for (const event of events) {
    let severity: TimelineEvent["severity"] = "info";
    if (event.type === "alert") {
      severity = "warning";
    } else if (event.type === "k8s_event") {
      const data = event.data as { type?: string };
      severity = data.type === "Warning" ? "warning" : "info";
    }

    timelineEvents.push({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      title: event.source,
      details: JSON.stringify(event.data).slice(0, 100),
      severity,
    });
  }

  // Sort by timestamp descending (most recent first)
  timelineEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return timelineEvents;
}

interface CompactTimelineProps {
  events: TimelineEvent[];
  maxEvents?: number;
}

export function CompactTimeline(props: CompactTimelineProps): JSX.Element {
  const maxEvents = props.maxEvents ?? 5;
  const displayEvents = () => props.events.slice(0, maxEvents);
  const hasMore = () => props.events.length > maxEvents;

  return (
    <box flexDirection="column">
      <text fg="cyan" attributes={ATTR_BOLD}>
        Recent Events
      </text>
      <box flexDirection="column" marginTop={1}>
        <For each={displayEvents()}>
          {(event) => {
            const color = getSeverityColor(event.severity);
            const icon = getEventIcon(event.type);

            return (
              <box flexDirection="row" gap={1}>
                <text fg={color}>{icon}</text>
                <text fg="white">{event.title}</text>
                <text fg="gray" attributes={ATTR_DIM}>
                  {formatRelativeTime(event.timestamp)}
                </text>
              </box>
            );
          }}
        </For>
        <Show when={hasMore()}>
          <text fg="gray" attributes={ATTR_DIM}>
            ... and {props.events.length - maxEvents} more events
          </text>
        </Show>
      </box>
    </box>
  );
}
