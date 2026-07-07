import { storage } from "./storage";
import {
  sendUpcomingSessionReminderEmailToClient,
  sendUpcomingSessionReminderEmailToCoach,
  type OrgBranding,
  type EmailLogContext,
} from "./email";
import { sendSms, smsReminder, normalizePhone } from "./sms";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Run every hour
const WINDOW_HOURS = 24; // Send reminders for sessions starting within 24 hours
const INITIAL_DELAY_MS = 2 * 60 * 1000; // Wait 2 minutes after startup before first check

async function getOrgBrandingForBooking(
  organizationId: string | null | undefined
): Promise<{ branding: OrgBranding | undefined; timezone: string; orgName: string }> {
  if (!organizationId) return { branding: undefined, timezone: "America/New_York", orgName: "TrainEfficiency" };
  try {
    const org = await storage.getOrganizationById(organizationId);
    if (!org) return { branding: undefined, timezone: "America/New_York", orgName: "TrainEfficiency" };
    return {
      branding: {
        name: org.name,
        accentColor: org.primaryColor || undefined,
        emailPrimaryColor: org.emailPrimaryColor || undefined,
        emailSecondaryColor: org.emailSecondaryColor || undefined,
        ownerEmail: org.ownerEmail || undefined,
      },
      timezone: org.timezone || "America/New_York",
      orgName: org.name || "TrainEfficiency",
    };
  } catch {
    return { branding: undefined, timezone: "America/New_York", orgName: "TrainEfficiency" };
  }
}

