/**
 * AgentMail Follow-Up Sequencing Service
 * Drafts and schedules follow-up emails per classification.
 * NEVER sends automatically — all sends require human approval.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { attentionItems } from "@shared/schema";
import { writeTimeline } from "./ceo-heartbeat-service";
import { sendAgentEmail, replyFromAgentInbox, type AgentInbox } from "./agentmail-service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FollowupRecord {
  id: string;
  organization_id: string;
  source_inbound_message_id: string | null;
  source_reply_queue_id: string | null;
  inbox: string;
  agent_name: string;
  classification: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  followup_body: string;
  sequence_name: string;
  sequence_step: number;
  scheduled_for: string;
  status: string;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  skipped_reason: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  edited_body?: string | null;
}

// ─── Sequence rules ──────────────────────────────────────────────────────────

interface SequenceStep { stepNumber: number; delayHours: number; label: string; }
interface SequenceRule { name: string; steps: SequenceStep[]; }

export const SEQUENCE_RULES: Record<string, SequenceRule> = {
  new_lead: {
    name: "Lead Nurture",
    steps: [
      { stepNumber: 1, delayHours: 24,  label: "24-hour check-in" },
      { stepNumber: 2, delayHours: 72,  label: "3-day value touchpoint" },
      { stepNumber: 3, delayHours: 168, label: "7-day final outreach" },
    ],
  },
  pricing_question: {
    name: "Pricing Follow-Up",
    steps: [
      { stepNumber: 1, delayHours: 24,  label: "24-hour pricing reminder" },
      { stepNumber: 2, delayHours: 72,  label: "3-day offer nudge" },
      { stepNumber: 3, delayHours: 168, label: "7-day last chance" },
    ],
  },
  booking_request: {
    name: "Booking Confirmation",
    steps: [
      { stepNumber: 1, delayHours: 12, label: "12-hour booking reminder" },
      { stepNumber: 2, delayHours: 24, label: "24-hour final reminder" },
    ],
  },
  reschedule_request: {
    name: "Reschedule Confirmation",
    steps: [
      { stepNumber: 1, delayHours: 12, label: "12-hour reschedule nudge" },
      { stepNumber: 2, delayHours: 24, label: "24-hour final nudge" },
    ],
  },
  employment_candidate: {
    name: "Hiring Pipeline",
    steps: [
      { stepNumber: 1, delayHours: 24,  label: "24-hour application follow-up" },
      { stepNumber: 2, delayHours: 96,  label: "4-day check-in" },
    ],
  },
  coach_partner_inquiry: {
    name: "Partnership Nurture",
    steps: [
      { stepNumber: 1, delayHours: 24,  label: "24-hour partnership follow-up" },
      { stepNumber: 2, delayHours: 120, label: "5-day value follow-up" },
    ],
  },
  support_issue: {
    name: "Support Resolution",
    steps: [
      { stepNumber: 1, delayHours: 24, label: "24-hour resolution check" },
      { stepNumber: 2, delayHours: 72, label: "72-hour satisfaction check" },
    ],
  },
  billing_issue: {
    name: "Billing Resolution",
    steps: [
      { stepNumber: 1, delayHours: 24, label: "24-hour billing follow-up" },
      { stepNumber: 2, delayHours: 72, label: "72-hour escalation check" },
    ],
  },
  software_bug_report: {
    name: "Bug Resolution",
    steps: [
      { stepNumber: 1, delayHours: 24, label: "24-hour bug status update" },
      { stepNumber: 2, delayHours: 72, label: "72-hour resolution confirmation" },
    ],
  },
  general_question: {
    name: "General Follow-Up",
    steps: [
      { stepNumber: 1, delayHours: 72, label: "3-day general follow-up" },
    ],
  },
  athlete_parent_question: {
    name: "Athlete/Parent Follow-Up",
    steps: [
      { stepNumber: 1, delayHours: 24, label: "24-hour follow-up" },
      { stepNumber: 2, delayHours: 72, label: "72-hour check-in" },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

// ─── AI Draft Generator ──────────────────────────────────────────────────────

export async function generateFollowupDraft(params: {
  classification: string;
  sequenceName: string;
  stepLabel: string;
  stepNumber: number;
  recipientName: string | null;
  recipientEmail: string;
  agentName: string;
  inbox: string;
  originalSubject: string;
  originalInboundBody?: string | null;
  firstReplyBody?: string | null;
}): Promise<string> {
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();

    const prompt = `You are ${params.agentName} at TrainEfficiency, a strength and conditioning business platform.

You are writing a follow-up email — step ${params.stepNumber} of the "${params.sequenceName}" sequence (${params.stepLabel}).

Context:
- Recipient: ${params.recipientName ?? params.recipientEmail}
- Classification: ${params.classification.replace(/_/g, " ")}
- Original subject: ${params.originalSubject}
- Original inbound email: ${params.originalInboundBody ? params.originalInboundBody.slice(0, 400) : "(not available)"}
- Our first reply: ${params.firstReplyBody ? params.firstReplyBody.slice(0, 400) : "(not available)"}

Write a brief, professional follow-up email body only (no subject line, no headers).
Keep it concise (2-4 sentences). Be warm, helpful, and non-pushy.
If step > 1, acknowledge that you haven't heard back yet.
Do not use placeholders like [Name] — use the actual name if provided, otherwise use a generic greeting.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    return resp.choices[0]?.message?.content?.trim() ?? generateFallbackDraft(params);
  } catch {
    return generateFallbackDraft(params);
  }
}

function generateFallbackDraft(params: {
  classification: string; stepNumber: number; recipientName: string | null;
  originalSubject: string; agentName: string;
}): string {
  const greeting = params.recipientName ? `Hi ${params.recipientName},` : "Hi there,";
  const followUpLine = params.stepNumber === 1
    ? "I just wanted to follow up on my previous message."
    : "I wanted to check in one more time to see if you had any questions.";
  return `${greeting}\n\n${followUpLine} I'm happy to help with any questions you have about your ${params.classification.replace(/_/g, " ")}.\n\nBest regards,\n${params.agentName}`;
}

// ─── Stop Condition Detection ─────────────────────────────────────────────────

export async function detectStopConditions(params: {
  organizationId: string;
  sourceInboundMessageId: string | null;
  recipientEmail: string;
  classification: string;
}): Promise<{ shouldStop: boolean; reason: string | null }> {
  // 1. Check if recipient replied (new inbound from same email)
  if (params.sourceInboundMessageId) {
    const replyCheck = rows(await db.execute(sql`
      SELECT id FROM agent_mail_inbound_messages
      WHERE organization_id = ${params.organizationId}
        AND from_email ILIKE ${params.recipientEmail}
        AND id != ${params.sourceInboundMessageId}
      LIMIT 1
    `).catch(() => []));
    if (replyCheck.length > 0) {
      return { shouldStop: true, reason: "recipient_replied" };
    }
  }

  // 2. Check for booking completion (booking/reschedule classifications)
  if (params.classification === "booking_request" || params.classification === "reschedule_request") {
    const bookingCheck = rows(await db.execute(sql`
      SELECT id FROM bookings
      WHERE organization_id = ${params.organizationId}
        AND status IN ('SCHEDULED','CONFIRMED','ACTIVE')
      LIMIT 1
    `).catch(() => []));
    if (bookingCheck.length > 0) {
      // Can't easily map email to booking without joining — skip for now, just rely on manual cancel
    }
  }

  // 3. Check inbound body for unsubscribe/stop language
  if (params.sourceInboundMessageId) {
    const inbound = rows(await db.execute(sql`
      SELECT body_text FROM agent_mail_inbound_messages WHERE id = ${params.sourceInboundMessageId}
    `).catch(() => []))[0];
    if (inbound?.body_text) {
      const lower = inbound.body_text.toLowerCase();
      const stopWords = ["unsubscribe", "stop emailing", "remove me", "do not contact", "don't contact", "opt out", "no longer interested"];
      if (stopWords.some((w) => lower.includes(w))) {
        return { shouldStop: true, reason: "unsubscribe_detected" };
      }
    }
  }

  // 4. Check if lead already converted (team_training_prospects with converted status)
  if (params.classification === "new_lead" || params.classification === "pricing_question") {
    const convertCheck = rows(await db.execute(sql`
      SELECT id FROM team_training_prospects
      WHERE organization_id = ${params.organizationId}
        AND contact_email ILIKE ${params.recipientEmail}
        AND status IN ('signed','converted','won')
      LIMIT 1
    `).catch(() => []));
    if (convertCheck.length > 0) {
      return { shouldStop: true, reason: "lead_converted" };
    }
  }

  // 5. Check if applicant moved to next stage
  if (params.classification === "employment_candidate") {
    const appCheck = rows(await db.execute(sql`
      SELECT id FROM employment_applicants
      WHERE organization_id = ${params.organizationId}
        AND email ILIKE ${params.recipientEmail}
        AND status NOT IN ('applied','reviewing')
      LIMIT 1
    `).catch(() => []));
    if (appCheck.length > 0) {
      return { shouldStop: true, reason: "applicant_stage_advanced" };
    }
  }

  return { shouldStop: false, reason: null };
}

// ─── Create sequence after first reply is sent ───────────────────────────────

export async function createFollowupSequence(params: {
  organizationId: string;
  sourceInboundMessageId: string | null;
  sourceReplyQueueId: string | null;
  inbox: string;
  agentName: string;
  classification: string;
  recipientEmail: string;
  recipientName: string | null;
  originalSubject: string;
  originalInboundBody?: string | null;
  firstReplyBody?: string | null;
  baseSentAt?: Date;
}): Promise<{ created: number; followupIds: string[] }> {
  const rule = SEQUENCE_RULES[params.classification];
  if (!rule) return { created: 0, followupIds: [] };

  const baseTime = params.baseSentAt ?? new Date();
  const followupIds: string[] = [];

  for (const step of rule.steps) {
    const scheduledFor = new Date(baseTime.getTime() + step.delayHours * 3600 * 1000);

    // Generate draft
    const followupBody = await generateFollowupDraft({
      classification: params.classification,
      sequenceName: rule.name,
      stepLabel: step.label,
      stepNumber: step.stepNumber,
      recipientName: params.recipientName,
      recipientEmail: params.recipientEmail,
      agentName: params.agentName,
      inbox: params.inbox,
      originalSubject: params.originalSubject,
      originalInboundBody: params.originalInboundBody,
      firstReplyBody: params.firstReplyBody,
    });

    const subjectLine = step.stepNumber === 1
      ? `Re: ${params.originalSubject}`
      : `Following up — ${params.originalSubject}`;

    const inserted = rows(await db.execute(sql`
      INSERT INTO agent_mail_followups (
        id, organization_id, source_inbound_message_id, source_reply_queue_id,
        inbox, agent_name, classification, recipient_email, recipient_name,
        subject, followup_body, sequence_name, sequence_step, scheduled_for,
        status, approval_status, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${params.organizationId},
        ${params.sourceInboundMessageId ?? null},
        ${params.sourceReplyQueueId ?? null},
        ${params.inbox},
        ${params.agentName},
        ${params.classification},
        ${params.recipientEmail},
        ${params.recipientName ?? null},
        ${subjectLine},
        ${followupBody},
        ${rule.name},
        ${step.stepNumber},
        ${scheduledFor.toISOString()},
        ${"scheduled"},
        ${"pending"},
        NOW(), NOW()
      )
      RETURNING id
    `).catch(() => []));

    const id = inserted[0]?.id;
    if (id) followupIds.push(id);
  }

  if (followupIds.length > 0) {
    await writeTimeline({
      orgId: params.organizationId,
      agentName: params.agentName,
      actionType: "agentmail_followup_sequence_created",
      actionStatus: "completed",
      priority: 2,
      relatedEntityType: "followup_sequence",
      relatedEntityId: params.sourceInboundMessageId ?? params.sourceReplyQueueId ?? "unknown",
      summary: `${params.agentName} scheduled ${followupIds.length}-step "${rule.name}" follow-up sequence for ${params.recipientEmail}`,
      requiresApproval: false,
      metadata: { steps: followupIds.length, classification: params.classification, inbox: params.inbox },
    }).catch(() => {});
  }

  return { created: followupIds.length, followupIds };
}

// ─── Cancel all pending followups for a thread ───────────────────────────────

export async function cancelFollowupsForThread(params: {
  organizationId: string;
  sourceInboundMessageId?: string | null;
  sourceReplyQueueId?: string | null;
  reason: string;
  cancelledBy?: string;
}): Promise<number> {
  let cancelled = 0;
  try {
    const conditions: string[] = [];
    const values: any[] = [params.organizationId, params.reason];

    if (params.sourceInboundMessageId) {
      const result = rows(await db.execute(sql`
        UPDATE agent_mail_followups
        SET status = 'cancelled', skipped_reason = ${params.reason}, updated_at = NOW()
        WHERE organization_id = ${params.organizationId}
          AND source_inbound_message_id = ${params.sourceInboundMessageId}
          AND status IN ('scheduled','pending_review')
        RETURNING id
      `).catch(() => []));
      cancelled += result.length;
    }
    if (params.sourceReplyQueueId) {
      const result = rows(await db.execute(sql`
        UPDATE agent_mail_followups
        SET status = 'cancelled', skipped_reason = ${params.reason}, updated_at = NOW()
        WHERE organization_id = ${params.organizationId}
          AND source_reply_queue_id = ${params.sourceReplyQueueId}
          AND status IN ('scheduled','pending_review')
        RETURNING id
      `).catch(() => []));
      cancelled += result.length;
    }
  } catch (e: any) {
    console.error("[FollowupService] cancelFollowupsForThread error:", e?.message);
  }
  return cancelled;
}

// ─── Mark a single followup skipped ──────────────────────────────────────────

export async function markFollowupSkipped(id: string, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_mail_followups
    SET status = 'skipped', skipped_reason = ${reason}, updated_at = NOW()
    WHERE id = ${id} AND status NOT IN ('sent','failed')
  `).catch(() => {});
}

// ─── Process due followups (cron job) ────────────────────────────────────────

export async function processDueFollowups(): Promise<{ processed: number; skipped: number; errors: number }> {
  const now = new Date().toISOString();
  let processed = 0, skipped = 0, errors = 0;

  const due = rows(await db.execute(sql`
    SELECT * FROM agent_mail_followups
    WHERE status = 'scheduled'
      AND scheduled_for <= ${now}
    ORDER BY scheduled_for ASC
    LIMIT 100
  `).catch(() => []));

  for (const f of due) {
    try {
      // Check stop conditions
      const stopCheck = await detectStopConditions({
        organizationId: f.organization_id,
        sourceInboundMessageId: f.source_inbound_message_id,
        recipientEmail: f.recipient_email,
        classification: f.classification,
      });

      if (stopCheck.shouldStop) {
        await markFollowupSkipped(f.id, stopCheck.reason ?? "stop_condition_met");
        skipped++;

        // Cancel remaining steps too
        await cancelFollowupsForThread({
          organizationId: f.organization_id,
          sourceInboundMessageId: f.source_inbound_message_id,
          sourceReplyQueueId: f.source_reply_queue_id,
          reason: stopCheck.reason ?? "stop_condition_met",
        });

        await writeTimeline({
          orgId: f.organization_id,
          agentName: f.agent_name,
          actionType: "agentmail_followup_skipped",
          actionStatus: "completed",
          priority: 2,
          relatedEntityType: "followup",
          relatedEntityId: f.id,
          summary: `Follow-up step ${f.sequence_step} skipped for ${f.recipient_email} — reason: ${stopCheck.reason}`,
          requiresApproval: false,
          metadata: { reason: stopCheck.reason },
        }).catch(() => {});
        continue;
      }

      // Move to pending_review
      await db.execute(sql`
        UPDATE agent_mail_followups
        SET status = 'pending_review', approval_status = 'pending_review', updated_at = NOW()
        WHERE id = ${f.id}
      `).catch(() => {});

      // Create Attention Inbox item
      const isDue = new Date(f.scheduled_for) < new Date(Date.now() - 2 * 3600 * 1000);
      await db.insert(attentionItems).values({
        orgId: f.organization_id,
        level: isDue ? "urgent" : "important",
        category: "agentmail_followup",
        title: `Follow-up awaiting approval: ${f.subject.slice(0, 60)}`,
        body: `${f.agent_name} has a step-${f.sequence_step} "${f.sequence_name}" follow-up ready for ${f.recipient_email}. Review and approve before sending.`,
        source: "agentmail_followup",
        sourceId: f.id,
        severity: isDue ? 85 : 70,
        urgency: isDue ? 80 : 65,
        businessImpact: 65,
        confidence: 0.9,
        actionUrl: `/admin/agentmail?tab=followups`,
        actionLabel: "Review Follow-Up",
        status: "active",
        metadata: {
          followupId: f.id,
          inbox: f.inbox,
          sequenceStep: f.sequence_step,
          sequenceName: f.sequence_name,
          classification: f.classification,
        },
      }).onConflictDoNothing().catch(() => {});

      // Timeline
      await writeTimeline({
        orgId: f.organization_id,
        agentName: f.agent_name,
        actionType: "agentmail_followup_due",
        actionStatus: "pending",
        priority: 3,
        relatedEntityType: "followup",
        relatedEntityId: f.id,
        summary: `${f.agent_name} follow-up step ${f.sequence_step} due for ${f.recipient_email} via ${f.inbox}@ — awaiting human approval`,
        requiresApproval: true,
        metadata: { inbox: f.inbox, sequenceName: f.sequence_name, step: f.sequence_step },
      }).catch(() => {});

      processed++;
    } catch (e: any) {
      console.error("[FollowupService] processDueFollowups error for", f.id, e?.message);
      errors++;
    }
  }

  console.log(`[FollowupService] processDueFollowups — due=${due.length} processed=${processed} skipped=${skipped} errors=${errors}`);
  return { processed, skipped, errors };
}

// ─── Send an approved followup ────────────────────────────────────────────────

export async function sendApprovedFollowup(params: {
  followupId: string;
  organizationId: string;
  actor: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const f = rows(await db.execute(sql`
    SELECT * FROM agent_mail_followups
    WHERE id = ${params.followupId} AND organization_id = ${params.organizationId}
  `).catch(() => []))[0];

  if (!f) return { ok: false, error: "Followup not found" };
  if (f.status === "sent") return { ok: false, error: "Already sent" };
  if (f.approval_status !== "approved") return { ok: false, error: "Not approved yet" };

  const bodyToSend: string = f.edited_body?.trim() || f.followup_body;

  const sendResult = await sendAgentEmail({
    organizationId: params.organizationId,
    agentName: f.agent_name,
    fromInbox: f.inbox as AgentInbox,
    to: f.recipient_email,
    subject: f.subject,
    body: bodyToSend,
    humanApproved: true,
  });

  if (sendResult.ok) {
    await db.execute(sql`
      UPDATE agent_mail_followups
      SET status = 'sent', sent_at = NOW(),
          provider_message_id = ${sendResult.messageId ?? null},
          updated_at = NOW()
      WHERE id = ${params.followupId}
    `).catch(() => {});

    // Dismiss attention item
    await db.execute(sql`
      UPDATE attention_items
      SET status = 'completed', updated_at = NOW()
      WHERE source = 'agentmail_followup' AND source_id = ${params.followupId}
    `).catch(() => {});

    await writeTimeline({
      orgId: params.organizationId,
      agentName: f.agent_name,
      actionType: "agentmail_followup_sent",
      actionStatus: "completed",
      priority: 3,
      relatedEntityType: "followup",
      relatedEntityId: params.followupId,
      summary: `${f.agent_name} follow-up step ${f.sequence_step} sent to ${f.recipient_email} via ${f.inbox}@ — approved by ${params.actor}`,
      requiresApproval: false,
      metadata: { inbox: f.inbox, step: f.sequence_step, actor: params.actor },
    }).catch(() => {});
  } else {
    await db.execute(sql`
      UPDATE agent_mail_followups
      SET status = 'failed', error_message = ${sendResult.error ?? "Send failed"}, updated_at = NOW()
      WHERE id = ${params.followupId}
    `).catch(() => {});
  }

  return sendResult;
}
