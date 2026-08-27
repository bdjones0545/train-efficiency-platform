/**
 * AgentMail Inbound Router
 * Classifies inbound emails, creates downstream records, and routes to agents.
 * No outbound emails are sent automatically.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { newAgentMailReplyIdentity } from "./agentmail-approved-send-service";
import { agentOperatingTimeline, attentionItems, employmentApplicants, teamTrainingProspects } from "@shared/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmailClassification =
  | "new_lead"
  | "booking_request"
  | "reschedule_request"
  | "cancellation_request"
  | "pricing_question"
  | "employment_candidate"
  | "support_issue"
  | "billing_issue"
  | "athlete_parent_question"
  | "coach_partner_inquiry"
  | "software_bug_report"
  | "urgent_escalation"
  | "general_question"
  | "spam_or_noise";

export interface InboundEmailPayload {
  organizationId: string;
  inbox: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  providerMessageId?: string;  // SMTP Message-ID — authoritative dedup key
  providerInboxId?: string;    // Provider's inbox_id — authoritative inbox identity
  providerThreadId?: string;
  providerEventId?: string;    // Webhook event_id from the envelope
  receivedAt?: Date;
  rawPayload?: unknown;
}

export interface ClassificationResult {
  classification: EmailClassification;
  confidence: number;   // 0-1
  intentSignals: string[];
  routedAgent: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestedReply?: string;
  actionType?: string;
  extractedData?: Record<string, unknown>;
}

export interface ProcessResult {
  ok: boolean;
  inboundId?: string;
  classification?: EmailClassification;
  routedAgent?: string;
  attentionItemId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Effect idempotency log ───────────────────────────────────────────────────

/**
 * Claim a downstream effect slot and execute fn if not already done.
 *
 * Each downstream side-effect of an inbound message has a deterministic identity:
 *   (inbound_id, effect_type)
 *
 * The agentmail_effect_log table records completed effects.  Before running a
 * write, this function attempts to INSERT the (inbound_id, effect_type) pair.
 * ON CONFLICT DO NOTHING means a duplicate returns no row → skip.
 *
 * This prevents duplicate prospect/applicant/attention rows when a crash after
 * a downstream write causes a retry that reclaims the stale processing lease.
 *
 * @returns true if effect was executed; false if it was already completed.
 * A failed business write rejects and rolls back both the write and effect row.
 */
async function tryEffect(
  inboundId: string,
  effectType: string,
  fn: (tx: any) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = rows(await tx.execute(sql`
      INSERT INTO agentmail_effect_log (id, inbound_id, effect_type)
      VALUES (gen_random_uuid()::text, ${inboundId}, ${effectType})
      ON CONFLICT (inbound_id, effect_type) DO NOTHING
      RETURNING id
    `));
    if (!claimed[0]) return false;

    // The business write and completion record share this transaction. A thrown
    // error or process/connection failure rolls both back, leaving the effect
    // retryable. Concurrent attempts serialize on the unique constraint.
    await fn(tx);
    return true;
  });
}

// ─── Intent extraction ───────────────────────────────────────────────────────

export function extractIntentSignals(subject: string, body: string): string[] {
  const text = `${subject} ${body}`.toLowerCase();
  const signals: string[] = [];

  const checks: [RegExp, string][] = [
    [/\b(price|pricing|cost|how much|rate|fee|package|quote)\b/, "pricing_inquiry"],
    [/\b(book|schedule|reserve|appointment|session|slot|available|availability)\b/, "booking_intent"],
    [/\b(reschedule|change.*time|move.*appointment|different.*time|switch.*slot)\b/, "reschedule_intent"],
    [/\b(cancel|cancellation|drop|stop|withdraw|no longer)\b/, "cancellation_intent"],
    [/\b(apply|application|job|position|role|hiring|resume|cv|experience|coach.*position)\b/, "employment_intent"],
    [/\b(bug|error|broken|not working|issue|problem|glitch|crash|fix)\b/, "bug_report"],
    [/\b(billing|invoice|charge|payment|refund|overcharg|subscription)\b/, "billing_issue"],
    [/\b(urgent|asap|immediately|critical|emergency|escalate|serious)\b/, "urgent_flag"],
    [/\b(spam|unsubscribe|remove|stop emailing|opt.?out)\b/, "spam_signal"],
    [/\b(partner|partnership|collaborate|sponsor|integration|b2b)\b/, "partner_inquiry"],
    [/\b(parent|my (son|daughter|child|kid)|youth|teen|minor)\b/, "parent_signal"],
    [/\b(lead|interested|learn more|tell me more|information|info)\b/, "lead_signal"],
    [/\b(support|help|assist|question|how do i|having trouble)\b/, "support_signal"],
    [/\b(speed|strength|conditioning|training|program|athlete)\b/, "sports_training_signal"],
  ];

  for (const [re, signal] of checks) {
    if (re.test(text)) signals.push(signal);
  }

  return signals;
}

