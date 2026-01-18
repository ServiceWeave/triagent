/* @jsxImportSource @opentui/solid */
import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { colors, spacing, ATTR_BOLD, ATTR_DIM, type AppStatus } from "../theme/index.js";

export interface StatusBarProps {
  status: AppStatus;
  messageCount: number;
}

/**
 * StatusBar - Bottom bar showing mode, keyboard hints, and message count
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  return (
    <box
      paddingLeft={spacing.sm}
      paddingRight={spacing.sm}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Show
        when={props.status === "awaiting_approval"}
        fallback={
          <text fg={colors.text.secondary} attributes={ATTR_DIM}>
            Press Enter to submit | Ctrl+C to quit
          </text>
        }
      >
        <text fg={colors.warning} attributes={ATTR_BOLD}>
          Approval required: Y/N or Enter
        </text>
      </Show>
      <text fg={colors.text.secondary} attributes={ATTR_DIM}>
        {props.messageCount} messages
      </text>
    </box>
  );
}
