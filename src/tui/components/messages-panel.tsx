/* @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { colors, spacing, ATTR_DIM, type AppStatus } from "../theme/index.js";
import { MessageItem, type Message } from "./message-item.js";
export type { Message };

export interface MessagesPanelProps {
  messages: Message[];
  status: AppStatus;
}

/**
 * MessagesPanel - Scrollable messages container with empty state
 */
export function MessagesPanel(props: MessagesPanelProps): JSX.Element {
  const getLastToolMessageId = (): string | undefined => {
    const toolMessages = props.messages.filter((m) => m.role === "tool");
    return toolMessages.at(-1)?.id;
  };

  const getLastUserMessageId = (): string | undefined => {
    const userMessages = props.messages.filter((m) => m.role === "user");
    return userMessages.at(-1)?.id;
  };

  const hasToolMessages = (): boolean => {
    return props.messages.some((m) => m.role === "tool");
  };

  const hasAssistantMessages = (): boolean => {
    return props.messages.some((m) => m.role === "assistant");
  };

  return (
    <scrollbox
      flexGrow={1}
      borderStyle="single"
      borderColor={colors.border.default}
      paddingLeft={spacing.xs}
      paddingRight={spacing.xs}
      stickyScroll
      stickyStart="bottom"
    >
      <box flexDirection="column" gap={0}>
        <Show
          when={props.messages.length > 0}
          fallback={
            <box paddingTop={spacing.sm} paddingBottom={spacing.sm}>
              <text fg={colors.text.secondary} attributes={ATTR_DIM}>
                Enter an incident description to start investigating...
              </text>
            </box>
          }
        >
          <For each={props.messages}>
            {(msg) => (
              <MessageItem
                message={msg}
                status={props.status}
                isLastToolMessage={msg.id === getLastToolMessageId()}
                isLastUserMessage={msg.id === getLastUserMessageId()}
                hasAssistantResponse={hasAssistantMessages()}
              />
            )}
          </For>
        </Show>
      </box>
    </scrollbox>
  );
}
