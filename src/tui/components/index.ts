// TUI Components - OpenTUI UI integration

// Layout components
export { CenteredLayout, type CenteredLayoutProps } from "./centered-layout.js";

// Header components
export { Header, type HeaderProps } from "./header.js";
export { StatusBadge, type StatusBadgeProps } from "./status-badge.js";

// Message components
export { MessageItem, type Message, type MessageItemProps } from "./message-item.js";
export { MessagesPanel, type MessagesPanelProps } from "./messages-panel.js";

// Input components
export { Editor, type EditorProps } from "./editor.js";

// Status components
export { StatusBar, type StatusBarProps } from "./status-bar.js";

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
