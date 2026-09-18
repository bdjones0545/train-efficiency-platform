/**
 * Lead Capture Follow-Up Sequence Engine
 * Handles automated email sequences for submitted and abandoned lead capture applications.
 */

import { storage } from "./storage";
import {
  AUTOMATION_KILL_SWITCH_REASON,
  automationRunBlocked,
  isAutomationSendsEnabled,
  logAutomationSendsDisabled,
  resetAutomationSendsLog,
} from "./lib/automation-sends";

/** Minimal shape of the SendGrid client, so tests can inject a counting stub. */
export type MailClient = { send: (msg: any) => Promise<any> };

const AUTOMATION_SCOPE = "lead-capture nurture sequences";

async function getSgMail() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return null;
  const sg = await import("@sendgrid/mail");
  sg.default.setApiKey(key);
  return sg.default;
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "noreply@trainefficiency.com";

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  schedulingInquiryEmail: string | null;
}

async function getOrgInfo(orgId: string): Promise<OrgInfo | null> {
  try {
    const org = await storage.getOrganizationById(orgId);
    return org as OrgInfo | null;
  } catch {
    return null;
  }
}

async function logFollowUp(params: {
  orgId: string;
  submissionId?: string;
  abandonedId?: string;
  sequenceStep: string;
  channel: string;
  subject: string;
  body: string;
  status: string;
}) {
  try {
    const { db } = await import("./db");
    const { leadCaptureFollowUps } = await import("@shared/schema");
    await db.insert(leadCaptureFollowUps).values({
      orgId: params.orgId,
      submissionId: params.submissionId || null,
      abandonedId: params.abandonedId || null,
      sequenceStep: params.sequenceStep,
      channel: params.channel,
      status: params.status,
      subject: params.subject,
      body: params.body,
    });
  } catch (_) {}
}

// ─── Submission Sequences ─────────────────────────────────────────────────────

function bookingCta(bookingUrl: string | null | undefined, label = "Book Your Free Evaluation →") {
  if (!bookingUrl) return "";
  return `
    <p style="text-align:center;margin:24px 0">
      <a href="${bookingUrl}" style="background:linear-gradient(135deg,#f97316,#f59e0b);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
        ${label}
      </a>
    </p>
    <p style="color:#71717a;font-size:12px;text-align:center;margin:0">Takes 60 seconds. No commitment required.</p>
  `;
}

function buildHighIntentFollowUp(athleteName: string, orgName: string, programName: string, coachName: string, bookingUrl?: string | null) {
  return {
    subject: `${athleteName}, your application is being reviewed now 🏆`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#f97316,#f59e0b);padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0">Your Application Stands Out</h2>
        </div>
        <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
          <p>Hey ${athleteName},</p>
          <p>I just reviewed your application to <strong style="color:#fb923c">${programName}</strong> and I want to connect with you personally.</p>
          <p>Your goals and commitment level are exactly what we look for in athletes who make real breakthroughs. I'd love to schedule a quick 15-minute evaluation to discuss whether you're the right fit.</p>
          ${bookingCta(bookingUrl, "Book Your Evaluation Now →")}
          <p>Or reply directly to this email — we'll find a time that works for you.</p>
          <p style="margin-top:24px">— ${coachName}<br><span style="color:#71717a">${orgName}</span></p>
        </div>
      </div>
    `,
  };
}

function build24hrFollowUp(athleteName: string, orgName: string, programName: string, coachName: string, bookingUrl?: string | null) {
  return {
    subject: `Still thinking it over, ${athleteName.split(" ")[0]}?`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0">A Quick Note From ${orgName}</h2>
        </div>
        <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
          <p>Hey ${athleteName.split(" ")[0]},</p>
          <p>Just checking in on your application to <strong style="color:#fb923c">${programName}</strong>. We typically respond within 24 hours and I want to make sure you're not waiting on us.</p>
          <p>If you're ready, the fastest next step is to book a free evaluation — it takes 60 seconds:</p>
          ${bookingCta(bookingUrl, "Schedule My Evaluation →")}
          <p>Or just reply to this email if you have questions. There's no commitment required to have a conversation.</p>
          <p style="color:#4ade80;font-weight:600">Spots are limited and we're currently accepting a small group of new athletes.</p>
          <p style="margin-top:24px">— ${coachName}<br><span style="color:#71717a">${orgName}</span></p>
        </div>
      </div>
    `,
  };
}

