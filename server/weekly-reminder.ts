import { storage } from "./storage";
import { sendWeeklyReminderEmail, type OrgBranding } from "./email";
import { automationRunBlocked, resetAutomationSendsLog } from "./lib/automation-sends";

const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 7;

const AUTOMATION_SCOPE = "weekly re-engagement reminders";

export interface WeeklyReminderDeps {
  /** Injected sender (tests pass a counting stub). */
  sendReminder?: typeof sendWeeklyReminderEmail;
  /** Injected inactive-user lookup. */
  getInactiveUsers?: (days: number) => Promise<any[]>;
  /** Injected "reminder sent" writer. */
  markSent?: (userId: string) => Promise<any>;
}

async function getOrgBrandingForUser(userId: string): Promise<OrgBranding | undefined> {
  try {
    const profile = await storage.getUserProfile(userId);
    if (!profile?.organizationId) return undefined;
    const org = await storage.getOrganizationById(profile.organizationId);
    if (!org) return undefined;
    return {
      name: org.name,
      accentColor: org.primaryColor || undefined,
      emailPrimaryColor: org.emailPrimaryColor || undefined,
      emailSecondaryColor: org.emailSecondaryColor || undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

export async function sendWeeklyReminders(deps: WeeklyReminderDeps = {}) {
  // ── 0: Global kill-switch ─────────────────────────────────────────────────
  // This sweep is marketing, produced by a timer. The emergency off-switch must
  // reach it, and it must reach it BEFORE any user is looked up or any state is
  // written — a skipped run leaves last_reminder_sent_at untouched so the sweep
  // resumes normally once the switch is back on.
  if (automationRunBlocked(AUTOMATION_SCOPE)) return;

  const send = deps.sendReminder ?? sendWeeklyReminderEmail;
  const getInactive = deps.getInactiveUsers ?? ((days: number) => storage.getInactiveUsersForReminder(days));
  const markSent = deps.markSent ?? ((userId: string) => storage.markReminderSent(userId));

  try {
    const inactiveUsers = await getInactive(INACTIVE_DAYS);

    const usersWithEmail = inactiveUsers.filter(u => u.email);
    if (usersWithEmail.length === 0) {
      console.log("[Weekly Reminder] No inactive users to remind.");
      return;
    }

    console.log(`[Weekly Reminder] Found ${usersWithEmail.length} inactive users. Sending reminders...`);

    for (const user of usersWithEmail) {
      try {
        const orgB = await getOrgBrandingForUser(user.id);
        const profile = await storage.getUserProfile(user.id).catch(() => null);
        // logCtx makes the preference check, the unsubscribe token and the
        // emergency pause inside sendEmail() apply to this marketing send.
        await send(user.email!, user.firstName || "there", orgB, {
          orgId: profile?.organizationId ?? "",
          type: "marketing",
          recipientUserId: user.id,
          userId: user.id,
          reasonSent: `Inactive for ${INACTIVE_DAYS}+ days`,
          sourceAction: "weekly_reminder_cron",
        });
        await markSent(user.id);
        console.log(`[Weekly Reminder] Sent to ${user.email} (org: ${orgB?.name || "platform"})`);
      } catch (err) {
        console.error(`[Weekly Reminder] Failed to send to ${user.email}:`, err);
      }
    }

    console.log("[Weekly Reminder] Batch complete.");
  } catch (error) {
    console.error("[Weekly Reminder] Error running job:", error);
  }
}

export function startWeeklyReminderJob() {
  console.log("[Weekly Reminder] Job started. Checking every 7 days for users inactive 7+ days.");

  // Global lock: prevents two instances (autoscale) from running the sweep
  // concurrently and double-sending before markReminderSent updates. Send
  // behavior inside sendWeeklyReminders is unchanged.
  const guardedRun = async () => {
    resetAutomationSendsLog(AUTOMATION_SCOPE);
    const { acquireJobLock, releaseJobLock } = await import("./services/ceo-heartbeat-service");
    const { acquired, lockKey } = await acquireJobLock("__global__", "weekly_reminder", 120).catch(
      (error) => { console.error("[Weekly Reminder] lock failure:", error); return { acquired: false, lockKey: "", ownerToken: "", expiresAt: null, failure: "lock_service" as const }; }
    );
    if (!acquired) {
      console.log("[Weekly Reminder] Lock held by another instance — skipping this run");
      return;
    }
    try {
      await sendWeeklyReminders();
    } finally {
      if (lockKey) await releaseJobLock(lockKey).catch(() => {});
    }
  };

  setTimeout(guardedRun, 60 * 1000);

  setInterval(guardedRun, REMINDER_INTERVAL_MS);
}
