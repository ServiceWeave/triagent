/* @jsxImportSource @opentui/solid */
import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { colors, spacing, ATTR_BOLD, ATTR_DIM, type AppStatus } from "../theme/index.js";

export interface EditorProps {
  status: AppStatus;
  value: string;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
  onApprovalInput?: (value: string) => void;
  onApprovalKeyDown?: (key: { name: string }) => void;
}

/**
 * Editor - Enhanced input with cyan prompt indicator
 * OpenCode-style with clean border and prompt
 */
export function Editor(props: EditorProps): JSX.Element {
  const getBorderColor = () => {
    if (props.status === "awaiting_approval") return colors.warning;
    if (props.status === "investigating") return colors.warning;
    return colors.info;
  };

  return (
    <Show
      when={props.status === "awaiting_approval"}
      fallback={
        <box
          borderStyle="single"
          borderColor={getBorderColor()}
          paddingLeft={spacing.xs}
          paddingRight={spacing.xs}
          flexDirection="row"
          gap={1}
        >
          <text fg={colors.info} attributes={ATTR_BOLD}>
            {">"}
          </text>
          <input
            flexGrow={1}
            focused={true}
            value={props.value}
            onInput={props.onInput}
            onSubmit={props.onSubmit}
            placeholder={
              props.status === "investigating"
                ? "Investigating..."
                : "Describe the incident..."
            }
            textColor={colors.text.primary}
            placeholderColor={colors.text.secondary}
            focusedTextColor={colors.text.primary}
            focusedBackgroundColor={colors.background.primary}
          />
        </box>
      }
    >
      {/* Approval mode input */}
      <box
        borderStyle="double"
        borderColor={colors.warning}
        paddingLeft={spacing.xs}
        paddingRight={spacing.xs}
        flexDirection="row"
        gap={1}
      >
        <text fg={colors.warning} attributes={ATTR_BOLD}>
          ?
        </text>
        <input
          flexGrow={1}
          focused={true}
          value=""
          onInput={(value) => props.onApprovalInput?.(value)}
          onKeyDown={(key) => props.onApprovalKeyDown?.(key)}
          placeholder="Press Y to approve, N to reject"
          textColor={colors.text.primary}
          placeholderColor={colors.text.secondary}
          focusedTextColor={colors.text.primary}
          focusedBackgroundColor={colors.background.primary}
        />
      </box>
    </Show>
  );
}
