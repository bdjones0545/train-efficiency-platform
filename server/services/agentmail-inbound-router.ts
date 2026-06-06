/**
 * AgentMail Inbound Router
 * Classifies inbound emails, creates downstream records, and routes to agents.
 * No outbound emails are sent automatically.
 */

import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { attentionItems, employmentApplicants, teamTrainingProspects } from "@shared/schema";
import { writeTimeline } from "./ceo-heartbeat-service";

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
  providerMessageId?: string;
  providerThreadId?: string;
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

export async function resolveOrgFromInbox(toEmail: string): Promise<string | null> {
  // Try to find an org that has AgentMail configured — use first org as fallback
  // In a multi-tenant setup you'd match the domain, but for single-tenant we use the first org.
  try {
    const orgRows = rows(await db.execute(sql`
      SELECT id FROM organizations LIMIT 1
    `));
    return orgRows[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Attention Inbox insertion ────────────────────────────────────────────────

function severityScore(s: ClassificationResult["severity"]): number {
  return { critical: 95, high: 80, medium: 55, low: 30 }[s] ?? 50;
}

function levelFromSeverity(s: ClassificationResult["severity"]): string {
  return { critical: "critical", high: "important", medium: "suggested", low: "informational" }[s] ?? "informational";
}

async function addToAttentionInbox(
  orgId: string,
  inboundId: string,
  email: InboundEmailPayload,
  result: ClassificationResult & { suggestedReply?: string },
): Promise<string | null> {
  try {
    const score = severityScore(result.severity);
    const level = levelFromSeverity(result.severity);

    const [item] = await db.insert(attentionItems).values({
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

    return item?.id ?? null;
  } catch (e: any) {
    console.error("[AgentMail Inbound] Attention inbox error:", e?.message);
    return null;
  }
}

// ─── Downstream record creation ───────────────────────────────────────────────

async function createDownstreamRecord(
  orgId: string,
  email: InboundEmailPayload,
  result: ClassificationResult & { suggestedReply?: string },
): Promise<void> {
  const { classification, intentSignals } = result;
  const body = email.bodyText ?? "";

  try {
    if (classification === "new_lead" || classification === "pricing_question" || classification === "coach_partner_inquiry") {
      // Insert into team_training_prospects as inbound lead
      const nameParts = (email.fromName ?? email.fromEmail.split("@")[0]).split(" ");
      await db.insert(teamTrainingProspects).values({
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
    }

    if (classification === "employment_candidate") {
      const nameParts = (email.fromName ?? "Unknown Applicant").split(" ");
      await db.insert(employmentApplicants).values({
        orgId,
        firstName: nameParts[0] ?? "Unknown",
        lastName: nameParts.slice(1).join(" ") || "Applicant",
        email: email.fromEmail,
        source: `agentmail_inbound_${email.inbox}`,
        status: "new",
        notes: `Inbound application via ${email.inbox}@\nSubject: ${email.subject}\n\n${body.slice(0, 800)}`,
        location: intentSignals.includes("parent_signal") ? "unknown" : undefined,
      } as any).onConflictDoNothing();
    }

    if (classification === "software_bug_report") {
      // Try to create software improvement task if table exists
      try {
        await db.execute(sql`
          INSERT INTO software_improvement_tasks (id, organization_id, title, description, severity, status, source_agent, priority, created_at, updated_at)
          VALUES (
            gen_random_uuid()::text,
            ${orgId},
            ${"Bug report: " + email.subject.slice(0, 100)},
            ${"Inbound bug report from " + email.fromEmail + "\n\n" + body.slice(0, 800)},
            ${"high"},
            ${"open"},
            ${"agentmail_inbound"},
            ${80},
            NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
        `);
      } catch { /* table may not exist */ }
    }
  } catch (e: any) {
    console.error("[AgentMail Inbound] Downstream record error:", e?.message);
  }
}

// ─── CEO Heartbeat timeline ───────────────────────────────────────────────────

async function notifyCeoHeartbeat(
  orgId: string,
  email: InboundEmailPayload,
  result: ClassificationResult,
  inboundId: string,
): Promise<void> {
  try {
    await writeTimeline({
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
    });
  } catch (e: any) {
    console.error("[AgentMail Inbound] CEO Heartbeat timeline error:", e?.message);
  }
}

// ─── Main processor ──────────────────────────────────────────────────────────

export async function processInboundAgentMail(
  payload: InboundEmailPayload,
): Promise<ProcessResult> {
  const orgId = payload.organizationId;

  // 1. Idempotency check
  if (payload.providerMessageId) {
    try {
      const existing = rows(await db.execute(sql`
        SELECT id FROM agent_mail_inbound_messages
        WHERE provider_message_id = ${payload.providerMessageId}
        LIMIT 1
      `));
      if (existing.length > 0) {
        return { ok: true, skipped: true, skipReason: "duplicate provider_message_id", inboundId: existing[0].id };
      }
    } catch { /* table may not exist yet — will be created */ }
  }

  // 2. Classify
  const baseResult = classifyInboundEmail(
    payload.inbox,
    payload.subject,
    payload.bodyText ?? "",
  );

  // 3. AI enhancement (best-effort)
  const result = await enhanceWithAI(baseResult, payload.subject, payload.bodyText ?? "");

  // 4. Persist inbound record
  let inboundId: string | null = null;
  try {
    const inserted = rows(await db.execute(sql`
      INSERT INTO agent_mail_inbound_messages (
        id, organization_id, inbox, from_email, from_name, to_email,
        subject, body_text, body_html, provider_message_id, provider_thread_id,
        classification, confidence, routed_agent, routed_status,
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
        ${payload.providerThreadId ?? null},
        ${result.classification},
        ${result.confidence},
        ${result.routedAgent},
        ${"routed"},
        ${result.classification},
        ${JSON.stringify({ suggestedReply: result.suggestedReply, intentSignals: result.intentSignals })},
        ${payload.rawPayload ? JSON.stringify(payload.rawPayload) : null},
        ${null},
        ${payload.receivedAt ?? new Date()},
        NOW(), NOW()
      )
      RETURNING id
    `));
    inboundId = inserted[0]?.id ?? null;
  } catch (e: any) {
    console.error("[AgentMail Inbound] DB insert error:", e?.message);
    return { ok: false, error: `DB insert failed: ${e?.message}` };
  }

  if (!inboundId) return { ok: false, error: "Failed to persist inbound message" };

  // 5. Spam → store only, skip routing
  if (result.classification === "spam_or_noise") {
    await db.execute(sql`
      UPDATE agent_mail_inbound_messages SET routed_status = 'spam_stored' WHERE id = ${inboundId}
    `).catch(() => {});
    return { ok: true, inboundId, classification: result.classification, routedAgent: "none", skipped: true, skipReason: "spam_or_noise" };
  }

  // 6. Create downstream records
  await createDownstreamRecord(orgId, payload, result);

  // 7. Add to Attention Inbox
  const attentionItemId = await addToAttentionInbox(orgId, inboundId, payload, result);

  // 8. CEO Heartbeat timeline
  await notifyCeoHeartbeat(orgId, payload, result, inboundId);

  // 9. Mark routed
  await db.execute(sql`
    UPDATE agent_mail_inbound_messages
    SET routed_status = 'routed', action_type = ${result.classification}
    WHERE id = ${inboundId}
  `).catch(() => {});

  return {
    ok: true,
    inboundId,
    classification: result.classification,
    routedAgent: result.routedAgent,
    attentionItemId: attentionItemId ?? undefined,
  };
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
