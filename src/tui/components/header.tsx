/* @jsxImportSource @opentui/solid */
import type { JSX } from "solid-js";
import { colors, spacing, ATTR_BOLD, ATTR_DIM, type AppStatus } from "../theme/index.js";
import { StatusBadge } from "./status-badge.js";

export interface HeaderProps {
  status: AppStatus;
  currentTool?: string | null;
  kubeContext: string;
  modelName?: string;
}

/**
 * Header - Top section with logo, title, model info, status badge, and kubernetes context
 * OpenCode-style layout with clean visual hierarchy
 */
export function Header(props: HeaderProps): JSX.Element {
  return (
    <box
      borderStyle="single"
      borderColor={colors.primary}
      paddingLeft={spacing.sm}
      paddingRight={spacing.sm}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
    >
      {/* Top row: Logo + Title + Model | Status Badge */}
      <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={colors.primary} attributes={ATTR_BOLD}>
            ☸ TRIAGENT
          </text>
          <text fg={colors.text.secondary}>|</text>
          <text fg={colors.text.secondary} attributes={ATTR_DIM}>
            {props.modelName}
          </text>
        </box>
        <StatusBadge status={props.status} currentTool={props.currentTool} />
      </box>

      {/* Bottom row: Subtitle | Kubernetes context */}
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={colors.text.secondary} attributes={ATTR_DIM}>
          Kubernetes Debugging Agent
        </text>
        <text fg={colors.info}>
          cluster: {props.kubeContext}
        </text>
      </box>
    </box>
  );
}
