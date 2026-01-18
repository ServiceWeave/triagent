/* @jsxImportSource @opentui/solid */
import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { SyntaxStyle, type ThemeTokenStyle } from "@opentui/core";
import "opentui-spinner/solid";
import { createPulse } from "opentui-spinner";
import { colors, spacing, ATTR_BOLD, ATTR_DIM, ATTR_ITALIC, type AppStatus } from "../theme/index.js";

// Markdown syntax highlighting theme (matching opencode's approach)
const MARKDOWN_SYNTAX_THEME: ThemeTokenStyle[] = [
  { scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: "cyan", bold: true } },
  { scope: ["markup.strong"], style: { foreground: "white", bold: true } },
  { scope: ["markup.italic"], style: { foreground: "white", italic: true } },
  { scope: ["markup.raw", "markup.raw.block"], style: { foreground: "yellow" } },
  { scope: ["markup.quote"], style: { foreground: "gray", italic: true } },
  { scope: ["markup.list", "markup.list.unchecked", "markup.list.checked"], style: { foreground: "gray" } },
  { scope: ["markup.link", "markup.link.url"], style: { foreground: "cyan", underline: true } },
  { scope: ["markup.link.label", "markup.link.bracket.close"], style: { foreground: "blue" } },
  { scope: ["markup.strikethrough"], style: { foreground: "gray", dim: true } },
  { scope: ["label"], style: { foreground: "gray", dim: true } },
  { scope: ["punctuation.special", "punctuation.delimiter"], style: { foreground: "gray" } },
  { scope: ["string.escape"], style: { foreground: "magenta" } },
];

const markdownSyntaxStyle = SyntaxStyle.fromTheme(MARKDOWN_SYNTAX_THEME);

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  toolName?: string;
  command?: string;
}

export interface MessageItemProps {
  message: Message;
  status: AppStatus;
  isLastToolMessage: boolean;
  isLastUserMessage?: boolean;
  hasAssistantResponse?: boolean;
  streaming?: boolean;
}

/**
 * MarkdownText - Renders markdown content with syntax highlighting
 */
function MarkdownText(props: { content: string; streaming?: boolean }): JSX.Element {
  return (
    <code
      filetype="markdown"
      content={props.content.trim()}
      syntaxStyle={markdownSyntaxStyle}
      conceal={true}
      drawUnstyledText={false}
      streaming={props.streaming ?? false}
      fg={colors.text.primary}
    />
  );
}

/**
 * MessageItem - Individual message rendering with role-based styling
 * OpenCode-inspired layout:
 * - User messages: left border with content
 * - Tool calls: bordered box showing command
 * - Assistant messages: plain markdown content
 */
export function MessageItem(props: MessageItemProps): JSX.Element {
  // Note: Don't destructure reactive props in SolidJS - access via props.xxx to maintain reactivity
  const { message, streaming } = props;

  // Show investigating spinner below user message when agent is working but no assistant response yet
  // Access props directly to maintain SolidJS reactivity
  const showInvestigatingSpinner = () =>
    props.isLastUserMessage && props.status === "investigating" && !props.hasAssistantResponse;

  return (
    <box flexDirection="column">
      {/* User message - left border, no label (opencode style) */}
      <Show when={message.role === "user"}>
        <box flexDirection="column">
          {/* Message with left border */}
          <box
            borderStyle="single"
            borderLeft={true}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor={colors.border.muted}
            paddingLeft={1}
          >
            <text fg={colors.text.primary}>{message.content}</text>
          </box>
          {/* Spinner during investigation (shown below user message) */}
          <Show when={showInvestigatingSpinner()}>
            <box flexDirection="row" paddingLeft={2}>
              <spinner name="dots" color={createPulse(["cyan", "blue", "magenta"], 200)} />
              <text fg={colors.text.secondary} attributes={ATTR_ITALIC}> Investigating...</text>
            </box>
          </Show>
        </box>
      </Show>

      {/* Tool message - bordered box showing command (opencode style) */}
      <Show when={message.role === "tool"}>
        <box
          borderStyle="single"
          borderColor={colors.role.tool}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row" gap={1}>
            {/* Status indicator - checkmark for completed, pause for awaiting approval */}
            <Show when={props.status === "awaiting_approval" && props.isLastToolMessage} fallback={<text fg={colors.success}>✓</text>}>
              <text fg={colors.warning}>⏸</text>
            </Show>
            {/* Tool name badge */}
            <text fg={colors.role.tool} attributes={ATTR_BOLD}>
              [{message.toolName}]
            </text>
            {/* Command */}
            <text fg={colors.text.secondary}>
              {message.content}
            </text>
          </box>
        </box>
      </Show>

      {/* Assistant message - no label, direct markdown content (opencode style) */}
      <Show when={message.role === "assistant"}>
        <box flexDirection="column" paddingLeft={1}>
          <MarkdownText content={message.content} streaming={streaming} />
        </box>
      </Show>
    </box>
  );
}