function build3DayNurture(athleteName: string, orgName: string, programName: string, coachName: string, sport: string | null, bookingUrl?: string | null) {
  const sportLine = sport ? `Whether it's ${sport} or any other sport` : "Whatever your sport";
  return {
    subject: `${athleteName.split(" ")[0]}, athletes who act now see results by next season`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#dc2626,#f97316);padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0">Don't Let the Off-Season Slip Away</h2>
        </div>
        <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
          <p>Hey ${athleteName.split(" ")[0]},</p>
          <p>${sportLine}, the athletes who start training now will be a step ahead when the season matters most.</p>
          <p>We still have your application on file for <strong style="color:#fb923c">${programName}</strong>. Our coaches are ready to build a plan specifically around your goals.</p>
          <p>Here's what some athletes said after their first month:</p>
          <ul style="color:#a1a1aa;font-size:14px;line-height:1.8">
            <li>"I added 15 yards to my 40 time in 8 weeks"</li>
            <li>"My confidence on the field went through the roof"</li>
            <li>"Best investment I've made in my athletic career"</li>
          </ul>
          ${bookingCta(bookingUrl, "Claim My Evaluation Spot →")}
          <p>Or just reply — we'll reach out within the hour.</p>
          <p style="margin-top:24px">— ${coachName}<br><span style="color:#71717a">${orgName}</span></p>
        </div>
      </div>
    `,
  };
}

// ─── Abandoned Recovery Sequences ────────────────────────────────────────────

function buildAbandonedRecovery1(athleteName: string, orgName: string, programName: string, orgSlug: string, programSlug: string) {
  const recoveryLink = `${process.env.BASE_URL || "https://trainefficiency.com"}/apply/${orgSlug}/${programSlug}?utm_source=recovery&utm_medium=email&utm_campaign=abandoned_30min`;
  return {
    subject: `${athleteName.split(" ")[0]}, you were almost there — finish your application`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#f97316,#f59e0b);padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0">Don't Leave Your Spot on the Table</h2>
        </div>
        <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
          <p>Hey ${athleteName},</p>
          <p>You started your application to <strong style="color:#fb923c">${programName}</strong> but didn't quite finish. That's okay — it takes less than 2 minutes to complete.</p>
          <p>We save your progress. Just pick up where you left off:</p>
          <p style="text-align:center;margin:24px 0">
            <a href="${recoveryLink}" style="background:linear-gradient(135deg,#f97316,#f59e0b);color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
              Complete My Application →
            </a>
          </p>
          <p style="color:#71717a;font-size:13px;text-align:center">Takes about 2 minutes. No commitment required.</p>
          <p style="margin-top:24px">— The ${orgName} Team</p>
        </div>
      </div>
    `,
  };
}

