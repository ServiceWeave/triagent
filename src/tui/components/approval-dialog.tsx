/* @jsxImportSource @opentui/solid */
import { DialogProvider, useDialog, useDialogKeyboard, type ConfirmContext } from "@opentui-ui/dialog/solid";
import { createTextAttributes } from "@opentui/core";
import type { JSX, ParentProps } from "solid-js";

const ATTR_BOLD = createTextAttributes({ bold: true });
const ATTR_DIM = createTextAttributes({ dim: true });

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalDialogOptions {
  command: string;
  riskLevel: RiskLevel;
  description?: string;
}

function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low": return "green";
    case "medium": return "yellow";
    case "high": return "red";
    case "critical": return "magenta";
  }
}

function getRiskEmoji(risk: RiskLevel): string {
  switch (risk) {
    case "low": return "🟢";
    case "medium": return "🟡";
    case "high": return "🟠";
    case "critical": return "🔴";
  }
}

function getRiskBorderColor(risk: RiskLevel): string {
  switch (risk) {
    case "low": return "#22c55e";
    case "medium": return "#eab308";
    case "high": return "#ef4444";
    case "critical": return "#ec4899";
  }
}

/**
 * Content component for the approval confirmation dialog
 */
function ApprovalDialogContent(ctx: ConfirmContext & { options: ApprovalDialogOptions }) {
  const { command, riskLevel, description } = ctx.options;
  const riskColor = getRiskColor(riskLevel);

  // Handle keyboard input
  useDialogKeyboard((key) => {
    if (key.name === "return" || key.name === "y") {
      ctx.resolve(true);
    } else if (key.name === "escape" || key.name === "n") {
      ctx.resolve(false);
    }
  }, ctx.dialogId);

  return () => (
    <box flexDirection="column" gap={1}>
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text fg={riskColor}>{getRiskEmoji(riskLevel)}</text>
        <text fg="white" attributes={ATTR_BOLD}>
          Write Operation Requires Approval
        </text>
        <text fg="gray" attributes={ATTR_DIM}>
          ({riskLevel} risk)
        </text>
      </box>

      {/* Command */}
      <box flexDirection="column">
        <text fg="cyan" attributes={ATTR_BOLD}>Command:</text>
        <text fg="yellow">{command}</text>
      </box>

      {/* Description if provided */}
      {description && (
        <box flexDirection="column">
          <text fg="gray" attributes={ATTR_DIM}>{description}</text>
        </box>
      )}

      {/* Warning for high risk */}
      {(riskLevel === "high" || riskLevel === "critical") && (
        <box>
          <text fg="red" attributes={ATTR_BOLD}>
            ⚠️ This is a {riskLevel}-risk operation. Review carefully.
          </text>
        </box>
      )}

      {/* Actions */}
      <box flexDirection="row" gap={4} marginTop={1}>
        <text fg="green" attributes={ATTR_BOLD}>[Y] Approve</text>
        <text fg="red" attributes={ATTR_BOLD}>[N] Reject</text>
      </box>

      {/* Instructions */}
      <text fg="gray" attributes={ATTR_DIM}>
        Press Y to approve, N to reject, or Esc to cancel
      </text>
    </box>
  );
}

/**
 * Provider component that enables dialog functionality
 */
export function ApprovalDialogProvider(props: ParentProps): JSX.Element {
  return (
    <DialogProvider
      size="medium"
      dialogOptions={{
        style: {
          borderStyle: "single",
          borderColor: "#ffffff",
          backgroundColor: "#1a1a1a",
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
        },
      }}
      backdropColor="#000000"
      backdropOpacity={0.5}
    >
      {props.children}
    </DialogProvider>
  );
}

/**
 * Hook to show approval confirmation dialogs
 */
export function useApprovalDialog() {
  const dialog = useDialog();

  const showApproval = async (options: ApprovalDialogOptions): Promise<boolean> => {
    const result = await dialog.confirm({
      content: (ctx) => ApprovalDialogContent({ ...ctx, options }),
      style: {
        borderColor: getRiskBorderColor(options.riskLevel),
        borderStyle: "double",
      },
    });
    return result;
  };

  return { showApproval, ...dialog };
}

// Re-export dialog hooks for other uses
export { useDialog, useDialogKeyboard };
