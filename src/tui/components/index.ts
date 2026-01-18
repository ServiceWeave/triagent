// TUI Components - OpenTUI UI integration

// Styled span with proper typing for fg/bg/attributes
export { StyledSpan, type StyledSpanProps } from "./styled-span.js";

// Toast notifications
export {
  ToastProvider,
  toast,
  toastSuccess,
  toastError,
  toastWarning,
  toastInfo,
  toastLoading,
  toastDismiss,
  toastPromise,
  useToasts,
  TOAST_DURATION,
} from "./toast.js";

// Approval dialogs
export {
  ApprovalDialogProvider,
  useApprovalDialog,
  useDialog,
  useDialogKeyboard,
  type RiskLevel,
  type ApprovalDialogOptions,
} from "./approval-dialog.js";

// Existing components
export { ApprovalModal, CommandApproval, ApprovalResult, type ApprovalRequest } from "./approval-modal.js";
export {
  Timeline,
  CompactTimeline,
  investigationEventsToTimeline,
  type TimelineEvent,
} from "./timeline.js";