async function sendSessionReminders() {
  const now = Date.now();
  const windowStart = now; // from now
  const windowEnd = now + WINDOW_HOURS * 60 * 60 * 1000; // to 24 hours from now

  let eligibleBookings: Awaited<ReturnType<typeof storage.getUpcomingBookingsForReminder>>;

  try {
    eligibleBookings = await storage.getUpcomingBookingsForReminder(windowStart, windowEnd);
  } catch (err) {
    console.error("[Session Reminders] Failed to query upcoming bookings:", err);
    return;
  }

  if (eligibleBookings.length === 0) {
    console.log("[Session Reminders] No upcoming bookings in the next 24 hours.");
    return;
  }

  // Filter to only those that still need a client or coach reminder
  const needsReminder = eligibleBookings.filter(
    b => !b.clientReminderSentAt || !b.coachReminderSentAt
  );

  if (needsReminder.length === 0) {
    console.log("[Session Reminders] All upcoming bookings already reminded. Skipping.");
    return;
  }

  console.log(
    `[Session Reminders] Found ${needsReminder.length} booking(s) needing reminders.`
  );

  for (const booking of needsReminder) {
    const startAt = new Date(booking.startAt);
    const endAt = new Date(booking.endAt);
    const location = (booking as any).location || undefined;

    // Fetch org branding and timezone
    const { branding, timezone, orgName } = await getOrgBrandingForBooking(booking.organizationId);

    // --- Client reminder ---
    if (!booking.clientReminderSentAt) {
      try {
        const clientUser = await storage.getUser(booking.clientId);
        if (clientUser?.email) {
          // Fetch coach name for client email
          const coachProfile = await storage.getCoachProfile(booking.coachId);
          const service = await storage.getService(booking.serviceId);
          const coachName = coachProfile?.user
            ? `${coachProfile.user.firstName ?? ""} ${coachProfile.user.lastName ?? ""}`.trim()
            : "Your Coach";
          const coachFirstName = coachProfile?.user?.firstName || "Your Coach";
          const serviceName = service?.name || "Training Session";

          const clientReminderLogCtx: EmailLogContext | undefined = booking.organizationId ? {
              orgId: booking.organizationId,
              type: "reminder",
              userId: clientUser.id,
              bookingId: booking.id,
              recipientUserId: clientUser.id,
            } : undefined;
          await sendUpcomingSessionReminderEmailToClient(
            clientUser.email,
            clientUser.firstName || "there",
            coachName,
            serviceName,
            startAt,
            endAt,
            location,
            timezone,
            branding,
            clientReminderLogCtx
          );

          // SMS reminder for client
          if (booking.organizationId && clientUser.phone && normalizePhone(clientUser.phone)) {
            const dateStr = startAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone });
            const timeStr = startAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
            await sendSms({
              to: clientUser.phone,
              body: smsReminder({
                clientFirstName: clientUser.firstName || "there",
                serviceName,
                coachFirstName,
                dateStr,
                timeStr,
                orgName,
              }),
              ctx: {
                orgId: booking.organizationId,
                type: "reminder",
                userId: clientUser.id,
                bookingId: booking.id,
                recipientUserId: clientUser.id,
              },
            });
          }

          await storage.markClientReminderSent(booking.id);
          console.log(
            `[Session Reminders] Client reminder sent to ${clientUser.email} for booking ${booking.id}`
          );
        } else {
          console.log(
            `[Session Reminders] Skipping client reminder for booking ${booking.id} — no client email on file`
          );
        }
      } catch (err) {
        console.error(
          `[Session Reminders] Client reminder failed for booking ${booking.id}:`,
          err
        );
        // Do not mark as sent — will retry next run
      }
    }

    // --- Coach reminder ---
    if (!booking.coachReminderSentAt) {
      try {
        const coachProfile = await storage.getCoachProfile(booking.coachId);
        const coachEmail = (coachProfile as any)?.email || coachProfile?.user?.email;
        const coachUserId = coachProfile?.user?.id;

        if (coachEmail) {
          const clientUser = await storage.getUser(booking.clientId);
          const service = await storage.getService(booking.serviceId);
          const clientName = clientUser
            ? `${clientUser.firstName ?? ""} ${clientUser.lastName ?? ""}`.trim()
            : "A client";
          const serviceName = service?.name || "Training Session";

          const coachReminderLogCtx: EmailLogContext | undefined = booking.organizationId ? {
              orgId: booking.organizationId,
              type: "reminder",
              bookingId: booking.id,
              recipientUserId: coachUserId,
            } : undefined;
          await sendUpcomingSessionReminderEmailToCoach(
            coachEmail,
            coachProfile?.user?.firstName || "Coach",
            clientName,
            serviceName,
            startAt,
            endAt,
            location,
            timezone,
            branding,
            coachReminderLogCtx
          );

          // SMS reminder for coach
          const coachPhone = coachProfile?.user?.phone;
          if (booking.organizationId && coachUserId && coachPhone && normalizePhone(coachPhone)) {
            const dateStr = startAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone });
            const timeStr = startAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
            await sendSms({
              to: coachPhone,
              body: smsReminder({
                clientFirstName: clientName,
                serviceName,
                coachFirstName: clientName,
                dateStr,
                timeStr,
                orgName,
              }),
              ctx: {
                orgId: booking.organizationId,
                type: "reminder",
                coachId: booking.coachId,
                bookingId: booking.id,
                recipientUserId: coachUserId,
              },
            });
          }

          await storage.markCoachReminderSent(booking.id);
          console.log(
            `[Session Reminders] Coach reminder sent to ${coachEmail} for booking ${booking.id}`
          );
        } else {
          console.log(
            `[Session Reminders] Skipping coach reminder for booking ${booking.id} — no coach email on file`
          );
        }
      } catch (err) {
        console.error(
          `[Session Reminders] Coach reminder failed for booking ${booking.id}:`,
          err
        );
        // Do not mark as sent — will retry next run
      }
    }
  }

  console.log("[Session Reminders] Batch complete.");
}

let jobStarted = false;

export function startSessionReminderJob() {
  if (jobStarted) return; // Guard against double-start in dev hot reload
  jobStarted = true;

  console.log(
    `[Session Reminders] Job started. Checking every hour for sessions in the next 24 hours.`
  );

  // Global lock: prevents two instances (autoscale) from running the sweep
  // concurrently and double-sending before markClient/CoachReminderSent updates.
  // Send behavior inside sendSessionReminders is unchanged.
  const guardedRun = async () => {
    const { acquireJobLock, releaseJobLock } = await import("./services/ceo-heartbeat-service");
    const { acquired, lockKey } = await acquireJobLock("__global__", "session_reminders", 60).catch(
      () => ({ acquired: true, lockKey: "" })
    );
    if (!acquired) {
      console.log("[Session Reminders] Lock held by another instance — skipping this run");
      return;
    }
    try {
      await sendSessionReminders();
    } finally {
      if (lockKey) await releaseJobLock(lockKey).catch(() => {});
    }
  };

  // Run first check after a short startup delay
  setTimeout(guardedRun, INITIAL_DELAY_MS);

  // Then run every hour
  setInterval(guardedRun, CHECK_INTERVAL_MS);
}