// ─── Deterministic classification ────────────────────────────────────────────

export function classifyInboundEmail(
  inbox: string,
  subject: string,
  body: string,
): ClassificationResult {
  const signals = extractIntentSignals(subject, body);
  const text = `${subject} ${body}`.toLowerCase();

  // Spam check first — applies across all inboxes
  if (
    signals.includes("spam_signal") ||
    /\b(lottery|winner|prince|inheritance|million dollar|click here|free gift)\b/.test(text)
  ) {
    return {
      classification: "spam_or_noise",
      confidence: 0.9,
      intentSignals: signals,
      routedAgent: "none",
      severity: "low",
    };
  }

  // Urgent escalation — high priority override
  if (signals.includes("urgent_flag") && inbox !== "hiring") {
    return {
      classification: "urgent_escalation",
      confidence: 0.85,
      intentSignals: signals,
      routedAgent: "CEO Heartbeat / Operations Agent",
      severity: "critical",
    };
  }

  // ── Inbox-specific primary routing ───────────────────────────────────────

  if (inbox === "hiring") {
    // hiring@ → almost always employment candidate unless clearly spam
    const classification: EmailClassification =
      signals.includes("employment_intent") || !signals.includes("spam_signal")
        ? "employment_candidate"
        : "general_question";
    return {
      classification,
      confidence: 0.88,
      intentSignals: signals,
      routedAgent: "Hiring / Employment Agent",
      severity: "medium",
    };
  }

  if (inbox === "scheduling") {
    if (signals.includes("reschedule_intent")) {
      return { classification: "reschedule_request", confidence: 0.9, intentSignals: signals, routedAgent: "Scheduling Agent", severity: "medium" };
    }
    if (signals.includes("cancellation_intent")) {
      return { classification: "cancellation_request", confidence: 0.9, intentSignals: signals, routedAgent: "Scheduling Agent", severity: "medium" };
    }
    if (signals.includes("booking_intent")) {
      return { classification: "booking_request", confidence: 0.9, intentSignals: signals, routedAgent: "Scheduling Agent", severity: "medium" };
    }
    return { classification: "booking_request", confidence: 0.7, intentSignals: signals, routedAgent: "Scheduling Agent", severity: "low" };
  }

  if (inbox === "revenue") {
    if (signals.includes("partner_inquiry")) {
      return { classification: "coach_partner_inquiry", confidence: 0.85, intentSignals: signals, routedAgent: "Revenue Agent", severity: "medium" };
    }
    if (signals.includes("pricing_inquiry")) {
      return { classification: "pricing_question", confidence: 0.88, intentSignals: signals, routedAgent: "Revenue Agent", severity: "medium" };
    }
    if (signals.includes("lead_signal") || signals.includes("sports_training_signal")) {
      return { classification: "new_lead", confidence: 0.82, intentSignals: signals, routedAgent: "Revenue Agent", severity: "high" };
    }
    return { classification: "new_lead", confidence: 0.65, intentSignals: signals, routedAgent: "Revenue Agent", severity: "medium" };
  }

  if (inbox === "support") {
    if (signals.includes("bug_report")) {
      return { classification: "software_bug_report", confidence: 0.87, intentSignals: signals, routedAgent: "Support / Client Success Agent", severity: "high" };
    }
    if (signals.includes("billing_issue")) {
      return { classification: "billing_issue", confidence: 0.9, intentSignals: signals, routedAgent: "Support / Client Success Agent", severity: "high" };
    }
    if (signals.includes("parent_signal")) {
      return { classification: "athlete_parent_question", confidence: 0.85, intentSignals: signals, routedAgent: "Support / Client Success Agent", severity: "medium" };
    }
    return { classification: "support_issue", confidence: 0.78, intentSignals: signals, routedAgent: "Support / Client Success Agent", severity: "medium" };
  }

  if (inbox === "ceo" || inbox === "operations") {
    if (signals.includes("partner_inquiry")) {
      return { classification: "coach_partner_inquiry", confidence: 0.82, intentSignals: signals, routedAgent: "Operations Agent", severity: "medium" };
    }
    return { classification: "urgent_escalation", confidence: 0.75, intentSignals: signals, routedAgent: "CEO Heartbeat / Operations Agent", severity: "high" };
  }

  // Fallback
  return {
    classification: "general_question",
    confidence: 0.6,
    intentSignals: signals,
    routedAgent: "Support / Client Success Agent",
    severity: "low",
  };
}

