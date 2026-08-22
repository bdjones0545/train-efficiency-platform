import type { Pool, PoolClient } from "pg";
import { pool } from "../db";

export const FOLLOW_UP_LEASE_MS = 5 * 60 * 1000;
export const FOLLOW_UP_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
let schemaInitialization: Promise<void> | null = null;

export async function ensureFollowUpReliabilitySchema(db: Queryable = pool): Promise<void> {
  if (db === pool && schemaInitialization) return schemaInitialization;
  const initialize = async () => {
  for (const value of ["processing", "retrying", "failed"]) {
    await db.query(`ALTER TYPE follow_up_status ADD VALUE IF NOT EXISTS '${value}'`);
  }
  await db.query(`ALTER TABLE email_follow_ups
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT ${FOLLOW_UP_MAX_ATTEMPTS},
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ`);
  await db.query(`CREATE TABLE IF NOT EXISTS follow_up_send_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    follow_up_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('claimed','provider_succeeded','completed','failed','skipped')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    provider_message_id TEXT,
    last_error TEXT,
    provider_succeeded_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, follow_up_id)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_email_follow_ups_retry
    ON email_follow_ups (org_id, status, next_retry_at, processing_started_at)`);
  };
  if (db === pool) {
    schemaInitialization = initialize().catch((error) => { schemaInitialization = null; throw error; });
    return schemaInitialization;
  }
  return initialize();
}

export async function claimFollowUp(orgId: string, followUpId: string, db: Queryable = pool) {
  const result = await db.query(`UPDATE email_follow_ups SET
      status='processing', processing_started_at=NOW(), attempt_count=attempt_count+1,
      next_retry_at=NULL, updated_at=NOW()
    WHERE id=$1 AND org_id=$2 AND (
      (status IN ('pending','retrying') AND COALESCE(next_retry_at, scheduled_for) <= NOW())
      OR (status='processing' AND processing_started_at < NOW() - INTERVAL '5 minutes')
    ) RETURNING *`, [followUpId, orgId]);
  return result.rows[0] ?? null;
}

export async function prepareFollowUpSend(orgId: string, followUpId: string, db: Queryable = pool) {
  await db.query(`INSERT INTO follow_up_send_effects (org_id, follow_up_id, state, attempt_count)
    VALUES ($1,$2,'claimed',1) ON CONFLICT (org_id,follow_up_id) DO NOTHING`, [orgId, followUpId]);
  const current = await db.query(`SELECT * FROM follow_up_send_effects WHERE org_id=$1 AND follow_up_id=$2`, [orgId, followUpId]);
  const effect = current.rows[0];
  if (!effect) throw new Error("Follow-up send identity could not be persisted");
  if (effect.state === "provider_succeeded" || effect.state === "completed") return { shouldSend: false, effect };
  const claimed = await db.query(`UPDATE follow_up_send_effects SET state='claimed', attempt_count=attempt_count+1,
      last_error=NULL, updated_at=NOW() WHERE org_id=$1 AND follow_up_id=$2 AND state IN ('failed','skipped') RETURNING *`, [orgId, followUpId]);
  return { shouldSend: true, effect: claimed.rows[0] ?? effect };
}

export async function recordFollowUpProviderSuccess(
  orgId: string, followUpId: string, providerMessageId?: string, db: Queryable = pool,
): Promise<void> {
  const result = await db.query(`UPDATE follow_up_send_effects SET state='provider_succeeded',
      provider_message_id=COALESCE($3,provider_message_id), provider_succeeded_at=NOW(), last_error=NULL, updated_at=NOW()
    WHERE org_id=$1 AND follow_up_id=$2 AND state IN ('claimed','provider_succeeded') RETURNING id`,
    [orgId, followUpId, providerMessageId ?? null]);
  if (!result.rowCount) throw new Error("Follow-up provider success has no owned send identity");
}

export async function executeFollowUpProviderEffect(
  orgId: string,
  followUpId: string,
  send: () => Promise<{ providerMessageId?: string } | void>,
  afterProviderSuccess?: () => Promise<void> | void,
  db: Queryable = pool,
): Promise<{ providerCalled: boolean }> {
  const identity = await prepareFollowUpSend(orgId, followUpId, db);
  if (!identity.shouldSend) return { providerCalled: false };
  const result = await send();
  await recordFollowUpProviderSuccess(orgId, followUpId, result?.providerMessageId, db);
  await afterProviderSuccess?.();
  return { providerCalled: true };
}

export function isPermanentFollowUpFailure(error: unknown): boolean {
  const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? 0);
  if ([400, 401, 403, 404, 410, 422].includes(status)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /invalid recipient|malformed address|permanent rejection/.test(message);
}

