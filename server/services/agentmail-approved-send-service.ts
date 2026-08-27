import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { pool } from "../db";
import { validateAgentMailApprovedSendSchema } from "../agentmail-approved-send-schema-validation";

export interface AgentMailApprovedPayload {
  recipientEmail: string;
  subject: string;
  body: string;
  inbox: string;
  agentName: string;
  providerInboundMessageId: string | null;
  threadId: string | null;
}

export interface AgentMailApprovedReplyAuthority extends AgentMailApprovedPayload {
  replyQueueId: string;
  orgId: string;
  logicalSendId: string;
  approvedPayloadVersion: string;
  approvalVersion: number;
}

export interface ApprovedProviderResult {
  ok: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  /** False for network/timeout outcomes where the provider may have accepted the send. */
  outcomeCertain?: boolean;
}

export type ApprovedSendResult = {
  ok: boolean;
  logicalSendRowId?: string;
  logicalSendId?: string;
  attemptId?: string;
  state: "confirmed_success" | "confirmed_failure" | "uncertain_provider_outcome" | "in_progress" | "suppressed";
  messageId?: string;
  error?: string;
  providerInvoked: boolean;
  duplicate: boolean;
};

export class AgentMailApprovedSendAuthorityError extends Error {
  constructor(message: string, readonly code: "not_found" | "not_approved" | "stale_approval" | "invalid_authority") {
    super(message);
    this.name = "AgentMailApprovedSendAuthorityError";
  }
}

type Queryable = Pick<pg.Pool, "query" | "connect">;

/**
 * Canonical serialization v1 is a JSON array with fixed field order and exact
 * send values. Null thread context remains explicit. Attachments are omitted
 * because this route currently has no attachment input.
 */
export function canonicalAgentMailApprovedPayload(payload: AgentMailApprovedPayload): string {
  return JSON.stringify([
    "agentmail-approved-payload-v1",
    payload.recipientEmail,
    payload.subject,
    payload.body,
    payload.inbox,
    payload.agentName,
    payload.providerInboundMessageId,
    payload.threadId,
  ]);
}

export function agentMailApprovedPayloadDigest(payload: AgentMailApprovedPayload): string {
  return createHash("sha256").update(canonicalAgentMailApprovedPayload(payload)).digest("hex");
}

function payloadFromRow(row: any): AgentMailApprovedPayload {
  const edited = typeof row.edited_body === "string" ? row.edited_body.trim() : "";
  return {
    recipientEmail: row.recipient_email,
    subject: row.subject,
    body: edited || row.draft_body,
    inbox: row.inbox,
    agentName: row.agent_name,
    providerInboundMessageId: row.provider_inbound_message_id ?? null,
    threadId: row.thread_id ?? null,
  };
}

function approvedVersion(version: number, payload: AgentMailApprovedPayload): string {
  return `v${version}:${agentMailApprovedPayloadDigest(payload)}`;
}

export function newAgentMailReplyIdentity(): { replyQueueId: string; logicalSendId: string } {
  const replyQueueId = randomUUID();
  // A reply-queue row represents exactly one intended reply to one inbound
  // message. Reapproval changes its payload version, not its business send.
  return { replyQueueId, logicalSendId: replyQueueId };
}