// ─── AI-enhanced classification (optional) ───────────────────────────────────

async function enhanceWithAI(
  base: ClassificationResult,
  subject: string,
  body: string,
): Promise<ClassificationResult & { suggestedReply?: string }> {
  if (!process.env.OPENAI_API_KEY) return base;

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const systemPrompt = `You are an email triage AI for a strength and conditioning business platform.
You will be given an inbound email and asked to:
1. Confirm or correct the classification
2. Generate a short, professional suggested reply draft (2-4 sentences max)

Classification options: new_lead, booking_request, reschedule_request, cancellation_request, pricing_question, employment_candidate, support_issue, billing_issue, athlete_parent_question, coach_partner_inquiry, software_bug_report, urgent_escalation, general_question, spam_or_noise

Respond ONLY with valid JSON: { "classification": "...", "confidence": 0.0-1.0, "suggestedReply": "..." }`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Subject: ${subject}\n\nBody: ${body.slice(0, 1000)}` },
      ],
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    return {
      ...base,
      classification: parsed.classification ?? base.classification,
      confidence: parsed.confidence ?? base.confidence,
      suggestedReply: parsed.suggestedReply,
    };
  } catch {
    return base;
  }
}

// ─── Resolve orgId from inbox address ────────────────────────────────────────

/**
 * Thin delegation wrapper — all routing logic lives in agentmail-ownership-service.ts.
 * Kept here for backward compatibility with existing importers.
 * Returns null on any failure; caller must quarantine the message.
 */
export async function resolveOrgFromInbox(toEmail: string): Promise<string | null> {
  const { resolveOrgFromInbox: resolve } = await import("../services/agentmail-ownership-service");
  const result = await resolve(toEmail).catch(() => ({
    orgId: null as null,
    role: null as null,
    reason: "no_ownership_record" as const,
  }));
  return result.orgId;
}

// ─── Attention Inbox insertion ────────────────────────────────────────────────

function severityScore(s: ClassificationResult["severity"]): number {
  return { critical: 95, high: 80, medium: 55, low: 30 }[s] ?? 50;
}

function levelFromSeverity(s: ClassificationResult["severity"]): string {
  return { critical: "critical", high: "important", medium: "suggested", low: "informational" }[s] ?? "informational";
}

async function addToAttentionInbox(
  executor: any,
  orgId: string,
  inboundId: string,
  email: InboundEmailPayload,
  result: ClassificationResult & { suggestedReply?: string },
): Promise<string | null> {
  const score = severityScore(result.severity);
    const level = levelFromSeverity(result.severity);

    const [item] = await executor.insert(attentionItems).values({
      orgId,
      level,
      category: "agentmail_inbound",
      title: `[${email.inbox.toUpperCase()}] ${email.subject.slice(0, 80)}`,
      body: `From: ${email.fromName ?? ""} <${email.fromEmail}>\nClassification: ${result.classification} (${Math.round(result.confidence * 100)}% confidence)\nAgent: ${result.routedAgent}\n\n${(email.bodyText ?? "").slice(0, 500)}`,
      source: "agentmail",
      sourceId: inboundId,
      severity: score,
      urgency: score,
      businessImpact: score,
      confidence: result.confidence,
      actionUrl: `/admin/agentmail?tab=inbound`,
      actionLabel: "Review Inbound Email",
      status: "active",
      metadata: {
        inbox: email.inbox,
        fromEmail: email.fromEmail,
        classification: result.classification,
        routedAgent: result.routedAgent,
        suggestedReply: result.suggestedReply,
        inboundMessageId: inboundId,
      },
    }).returning({ id: attentionItems.id });

  if (!item?.id) throw new Error("Attention item insert returned no id");
  return item.id;
}

// ─── Downstream record creation ───────────────────────────────────────────────

/**
 * Create downstream records for classified inbound email.
 * Each write is wrapped in tryEffect() which consults agentmail_effect_log to
 * prevent duplicate records when a crash after a partial write causes retry.
 *
 * Effect identities: "prospect", "applicant", "software_task"
 * Deterministic key: (inbound_id, effect_type) — unique per-event per-effect
 */
async function createDownstreamRecord(
  orgId: string,
  email: InboundEmailPayload,
  result: ClassificationResult & { suggestedReply?: string },
  inboundId: string,
): Promise<void> {
  const { classification, intentSignals } = result;
  const body = email.bodyText ?? "";

  if (classification === "new_lead" || classification === "pricing_question" || classification === "coach_partner_inquiry") {
    await tryEffect(inboundId, "prospect", async (tx) => {
      const nameParts = (email.fromName ?? email.fromEmail.split("@")[0]).split(" ");
      await tx.insert(teamTrainingProspects).values({
        orgId,
        prospectName: email.fromName ?? email.fromEmail,
        organizationType: "inbound_email",
        contactEmail: email.fromEmail,
        contactName: email.fromName ?? nameParts[0] ?? "",
        outreachStatus: "New",
        notes: `Inbound email via ${email.inbox}@\nSubject: ${email.subject}\n\n${body.slice(0, 800)}`,
        confidenceScore: Math.round(result.confidence * 100),
        pipelineType: "b2b",
        leadType: classification === "coach_partner_inquiry" ? "partner_inquiry" : "inbound_lead",
      } as any).onConflictDoNothing();
    });
  }

  if (classification === "employment_candidate") {
    await tryEffect(inboundId, "applicant", async (tx) => {
      const nameParts = (email.fromName ?? "Unknown Applicant").split(" ");
      await tx.insert(employmentApplicants).values({
        orgId,
        firstName: nameParts[0] ?? "Unknown",
        lastName: nameParts.slice(1).join(" ") || "Applicant",
        email: email.fromEmail,
        source: `agentmail_inbound_${email.inbox}`,
        status: "new",
        notes: `Inbound application via ${email.inbox}@\nSubject: ${email.subject}\n\n${body.slice(0, 800)}`,
        location: intentSignals.includes("parent_signal") ? "unknown" : undefined,
      } as any).onConflictDoNothing();
    });
  }

  if (classification === "software_bug_report") {
    await tryEffect(inboundId, "software_task", async (tx) => {
        await tx.execute(sql`
          INSERT INTO software_improvement_tasks (
            id, organization_id, title, problem_summary, severity, status,
            source_agent, source_type, priority, created_at, updated_at
          )
          VALUES (
            gen_random_uuid()::text,
            ${orgId},
            ${"Bug report: " + email.subject.slice(0, 100)},
            ${"Inbound bug report from " + email.fromEmail + "\n\n" + body.slice(0, 800)},
            ${"high"},
            ${"detected"},
            ${"agentmail_inbound"},
            ${"agentmail_inbound"},
            ${80},
            NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
        `);
    });
  }
}

// ─── CEO Heartbeat timeline ───────────────────────────────────────────────────

async function notifyCeoHeartbeat(
  executor: any,
  orgId: string,
  email: InboundEmailPayload,
  result: ClassificationResult,
  inboundId: string,
): Promise<void> {
  const [row] = await executor.insert(agentOperatingTimeline).values({
      orgId,
      agentName: result.routedAgent,
      actionType: "agentmail_inbound",
      actionStatus: "completed",
      priority: result.severity === "critical" ? 1 : result.severity === "high" ? 2 : 3,
      relatedEntityType: "inbound_email",
      relatedEntityId: inboundId,
      summary: `Inbound email received at ${email.inbox}@ from ${email.fromEmail} — classified as ${result.classification} (${Math.round(result.confidence * 100)}% confidence), routed to ${result.routedAgent}`,
      decisionReason: `Intent signals: ${result.intentSignals.join(", ")}`,
      requiresApproval: false,
      metadata: {
        inbox: email.inbox,
        fromEmail: email.fromEmail,
        subject: email.subject,
        classification: result.classification,
        severity: result.severity,
      },
    }).returning({ id: agentOperatingTimeline.id });
  if (!row?.id) throw new Error("CEO timeline insert returned no id");
}

// ─── Main processor ──────────────────────────────────────────────────────────

export async function processInboundAgentMail(
  payload: InboundEmailPayload,
  enhanceOverride?: (
    base: ClassificationResult,
    subject: string,
    body: string,
  ) => Promise<ClassificationResult & { suggestedReply?: string }>,
): Promise<ProcessResult> {
  const orgId = payload.organizationId;

  // 1. Classify
  const baseResult = classifyInboundEmail(
    payload.inbox,
    payload.subject,
    payload.bodyText ?? "",
  );

  // 2b. AI enhancement (best-effort)
  const result = await (enhanceOverride ?? enhanceWithAI)(baseResult, payload.subject, payload.bodyText ?? "");

  // 3. Persist + crash-recovery state machine
  //
  // States: received → processing → completed | failed
  //
  // On duplicate delivery (provider_message_id conflict):
  //   completed  → idempotent skip (already done)
  //   processing + fresh lease (< STALE_LEASE_MS) → concurrent skip
  //   processing + stale lease → reclaim and retry
  //   failed + attempts < MAX → reclaim and retry
  //   failed + attempts >= MAX → permanent skip
  //
  // This means a process crash mid-handling does NOT permanently suppress
  // retries — a subsequent delivery reclaims the stale lease and reprocesses.

  const STALE_LEASE_MS = 5 * 60 * 1000;  // 5 minutes
  const MAX_ATTEMPTS   = 3;

  let inboundId: string | null = null;

  try {
    // ── Step A: INSERT — or detect conflict ────────────────────────────────
    const inserted = rows(await db.execute(sql`
      INSERT INTO agent_mail_inbound_messages (
        id, organization_id, inbox, from_email, from_name, to_email,
        subject, body_text, body_html,
        provider_message_id, provider_inbox_id, provider_thread_id, provider_event_id,
        classification, confidence, routed_agent, routed_status,
        routing_status, routing_reason, routed_at,
        processing_state, processing_attempts,
        action_type, action_payload, raw_payload, error_message,
        received_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${orgId},
        ${payload.inbox},
        ${payload.fromEmail},
        ${payload.fromName ?? null},
        ${payload.toEmail},
        ${payload.subject},
        ${payload.bodyText ?? null},
        ${payload.bodyHtml ?? null},
        ${payload.providerMessageId ?? null},
        ${payload.providerInboxId ?? null},
        ${payload.providerThreadId ?? null},
        ${payload.providerEventId ?? null},
        ${result.classification},
        ${result.confidence},
        ${result.routedAgent},
        ${"received"},
        ${"routed"}, ${"resolved"}, NULL,
        ${"received"}, ${0},
        ${result.classification},
        ${JSON.stringify({ suggestedReply: result.suggestedReply, intentSignals: result.intentSignals })},
        ${payload.rawPayload ? JSON.stringify(payload.rawPayload) : null},
        ${null},
        ${payload.receivedAt ?? new Date()},
        NOW(), NOW()
      )
      ON CONFLICT (provider_message_id) DO NOTHING
      RETURNING id, processing_state, processing_attempts
    `));

    if (inserted[0]?.id) {
      // Fresh row — we own it, proceed to claim below
      inboundId = inserted[0].id;
    } else if (payload.providerMessageId) {
      // Conflict — fetch the existing row to decide
      const existing = rows(await db.execute(sql`
        SELECT id, processing_state, processing_started_at, processing_attempts
        FROM agent_mail_inbound_messages
        WHERE provider_message_id = ${payload.providerMessageId}
        LIMIT 1
      `));

      if (!existing[0]) {
        // Should not happen (conflict implies row exists), but guard anyway
        return { ok: false, error: "Failed to locate conflicting inbound message" };
      }

      const row = existing[0];
      const state:    string = row.processing_state;
      const attempts: number = Number(row.processing_attempts ?? 0);
      const startedAt: number = row.processing_started_at
        ? new Date(row.processing_started_at).getTime()
        : 0;

      if (state === "completed") {
        return { ok: true, skipped: true, skipReason: "already_completed", inboundId: row.id };
      }

      if (state === "processing" && Date.now() - startedAt < STALE_LEASE_MS) {
        return { ok: true, skipped: true, skipReason: "concurrent_processing", inboundId: row.id };
      }

      if (state === "failed" && attempts >= MAX_ATTEMPTS) {
        return { ok: true, skipped: true, skipReason: "max_processing_attempts", inboundId: row.id };
      }

      // Stale lease / failed-but-retryable / received — fall through to claim
      inboundId = row.id;
    } else {
      // No provider_message_id — can't resolve conflict; treat as failure
      return { ok: false, error: "Failed to persist inbound message (no deduplication key)" };
    }
  } catch (e: any) {
    console.error("[AgentMail Inbound] DB insert error:", e?.message);
    return { ok: false, error: `DB insert failed: ${e?.message}` };
  }

  if (!inboundId) return { ok: false, error: "Failed to persist inbound message" };

  // ── Step B: Atomic lease claim ───────────────────────────────────────────
  try {
    const claimed = rows(await db.execute(sql`
      UPDATE agent_mail_inbound_messages
      SET processing_state      = 'processing',
          processing_started_at = NOW(),
          processing_attempts   = processing_attempts + 1,
          updated_at            = NOW()
      WHERE id = ${inboundId}
        AND (
          processing_state = 'received'
          OR (processing_state = 'failed' AND processing_attempts < ${MAX_ATTEMPTS})
          OR (processing_state = 'processing'
              AND processing_started_at < NOW() - INTERVAL '5 minutes')
        )
      RETURNING id
    `));

    if (!claimed[0]?.id) {
      // Another worker claimed it between our SELECT and UPDATE
      return { ok: true, skipped: true, skipReason: "concurrent_processing", inboundId };
    }
  } catch (e: any) {
    console.error("[AgentMail Inbound] Lease claim error:", e?.message);
    return { ok: false, error: `Lease claim failed: ${e?.message}` };
  }

  // Downstream processing — wrapped so any error sets processing_state = 'failed'
  // rather than leaving the row stuck in 'processing'.
  try {
    // 5. Spam → store only, skip routing
    if (result.classification === "spam_or_noise") {
      await db.execute(sql`
        UPDATE agent_mail_inbound_messages
        SET routed_status    = 'spam_stored',
            processing_state = 'completed',
            routed_at        = NOW(),
            updated_at       = NOW()
        WHERE id = ${inboundId}
      `).catch(() => {});
      return { ok: true, inboundId, classification: result.classification, routedAgent: "none", skipped: true, skipReason: "spam_or_noise" };
    }

    // 6. Create downstream records — each write idempotent via agentmail_effect_log
    await createDownstreamRecord(orgId, payload, result, inboundId);

    // 7. Add to Attention Inbox — idempotent via effect log
    let attentionItemId: string | null = null;
    await tryEffect(inboundId, "attention_item", async (tx) => {
      attentionItemId = await addToAttentionInbox(tx, orgId, inboundId, payload, result);
    });

    // 7b. Reply queue entry — idempotent via effect log
    if (result.suggestedReply) {
      const replyIdentity = newAgentMailReplyIdentity();
      await tryEffect(inboundId, "reply_queue", async (tx) => {
        await tx.execute(sql`
          INSERT INTO agent_mail_reply_queue (
            id, logical_send_id, organization_id, inbound_message_id, inbox, agent_name, classification,
            recipient_email, recipient_name, subject, draft_body, status,
            approval_status, confidence, thread_id, provider_inbound_message_id,
            created_at, updated_at
          ) VALUES (
            ${replyIdentity.replyQueueId}, ${replyIdentity.logicalSendId}, ${orgId}, ${inboundId}, ${payload.inbox},
            ${result.routedAgent}, ${result.classification}, ${payload.fromEmail},
            ${payload.fromName ?? null}, ${`Re: ${payload.subject}`}, ${result.suggestedReply},
            'pending_review', 'pending_review', ${result.confidence},
            ${payload.providerThreadId ?? null}, ${payload.providerMessageId ?? null}, NOW(), NOW()
          ) ON CONFLICT (organization_id, inbound_message_id) DO NOTHING
        `);
      });
    }

    // 8. CEO Heartbeat timeline — idempotent via effect log
    await tryEffect(inboundId, "ceo_timeline", async (tx) => {
      await notifyCeoHeartbeat(tx, orgId, payload, result, inboundId);
    });

    // 9. Mark completed — processing_state transition: processing → completed
    await db.execute(sql`
      UPDATE agent_mail_inbound_messages
      SET routed_status    = 'routed',
          routing_status   = 'routed',
          routed_at        = NOW(),
          action_type      = ${result.classification},
          processing_state = 'completed',
          updated_at       = NOW()
      WHERE id = ${inboundId}
    `).catch(() => {});

    return {
      ok: true,
      inboundId,
      classification: result.classification,
      routedAgent: result.routedAgent,
      attentionItemId: attentionItemId ?? undefined,
    };
  } catch (downstreamErr: any) {
    // Downstream failure — mark as 'failed' so a subsequent retry can reclaim the lease.
    const errMsg = downstreamErr?.message ?? "unknown downstream error";
    console.error("[AgentMail Inbound] Downstream processing failed:", errMsg);
    await db.execute(sql`
      UPDATE agent_mail_inbound_messages
      SET processing_state = 'failed',
          last_error       = ${errMsg},
          updated_at       = NOW()
      WHERE id = ${inboundId}
    `).catch(() => {});
    return { ok: false, error: `Downstream processing failed: ${errMsg}`, inboundId };
  }
}

// ─── Map inbox to default agent ──────────────────────────────────────────────

export function mapInboxToDefaultAgent(inbox: string): string {
  const map: Record<string, string> = {
    revenue:    "Revenue Agent",
    hiring:     "Hiring / Employment Agent",
    scheduling: "Scheduling Agent",
    support:    "Support / Client Success Agent",
    operations: "Operations Agent",
    ceo:        "CEO Heartbeat / Operations Agent",
  };
  return map[inbox] ?? "Support / Client Success Agent";
}

// ─── Simulated test payloads ──────────────────────────────────────────────────

export const INBOUND_TEST_CASES: Array<{
  label: string;
  payload: Omit<InboundEmailPayload, "organizationId">;
}> = [
  {
    label: "Parent asking about speed training pricing",
    payload: {
      inbox: "revenue",
      fromEmail: "sarah.miller@gmail.com",
      fromName: "Sarah Miller",
      toEmail: "revenue@agentmail.to",
      subject: "Speed training pricing for my son",
      bodyText: "Hi, my 15-year-old son is interested in your speed and conditioning program. Can you send me pricing and availability? We are in Atlanta. Thanks, Sarah",
      providerMessageId: `test-parent-pricing-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
  {
    label: "Athlete requesting reschedule",
    payload: {
      inbox: "scheduling",
      fromEmail: "jake.thomas@gmail.com",
      fromName: "Jake Thomas",
      toEmail: "scheduling@agentmail.to",
      subject: "Need to reschedule my Thursday session",
      bodyText: "Hey, something came up and I need to reschedule my Thursday 4pm session to Friday if possible. Let me know what works. Thanks - Jake",
      providerMessageId: `test-reschedule-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
  {
    label: "Coach asking about employment",
    payload: {
      inbox: "hiring",
      fromEmail: "marcus.johnson@gmail.com",
      fromName: "Marcus Johnson",
      toEmail: "hiring@agentmail.to",
      subject: "Application for Strength Coach position",
      bodyText: "Hello, I have 5 years of experience as a certified strength and conditioning coach (CSCS). I'm interested in joining your team. I have a proven track record working with college athletes. Please find my resume attached. Best, Marcus Johnson",
      providerMessageId: `test-hiring-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
  {
    label: "Customer reporting billing issue",
    payload: {
      inbox: "support",
      fromEmail: "client.dana@yahoo.com",
      fromName: "Dana Rivera",
      toEmail: "support@agentmail.to",
      subject: "Charged twice this month",
      bodyText: "Hi, I noticed I was charged twice on my credit card this month for my subscription. The charges are both $199 on Nov 1 and Nov 3. Can you please issue a refund for the duplicate? My account email is client.dana@yahoo.com.",
      providerMessageId: `test-billing-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
  {
    label: "Software bug report",
    payload: {
      inbox: "support",
      fromEmail: "coach.alex@trainco.com",
      fromName: "Coach Alex",
      toEmail: "support@agentmail.to",
      subject: "Calendar not loading - getting error",
      bodyText: "The scheduling calendar won't load for me. I keep getting a blank white screen when I click on 'My Schedule'. This started happening after the update yesterday. I'm using Chrome on Mac. This is urgent as I can't see my client appointments.",
      providerMessageId: `test-bug-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
  {
    label: "Spam / noise",
    payload: {
      inbox: "operations",
      fromEmail: "promo@cheap-deals123.com",
      fromName: "Deals Newsletter",
      toEmail: "operations@agentmail.to",
      subject: "You've won a $500 gift card! Click here now",
      bodyText: "Congratulations! You have been selected as our lottery winner. Click here to claim your free gift. Limited time offer.",
      providerMessageId: `test-spam-${Date.now()}`,
      receivedAt: new Date(),
    },
  },
];
