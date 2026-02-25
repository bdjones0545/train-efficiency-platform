import { storage } from "./storage";
import { sendWeeklyReminderEmail, type OrgBranding } from "./email";

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 7;

async function getOrgBrandingForUser(userId: string): Promise<OrgBranding | undefined> {
  try {
    const profile = await storage.getUserProfile(userId);
    if (!profile?.organizationId) return undefined;
    const org = await storage.getOrganizationById(profile.organizationId);
    if (!org) return undefined;
    return {
      name: org.name,
      accentColor: org.primaryColor || undefined,
      ownerEmail: org.ownerEmail || undefined,
    };
  } catch {
    return undefined;
  }
}

async function sendWeeklyReminders() {
  try {
    const inactiveUsers = await storage.getInactiveUsersForReminder(INACTIVE_DAYS);

    const usersWithEmail = inactiveUsers.filter(u => u.email);
    if (usersWithEmail.length === 0) {
      console.log("[Weekly Reminder] No inactive users to remind.");
      return;
    }

    console.log(`[Weekly Reminder] Found ${usersWithEmail.length} inactive users. Sending reminders...`);

    for (const user of usersWithEmail) {
      try {
        const orgB = await getOrgBrandingForUser(user.id);
        await sendWeeklyReminderEmail(user.email!, user.firstName || "there", orgB);
        await storage.markReminderSent(user.id);
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
  console.log("[Weekly Reminder] Job started. Checking daily for users inactive 7+ days.");

  setTimeout(() => {
    sendWeeklyReminders();
  }, 60 * 1000);

  setInterval(() => {
    sendWeeklyReminders();
  }, REMINDER_INTERVAL_MS);
}
