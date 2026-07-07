/**
 * Lead Capture Follow-Up Sequence Engine
 * Handles automated email sequences for submitted and abandoned lead capture applications.
 */

import { storage } from "./storage";

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

// ─── Public API ───────────────────────────────────────────────────────────────

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
}): Promise<boolean> {
  const sg = await getSgMail();
  if (!sg) return false;
  const coachName = params.coachName || "Coach";
  let emailData: { subject: string; html: string } | null = null;

  if (params.step === "high_intent_1hr") {
    emailData = buildHighIntentFollowUp(params.athleteName, params.orgName, params.programName, coachName, params.bookingUrl);
  } else if (params.step === "followup_24hr") {
    emailData = build24hrFollowUp(params.athleteName, params.orgName, params.programName, coachName, params.bookingUrl);
  } else if (params.step === "nurture_3day") {
    emailData = build3DayNurture(params.athleteName, params.orgName, params.programName, coachName, params.sport || null, params.bookingUrl);
  }

  if (!emailData) return false;

  try {
    await sg.send({ to: params.email, from: FROM_EMAIL, subject: emailData.subject, html: emailData.html });
    await logFollowUp({ orgId: params.orgId, submissionId: params.submissionId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: emailData.html, status: "sent" });
    return true;
  } catch (err: any) {
    await logFollowUp({ orgId: params.orgId, submissionId: params.submissionId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: emailData.html, status: "failed" });
    return false;
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
}): Promise<boolean> {
  const sg = await getSgMail();
  if (!sg) return false;
  let emailData: { subject: string; html: string } | null = null;

  if (params.step === "recovery_30min") {
    emailData = buildAbandonedRecovery1(params.athleteName, params.orgName, params.programName, params.orgSlug, params.programSlug);
  } else if (params.step === "recovery_24hr") {
    emailData = buildAbandonedRecovery2(params.athleteName, params.orgName, params.programName, params.orgSlug, params.programSlug);
  }

  if (!emailData) return false;

  try {
    await sg.send({ to: params.email, from: FROM_EMAIL, subject: emailData.subject, html: emailData.html });
    await logFollowUp({ orgId: params.orgId, abandonedId: params.abandonedId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: emailData.html, status: "sent" });
    return true;
  } catch {
    await logFollowUp({ orgId: params.orgId, abandonedId: params.abandonedId, sequenceStep: params.step, channel: "email", subject: emailData.subject, body: emailData.html, status: "failed" });
    return false;
  }
}

// ─── Cron Runner ─────────────────────────────────────────────────────────────

