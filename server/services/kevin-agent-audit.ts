/**
 * kevin-agent-audit.ts — Structured audit logging for Kevin agent job lifecycle.
 *
 * Never logs secrets, full HMAC signatures, sensitive payment details,
 * or unnecessary personal information.
 */

export type AgentAuditEvent =
  | "agent.job.requested"
  | "agent.job.dispatching"
  | "agent.job.accepted"
  | "agent.job.running"
  | "agent.job.callback_received"
  | "agent.job.completed"
  | "agent.job.failed"
  | "agent.job.blocked"
  | "agent.job.cancelled"
  | "agent.job.replayed_callback_rejected"
  | "agent.job.invalid_signature_rejected"
  | "retention.analysis.created"
  | "retention.analysis.viewed";

export interface AgentAuditMetadata {
  organizationId?: string;
  userId?: string;
  agentId?: string;
  taskType?: string;
  jobId?: string;
  remoteTaskId?: string;
  clientId?: string;
  correlationId?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Emits a structured audit log event.
 * Uses console.log so it integrates with existing Replit log collection.
 */
export function auditAgentJob(
  event: AgentAuditEvent,
  metadata: AgentAuditMetadata = {},
): void {
  // Strip any accidental secret-shaped values
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lk = key.toLowerCase();
    if (
      lk.includes("secret") ||
      lk.includes("hmac") ||
      lk.includes("signature") ||
      lk.includes("token") ||
      lk.includes("password") ||
      lk.includes("key")
    ) {
      // Skip sensitive fields
      continue;
    }
    safe[key] = value;
  }

  console.log(
    JSON.stringify({
      event,
      ...safe,
      timestamp: new Date().toISOString(),
    }),
  );
}
