/**
 * Design Tokens for Triagent TUI
 * Centralized colors, spacing, and layout constants
 * Inspired by OpenCode's visual style
 */

import { createTextAttributes } from "@opentui/core";

// ============================================================================
// COLORS
// ============================================================================

export const colors = {
  // Primary brand color
  primary: "red",
  primaryHex: "#ef4444",

  // Semantic colors
  success: "green",
  successHex: "#22c55e",
  warning: "yellow",
  warningHex: "#eab308",
  error: "red",
  errorHex: "#ef4444",
  info: "cyan",
  infoHex: "#06b6d4",

  // Text colors
  text: {
    primary: "white",
    secondary: "gray",
    muted: "gray",
  },

  // Background colors
  background: {
    primary: "#1a1a1a",
    secondary: "#2a2a2a",
    elevated: "#333333",
  },

  // Border colors
  border: {
    default: "gray",
    focused: "cyan",
    active: "red",
    muted: "#444444",
  },

  // Role-specific colors
  role: {
    user: "cyan",
    assistant: "green",
    tool: "blue",
    system: "magenta",
  },

  // Risk level colors
  risk: {
    low: "green",
    lowHex: "#22c55e",
    medium: "yellow",
    mediumHex: "#eab308",
    high: "red",
    highHex: "#ef4444",
    critical: "magenta",
    criticalHex: "#ec4899",
  },
} as const;

// ============================================================================
// SPACING
// ============================================================================

export const spacing = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
} as const;

// ============================================================================
// LAYOUT
// ============================================================================

export const layout = {
  maxWidth: 100,
  headerHeight: 4,
  footerHeight: 1,
  inputHeight: 3,
  minContentHeight: 10,
} as const;

// ============================================================================
// TEXT ATTRIBUTES
// ============================================================================

export const ATTR_BOLD = createTextAttributes({ bold: true });
export const ATTR_DIM = createTextAttributes({ dim: true });
export const ATTR_ITALIC = createTextAttributes({ italic: true });
export const ATTR_UNDERLINE = createTextAttributes({ underline: true });
export const ATTR_BOLD_DIM = createTextAttributes({ bold: true, dim: true });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export type RiskLevel = "low" | "medium" | "high" | "critical";

export function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return colors.risk.low;
    case "medium":
      return colors.risk.medium;
    case "high":
      return colors.risk.high;
    case "critical":
      return colors.risk.critical;
  }
}

export function getRiskHexColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return colors.risk.lowHex;
    case "medium":
      return colors.risk.mediumHex;
    case "high":
      return colors.risk.highHex;
    case "critical":
      return colors.risk.criticalHex;
  }
}

export function getRiskEmoji(risk: RiskLevel): string {
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

export type AppStatus = "idle" | "investigating" | "awaiting_approval" | "complete" | "error";

export function getStatusColor(status: AppStatus): string {
  switch (status) {
    case "investigating":
      return colors.warning;
    case "awaiting_approval":
      return colors.error;
    case "complete":
      return colors.success;
    case "error":
      return colors.error;
    default:
      return colors.text.secondary;
  }
}

export function getStatusText(status: AppStatus, currentTool?: string | null): string {
  switch (status) {
    case "investigating":
      return currentTool ? `Running: ${currentTool}` : "Investigating...";
    case "awaiting_approval":
      return "Awaiting Approval";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}