export async function approveAgentMailReplyAuthority(
  orgId: string,
  replyQueueId: string,
  approvedBy: string,
  database: Queryable = pool,
): Promise<AgentMailApprovedReplyAuthority> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM agent_mail_reply_queue WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [replyQueueId, orgId],
    );
    const row = result.rows[0];
    if (!row) throw new AgentMailApprovedSendAuthorityError("Reply not found", "not_found");
    if (row.status === "sent") throw new AgentMailApprovedSendAuthorityError("Reply already sent", "invalid_authority");
    if (!row.logical_send_id?.trim()) {
      throw new AgentMailApprovedSendAuthorityError("Legacy reply has no canonical logical-send identity", "invalid_authority");
    }
    const nextVersion = Number(row.approval_version ?? 0) + 1;
    const payload = payloadFromRow(row);
    const version = approvedVersion(nextVersion, payload);
    await client.query(
      `UPDATE agent_mail_reply_queue SET approval_status='approved',approved_by=$3,approved_at=NOW(),
         status='approved',approval_version=$4,approved_payload_version=$5,updated_at=NOW()
       WHERE id=$1 AND organization_id=$2`,
      [replyQueueId, orgId, approvedBy, nextVersion, version],
    );
    await client.query("COMMIT");
    return {
      ...payload, replyQueueId, orgId, logicalSendId: row.logical_send_id,
      approvedPayloadVersion: version, approvalVersion: nextVersion,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function editAgentMailReplyAuthority(
  orgId: string,
  replyQueueId: string,
  editedBody: string,
  database: Queryable = pool,
): Promise<boolean> {
  const result = await database.query(
    `UPDATE agent_mail_reply_queue
     SET edited_body=$3,approval_status='pending_review',approved_by=NULL,approved_at=NULL,
           approved_payload_version=NULL,status='pending_review',updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status IN ('drafted','pending_review','approved')`,
    [replyQueueId, orgId, editedBody],
  );
  return (result.rowCount ?? 0) === 1;
}

async function loadAuthority(database: Queryable, orgId: string, replyQueueId: string): Promise<AgentMailApprovedReplyAuthority> {
  const result = await database.query(
    `SELECT * FROM agent_mail_reply_queue WHERE id=$1 AND organization_id=$2`,
    [replyQueueId, orgId],
  );
  const row = result.rows[0];
  if (!row) throw new AgentMailApprovedSendAuthorityError("Reply not found", "not_found");
  if (row.approval_status !== "approved" || !row.logical_send_id?.trim() || !row.approved_payload_version?.trim()) {
    throw new AgentMailApprovedSendAuthorityError("Reply requires a current approval", "not_approved");
  }
  const payload = payloadFromRow(row);
  const expected = approvedVersion(Number(row.approval_version), payload);
  if (expected !== row.approved_payload_version) {
    throw new AgentMailApprovedSendAuthorityError("Approved payload version is stale", "stale_approval");
  }
  return {
    ...payload, replyQueueId, orgId, logicalSendId: row.logical_send_id,
    approvedPayloadVersion: row.approved_payload_version, approvalVersion: Number(row.approval_version),
  };
}

async function loadPreflightAuthority(database: Queryable, orgId: string, replyQueueId: string): Promise<AgentMailApprovedReplyAuthority> {
  const result = await database.query(
    `SELECT id,organization_id,recipient_email,subject,draft_body,edited_body,inbox,agent_name,
       provider_inbound_message_id,thread_id,approval_status
     FROM agent_mail_reply_queue WHERE id=$1 AND organization_id=$2`,
    [replyQueueId, orgId],
  );
  const row = result.rows[0];
  if (!row) throw new AgentMailApprovedSendAuthorityError("Reply not found", "not_found");
  if (row.approval_status !== "approved") {
    throw new AgentMailApprovedSendAuthorityError("Reply requires a current approval", "not_approved");
  }
  return {
    ...payloadFromRow(row), replyQueueId, orgId, logicalSendId: "preflight-only",
    approvedPayloadVersion: "preflight-only", approvalVersion: 0,
  };
}

type Claim = { authorized: boolean; duplicate: boolean; logicalSendRowId: string; attemptId?: string; state: ApprovedSendResult["state"]; messageId?: string };

async function claimAttempt(database: Queryable, authority: AgentMailApprovedReplyAuthority): Promise<Claim> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`agentmail-approved:${authority.orgId}:${authority.logicalSendId}`],
    );
    const locked = await client.query(
      `SELECT * FROM agent_mail_reply_queue WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
      [authority.replyQueueId, authority.orgId],
    );
    const row = locked.rows[0];
    if (!row || row.approval_status !== "approved" || row.logical_send_id !== authority.logicalSendId
      || row.approved_payload_version !== authority.approvedPayloadVersion
      || approvedVersion(Number(row.approval_version), payloadFromRow(row)) !== authority.approvedPayloadVersion) {
      throw new AgentMailApprovedSendAuthorityError("Approval changed before send claim", "stale_approval");
    }

    const inserted = await client.query(
      `INSERT INTO agentmail_approved_logical_sends
        (id,org_id,send_class,logical_send_id,authority_type,authority_id,approved_payload_version,status,provider)
       VALUES($1,$2,'human_approved',$3,'agentmail_reply_queue',$4,$5,'claimed','agentmail')
       ON CONFLICT(org_id,send_class,logical_send_id) DO NOTHING RETURNING id`,
      [randomUUID(), authority.orgId, authority.logicalSendId, authority.replyQueueId, authority.approvedPayloadVersion],
    );
    let logicalSendRowId = inserted.rows[0]?.id as string | undefined;
    let attemptNumber = 1;
    if (!logicalSendRowId) {
      const existingResult = await client.query(
        `SELECT * FROM agentmail_approved_logical_sends
         WHERE org_id=$1 AND send_class='human_approved' AND logical_send_id=$2 FOR UPDATE`,
        [authority.orgId, authority.logicalSendId],
      );
      const existing = existingResult.rows[0];
      if (!existing || existing.authority_type !== "agentmail_reply_queue"
        || existing.authority_id !== authority.replyQueueId
        || existing.approved_payload_version !== authority.approvedPayloadVersion) {
        throw new AgentMailApprovedSendAuthorityError("Logical-send identity conflicts with approval authority", "invalid_authority");
      }
      logicalSendRowId = existing.id;
      if (!logicalSendRowId) throw new Error("persisted logical send has no ID");
      if (existing.status === "confirmed_success") {
        const receipt = await client.query(
          `SELECT provider_message_id FROM agentmail_approved_send_attempts
           WHERE logical_send_row_id=$1 AND status='confirmed_success' ORDER BY attempt_number DESC LIMIT 1`,
          [logicalSendRowId],
        );
        await client.query("COMMIT");
        return { authorized: false, duplicate: true, logicalSendRowId, state: "confirmed_success", messageId: receipt.rows[0]?.provider_message_id };
      }
      if (existing.status === "attempt_in_progress") {
        await client.query("COMMIT");
        return { authorized: false, duplicate: true, logicalSendRowId, state: "in_progress" };
      }
      if (existing.status === "claimed") {
        const resumable = await client.query(
          `SELECT id FROM agentmail_approved_send_attempts
           WHERE logical_send_row_id=$1 AND status='authorized' ORDER BY attempt_number DESC LIMIT 1`,
          [logicalSendRowId],
        );
        const attemptId = resumable.rows[0]?.id as string | undefined;
        if (!attemptId) {
          throw new Error("claimed logical send has no authorized provider attempt");
        }
        await client.query("COMMIT");
        return { authorized: true, duplicate: true, logicalSendRowId, attemptId, state: "in_progress" };
      }
      if (existing.status === "uncertain_provider_outcome") {
        await client.query("COMMIT");
        return { authorized: false, duplicate: true, logicalSendRowId, state: "uncertain_provider_outcome" };
      }
      const number = await client.query(
        `SELECT COALESCE(MAX(attempt_number),0)+1 AS next_attempt FROM agentmail_approved_send_attempts WHERE logical_send_row_id=$1`,
        [logicalSendRowId],
      );
      attemptNumber = Number(number.rows[0].next_attempt);
      await client.query(
        `UPDATE agentmail_approved_logical_sends SET status='claimed',succeeded_at=NULL,uncertain_at=NULL,updated_at=NOW() WHERE id=$1`,
        [logicalSendRowId],
      );
    }
    if (!logicalSendRowId) throw new Error("logical send claim did not return an ID");
    const attemptId = randomUUID();
    await client.query(
      `INSERT INTO agentmail_approved_send_attempts
        (id,logical_send_row_id,attempt_number,provider,approved_payload_version,status)
       VALUES($1,$2,$3,'agentmail',$4,'authorized')`,
      [attemptId, logicalSendRowId, attemptNumber, authority.approvedPayloadVersion],
    );
    const queueClaim = await client.query(
      `UPDATE agent_mail_reply_queue SET status='send_in_progress',updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND approval_status='approved'
         AND logical_send_id=$3 AND approved_payload_version=$4`,
      [authority.replyQueueId, authority.orgId, authority.logicalSendId, authority.approvedPayloadVersion],
    );
    if (queueClaim.rowCount !== 1) {
      throw new AgentMailApprovedSendAuthorityError("Reply authority changed during send claim", "stale_approval");
    }
    await client.query("COMMIT");
    return { authorized: true, duplicate: false, logicalSendRowId, attemptId, state: "in_progress" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function startProviderAttempt(
  database: Queryable,
  logicalSendRowId: string,
  attemptId: string,
): Promise<boolean> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const attempt = await client.query(
      `UPDATE agentmail_approved_send_attempts SET status='in_progress',started_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND logical_send_row_id=$2 AND status='authorized'`,
      [attemptId, logicalSendRowId],
    );
    if (attempt.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    const logical = await client.query(
      `UPDATE agentmail_approved_logical_sends SET status='attempt_in_progress',updated_at=NOW()
       WHERE id=$1 AND status='claimed'`,
      [logicalSendRowId],
    );
    if (logical.rowCount !== 1) throw new Error("logical send was not claimable for provider invocation");
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistResult(
  database: Queryable,
  authority: AgentMailApprovedReplyAuthority,
  claim: Required<Pick<Claim, "logicalSendRowId" | "attemptId">>,
  state: "confirmed_success" | "confirmed_failure" | "uncertain_provider_outcome",
  result: ApprovedProviderResult,
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const completedAt = new Date();
    const attemptUpdate = await client.query(
      `UPDATE agentmail_approved_send_attempts SET status=$2,provider_message_id=$3,provider_thread_id=$4,
         error_message=$5,completed_at=$6,updated_at=NOW()
       WHERE id=$1 AND logical_send_row_id=$7 AND status='in_progress'`,
      [claim.attemptId, state, result.messageId ?? null, result.threadId ?? null, result.error ?? null, completedAt, claim.logicalSendRowId],
    );
    if (attemptUpdate.rowCount !== 1) throw new Error("provider attempt result transition was not persisted");
    const logicalUpdate = await client.query(
      `UPDATE agentmail_approved_logical_sends SET status=$2,
         succeeded_at=CASE WHEN $2='confirmed_success' THEN $3::timestamptz ELSE NULL END,
         uncertain_at=CASE WHEN $2='uncertain_provider_outcome' THEN $3::timestamptz ELSE NULL END,updated_at=NOW()
       WHERE id=$1 AND status='attempt_in_progress'`,
      [claim.logicalSendRowId, state, completedAt],
    );
    if (logicalUpdate.rowCount !== 1) throw new Error("logical send result transition was not persisted");
    if (state === "confirmed_success") {
      const queueUpdate = await client.query(
        `UPDATE agent_mail_reply_queue SET status='sent',final_body=$3,sent_at=$4,
           provider_message_id=$5,delivery_status='delivered',updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND logical_send_id=$6 AND approved_payload_version=$7`,
        [authority.replyQueueId, authority.orgId, authority.body, completedAt, result.messageId ?? null,
          authority.logicalSendId, authority.approvedPayloadVersion],
      );
      if (queueUpdate.rowCount !== 1) throw new Error("reply queue success transition was not persisted");
    } else if (state === "confirmed_failure") {
      await client.query(
        `UPDATE agent_mail_reply_queue SET status='failed',delivery_status='failed',rejection_reason=$3,updated_at=NOW()
         WHERE id=$1 AND organization_id=$2`,
        [authority.replyQueueId, authority.orgId, result.error ?? "Send failed"],
      );
    } else {
      await client.query(
        `UPDATE agent_mail_reply_queue SET status='send_unknown',delivery_status='unknown',rejection_reason=$3,updated_at=NOW()
         WHERE id=$1 AND organization_id=$2`,
        [authority.replyQueueId, authority.orgId, result.error ?? "Provider outcome unknown"],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function executeAgentMailApprovedReply(options: {
  orgId: string;
  replyQueueId: string;
  preflight: (authority: AgentMailApprovedReplyAuthority) => Promise<{ allowed: boolean; error?: string }>;
  invokeProvider: (authority: AgentMailApprovedReplyAuthority) => Promise<ApprovedProviderResult>;
  database?: Queryable;
  validateSchema?: () => Promise<void>;
}): Promise<ApprovedSendResult> {
  const database = options.database ?? pool;
  const preflightAuthority = await loadPreflightAuthority(database, options.orgId, options.replyQueueId);
  const preflight = await options.preflight(preflightAuthority);
  if (!preflight.allowed) {
    return { ok: false, state: "suppressed", error: preflight.error ?? "Send blocked", providerInvoked: false, duplicate: false };
  }
  await (options.validateSchema ?? (() => validateAgentMailApprovedSendSchema()))();
  const authority = await loadAuthority(database, options.orgId, options.replyQueueId);
  const claim = await claimAttempt(database, authority);
  if (!claim.authorized || !claim.attemptId) {
    return {
      ok: claim.state === "confirmed_success", state: claim.state, messageId: claim.messageId,
      logicalSendRowId: claim.logicalSendRowId, logicalSendId: authority.logicalSendId,
      providerInvoked: false, duplicate: true,
    };
  }

  const started = await startProviderAttempt(database, claim.logicalSendRowId, claim.attemptId);
  if (!started) {
    return {
      ok: false, state: "in_progress", logicalSendRowId: claim.logicalSendRowId,
      logicalSendId: authority.logicalSendId, attemptId: claim.attemptId,
      providerInvoked: false, duplicate: true,
    };
  }

  let providerResult: ApprovedProviderResult;
  try {
    providerResult = await options.invokeProvider(authority);
  } catch (error) {
    providerResult = { ok: false, outcomeCertain: false, error: error instanceof Error ? error.message : "Provider outcome unknown" };
  }
  const state = providerResult.ok
    ? "confirmed_success"
    : providerResult.outcomeCertain === false ? "uncertain_provider_outcome" : "confirmed_failure";
  try {
    await persistResult(database, authority, { logicalSendRowId: claim.logicalSendRowId, attemptId: claim.attemptId }, state, providerResult);
  } catch {
    // The durable in-progress attempt is intentionally left unresolved. It is
    // treated as unknown on every subsequent call and never blindly retried.
    return {
      ok: false, state: "uncertain_provider_outcome", error: "Provider result could not be durably recorded",
      logicalSendRowId: claim.logicalSendRowId, logicalSendId: authority.logicalSendId, attemptId: claim.attemptId,
      providerInvoked: true, duplicate: false,
    };
  }
  return {
    ok: state === "confirmed_success", state, messageId: providerResult.messageId, error: providerResult.error,
    logicalSendRowId: claim.logicalSendRowId, logicalSendId: authority.logicalSendId, attemptId: claim.attemptId,
    providerInvoked: true, duplicate: false,
  };
}