function buildAbandonedRecovery2(athleteName: string, orgName: string, programName: string, orgSlug: string, programSlug: string) {
  const recoveryLink = `${process.env.BASE_URL || "https://trainefficiency.com"}/apply/${orgSlug}/${programSlug}?utm_source=recovery&utm_medium=email&utm_campaign=abandoned_24hr`;
  return {
    subject: `Last chance: your ${programName} spot`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#dc2626,#f97316);padding:20px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0">We're Still Holding a Spot for You</h2>
        </div>
        <div style="background:#18181b;padding:24px;border-radius:0 0 12px 12px;color:#e4e4e7">
          <p>Hey ${athleteName},</p>
          <p>It's been a day since you started your application to <strong style="color:#fb923c">${programName}</strong>. We noticed you didn't finish and wanted to check in one more time.</p>
          <p>If something stopped you — cost, timing, questions about the program — just reply and let us know. We'll work through it together.</p>
          <p style="text-align:center;margin:24px 0">
            <a href="${recoveryLink}" style="background:linear-gradient(135deg,#dc2626,#f97316);color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
              Finish My Application →
            </a>
          </p>
          <p style="color:#71717a;font-size:13px;text-align:center">After this we won't bother you again.</p>
          <p style="margin-top:24px">— The ${orgName} Team</p>
        </div>
      </div>
    `,
  };
}

// ─── Opt-out / unsubscribe ────────────────────────────────────────────────────

const APP_BASE_URL = process.env.APP_URL || process.env.BASE_URL || "https://trainefficiency.com";

/**
 * Nurture mail is marketing, so every step carries a way out.
 *
 *  - Recipient has an account → the real per-org unsubscribe token
 *    (users/user_org_preferences.unsubscribe_token, the same mechanism
 *    server/email.ts uses) behind /unsubscribe/<token>.
 *  - Recipient is only a prospect → the prospect opt-out mechanism
 *    (prospect_opt_outs, read by storage.isProspectOptedOut, which every step
 *    below consults). There is no self-serve prospect opt-out endpoint yet, so
 *    the link is a mailto: to the org — honest about what exists.
 */
export async function buildOptOutFooter(
  orgId: string,
  recipientEmail: string,
  orgName: string,
  contactEmail?: string | null,
): Promise<string> {
  try {
    const user = await storage.getUserByEmail(recipientEmail);
    if (user?.id) {
      const token = await storage.ensureUnsubscribeToken(user.id, orgId);
      const url = `${APP_BASE_URL}/unsubscribe/${token}`;
      return `<div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #333">
        <p style="font-size:12px;color:#666;margin:0;font-family:Arial,sans-serif">
          <a href="${url}" style="color:#888;text-decoration:underline">Manage email preferences</a>
        </p></div>`;
    }
  } catch (err: any) {
    console.error(`[LeadCapture Sequences] unsubscribe token lookup failed for ${recipientEmail}:`, err?.message || err);
  }

  const mailTo = contactEmail || process.env.SENDGRID_FROM_EMAIL || FROM_EMAIL;
  const href = `mailto:${mailTo}?subject=${encodeURIComponent("Unsubscribe")}&body=${encodeURIComponent(`Please stop sending me emails (${recipientEmail}).`)}`;
  return `<div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #333">
    <p style="font-size:12px;color:#666;margin:0;font-family:Arial,sans-serif">
      You are receiving this because you applied to a ${orgName} program.
      <a href="${href}" style="color:#888;text-decoration:underline">Unsubscribe</a>
    </p></div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SequenceSendDeps {
  /** Injected SendGrid client (tests pass a counting stub). */
  mail?: MailClient | null;
  /** Injected opt-out predicate (defaults to storage.isProspectOptedOut). */
  isOptedOut?: (orgId: string, email: string) => Promise<boolean>;
  /** Injected follow-up logger. */
  log?: typeof logFollowUp;
  /** Injected database handle — lets a test observe claim/send ordering. */
  loadDb?: () => Promise<any>;
  /** Injected storage facade. */
  storage?: Pick<typeof storage, "getOrganizationById" | "getAthleticProgramById" | "getUser">;
}

export type SequenceSendOutcome = "sent" | "failed" | "skipped";

async function resolveOptOut(deps: SequenceSendDeps, orgId: string, email: string): Promise<boolean> {
  const check = deps.isOptedOut ?? ((o: string, e: string) => storage.isProspectOptedOut(o, e));
  try {
    return await check(orgId, email);
  } catch (err: any) {
    // Fail closed: an opt-out lookup we cannot complete is not permission to send.
    console.error(`[LeadCapture Sequences] opt-out lookup failed for ${email} — skipping send:`, err?.message || err);
    return true;
  }
}

export async function sendSubmissionFollowUp(params: {
  submissionId: string;
  step: "high_intent_1hr" | "followup_24hr" | "nurture_3day" | string;
  orgId: string;
  athleteName: string;
  email: string;
  sport?: string | null;
  programName: string;
  orgName: string;
  orgSlug: string;
  coachName?: string;
  bookingUrl?: string | null;
  contactEmail?: string | null;
}, deps: SequenceSendDeps = {}): Promise<SequenceSendOutcome> {
  // ── 0: Global kill-switch — automated nurture mail, not transactional ──────
  if (!isAutomationSendsEnabled()) {
    logAutomationSendsDisabled(AUTOMATION_SCOPE);
    return "skipped";
  }

  const logStep = deps.log ?? logFollowUp;
  if (await resolveOptOut(deps, params.orgId, params.email)) {
    console.log(`[LeadCapture Sequences] ${params.email} has opted out — skipping ${params.step}`);
    await logStep({ orgId: params.orgId, submissionId: params.submissionId, sequenceStep: params.step, channel: "email", subject: "(suppressed)", body: "", status: "skipped_opt_out" });
    return "skipped";
  }

  const sg = deps.mail !== undefined ? deps.mail : await getSgMail();
  if (!sg) return "failed";
  const coachName = params.coachName || "Coach";
  let emailData: { subject: string; html: string } | null = null;

  if (params.step === "high_intent_1hr") {
    emailData = buildHighIntentFollowUp(params.athleteName, params.orgName, params.programName, coachName, params.bookingUrl);
  } else if (params.step === "followup_24hr") {
    emailData = build24hrFollowUp(params.athleteName, params.orgName, params.programName, coachName, params.bookingUrl);
  } else if (params.step === "nurture_3day") {
    emailData = build3DayNurture(params.athleteName, params.orgName, params.programName, coachName, params.sport || null, params.bookingUrl);
  }

  if (!emailData) return "failed";

  const footer = await buildOptOutFooter(params.orgId, params.email, params.orgName, params.contactEmail);
  const html = emailData.html + footer;

  try {
    await sg.send({ to: params.email, from: FROM_EMAIL, subject: emailData.subject, html });
    await logStep({ orgId: params.orgId, submissionId: params.submissionId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: html, status: "sent" });
    return "sent";
  } catch (err: any) {
    console.error(`[LeadCapture Sequences] ${params.step} send FAILED → ${params.email}:`, err?.message || err);
    await logStep({ orgId: params.orgId, submissionId: params.submissionId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: html, status: "failed" });
    return "failed";
  }
}

export async function sendAbandonedRecovery(params: {
  abandonedId: string;
  step: "recovery_30min" | "recovery_24hr";
  orgId: string;
  athleteName: string;
  email: string;
  programName: string;
  orgName: string;
  orgSlug: string;
  programSlug: string;
  contactEmail?: string | null;
}, deps: SequenceSendDeps = {}): Promise<SequenceSendOutcome> {
  // ── 0: Global kill-switch ─────────────────────────────────────────────────
  if (!isAutomationSendsEnabled()) {
    logAutomationSendsDisabled(AUTOMATION_SCOPE);
    return "skipped";
  }

  const logStep = deps.log ?? logFollowUp;
  if (await resolveOptOut(deps, params.orgId, params.email)) {
    console.log(`[LeadCapture Sequences] ${params.email} has opted out — skipping ${params.step}`);
    await logStep({ orgId: params.orgId, abandonedId: params.abandonedId, sequenceStep: params.step, channel: "email", subject: "(suppressed)", body: "", status: "skipped_opt_out" });
    return "skipped";
  }

  const sg = deps.mail !== undefined ? deps.mail : await getSgMail();
  if (!sg) return "failed";
  let emailData: { subject: string; html: string } | null = null;

  if (params.step === "recovery_30min") {
    emailData = buildAbandonedRecovery1(params.athleteName, params.orgName, params.programName, params.orgSlug, params.programSlug);
  } else if (params.step === "recovery_24hr") {
    emailData = buildAbandonedRecovery2(params.athleteName, params.orgName, params.programName, params.orgSlug, params.programSlug);
  }

  if (!emailData) return "failed";

  const footer = await buildOptOutFooter(params.orgId, params.email, params.orgName, params.contactEmail);
  const html = emailData.html + footer;

  try {
    await sg.send({ to: params.email, from: FROM_EMAIL, subject: emailData.subject, html });
    await logStep({ orgId: params.orgId, abandonedId: params.abandonedId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: html, status: "sent" });
    return "sent";
  } catch (err: any) {
    console.error(`[LeadCapture Sequences] ${params.step} send FAILED → ${params.email}:`, err?.message || err);
    await logStep({ orgId: params.orgId, abandonedId: params.abandonedId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: html, status: "failed" });
    return "failed";
  }
}

// ─── Claim-before-send ────────────────────────────────────────────────────────
//
// Before this PR the cron sent first and wrote sequence_status afterwards, so a
// status write that failed after a successful send re-sent the same step on the
// next tick, and a send that failed still advanced the row (a silent drop).
//
// Now each step is CLAIMED first with an atomic conditional UPDATE — the same
// shape as claimFollowUp() in server/email-agent/follow-up-cron.ts — into a
// terminal-for-the-sweep "<step>_sending" state. The sweep selects only
// pending / high_intent_sent / followup_24hr_sent, so a claimed row is never
// picked up twice. The result is then recorded: "<step>_sent" (or "completed")
// on success, "<step>_failed" on failure. A failed step does NOT advance to the
// next step, and it is a visible row rather than a swallowed exception.
//
// Tradeoff, deliberately chosen: a process that dies between claim and result
// leaves a "<step>_sending" row that the sweep will not retry. A stuck row is
// an operational annoyance; a duplicate send is money and a spam complaint.

export const SENDING_SUFFIX = "_sending";
export const FAILED_SUFFIX = "_failed";

/**
 * Atomic claim: advances `sequence_status` from `expected` to `claimStatus`
 * only if no other worker got there first. Returns true when THIS caller owns
 * the step.
 */
export async function claimSubmissionStep(
  dbLike: any,
  table: any,
  ops: { eq: any; and: any; sql: any },
  submissionId: string,
  expected: string,
  claimStatus: string,
  now: Date,
): Promise<boolean> {
  const claimed = await dbLike
    .update(table)
    .set({
      sequenceStatus: claimStatus,
      lastFollowUpAt: now,
      followUpCount: ops.sql`COALESCE(${table.followUpCount}, 0) + 1`,
    })
    .where(ops.and(ops.eq(table.id, submissionId), ops.eq(table.sequenceStatus, expected)))
    .returning({ id: table.id });
  return Array.isArray(claimed) ? claimed.length > 0 : !!claimed;
}

export async function claimAbandonedStep(
  dbLike: any,
  table: any,
  ops: { eq: any; and: any; sql: any },
  abandonedId: string,
  expected: string,
  claimStatus: string,
  now: Date,
): Promise<boolean> {
  const claimed = await dbLike
    .update(table)
    .set({
      recoverySequenceStatus: claimStatus,
      followupSentAt: now,
      followupCount: ops.sql`COALESCE(${table.followupCount}, 0) + 1`,
    })
    .where(ops.and(ops.eq(table.id, abandonedId), ops.eq(table.recoverySequenceStatus, expected)))
    .returning({ id: table.id });
  return Array.isArray(claimed) ? claimed.length > 0 : !!claimed;
}

// ─── Cron Runner ─────────────────────────────────────────────────────────────

export async function runLeadCaptureSequenceCron(deps: SequenceSendDeps = {}): Promise<void> {
  // ── 0: Global kill-switch — before any DB read, any send, any state change ──
  if (automationRunBlocked(AUTOMATION_SCOPE)) return;

  try {
    const db = deps.loadDb ? await deps.loadDb() : (await import("./db")).db;
    const store = deps.storage ?? storage;
    const { leadCaptureSubmissions, leadCaptureAbandoned } = await import("@shared/schema");
    const { eq, isNull, and, or, sql } = await import("drizzle-orm");
    const ops = { eq, and, sql };
    const now = new Date();

    // --- Process submission sequences ---
    const submissions = await db.select().from(leadCaptureSubmissions)
      .where(or(
        eq(leadCaptureSubmissions.sequenceStatus, "pending"),
        eq(leadCaptureSubmissions.sequenceStatus, "high_intent_sent"),
        eq(leadCaptureSubmissions.sequenceStatus, "followup_24hr_sent"),
      ));

    for (const sub of submissions) {
      try {
        const org = await store.getOrganizationById(sub.orgId);
        if (!org) continue;
        const program = await store.getAthleticProgramById(sub.programId);
        if (!program) continue;
        const owner = org.ownerUserId ? await store.getUser(org.ownerUserId) : null;
        const coachName = owner?.firstName ? `${owner.firstName} ${owner.lastName || ""}`.trim() : "Coach";
        const subAge = now.getTime() - new Date(sub.createdAt!).getTime();

        const bookingUrl = (program as any).bookingUrl || null;
        const contactEmail = (org as any).ownerEmail || (org as any).schedulingInquiryEmail || null;

        // Decide which step is due, if any.
        let step: string | null = null;
        let expected: string | null = null;
        let successStatus: string | null = null;

        if (sub.sequenceStatus === "pending" && (sub.aiQualificationScore ?? 0) >= 75 && subAge >= 60 * 60 * 1000) {
          step = "high_intent_1hr"; expected = "pending"; successStatus = "high_intent_sent";
        } else if (sub.sequenceStatus === "pending" && subAge >= 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          step = "followup_24hr"; expected = "pending"; successStatus = "followup_24hr_sent";
        } else if (sub.sequenceStatus === "high_intent_sent" && subAge >= 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          step = "followup_24hr"; expected = "high_intent_sent"; successStatus = "followup_24hr_sent";
        } else if (sub.sequenceStatus === "followup_24hr_sent" && subAge >= 3 * 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          step = "nurture_3day"; expected = "followup_24hr_sent"; successStatus = "completed";
        }

        if (!step || !expected || !successStatus) continue;

        // ── Claim BEFORE sending ───────────────────────────────────────────
        const claimStatus = `${step}${SENDING_SUFFIX}`;
        const owned = await claimSubmissionStep(db, leadCaptureSubmissions, ops, sub.id, expected, claimStatus, now);
        if (!owned) {
          console.log(`[LeadCapture Sequences] submission ${sub.id} step ${step} already claimed — skipping`);
          continue;
        }

        const outcome = await sendSubmissionFollowUp({
          submissionId: sub.id, step, orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email,
          sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug,
          coachName, bookingUrl, contactEmail,
        }, deps);

        // ── Record the result ──────────────────────────────────────────────
        const finalStatus = outcome === "sent" ? successStatus : `${step}${FAILED_SUFFIX}`;
        await db.update(leadCaptureSubmissions)
          .set({ sequenceStatus: finalStatus })
          .where(eq(leadCaptureSubmissions.id, sub.id));
        if (outcome !== "sent") {
          console.warn(`[LeadCapture Sequences] submission ${sub.id} step ${step} ${outcome} — sequence NOT advanced (status=${finalStatus})`);
        }
      } catch (err: any) {
        // Never swallowed: the previous `catch (_) {}` turned every failure here
        // into an invisible drop.
        console.error(`[LeadCapture Sequences] submission ${sub.id} failed:`, err?.message || err);
      }
    }

    // --- Process abandoned recovery sequences ---
    const abandoned = await db.select().from(leadCaptureAbandoned)
      .where(and(isNull(leadCaptureAbandoned.completedAt), or(
        eq(leadCaptureAbandoned.recoverySequenceStatus, "pending"),
        eq(leadCaptureAbandoned.recoverySequenceStatus, "recovery_30min_sent"),
      )));

    for (const ab of abandoned) {
      try {
        const org = await store.getOrganizationById(ab.orgId);
        if (!org) continue;
        const program = await store.getAthleticProgramById(ab.programId);
        if (!program) continue;
        const abAge = now.getTime() - new Date(ab.createdAt!).getTime();
        const contactEmail = (org as any).ownerEmail || (org as any).schedulingInquiryEmail || null;

        let step: "recovery_30min" | "recovery_24hr" | null = null;
        let expected: string | null = null;
        let successStatus: string | null = null;

        if (ab.recoverySequenceStatus === "pending" && abAge >= 30 * 60 * 1000) {
          step = "recovery_30min"; expected = "pending"; successStatus = "recovery_30min_sent";
        } else if (ab.recoverySequenceStatus === "recovery_30min_sent" && abAge >= 24 * 60 * 60 * 1000) {
          step = "recovery_24hr"; expected = "recovery_30min_sent"; successStatus = "recovery_24hr_sent";
        }

        if (!step || !expected || !successStatus) continue;

        const claimStatus = `${step}${SENDING_SUFFIX}`;
        const owned = await claimAbandonedStep(db, leadCaptureAbandoned, ops, ab.id, expected, claimStatus, now);
        if (!owned) {
          console.log(`[LeadCapture Sequences] abandoned ${ab.id} step ${step} already claimed — skipping`);
          continue;
        }

        const outcome = await sendAbandonedRecovery({
          abandonedId: ab.id, step, orgId: ab.orgId, athleteName: ab.athleteName, email: ab.email,
          programName: program.name, orgName: org.name, orgSlug: org.slug, programSlug: program.slug,
          contactEmail,
        }, deps);

        const finalStatus = outcome === "sent" ? successStatus : `${step}${FAILED_SUFFIX}`;
        await db.update(leadCaptureAbandoned)
          .set({ recoverySequenceStatus: finalStatus })
          .where(eq(leadCaptureAbandoned.id, ab.id));
        if (outcome !== "sent") {
          console.warn(`[LeadCapture Sequences] abandoned ${ab.id} step ${step} ${outcome} — sequence NOT advanced (status=${finalStatus})`);
        }
      } catch (err: any) {
        console.error(`[LeadCapture Sequences] abandoned ${ab.id} failed:`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error("[LeadCapture Sequences] cron error:", err.message);
  }
}

export function initializeLeadCaptureSequenceCron(): void {
  // Global lock: runLeadCaptureSequenceCron is a cross-org sweep, so a single
  // instance runs it per tick (autoscale) — preventing duplicate lead sends
  // before each row's sequenceStatus advances. Send behavior is unchanged.
  const guardedRun = async () => {
    resetAutomationSendsLog(AUTOMATION_SCOPE);
    const { acquireJobLock, releaseJobLock } = await import("./services/ceo-heartbeat-service");
    const { acquired, lockKey } = await acquireJobLock("__global__", "lead_capture_sequences", 30).catch(
      (error) => { console.error("[Lead Capture] lock failure:", error); return { acquired: false, lockKey: "", ownerToken: "", expiresAt: null, failure: "lock_service" as const }; }
    );
    if (!acquired) {
      console.log("[LeadCapture Sequences] Lock held by another instance — skipping this run");
      return;
    }
    try {
      await runLeadCaptureSequenceCron();
    } finally {
      if (lockKey) await releaseJobLock(lockKey).catch(() => {});
    }
  };

  setTimeout(guardedRun, 5 * 60 * 1000); // first run 5 min after boot
  setInterval(guardedRun, 30 * 60 * 1000); // then every 30 min
  console.log(`[LeadCapture Sequences] cron started — runs every 30 minutes (${AUTOMATION_KILL_SWITCH_REASON} respected)`);
}
