import type { Express } from "express";
import { db } from "./db";
import {
  parentGuardians, athleteGuardianLinks, guardianNotifications,
  userProfiles, orgUsers, bookings, athleticBookings,
  educationProgress, educationModules, educationPathways,
  athleteStreaks, workoutCompletionLogs, prLiftEntries, prLiftTypes,
  orgMessages,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, gte, sql as drizzleSql } from "drizzle-orm";
import crypto from "crypto";
import { sendClientInviteEmail } from "./email";
import { storage } from "./storage";
import { buildPublicAppUrl } from "./utils/url";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

async function getOrgProfile(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return p ?? null;
}

function requireAuth(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireCoach(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    if (!["ADMIN", "COACH"].includes(p.role ?? "")) return res.status(403).json({ message: "Forbidden" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

function requireGuardianOrCoach(req: any, res: any, next: any) {
  (async () => {
    const p = await getOrgProfile(req);
    if (!p) return res.status(401).json({ message: "Unauthorized" });
    const allowed = ["ADMIN", "COACH", "GUARDIAN"].includes(p.role ?? "");
    if (!allowed) return res.status(403).json({ message: "Forbidden" });
    (req as any)._profile = p;
    next();
  })().catch(() => res.status(500).json({ message: "Auth error" }));
}

// ─── Supportive language mapper ───────────────────────────────────────────────

function toSupportiveStatus(riskLevel: string | null | undefined): {
  label: string;
  color: "green" | "amber" | "blue" | "purple";
  message: string;
} {
  switch ((riskLevel ?? "").toLowerCase()) {
    case "red":
    case "high":
      return { label: "Needs Recovery Focus", color: "amber", message: "A little extra support and rest could help right now." };
    case "orange":
    case "medium":
      return { label: "Consistency Opportunity", color: "blue", message: "Building momentum — every session counts." };
    case "green":
    case "low":
      return { label: "Strong Momentum", color: "green", message: "Doing great! Keep up the excellent habits." };
    default:
      return { label: "On Track", color: "blue", message: "Making steady progress toward their goals." };
  }
}

// ─── Build guardian data for one athlete ─────────────────────────────────────

async function buildAthleteSnapshot(orgId: string, athleteUserId: string) {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // ── Profile ─────────────────────────────────────────────────────────────────
  const [profile] = await db.select().from(userProfiles)
    .where(eq(userProfiles.userId, athleteUserId)).limit(1);

  // ── Upcoming bookings (next 30 days) ────────────────────────────────────────
  const upcomingBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.userId, athleteUserId),
      drizzleSql`${bookings.startTime} >= ${now}`,
      drizzleSql`${bookings.startTime} <= ${in30}`,
    ))
    .orderBy(asc(bookings.startTime))
    .limit(7);

  // ── Recent athletic bookings ─────────────────────────────────────────────────
  const recentAthletic = await db.select().from(athleticBookings)
    .where(eq(athleticBookings.userId, athleteUserId))
    .orderBy(desc(athleticBookings.createdAt))
    .limit(5);

  // ── Streak data ──────────────────────────────────────────────────────────────
  const [streakData] = await db.select().from(athleteStreaks)
    .where(and(eq(athleteStreaks.orgId, orgId), eq(athleteStreaks.athleteUserId, athleteUserId)))
    .limit(1);

  // ── Workout completion / attendance (last 30 days) ───────────────────────────
  const completionLogs = await db.select().from(workoutCompletionLogs)
    .where(and(
      eq(workoutCompletionLogs.orgId, orgId),
      eq(workoutCompletionLogs.athleteUserId, athleteUserId),
      gte(workoutCompletionLogs.completedAt, thirtyDaysAgo),
    ))
    .orderBy(desc(workoutCompletionLogs.completedAt))
    .limit(50);

  // Build last-14-day attendance dots
  const completedDates = new Set(
    completionLogs
      .filter((l: any) => l.completedAt)
      .map((l: any) => new Date(l.completedAt).toDateString())
  );
  const attendanceDots: { date: string; completed: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    attendanceDots.push({ date: d.toDateString(), completed: completedDates.has(d.toDateString()) });
  }
  const last14Completed = attendanceDots.filter((d) => d.completed).length;
  const consistencyPct = Math.round((last14Completed / 14) * 100);

  // ── Recent PRs (last 60 days) ────────────────────────────────────────────────
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  let recentPRs: any[] = [];
  try {
    const prEntries = await db.select().from(prLiftEntries)
      .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, athleteUserId)))
      .orderBy(desc(prLiftEntries.createdAt))
      .limit(10);

    if (prEntries.length > 0) {
      const liftTypeIds = [...new Set(prEntries.map((e: any) => e.liftTypeId))];
      const liftTypes = await db.select().from(prLiftTypes)
        .where(inArray(prLiftTypes.id, liftTypeIds as string[]));
      const liftTypeMap = Object.fromEntries(liftTypes.map((lt: any) => [lt.id, lt]));

      recentPRs = prEntries.map((e: any) => ({
        id: e.id,
        liftName: liftTypeMap[e.liftTypeId]?.name ?? "Lift",
        value: e.value,
        unit: e.unit,
        entryDate: e.entryDate,
        verified: !!e.verifiedByCoachId,
      }));
    }
  } catch (_) {
    // PRs not available
  }

  // ── Education progress ───────────────────────────────────────────────────────
  const eduProgress = await db.select().from(educationProgress)
    .where(and(
      eq(educationProgress.orgId, orgId),
      eq(educationProgress.athleteUserId, athleteUserId),
    ));

  const publishedPathways = await db.select({ id: educationPathways.id, title: educationPathways.title })
    .from(educationPathways)
    .where(drizzleSql`(${educationPathways.orgId} = ${orgId} OR ${educationPathways.isDefault} = true) AND ${educationPathways.status} = 'published'`);

  let totalModules = 0;
  let completedModules = 0;
  let overdueModules: any[] = [];

  if (publishedPathways.length > 0) {
    const pathwayIds = publishedPathways.map((p: any) => p.id);
    const allMods = await db.select().from(educationModules)
      .where(and(inArray(educationModules.pathwayId, pathwayIds), eq(educationModules.status, "published")));
    totalModules = allMods.length;
    completedModules = eduProgress.filter((p: any) => p.status === "completed").length;

    const completedModIds = new Set(
      eduProgress.filter((p: any) => p.status === "completed").map((p: any) => p.moduleId)
    );
    overdueModules = allMods
      .filter((m: any) => !completedModIds.has(m.id))
      .slice(0, 3)
      .map((m: any) => ({ id: m.id, title: m.title, pathwayId: m.pathwayId }));
  }

  const eduScores = eduProgress.filter((p: any) => p.quizScore !== null).map((p: any) => p.quizScore as number);
  const avgScore = eduScores.length > 0
    ? Math.round(eduScores.reduce((a, b) => a + b, 0) / eduScores.length)
    : null;

  const recentCompletions = eduProgress
    .filter((p: any) => p.status === "completed" && p.completedAt)
    .sort((a: any, b: any) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 3);

  // ── Guardian messages (coach announcements) ───────────────────────────────────
  const athleteName = profile
    ? `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || profile.username || "Athlete"
    : "Athlete";

  // ── Assemble ─────────────────────────────────────────────────────────────────
  return {
    profile,
    athleteUserId,
    athleteName,
    streak: {
      currentStreak: streakData?.currentStreak ?? 0,
      longestStreak: streakData?.longestStreak ?? 0,
      totalSessionsCompleted: streakData?.totalSessionsCompleted ?? 0,
      lastCompletedDate: streakData?.lastCompletedDate ?? null,
    },
    attendance: {
      completedLast30Days: completionLogs.length,
      consistencyPct,
      attendanceDots,
      last14Completed,
    },
    education: {
      totalModules,
      completedModules,
      percentComplete: totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0,
      avgScore,
      recentCompletions,
      overdueModules,
    },
    upcomingBookings,
    recentAthletic,
    recentPRs,
  };
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerGuardianRoutes(app: Express) {

  // ── POST /api/org/guardians/invite ──────────────────────────────────────────
  app.post("/api/org/guardians/invite", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { inviteEmail, athleteUserId, relationshipType } = req.body;
      if (!inviteEmail) return res.status(400).json({ message: "inviteEmail required" });

      const orgId = profile.organizationId;
      const invitedBy = getUserId(req)!;
      const targetAthleteId = athleteUserId ?? invitedBy;

      const existing = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, orgId),
          eq(athleteGuardianLinks.athleteUserId, targetAthleteId),
          eq(athleteGuardianLinks.inviteEmail, inviteEmail),
        )).limit(1);

      if (existing.length > 0 && existing[0].status === "active") {
        return res.status(409).json({ message: "Guardian already linked" });
      }

      const inviteToken = crypto.randomBytes(24).toString("hex");

      let guardianUserId = "";
      const existingUser = await db.select().from(userProfiles)
        .where(drizzleSql`lower(${userProfiles.email}) = lower(${inviteEmail})`)
        .limit(1);

      if (existingUser.length > 0) {
        guardianUserId = existingUser[0].userId;
        const existingGuardianProfile = await db.select().from(parentGuardians)
          .where(and(eq(parentGuardians.orgId, orgId), eq(parentGuardians.orgUserId, guardianUserId)))
          .limit(1);
        if (existingGuardianProfile.length === 0) {
          await db.insert(parentGuardians).values({
            orgId,
            orgUserId: guardianUserId,
            relationshipType: relationshipType ?? "guardian",
          });
        }
      }

      if (existing.length > 0) {
        await db.update(athleteGuardianLinks)
          .set({ inviteToken, status: "pending", activatedAt: null })
          .where(eq(athleteGuardianLinks.id, existing[0].id));
      } else {
        await db.insert(athleteGuardianLinks).values({
          orgId,
          athleteUserId: targetAthleteId,
          guardianUserId: guardianUserId || "pending-" + inviteToken,
          status: guardianUserId ? "active" : "pending",
          invitedByUserId: invitedBy,
          inviteEmail,
          inviteToken,
          permissions: {
            schedule: true,
            attendance: true,
            education: true,
            prMilestones: true,
            workoutCompletion: true,
            announcements: true,
            streaks: true,
          },
          activatedAt: guardianUserId ? new Date() : null,
        });
      }

      // Send invite email if guardian doesn't already have an account
      if (!guardianUserId) {
        const baseUrl = buildPublicAppUrl();
        const acceptLink = `${baseUrl}/guardian-accept?token=${inviteToken}`;
        const emailResult: { ok: boolean; error?: string } = await sendClientInviteEmail(
          inviteEmail,
          inviteEmail.split("@")[0],
          acceptLink,
          undefined,
        ).then(() => ({ ok: true }))
          .catch((err: any) => ({ ok: false, error: err?.message ?? String(err) }));

        storage.createCommunicationLog({
          orgId,
          type: "invite",
          channel: "email",
          recipientEmail: inviteEmail,
          subject: "You've been invited as a guardian",
          status: emailResult.ok ? "sent" : "failed",
          provider: "sendgrid",
          errorMessage: emailResult.ok ? undefined : emailResult.error,
        } as any).catch(() => {});

        if (!emailResult.ok) {
          console.error("[guardian-invite] email failed:", emailResult.error);
        }
      }

      res.json({
        ok: true,
        message: guardianUserId
          ? "Guardian linked immediately (existing account found)"
          : "Invite sent — guardian will receive an email to create an account",
        inviteToken,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/guardians/accept-invite ───────────────────────────────────
  app.post("/api/org/guardians/accept-invite", requireAuth, async (req: any, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "token required" });

      const userId = getUserId(req)!;
      const profile = req._profile;

      const [link] = await db.select().from(athleteGuardianLinks)
        .where(eq(athleteGuardianLinks.inviteToken, token))
        .limit(1);

      if (!link) return res.status(404).json({ message: "Invite not found or expired" });
      if (link.status === "active") return res.json({ ok: true, message: "Already active" });
      if (link.status === "revoked") return res.status(403).json({ message: "Invite revoked" });

      const existing = await db.select().from(parentGuardians)
        .where(and(eq(parentGuardians.orgId, link.orgId), eq(parentGuardians.orgUserId, userId)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(parentGuardians).values({
          orgId: link.orgId,
          orgUserId: userId,
          relationshipType: "guardian",
        });
      }

      await db.update(athleteGuardianLinks)
        .set({ guardianUserId: userId, status: "active", activatedAt: new Date() })
        .where(eq(athleteGuardianLinks.id, link.id));

      if (!["ADMIN", "COACH"].includes(profile.role ?? "")) {
        await db.update(userProfiles)
          .set({ role: "GUARDIAN" })
          .where(eq(userProfiles.userId, userId));
      }

      res.json({ ok: true, orgSlug: link.orgId });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardians ──────────────────────────────────────────────────
  app.get("/api/org/guardians", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const links = await db.select().from(athleteGuardianLinks)
        .where(eq(athleteGuardianLinks.orgId, profile.organizationId))
        .orderBy(desc(athleteGuardianLinks.createdAt));

      const guardianUserIds = links.map((l: any) => l.guardianUserId).filter((id: string) => !id.startsWith("pending-"));
      const athleteUserIds = [...new Set(links.map((l: any) => l.athleteUserId))];

      const guardianProfiles = guardianUserIds.length > 0
        ? await db.select().from(userProfiles).where(inArray(userProfiles.userId, guardianUserIds as string[]))
        : [];
      const athleteProfiles = athleteUserIds.length > 0
        ? await db.select().from(userProfiles).where(inArray(userProfiles.userId, athleteUserIds as string[]))
        : [];

      const gpMap = Object.fromEntries(guardianProfiles.map((p: any) => [p.userId, p]));
      const apMap = Object.fromEntries(athleteProfiles.map((p: any) => [p.userId, p]));

      res.json({
        links: links.map((l: any) => ({
          ...l,
          guardianProfile: gpMap[l.guardianUserId] ?? null,
          athleteProfile: apMap[l.athleteUserId] ?? null,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/guardians/link/:id ───────────────────────────────────────
  app.patch("/api/org/guardians/link/:id", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      const { status, permissions } = req.body;

      const updates: any = {};
      if (status) updates.status = status;
      if (permissions) updates.permissions = permissions;

      const [updated] = await db.update(athleteGuardianLinks)
        .set(updates)
        .where(and(eq(athleteGuardianLinks.id, id), eq(athleteGuardianLinks.orgId, profile.organizationId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json({ link: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── DELETE /api/org/guardians/link/:id ──────────────────────────────────────
  app.delete("/api/org/guardians/link/:id", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { id } = req.params;
      await db.update(athleteGuardianLinks)
        .set({ status: "revoked" })
        .where(and(eq(athleteGuardianLinks.id, id), eq(athleteGuardianLinks.orgId, profile.organizationId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/portal ───────────────────────────────────────────
  app.get("/api/org/guardian/portal", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const orgId = profile.organizationId;

      const links = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, orgId),
          eq(athleteGuardianLinks.guardianUserId, userId),
          eq(athleteGuardianLinks.status, "active"),
        ));

      const athletes = await Promise.all(
        links.map((link: any) => buildAthleteSnapshot(orgId, link.athleteUserId).then((snap) => ({
          ...snap,
          link,
          supportiveStatus: toSupportiveStatus(null),
        })))
      );

      const unreadCount = await db.select({ count: drizzleSql<number>`count(*)::int` })
        .from(guardianNotifications)
        .where(and(
          eq(guardianNotifications.orgId, orgId),
          eq(guardianNotifications.guardianUserId, userId),
          eq(guardianNotifications.isRead, false),
        ));

      res.json({
        athletes,
        links,
        unreadCount: unreadCount[0]?.count ?? 0,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/dashboard ─────────────────────────────────────────
  // Unified dashboard endpoint — same as portal but with extra announcements
  app.get("/api/org/guardian/dashboard", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const orgId = profile.organizationId;

      const links = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, orgId),
          eq(athleteGuardianLinks.guardianUserId, userId),
          eq(athleteGuardianLinks.status, "active"),
        ));

      const athletes = await Promise.all(
        links.map((link: any) => buildAthleteSnapshot(orgId, link.athleteUserId).then((snap) => ({
          ...snap,
          link,
          supportiveStatus: toSupportiveStatus(null),
        })))
      );

      // Recent guardian notifications (last 20)
      const recentNotifications = await db.select().from(guardianNotifications)
        .where(and(
          eq(guardianNotifications.orgId, orgId),
          eq(guardianNotifications.guardianUserId, userId),
        ))
        .orderBy(desc(guardianNotifications.createdAt))
        .limit(20);

      const unreadCount = recentNotifications.filter((n: any) => !n.isRead).length;

      res.json({
        athletes,
        links,
        recentNotifications,
        unreadCount,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/athlete/:userId ──────────────────────────────────
  app.get("/api/org/guardian/athlete/:userId", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const guardianUserId = getUserId(req)!;
      const { userId } = req.params;
      const orgId = profile.organizationId;

      const isCoach = ["ADMIN", "COACH"].includes(profile.role ?? "");
      if (!isCoach) {
        const [link] = await db.select().from(athleteGuardianLinks)
          .where(and(
            eq(athleteGuardianLinks.orgId, orgId),
            eq(athleteGuardianLinks.guardianUserId, guardianUserId),
            eq(athleteGuardianLinks.athleteUserId, userId),
            eq(athleteGuardianLinks.status, "active"),
          )).limit(1);
        if (!link) return res.status(403).json({ message: "Not linked to this athlete" });
      }

      const snapshot = await buildAthleteSnapshot(orgId, userId);
      res.json({ ...snapshot, supportiveStatus: toSupportiveStatus(null) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/notifications ────────────────────────────────────
  app.get("/api/org/guardian/notifications", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;

      const notifs = await db.select().from(guardianNotifications)
        .where(and(
          eq(guardianNotifications.orgId, profile.organizationId),
          eq(guardianNotifications.guardianUserId, userId),
        ))
        .orderBy(desc(guardianNotifications.createdAt))
        .limit(50);

      res.json({ notifications: notifs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/guardian/notifications/:id/read ─────────────────────────
  app.patch("/api/org/guardian/notifications/:id/read", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const { id } = req.params;
      await db.update(guardianNotifications)
        .set({ isRead: true })
        .where(eq(guardianNotifications.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/guardian/notifications/read-all ─────────────────────────
  app.patch("/api/org/guardian/notifications/read-all", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      await db.update(guardianNotifications)
        .set({ isRead: true })
        .where(and(
          eq(guardianNotifications.orgId, profile.organizationId),
          eq(guardianNotifications.guardianUserId, userId),
        ));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── POST /api/org/guardian/notifications/send ──────────────────────────────
  app.post("/api/org/guardian/notifications/send", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { athleteUserId, type, title, message, metadata } = req.body;

      const links = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, profile.organizationId),
          eq(athleteGuardianLinks.athleteUserId, athleteUserId),
          eq(athleteGuardianLinks.status, "active"),
        ));

      for (const link of links) {
        await db.insert(guardianNotifications).values({
          orgId: profile.organizationId,
          guardianUserId: link.guardianUserId,
          athleteUserId,
          type: type ?? "coach_announcement",
          title: title ?? "Update from your coach",
          message: message ?? "",
          metadata: metadata ?? {},
        });
      }

      res.json({ ok: true, sent: links.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── PATCH /api/org/guardian/preferences ─────────────────────────────────────
  // Guardian updates their own notification opt-ins for a specific athlete link
  app.patch("/api/org/guardian/preferences", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const { athleteUserId, preferences } = req.body;

      if (!athleteUserId || !preferences) {
        return res.status(400).json({ message: "athleteUserId and preferences required" });
      }

      const [link] = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, profile.organizationId),
          eq(athleteGuardianLinks.guardianUserId, userId),
          eq(athleteGuardianLinks.athleteUserId, athleteUserId),
          eq(athleteGuardianLinks.status, "active"),
        )).limit(1);

      if (!link) return res.status(404).json({ message: "Link not found" });

      const currentPerms = (link.permissions as any) ?? {};
      const [updated] = await db.update(athleteGuardianLinks)
        .set({ permissions: { ...currentPerms, ...preferences } })
        .where(eq(athleteGuardianLinks.id, link.id))
        .returning();

      res.json({ ok: true, preferences: updated.permissions });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/messages ──────────────────────────────────────────
  app.get("/api/org/guardian/messages", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;

      const notifs = await db.select().from(guardianNotifications)
        .where(and(
          eq(guardianNotifications.orgId, profile.organizationId),
          eq(guardianNotifications.guardianUserId, userId),
        ))
        .orderBy(desc(guardianNotifications.createdAt))
        .limit(30);

      res.json({ messages: notifs });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/guardian/accept ─────────────────────────────────────────
  app.get("/api/org/guardian/accept", async (req: any, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ message: "token required" });

      const [link] = await db.select().from(athleteGuardianLinks)
        .where(eq(athleteGuardianLinks.inviteToken, token as string))
        .limit(1);

      if (!link) return res.status(404).json({ message: "Invite not found" });
      res.json({ valid: true, status: link.status, inviteEmail: link.inviteEmail, orgId: link.orgId });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── GET /api/org/coach/athlete/:userId/guardians ─────────────────────────────
  app.get("/api/org/coach/athlete/:userId/guardians", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { userId } = req.params;

      const links = await db.select().from(athleteGuardianLinks)
        .where(and(
          eq(athleteGuardianLinks.orgId, profile.organizationId),
          eq(athleteGuardianLinks.athleteUserId, userId),
        ))
        .orderBy(desc(athleteGuardianLinks.createdAt));

      const guardianUserIds = links.map((l: any) => l.guardianUserId).filter((id: string) => !id.startsWith("pending-"));
      const profiles = guardianUserIds.length > 0
        ? await db.select().from(userProfiles).where(inArray(userProfiles.userId, guardianUserIds as string[]))
        : [];
      const pMap = Object.fromEntries(profiles.map((p: any) => [p.userId, p]));

      res.json({ links: links.map((l: any) => ({ ...l, guardianProfile: pMap[l.guardianUserId] ?? null })) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
