import { db } from "../db";
import { orgNotifications, notificationAutomationLogs } from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";

// ─── Event Types ──────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "workout_assigned" | "workout_completed" | "workout_missed" | "workout_updated"
  | "readiness_low" | "high_fatigue" | "adaptation_recommendation"
  | "pr_added" | "new_pr" | "pr_spike" | "streak_milestone"
  | "new_highlight_found" | "public_profile_update" | "recruiting_update" | "inactivity_warning"
  | "coach_message" | "team_announcement"
  | "welcome_to_team" | "athlete_added" | "trainchat_adjustment_ready";

export interface NotificationEventPayload {
  orgId: string;
  userId?: string;
  coachUserId?: string;
  teamId?: string;
  metadata?: Record<string, any>;
  programId?: string;
  programName?: string;
  sessionId?: string;
  readinessScore?: number;
  fatigueLevel?: number;
  liftName?: string;
  liftValue?: number;
  liftUnit?: string;
  previousBest?: number;
  improvementPct?: number;
  highlightTitle?: string;
  athleteName?: string;
}

// ─── Cooldown Windows ─────────────────────────────────────────────────────────

const COOLDOWN_MS: Partial<Record<NotificationEventType, number>> = {
  readiness_low:             4  * 60 * 60 * 1000,
  high_fatigue:              24 * 60 * 60 * 1000,
  workout_missed:            24 * 60 * 60 * 1000,
  inactivity_warning:        48 * 60 * 60 * 1000,
  pr_added:                  60 * 60 * 1000,
  workout_reminder:          24 * 60 * 60 * 1000,
  adaptation_recommendation:  6 * 60 * 60 * 1000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function inCooldown(orgId: string, eventType: NotificationEventType, userId?: string): Promise<boolean> {
  const window = COOLDOWN_MS[eventType];
  if (!window) return false;
  const cutoff = new Date(Date.now() - window);
  const conds: any[] = [
    eq(notificationAutomationLogs.orgId, orgId),
    eq(notificationAutomationLogs.eventType, eventType),
    gte(notificationAutomationLogs.createdAt, cutoff),
  ];
  if (userId) conds.push(eq(notificationAutomationLogs.userId, userId));
  const rows = await db.select().from(notificationAutomationLogs).where(and(...conds)).limit(1);
  return rows.length > 0;
}

async function notify(data: {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  deliveryType?: string;
}): Promise<string> {
  const [n] = await db.insert(orgNotifications).values({
    orgId: data.orgId,
    userId: data.userId,
    type: data.type,
    title: data.title,
    message: data.message,
    actionUrl: data.actionUrl,
    metadata: { deliveryType: "in_app", ...data.metadata },
  }).returning();
  return n.id;
}

async function logEvent(
  eventType: NotificationEventType,
  orgId: string,
  userId: string | undefined,
  payload: any,
  notificationIds: string[],
  status = "processed",
) {
  await db.insert(notificationAutomationLogs).values({
    eventType,
    orgId,
    userId: userId ?? null,
    payload: payload as any,
    notificationIds: notificationIds as any,
    status,
  }).catch(() => {});
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

export async function triggerNotificationEvent(
  eventType: NotificationEventType,
  payload: NotificationEventPayload,
): Promise<{ notificationIds: string[]; skipped: boolean }> {
  const { orgId, userId, coachUserId, metadata = {} } = payload;
  const ids: string[] = [];

  try {
    if (await inCooldown(orgId, eventType, userId)) {
      return { notificationIds: [], skipped: true };
    }

    switch (eventType) {

      // ── WORKOUT ──────────────────────────────────────────────────────────────

      case "workout_assigned": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "workout_assigned",
          title: `New program assigned: ${payload.programName ?? "Training Program"}`,
          message: "Your coach has assigned you a new training program. Tap to view and get started.",
          actionUrl: "/workout",
          metadata: { programId: payload.programId, ...metadata },
        }));
        break;
      }

      case "workout_completed": {
        if (coachUserId && userId) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "workout_completed",
            title: `${payload.athleteName ?? "Athlete"} completed a session`,
            message: `Session logged${payload.programName ? ` in ${payload.programName}` : ""}.`,
            actionUrl: "/workout",
            metadata: { athleteUserId: userId, programId: payload.programId, severity: "info", ...metadata },
          }));
        }
        break;
      }

      case "workout_missed": {
        if (userId) {
          ids.push(await notify({
            orgId, userId, type: "missed_workout",
            title: "Missed workout",
            message: `You missed a scheduled session${payload.programName ? ` in ${payload.programName}` : ""}. Reach out to your coach if you need to reschedule.`,
            actionUrl: "/workout",
            metadata: { programId: payload.programId, ...metadata },
          }));
        }
        if (coachUserId) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "coach_alert",
            title: `${payload.athleteName ?? "Athlete"} missed a session`,
            message: `A missed workout was detected${payload.programName ? ` in ${payload.programName}` : ""}. Review their schedule.`,
            actionUrl: "/workout",
            metadata: { athleteUserId: userId, severity: "medium", ...metadata },
          }));
        }
        break;
      }

      case "workout_updated": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "workout_assigned",
          title: `Program updated: ${payload.programName ?? "Your workout"}`,
          message: "Your training program has been updated by your coach. Check the latest schedule.",
          actionUrl: "/workout",
          metadata: { programId: payload.programId, ...metadata },
        }));
        break;
      }

      case "readiness_low": {
        if (!userId) break;
        const score = payload.readinessScore ?? 0;
        ids.push(await notify({
          orgId, userId, type: "readiness_followup",
          title: "Low readiness detected",
          message: `Your readiness score of ${score}/10 is low. Your coach may adjust your workload. Rest and recovery are part of training.`,
          actionUrl: "/workout",
          metadata: { readinessScore: score, ...metadata },
        }));
        if (coachUserId) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "coach_alert",
            title: `${payload.athleteName ?? "Athlete"} — low readiness (${score}/10)`,
            message: "Consider adjusting their workload. Adaptation recommendations may have been generated.",
            actionUrl: "/workout",
            metadata: { athleteUserId: userId, readinessScore: score, severity: "medium", ...metadata },
          }));
        }
        break;
      }

      case "high_fatigue": {
        if (!coachUserId) break;
        ids.push(await notify({
          orgId, userId: coachUserId, type: "coach_alert",
          title: `${payload.athleteName ?? "Athlete"} — high fatigue flagged`,
          message: `Fatigue level ${payload.fatigueLevel ?? ""}${payload.fatigueLevel ? "/10" : ""} — this athlete may need a deload or recovery session.`,
          actionUrl: "/workout",
          metadata: { athleteUserId: userId, fatigueLevel: payload.fatigueLevel, severity: "high", ...metadata },
        }));
        break;
      }

      case "adaptation_recommendation": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "readiness_followup",
          title: "Workout adapted for you",
          message: "Based on your check-in data, an AI workout adjustment has been generated. Review before your next session.",
          actionUrl: "/workout",
          metadata: { programId: payload.programId, ...metadata },
        }));
        break;
      }

      // ── PR EVENTS ────────────────────────────────────────────────────────────

      case "pr_added": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "pr_celebration",
          title: `PR logged — ${payload.liftName ?? "Lift"}`,
          message: `${payload.liftValue ?? ""} ${payload.liftUnit ?? ""} logged.${payload.previousBest ? ` Previous best: ${payload.previousBest} ${payload.liftUnit ?? ""}.` : ""} Keep grinding!`,
          actionUrl: "/pr",
          metadata: { liftName: payload.liftName, liftValue: payload.liftValue, ...metadata },
        }));
        break;
      }

      case "new_pr": {
        if (!userId) break;
        const pctStr = payload.improvementPct ? ` (+${payload.improvementPct.toFixed(1)}%)` : "";
        ids.push(await notify({
          orgId, userId, type: "pr_celebration",
          title: `New PR! ${payload.liftName ?? "Lift"} 🎉`,
          message: `${payload.liftValue} ${payload.liftUnit ?? ""}${pctStr}${payload.previousBest ? ` — was ${payload.previousBest} ${payload.liftUnit ?? ""}` : ""}. Personal record!`,
          actionUrl: "/pr",
          metadata: { liftName: payload.liftName, liftValue: payload.liftValue, improvementPct: payload.improvementPct, celebration: true, ...metadata },
        }));
        if (coachUserId && payload.improvementPct && payload.improvementPct >= 5) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "coach_alert",
            title: `PR spike — ${payload.athleteName ?? "Athlete"}`,
            message: `${payload.liftName}: +${payload.improvementPct.toFixed(1)}% (${payload.liftValue} ${payload.liftUnit ?? ""}). Share with the team!`,
            actionUrl: "/pr",
            metadata: { athleteUserId: userId, liftName: payload.liftName, improvementPct: payload.improvementPct, severity: "positive", ...metadata },
          }));
        }
        break;
      }

      case "pr_spike": {
        if (!coachUserId) break;
        ids.push(await notify({
          orgId, userId: coachUserId, type: "coach_alert",
          title: `PR spike — ${payload.athleteName ?? "Athlete"}`,
          message: `${payload.liftName}: +${payload.improvementPct?.toFixed(1) ?? ""}% (${payload.liftValue} ${payload.liftUnit ?? ""}).`,
          actionUrl: "/pr",
          metadata: { athleteUserId: userId, severity: "positive", ...metadata },
        }));
        break;
      }

      case "streak_milestone": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "pr_celebration",
          title: "Milestone reached! 🏆",
          message: metadata.milestoneMessage ?? "You've hit a new consistency milestone. Keep pushing!",
          actionUrl: "/pr",
          metadata: { celebration: true, ...metadata },
        }));
        break;
      }

      // ── INTELLIGENCE ─────────────────────────────────────────────────────────

      case "new_highlight_found": {
        if (userId) {
          ids.push(await notify({
            orgId, userId, type: "pr_celebration",
            title: "New highlight detected",
            message: payload.highlightTitle ?? "A new highlight has been found for your profile.",
            actionUrl: "/intelligence",
            metadata,
          }));
        }
        if (coachUserId) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "coach_alert",
            title: `New highlight — ${payload.athleteName ?? "Athlete"}`,
            message: payload.highlightTitle ?? "A new highlight was found. Review and approve for their profile.",
            actionUrl: "/intelligence",
            metadata: { athleteUserId: userId, severity: "info", ...metadata },
          }));
        }
        break;
      }

      case "inactivity_warning": {
        if (userId) {
          ids.push(await notify({
            orgId, userId, type: "readiness_followup",
            title: "Time to get back on track",
            message: "We haven't seen any activity from you recently. Check in with your coach and log your next session.",
            actionUrl: "/workout",
            metadata,
          }));
        }
        if (coachUserId) {
          ids.push(await notify({
            orgId, userId: coachUserId, type: "coach_alert",
            title: `Inactivity — ${payload.athleteName ?? "Athlete"}`,
            message: "This athlete has not logged any activity recently. Consider following up.",
            actionUrl: "/workout",
            metadata: { athleteUserId: userId, severity: "medium", ...metadata },
          }));
        }
        break;
      }

      // ── SYSTEM ───────────────────────────────────────────────────────────────

      case "welcome_to_team": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "team_announcement",
          title: "Welcome to the team! 🎉",
          message: metadata.teamName
            ? `You've been added to ${metadata.teamName}. Your journey starts now.`
            : "You've been added to a team. Welcome aboard!",
          actionUrl: "/portal",
          metadata,
        }));
        break;
      }

      case "athlete_added": {
        if (!coachUserId) break;
        ids.push(await notify({
          orgId, userId: coachUserId, type: "coach_alert",
          title: "New athlete joined",
          message: `${payload.athleteName ?? "A new athlete"} has joined your organization.`,
          actionUrl: "/coach",
          metadata: { athleteUserId: userId, severity: "info", ...metadata },
        }));
        break;
      }

      case "trainchat_adjustment_ready": {
        if (!userId) break;
        ids.push(await notify({
          orgId, userId, type: "readiness_followup",
          title: "AI workout adjustment ready",
          message: "TrainChat has generated a personalized workout adjustment based on your recent data.",
          actionUrl: "/workout",
          metadata,
        }));
        break;
      }
    }

    await logEvent(eventType, orgId, userId, payload, ids);
    return { notificationIds: ids, skipped: false };
  } catch (err: any) {
    console.error("[notification-automation]", eventType, err?.message);
    await logEvent(eventType, orgId, userId, payload, [], "error");
    return { notificationIds: [], skipped: false };
  }
}

// ─── Coach Digest Aggregator ──────────────────────────────────────────────────

export async function getCoachDigest(orgId: string, coachUserId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.select().from(orgNotifications).where(
    and(
      eq(orgNotifications.orgId, orgId),
      eq(orgNotifications.userId, coachUserId),
      eq(orgNotifications.type, "coach_alert"),
      gte(orgNotifications.createdAt, since),
    )
  );
  const meta = recent.map((n) => (n.metadata as any) ?? {});
  return {
    total: recent.length,
    prSpikes:       meta.filter((m) => m.severity === "positive").length,
    missedWorkouts: recent.filter((n) => (n.title ?? "").includes("missed")).length,
    lowReadiness:   recent.filter((n) => (n.title ?? "").includes("readiness")).length,
    inactivity:     recent.filter((n) => (n.title ?? "").includes("Inactivity")).length,
    period: "today",
  };
}
