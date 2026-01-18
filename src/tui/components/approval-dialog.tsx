/* @jsxImportSource @opentui/solid */
import { DialogProvider, useDialog, useDialogKeyboard, type ConfirmContext } from "@opentui-ui/dialog/solid";
import type { JSX, ParentProps } from "solid-js";
import {
  colors,
  spacing,
  ATTR_BOLD,
  ATTR_DIM,
  getRiskColor,
  getRiskHexColor,
  type RiskLevel,
} from "../theme/index.js";

export type { RiskLevel };

export interface ApprovalDialogOptions {
  command: string;
  riskLevel: RiskLevel;
  description?: string;
}

function getRiskEmoji(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "●";
    case "medium":
      return "●";
    case "high":
      return "●";
    case "critical":
      return "●";
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
        <text fg={colors.text.primary} attributes={ATTR_BOLD}>
          Write Operation Requires Approval
        </text>
        <text fg={colors.text.secondary} attributes={ATTR_DIM}>
          ({riskLevel} risk)
        </text>
      </box>

      {/* Command */}
      <box flexDirection="column">
        <text fg={colors.info} attributes={ATTR_BOLD}>Command:</text>
        <text fg={colors.warning}>{command}</text>
      </box>

      {/* Description if provided */}
      {description && (
        <box flexDirection="column">
          <text fg={colors.text.secondary} attributes={ATTR_DIM}>{description}</text>
        </box>
      )}

      {/* Warning for high risk */}
      {(riskLevel === "high" || riskLevel === "critical") && (
        <box>
          <text fg={colors.error} attributes={ATTR_BOLD}>
            This is a {riskLevel}-risk operation. Review carefully.
          </text>
        </box>
      )}

      {/* Actions */}
      <box flexDirection="row" gap={4} marginTop={1}>
        <text fg={colors.success} attributes={ATTR_BOLD}>[Y] Approve</text>
        <text fg={colors.error} attributes={ATTR_BOLD}>[N] Reject</text>
      </box>

      {/* Instructions */}
      <text fg={colors.text.secondary} attributes={ATTR_DIM}>
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
          borderColor: colors.text.primary,
          backgroundColor: colors.background.primary,
          paddingLeft: spacing.sm,
          paddingRight: spacing.sm,
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
        borderColor: getRiskHexColor(options.riskLevel),
        borderStyle: "double",
      },
    });
    return result;
  };

  return { showApproval, ...dialog };
}

// Re-export dialog hooks for other uses
export { useDialog, useDialogKeyboard };
