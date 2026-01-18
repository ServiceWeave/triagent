import { randomBytes } from "crypto";

export interface PendingApproval {
  id: string;
  command: string;
  token: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: Date;
  expiresAt: Date;
}

export interface ApprovalStore {
  /** Request approval for a command, returns pending approval info */
  requestApproval(command: string): PendingApproval;

  /** Approve a pending request, returns the token */
  approve(id: string): string | null;

  /** Reject a pending request */
  reject(id: string): void;

  /** Validate an approval token for a command */
  validateToken(command: string, token: string): boolean;

  /** Get pending approval by ID */
  getPending(id: string): PendingApproval | undefined;

  /** Get all pending approvals */
  getAllPending(): PendingApproval[];

  /** Clear expired approvals */
  clearExpired(): void;
}

// Risk patterns - more dangerous commands = higher risk
const CRITICAL_PATTERNS = [
  /\bkubectl\s+delete\s+(namespace|ns|node|pv|pvc|clusterrole)/i,
  /\brm\s+-rf?\s+\/(?!tmp)/i, // rm -rf not in /tmp
  /\bgit\s+push\s+.*--force/i,
  /\bhelm\s+(uninstall|delete)\b/i,
];

const HIGH_PATTERNS = [
  /\bkubectl\s+delete\b/i,
  /\bkubectl\s+apply\s+-f\s+http/i, // apply from URL
  /\bkubectl\s+drain\b/i,
  /\bkubectl\s+cordon\b/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+push\b/i,
  /\bhelm\s+(install|upgrade)\b/i,
];

const MEDIUM_PATTERNS = [
  /\bkubectl\s+scale\b/i,
  /\bkubectl\s+rollout\s+(restart|undo)/i,
  /\bkubectl\s+(apply|create|patch)\b/i,
  /\bgit\s+(commit|merge|rebase)/i,
];

function classifyRisk(command: string): PendingApproval["riskLevel"] {
  if (CRITICAL_PATTERNS.some(p => p.test(command))) return "critical";
  if (HIGH_PATTERNS.some(p => p.test(command))) return "high";
  if (MEDIUM_PATTERNS.some(p => p.test(command))) return "medium";
  return "low";
}

function generateToken(): string {
  return randomBytes(16).toString("hex");
}

function generateId(): string {
  return randomBytes(8).toString("hex");
}

const EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

// Singleton store instance
class ApprovalStoreImpl implements ApprovalStore {
  private pending: Map<string, PendingApproval> = new Map();
  private approvedTokens: Map<string, { command: string; expiresAt: Date }> = new Map();

  requestApproval(command: string): PendingApproval {
    // Clean up expired entries first
    this.clearExpired();

    const id = generateId();
    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRATION_MS);

    const approval: PendingApproval = {
      id,
      command,
      token,
      riskLevel: classifyRisk(command),
      createdAt: now,
      expiresAt,
    };

    this.pending.set(id, approval);
    return approval;
  }

  approve(id: string): string | null {
    const pending = this.pending.get(id);
    if (!pending) return null;

    // Check if expired
    if (new Date() > pending.expiresAt) {
      this.pending.delete(id);
      return null;
    }

    // Move to approved tokens
    this.approvedTokens.set(pending.token, {
      command: pending.command,
      expiresAt: pending.expiresAt,
    });

    // Remove from pending
    this.pending.delete(id);

    return pending.token;
  }

  reject(id: string): void {
    this.pending.delete(id);
  }

  validateToken(command: string, token: string): boolean {
    const approved = this.approvedTokens.get(token);
    if (!approved) return false;

    // Check expiration
    if (new Date() > approved.expiresAt) {
      this.approvedTokens.delete(token);
      return false;
    }

    // Token must match the exact command
    if (approved.command !== command) return false;

    // Token is valid - consume it (one-time use)
    this.approvedTokens.delete(token);
    return true;
  }

  getPending(id: string): PendingApproval | undefined {
    const pending = this.pending.get(id);
    if (pending && new Date() > pending.expiresAt) {
      this.pending.delete(id);
      return undefined;
    }
    return pending;
  }

  getAllPending(): PendingApproval[] {
    this.clearExpired();
    return Array.from(this.pending.values());
  }

  clearExpired(): void {
    const now = new Date();

    for (const [id, pending] of this.pending) {
      if (now > pending.expiresAt) {
        this.pending.delete(id);
      }
    }

    for (const [token, approved] of this.approvedTokens) {
      if (now > approved.expiresAt) {
        this.approvedTokens.delete(token);
      }
    }
  }
}

// Export singleton instance
export const approvalStore: ApprovalStore = new ApprovalStoreImpl();
