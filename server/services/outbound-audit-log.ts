/**
 * Outbound Email Audit Log
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 Remediation: Central write helper for the outbound_email_audit_log
 * table. Every outbound email (sent, blocked, failed, or draft) across all
 * channels (sendgrid, gmail, agentmail) is recorded here.
 *
 * The table is created lazily on first use — no schema migration required.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS outbound_email_audit_log (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        organization_id     TEXT NOT NULL,
        channel             TEXT NOT NULL,
        source_system       TEXT NOT NULL,
        source_record_id    TEXT,
        recipient_email     TEXT NOT NULL,
        recipient_name      TEXT,
        from_email          TEXT,
        subject             TEXT,
        email_type          TEXT,
        triggered_by        TEXT,
        auto_sent           BOOLEAN NOT NULL DEFAULT false,
        approval_required   BOOLEAN NOT NULL DEFAULT false,
        approval_status     TEXT DEFAULT 'n/a',
        policy_decision     TEXT,
        guard_result        TEXT,
        status              TEXT NOT NULL DEFAULT 'sent',
        provider_message_id TEXT,
        error_message       TEXT,
        sent_at             TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_oeall_org         ON outbound_email_audit_log (organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_oeall_recipient   ON outbound_email_audit_log (recipient_email)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_oeall_channel     ON outbound_email_audit_log (channel)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_oeall_status      ON outbound_email_audit_log (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_oeall_created_at  ON outbound_email_audit_log (created_at)`);
    tableEnsured = true;
  } catch (e: any) {
    console.warn("[AuditLog] Table setup warning:", e?.message);
  }
}

export interface AuditLogEntry {
  orgId: string;
  channel: "sendgrid" | "gmail" | "agentmail";
  sourceSystem: string;
  sourceRecordId?: string;
  recipientEmail: string;
  recipientName?: string;
  fromEmail?: string;
  subject?: string;
  emailType?: string;
  triggeredBy?: string;
  autoSent?: boolean;
  approvalRequired?: boolean;
  approvalStatus?: string;
  policyDecision?: string;
  guardResult?: string;
  status: "sent" | "blocked" | "failed" | "draft_created";
  providerMessageId?: string;
  errorMessage?: string;
  sentAt?: Date;
}

/**
 * Write one record to the unified outbound email audit log.
 * Returns the new row ID, or undefined on error (never throws).
 */
export async function writeOutboundAuditLog(entry: AuditLogEntry): Promise<string | undefined> {
  try {
    await ensureTable();
    const rows = await db.execute(sql`
      INSERT INTO outbound_email_audit_log (
        id, organization_id, channel, source_system, source_record_id,
        recipient_email, recipient_name, from_email, subject, email_type,
        triggered_by, auto_sent, approval_required, approval_status,
        policy_decision, guard_result, status, provider_message_id,
        error_message, sent_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${entry.orgId},
        ${entry.channel},
        ${entry.sourceSystem},
        ${entry.sourceRecordId ?? null},
        ${entry.recipientEmail},
        ${entry.recipientName ?? null},
        ${entry.fromEmail ?? null},
        ${entry.subject ?? null},
        ${entry.emailType ?? null},
        ${entry.triggeredBy ?? null},
        ${entry.autoSent ?? false},
        ${entry.approvalRequired ?? false},
        ${entry.approvalStatus ?? 'n/a'},
        ${entry.policyDecision ?? null},
        ${entry.guardResult ?? null},
        ${entry.status},
        ${entry.providerMessageId ?? null},
        ${entry.errorMessage ?? null},
        ${entry.sentAt ?? null},
        NOW(), NOW()
      )
      RETURNING id
    `);
    const r = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return r[0]?.id as string | undefined;
  } catch (e: any) {
    console.warn("[AuditLog] Write error:", e?.message);
    return undefined;
  }
}

/**
 * Query the audit log with optional filters.
 */
export async function queryOutboundAuditLog(opts: {
  orgId: string;
  channel?: string;
  status?: string;
  autoSent?: boolean;
  approvalRequired?: boolean;
  policyDecision?: string;
  guardResult?: string;
  recipientEmail?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: any[]; total: number }> {
  await ensureTable();

  const conditions: string[] = [`organization_id = '${opts.orgId.replace(/'/g, "''")}'`];
  if (opts.channel) conditions.push(`channel = '${opts.channel.replace(/'/g, "''")}'`);
  if (opts.status) conditions.push(`status = '${opts.status.replace(/'/g, "''")}'`);
  if (opts.autoSent !== undefined) conditions.push(`auto_sent = ${opts.autoSent}`);
  if (opts.approvalRequired !== undefined) conditions.push(`approval_required = ${opts.approvalRequired}`);
  if (opts.policyDecision) conditions.push(`policy_decision = '${opts.policyDecision.replace(/'/g, "''")}'`);
  if (opts.recipientEmail) conditions.push(`recipient_email ILIKE '%${opts.recipientEmail.replace(/'/g, "''")}%'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  try {
    const [rowsResult, countResult] = await Promise.all([
      db.execute(sql.raw(`
        SELECT * FROM outbound_email_audit_log
        ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`SELECT COUNT(*)::int AS total FROM outbound_email_audit_log ${where}`)),
    ]);

    const rows = Array.isArray(rowsResult) ? rowsResult : (rowsResult as any).rows ?? [];
    const countRows = Array.isArray(countResult) ? countResult : (countResult as any).rows ?? [];
    const total = parseInt(countRows[0]?.total ?? "0", 10);

    return { rows, total };
  } catch (e: any) {
    console.warn("[AuditLog] Query error:", e?.message);
    return { rows: [], total: 0 };
  }
}