async function runLeadCaptureSequenceCron(): Promise<void> {
  try {
    const { db } = await import("./db");
    const { leadCaptureSubmissions, leadCaptureAbandoned, leadCaptureFunnelEvents } = await import("@shared/schema");
    const { eq, isNull, lte, and, or, ne } = await import("drizzle-orm");
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHrsAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    // --- Process submission sequences ---
    const submissions = await db.select().from(leadCaptureSubmissions)
      .where(or(
        eq(leadCaptureSubmissions.sequenceStatus, "pending"),
        eq(leadCaptureSubmissions.sequenceStatus, "high_intent_sent"),
        eq(leadCaptureSubmissions.sequenceStatus, "followup_24hr_sent"),
      ));

    for (const sub of submissions) {
      try {
        const org = await storage.getOrganizationById(sub.orgId);
        if (!org) continue;
        const program = await storage.getAthleticProgramById(sub.programId);
        if (!program) continue;
        const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
        const coachName = owner?.firstName ? `${owner.firstName} ${owner.lastName || ""}`.trim() : "Coach";
        const subAge = now.getTime() - new Date(sub.createdAt!).getTime();

        const bookingUrl = (program as any).bookingUrl || null;

        if (sub.sequenceStatus === "pending" && (sub.aiQualificationScore ?? 0) >= 75 && subAge >= 60 * 60 * 1000) {
          // 1hr high-intent follow-up
          await sendSubmissionFollowUp({ submissionId: sub.id, step: "high_intent_1hr", orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email, sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug, coachName, bookingUrl });
          await db.update(leadCaptureSubmissions).set({ sequenceStatus: "high_intent_sent", lastFollowUpAt: now, followUpCount: (sub.followUpCount ?? 0) + 1 }).where(eq(leadCaptureSubmissions.id, sub.id));
        } else if (sub.sequenceStatus === "pending" && subAge >= 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          // 24hr follow-up for uncontacted
          await sendSubmissionFollowUp({ submissionId: sub.id, step: "followup_24hr", orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email, sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug, coachName, bookingUrl });
          await db.update(leadCaptureSubmissions).set({ sequenceStatus: "followup_24hr_sent", lastFollowUpAt: now, followUpCount: (sub.followUpCount ?? 0) + 1 }).where(eq(leadCaptureSubmissions.id, sub.id));
        } else if (sub.sequenceStatus === "high_intent_sent" && subAge >= 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          // 24hr follow-up after high-intent
          await sendSubmissionFollowUp({ submissionId: sub.id, step: "followup_24hr", orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email, sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug, coachName, bookingUrl });
          await db.update(leadCaptureSubmissions).set({ sequenceStatus: "followup_24hr_sent", lastFollowUpAt: now, followUpCount: (sub.followUpCount ?? 0) + 1 }).where(eq(leadCaptureSubmissions.id, sub.id));
        } else if (sub.sequenceStatus === "followup_24hr_sent" && subAge >= 3 * 24 * 60 * 60 * 1000 && !sub.contactedAt) {
          // 3-day nurture
          await sendSubmissionFollowUp({ submissionId: sub.id, step: "nurture_3day", orgId: sub.orgId, athleteName: sub.athleteName, email: sub.email, sport: sub.sport, programName: program.name, orgName: org.name, orgSlug: org.slug, coachName, bookingUrl });
          await db.update(leadCaptureSubmissions).set({ sequenceStatus: "completed", lastFollowUpAt: now, followUpCount: (sub.followUpCount ?? 0) + 1 }).where(eq(leadCaptureSubmissions.id, sub.id));
        }
      } catch (_) {}
    }

    // --- Process abandoned recovery sequences ---
    const abandoned = await db.select().from(leadCaptureAbandoned)
      .where(and(isNull(leadCaptureAbandoned.completedAt), or(
        eq(leadCaptureAbandoned.recoverySequenceStatus, "pending"),
        eq(leadCaptureAbandoned.recoverySequenceStatus, "recovery_30min_sent"),
      )));

    for (const ab of abandoned) {
      try {
        const org = await storage.getOrganizationById(ab.orgId);
        if (!org) continue;
        const program = await storage.getAthleticProgramById(ab.programId);
        if (!program) continue;
        const abAge = now.getTime() - new Date(ab.createdAt!).getTime();

        if (ab.recoverySequenceStatus === "pending" && abAge >= 30 * 60 * 1000) {
          await sendAbandonedRecovery({ abandonedId: ab.id, step: "recovery_30min", orgId: ab.orgId, athleteName: ab.athleteName, email: ab.email, programName: program.name, orgName: org.name, orgSlug: org.slug, programSlug: program.slug });
          await db.update(leadCaptureAbandoned).set({ recoverySequenceStatus: "recovery_30min_sent", followupSentAt: now, followupCount: (ab.followupCount ?? 0) + 1 }).where(eq(leadCaptureAbandoned.id, ab.id));
        } else if (ab.recoverySequenceStatus === "recovery_30min_sent" && abAge >= 24 * 60 * 60 * 1000) {
          await sendAbandonedRecovery({ abandonedId: ab.id, step: "recovery_24hr", orgId: ab.orgId, athleteName: ab.athleteName, email: ab.email, programName: program.name, orgName: org.name, orgSlug: org.slug, programSlug: program.slug });
          await db.update(leadCaptureAbandoned).set({ recoverySequenceStatus: "recovery_24hr_sent", followupSentAt: now, followupCount: (ab.followupCount ?? 0) + 1 }).where(eq(leadCaptureAbandoned.id, ab.id));
        }
      } catch (_) {}
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
    const { acquireJobLock, releaseJobLock } = await import("./services/ceo-heartbeat-service");
    const { acquired, lockKey } = await acquireJobLock("__global__", "lead_capture_sequences", 30).catch(
      () => ({ acquired: true, lockKey: "" })
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
  console.log("[LeadCapture Sequences] cron started — runs every 30 minutes");
}