export async function completeFollowUpSend(input: {
  orgId: string; followUpId: string; prospectId: string; recipientEmail: string;
  subject: string; body: string;
}, dbPool: Pool = pool): Promise<{ gmailActionId: string }> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const effect = await client.query(`UPDATE follow_up_send_effects SET state='completed',completed_at=NOW(),updated_at=NOW()
      WHERE org_id=$1 AND follow_up_id=$2 AND state IN ('provider_succeeded','completed') RETURNING id`, [input.orgId, input.followUpId]);
    if (!effect.rowCount) throw new Error("Provider success must be durable before follow-up completion");
    const followUp = await client.query(`UPDATE email_follow_ups SET status='sent',sent_at=COALESCE(sent_at,NOW()),
      subject=$3,body=$4,processing_started_at=NULL,next_retry_at=NULL,last_error=NULL,updated_at=NOW()
      WHERE id=$1 AND org_id=$2 AND status IN ('processing','retrying','sent') RETURNING id`,
      [input.followUpId, input.orgId, input.subject, input.body]);
    if (!followUp.rowCount) throw new Error("Owned follow-up could not be completed");
    const existing = await client.query(`SELECT id FROM gmail_agent_actions WHERE org_id=$1 AND action_type='follow_up_email'
      AND result->>'followUpId'=$2 AND status='auto_executed' LIMIT 1`, [input.orgId, input.followUpId]);
    let gmailActionId = existing.rows[0]?.id;
    if (!gmailActionId) {
      const action = await client.query(`INSERT INTO gmail_agent_actions
        (id,org_id,action_type,recipient_email,subject,body_preview,risk_level,approval_required,status,
         communication_domain,created_by_agent,executed_at,result)
        VALUES (gen_random_uuid()::text,$1,'follow_up_email',$2,$3,$4,'low',false,'auto_executed',
         'team_training','follow_up_cron',NOW(),jsonb_build_object('followUpId',$5::text,'prospectId',$6::text)) RETURNING id`,
        [input.orgId, input.recipientEmail, input.subject, input.body.slice(0, 300), input.followUpId, input.prospectId]);
      gmailActionId = action.rows[0].id;
    }
    await client.query("COMMIT");
    return { gmailActionId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function recordFollowUpFailure(
  orgId: string, followUpId: string, error: string, dbPool: Pool = pool, permanent = false,
): Promise<{ state: "retrying" | "failed"; attemptCount: number; nextRetryAt: Date | null }> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO follow_up_send_effects(org_id,follow_up_id,state,attempt_count,last_error)
      VALUES($1,$2,'failed',1,$3) ON CONFLICT(org_id,follow_up_id) DO UPDATE
      SET state='failed',last_error=EXCLUDED.last_error,updated_at=NOW()
      WHERE follow_up_send_effects.state NOT IN ('provider_succeeded','completed')`, [orgId, followUpId, error]);
    const row = await client.query(`SELECT attempt_count,max_attempts FROM email_follow_ups WHERE id=$1 AND org_id=$2 FOR UPDATE`, [followUpId, orgId]);
    if (!row.rowCount) throw new Error("Follow-up not found for failure transition");
    const attemptCount = Number(row.rows[0].attempt_count);
    const maxAttempts = Number(row.rows[0].max_attempts);
    const exhausted = permanent || attemptCount >= maxAttempts;
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
    const nextRetryAt = exhausted ? null : new Date(Date.now() + delay);
    await client.query(`UPDATE email_follow_ups SET status=$3::follow_up_status,last_error=$4,processing_started_at=NULL,
      next_retry_at=$5::timestamptz,failed_at=CASE WHEN $3::text='failed' THEN NOW() ELSE failed_at END,updated_at=NOW()
      WHERE id=$1 AND org_id=$2`, [followUpId, orgId, exhausted ? "failed" : "retrying", error, nextRetryAt]);
    await client.query("COMMIT");
    return { state: exhausted ? "failed" : "retrying", attemptCount, nextRetryAt };
  } catch (error_) {
    await client.query("ROLLBACK").catch(() => undefined); throw error_;
  } finally { client.release(); }
}

export async function markFollowUpSendSkipped(orgId: string, followUpId: string, db: Queryable = pool): Promise<void> {
  await db.query(`UPDATE follow_up_send_effects SET state='skipped',updated_at=NOW()
    WHERE org_id=$1 AND follow_up_id=$2 AND state NOT IN ('provider_succeeded','completed')`, [orgId, followUpId]);
}

export async function replayFailedFollowUp(orgId: string, followUpId: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query(`UPDATE email_follow_ups SET status='retrying',next_retry_at=NOW(),
      processing_started_at=NULL,updated_at=NOW() WHERE id=$1 AND org_id=$2 AND status='failed' RETURNING id`, [followUpId, orgId]);
  return Boolean(result.rowCount);
}
