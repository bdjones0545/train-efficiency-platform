import { storage } from "../storage";
import { sendTeamTrainingOutreachEmail, type OrgBranding } from "../email";
import { generateOutreachEmailFromVariant } from "../team-training-prospecting";

// Follow-up sequence schedule: days after initial send
const FOLLOW_UP_DAYS = [3, 7, 14];
const MAX_FOLLOW_UPS = 3;

const FOLLOW_UP_OPENERS = [
  "Just wanted to follow up on my previous message regarding team training for",
  "Circling back on my last note about strength & conditioning for",
  "Wanted to reconnect — reaching out again about training programs for",
];

async function getOrgBranding(orgId: string): Promise<OrgBranding | undefined> {
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return undefined;
    const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
    return {
      name: org.name,
      accentColor: org.primaryColor || undefined,
      emailPrimaryColor: org.emailPrimaryColor || undefined,
      emailSecondaryColor: org.emailSecondaryColor || undefined,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

async function getCoachName(orgId: string): Promise<string> {
  try {
    const org = await storage.getOrganizationById(orgId);
    if (!org) return "Coach";
    const owner = org.ownerUserId ? await storage.getUser(org.ownerUserId) : null;
    if (owner?.firstName) return `${owner.firstName} ${owner.lastName || ""}`.trim();
    return "Coach";
  } catch {
    return "Coach";
  }
}

/**
 * Schedule follow-up steps for a newly-sent outreach draft.
 * Called right after the initial email is successfully sent.
 */
export async function scheduleFollowUpsForDraft(
  orgId: string,
  outreachDraftId: string,
  prospectId: string,
  sentAt: Date = new Date(),
): Promise<void> {
  // Cancel any existing pending follow-ups for this draft (idempotent)
  await storage.cancelFollowUpSequence(outreachDraftId);

  for (let i = 0; i < FOLLOW_UP_DAYS.length; i++) {
    const scheduledFor = new Date(sentAt.getTime() + FOLLOW_UP_DAYS[i] * 24 * 60 * 60 * 1000);
    await storage.createFollowUp({
      orgId,
      outreachDraftId,
      prospectId,
      stepNumber: i + 1,
      scheduledFor,
      status: "pending",
    });
  }

  console.log(`[FollowUp] Scheduled ${FOLLOW_UP_DAYS.length} follow-ups for draft ${outreachDraftId}`);
}

/**
 * Process all due follow-ups for a given org.
 * Called from the daily cron.
 */
export async function processFollowUpsForOrg(orgId: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const result = { sent: 0, skipped: 0, errors: [] as string[] };

  const dueFollowUps = await storage.getDueFollowUps(orgId);
  if (dueFollowUps.length === 0) return result;

  console.log(`[FollowUp] org ${orgId} — ${dueFollowUps.length} due follow-ups`);

  const branding = await getOrgBranding(orgId);
  const coachName = await getCoachName(orgId);

  for (const followUp of dueFollowUps) {
    try {
      const prospect = await storage.getTeamTrainingProspect(followUp.prospectId);

      // Stop conditions
      if (!prospect || !prospect.contactEmail) {
        await storage.updateFollowUp(followUp.id, { status: "skipped" });
        result.skipped++;
        continue;
      }

      if (prospect.outreachStatus === "Do Not Contact" || prospect.outreachStatus === "Replied") {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        continue;
      }

      const optedOut = await storage.isProspectOptedOut(orgId, prospect.contactEmail);
      if (optedOut) {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        continue;
      }

      // Check max follow-ups guard (step_number <= MAX_FOLLOW_UPS)
      if (followUp.stepNumber > MAX_FOLLOW_UPS) {
        await storage.updateFollowUp(followUp.id, { status: "cancelled" });
        result.skipped++;
        continue;
      }

      // Generate follow-up body
      let subject = followUp.subject;
      let body = followUp.body;

      if (!subject || !body) {
        const variant = await storage.selectVariantForEmail(orgId);
        const org = await storage.getOrganizationById(orgId);
        const businessName = org?.name || "Our Training Facility";

        const opener = FOLLOW_UP_OPENERS[(followUp.stepNumber - 1) % FOLLOW_UP_OPENERS.length];

        const closingLines: Record<number, string> = {
          1: "I'd love to connect and share how we've helped similar programs this season.",
          2: "Would a quick 10-minute call make sense this week?",
          3: "If now isn't the right time, no worries — I'll close this out. Otherwise, I'm happy to connect.",
        };
        const closingLine = closingLines[followUp.stepNumber] ?? closingLines[3];

        if (variant) {
          const emailParams = {
            prospectName: prospect.prospectName,
            sport: prospect.sport || "sports",
            city: prospect.city || "",
            contactName: prospect.contactName || "",
            businessName,
            coachName,
          };
          const generated = await generateOutreachEmailFromVariant(emailParams, variant);
          subject = `Re: ${generated.subject}`;
          body = `${opener} ${prospect.prospectName}.\n\n${closingLine}\n\n${generated.body}`;
        } else {
          subject = `Following up — Training for ${prospect.prospectName}`;
          body = `Hi${prospect.contactName ? " " + prospect.contactName : ""},\n\n${opener} ${prospect.prospectName}.\n\n${closingLine}\n\nBest,\n${coachName}\n${businessName}`;
        }
      }

      await sendTeamTrainingOutreachEmail(
        prospect.contactEmail,
        subject!,
        body!,
        branding,
        followUp.id,
      );

      await storage.updateFollowUp(followUp.id, {
        status: "sent",
        sentAt: new Date(),
        subject,
        body,
      });

      await storage.logOutreachEvent({
        orgId,
        prospectId: followUp.prospectId,
        draftId: followUp.outreachDraftId,
        eventType: "sent",
        description: `[Auto] Follow-up #${followUp.stepNumber} sent to ${prospect.contactEmail}`,
      });

      result.sent++;
    } catch (err: any) {
      console.error(`[FollowUp] Error processing follow-up ${followUp.id}:`, err.message);
      result.errors.push(`follow-up ${followUp.id}: ${err.message}`);
      await storage.updateFollowUp(followUp.id, { status: "skipped" }).catch(() => {});
    }
  }

  console.log(`[FollowUp] org ${orgId} — sent=${result.sent} skipped=${result.skipped} errors=${result.errors.length}`);
  return result;
}

let followUpCronInitialized = false;

export function initializeFollowUpCron(): void {
  if (followUpCronInitialized) return;
  followUpCronInitialized = true;

  // Run once at startup (after a short delay), then every hour
  setTimeout(() => runFollowUpCron(), 15_000);

  setInterval(() => runFollowUpCron(), 60 * 60 * 1000);

  console.log("[FollowUp Cron] started — will run hourly");
}

async function runFollowUpCron(): Promise<void> {
  try {
    // Get all orgs that have an enabled email agent
    const { appSettings } = await import("@shared/schema");
    const { db } = await import("../db");
    const { eq, like } = await import("drizzle-orm");

    const settingRows = await db.select().from(appSettings)
      .where(like(appSettings.key, "email_agent_%"));

    const orgIds = new Set<string>();
    for (const row of settingRows) {
      const match = row.key.match(/^email_agent_(.+)$/);
      if (match) {
        try {
          const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          if (val?.enabled) orgIds.add(match[1]);
        } catch {}
      }
    }

    for (const orgId of Array.from(orgIds)) {
      await processFollowUpsForOrg(orgId).catch(e =>
        console.error(`[FollowUp Cron] org ${orgId} error:`, e.message)
      );
    }
  } catch (err: any) {
    console.error("[FollowUp Cron] error:", err.message);
  }
}
