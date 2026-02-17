import { storage } from "./storage";
import { sendWeeklyReminderEmail } from "./email";

const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 7;

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
        await sendWeeklyReminderEmail(user.email!, user.firstName || "there");
        await storage.markReminderSent(user.id);
        console.log(`[Weekly Reminder] Sent to ${user.email}`);
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
