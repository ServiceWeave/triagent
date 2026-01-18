/* @jsxImportSource @opentui/solid */
import type { JSX } from "solid-js";
import { ATTR_BOLD, getStatusColor, getStatusText, type AppStatus } from "../theme/index.js";

export interface StatusBadgeProps {
  status: AppStatus;
  currentTool?: string | null;
}

/**
 * StatusBadge - Status indicator showing Ready/Investigating/Awaiting Approval/Error
 * Displays current app state with appropriate color coding
 */
export function StatusBadge(props: StatusBadgeProps): JSX.Element {
  return (
    <text fg={getStatusColor(props.status)} attributes={ATTR_BOLD}>
      [{getStatusText(props.status, props.currentTool)}]
    </text>
  );
}
