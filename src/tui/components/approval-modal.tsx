/* @jsxImportSource @opentui/solid */
import { Show, type JSX } from "solid-js";
import { createTextAttributes } from "@opentui/core";

const ATTR_DIM = createTextAttributes({ dim: true });
const ATTR_BOLD = createTextAttributes({ bold: true });

export interface ApprovalRequest {
  id: string;
  action: string;
  target: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
  approvalToken: string;
  expiresAt: Date;
}

interface ApprovalModalProps {
  request: ApprovalRequest | null;
  onApprove: (token: string) => void;
  onReject: () => void;
  visible: boolean;
}

function getRiskColor(risk: ApprovalRequest["riskLevel"]): string {
  switch (risk) {
    case "low":
      return "green";
    case "medium":
      return "yellow";
    case "high":
      return "red";
    case "critical":
      return "magenta";
  }
}

function getRiskEmoji(risk: ApprovalRequest["riskLevel"]): string {
  switch (risk) {
    case "low":
      return "🟢";
    case "medium":
      return "🟡";
    case "high":
      return "🟠";
    case "critical":
      return "🔴";
  }
}

export function ApprovalModal(props: ApprovalModalProps): JSX.Element {
  const request = () => props.request;
  const visible = () => props.visible && request() !== null;

  return (
    <Show when={visible()}>
      <box
        position="absolute"
        top={5}
        left={10}
        width={60}
        borderStyle="double"
        borderColor={getRiskColor(request()!.riskLevel)}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        {/* Header */}
        <box flexDirection="row" justifyContent="center" marginBottom={1}>
          <text fg={getRiskColor(request()!.riskLevel)} attributes={ATTR_BOLD}>
            ⚠️ APPROVAL REQUIRED ⚠️
          </text>
        </box>

        {/* Risk Level */}
        <box flexDirection="row" gap={1} marginBottom={1}>
          <text fg="white">Risk Level:</text>
          <text fg={getRiskColor(request()!.riskLevel)} attributes={ATTR_BOLD}>
            {getRiskEmoji(request()!.riskLevel)} {request()!.riskLevel.toUpperCase()}
          </text>
        </box>

        {/* Action */}
        <box flexDirection="column" marginBottom={1}>
          <text fg="cyan" attributes={ATTR_BOLD}>Action:</text>
          <text fg="white">{request()!.action}</text>
        </box>

        {/* Target */}
        <box flexDirection="column" marginBottom={1}>
          <text fg="cyan" attributes={ATTR_BOLD}>Target:</text>
          <text fg="white">{request()!.target}</text>
        </box>

        {/* Description */}
        <box flexDirection="column" marginBottom={1}>
          <text fg="cyan" attributes={ATTR_BOLD}>Description:</text>
          <text fg="gray" wrapMode="word">{request()!.description}</text>
        </box>

        {/* Expiration */}
        <box flexDirection="row" gap={1} marginBottom={1}>
          <text fg="gray" attributes={ATTR_DIM}>
            Expires: {formatTimeRemaining(request()!.expiresAt)}
          </text>
        </box>

        {/* Divider */}
        <text fg="gray" attributes={ATTR_DIM}>
          ─────────────────────────────────────────────
        </text>

        {/* Actions */}
        <box flexDirection="row" justifyContent="center" gap={4} marginTop={1}>
          <text fg="green" attributes={ATTR_BOLD}>
            [Y] Approve
          </text>
          <text fg="red" attributes={ATTR_BOLD}>
            [N] Reject
          </text>
        </box>

        {/* Warning for high risk */}
        <Show when={request()!.riskLevel === "high" || request()!.riskLevel === "critical"}>
          <box marginTop={1}>
            <text fg="red" attributes={ATTR_BOLD}>
              ⚠️ This is a {request()!.riskLevel}-risk action. Please review carefully.
            </text>
          </box>
        </Show>
      </box>
    </Show>
  );
}

function formatTimeRemaining(expiresAt: Date): string {
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining <= 0) {
    return "Expired";
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Interactive approval prompt for use in message flow
// Similar to Claude Code's AskUserQuestion pattern
interface CommandApprovalProps {
  approvalId: string;
  command: string;
  riskLevel: ApprovalRequest["riskLevel"];
  selectedOption: number; // 0 = approve, 1 = reject, -1 = no selection
  onSelect: (option: number) => void;
  submitted: boolean;
}

export function CommandApproval(props: CommandApprovalProps): JSX.Element {
  const riskColor = getRiskColor(props.riskLevel);

  return (
    <box
      flexDirection="column"
      borderStyle="single"
      borderColor={riskColor}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      marginBottom={1}
    >
      {/* Header */}
      <box flexDirection="row" gap={1} marginBottom={1}>
        <text fg={riskColor}>{getRiskEmoji(props.riskLevel)}</text>
        <text fg="white" attributes={ATTR_BOLD}>
          Write Operation Requires Approval
        </text>
        <text fg="gray" attributes={ATTR_DIM}>
          ({props.riskLevel} risk)
        </text>
      </box>

      {/* Command */}
      <box flexDirection="column" marginBottom={1}>
        <text fg="cyan" attributes={ATTR_BOLD}>Command:</text>
        <text fg="yellow">{props.command}</text>
      </box>

      {/* Options - Claude Code style */}
      <box flexDirection="column" gap={1}>
        <OptionButton
          index={0}
          label="Yes, execute this command"
          selected={props.selectedOption === 0}
          submitted={props.submitted}
          color="green"
        />
        <OptionButton
          index={1}
          label="No, cancel this operation"
          selected={props.selectedOption === 1}
          submitted={props.submitted}
          color="red"
        />
      </box>

      {/* Instructions */}
      <Show when={!props.submitted}>
        <text fg="gray" attributes={ATTR_DIM} marginTop={1}>
          Use ↑↓ to select, Enter to confirm
        </text>
      </Show>
    </box>
  );
}

interface OptionButtonProps {
  index: number;
  label: string;
  selected: boolean;
  submitted: boolean;
  color: string;
}

function OptionButton(props: OptionButtonProps): JSX.Element {
  const isSelected = () => props.selected;
  const isSubmitted = () => props.submitted;

  return (
    <box flexDirection="row" gap={1}>
      <Show
        when={isSelected()}
        fallback={<text fg="gray">○</text>}
      >
        <text fg={props.color}>●</text>
      </Show>
      <text
        fg={isSelected() ? props.color : "white"}
        attributes={isSelected() ? ATTR_BOLD : undefined}
      >
        {props.label}
      </text>
      <Show when={isSelected() && isSubmitted()}>
        <text fg={props.color}> ✓</text>
      </Show>
    </box>
  );
}

// Compact inline version for showing result after approval
interface ApprovalResultProps {
  command: string;
  approved: boolean;
  riskLevel: ApprovalRequest["riskLevel"];
}

export function ApprovalResult(props: ApprovalResultProps): JSX.Element {
  const riskColor = getRiskColor(props.riskLevel);
  const statusColor = props.approved ? "green" : "red";
  const statusText = props.approved ? "Approved" : "Rejected";
  const statusIcon = props.approved ? "✓" : "✗";

  return (
    <box flexDirection="row" gap={1} marginTop={1} marginBottom={1}>
      <text fg={riskColor}>{getRiskEmoji(props.riskLevel)}</text>
      <text fg="gray" attributes={ATTR_DIM}>[{props.riskLevel}]</text>
      <text fg={statusColor}>{statusIcon} {statusText}:</text>
      <text fg="yellow">{props.command}</text>
    </box>
  );
}
