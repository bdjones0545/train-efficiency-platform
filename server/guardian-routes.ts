import type { Express } from "express";
import { db } from "./db";
import {
  parentGuardians, athleteGuardianLinks, guardianNotifications,
  userProfiles, orgUsers, bookings, athleticBookings,
  educationProgress, educationModules, educationPathways,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, sql as drizzleSql } from "drizzle-orm";
import crypto from "crypto";

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

// ─── Build guardian data for one athlete ─────────────────────────────────────

async function buildAthleteSnapshot(orgId: string, athleteUserId: string) {
  // Basic profile
  const [profile] = await db.select().from(userProfiles)
    .where(eq(userProfiles.userId, athleteUserId)).limit(1);

  // Upcoming bookings (next 30 days)
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const upcomingBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.userId, athleteUserId),
      drizzleSql`${bookings.startTime} >= ${now}`,
      drizzleSql`${bookings.startTime} <= ${in30}`,
    ))
    .orderBy(asc(bookings.startTime))
    .limit(5);

  // Recent athletic bookings
  const recentAthletic = await db.select().from(athleticBookings)
    .where(eq(athleticBookings.userId, athleteUserId))
    .orderBy(desc(athleticBookings.createdAt))
    .limit(5);

  // Education progress
  const eduProgress = await db.select().from(educationProgress)
    .where(and(
      eq(educationProgress.orgId, orgId),
      eq(educationProgress.athleteUserId, athleteUserId),
    ));

  // Count published modules across published pathways
  const publishedPathways = await db.select({ id: educationPathways.id })
    .from(educationPathways)
    .where(drizzleSql`(${educationPathways.orgId} = ${orgId} OR ${educationPathways.isDefault} = true) AND ${educationPathways.status} = 'published'`);

  let totalModules = 0;
  let completedModules = 0;
  if (publishedPathways.length > 0) {
    const pathwayIds = publishedPathways.map((p: any) => p.id);
    const allMods = await db.select({ id: educationModules.id })
      .from(educationModules)
      .where(and(
        inArray(educationModules.pathwayId, pathwayIds),
        eq(educationModules.status, "published"),
      ));
    totalModules = allMods.length;
    completedModules = eduProgress.filter((p: any) => p.status === "completed").length;
  }

  const eduScores = eduProgress
    .filter((p: any) => p.quizScore !== null)
    .map((p: any) => p.quizScore as number);
  const avgScore = eduScores.length > 0
    ? Math.round(eduScores.reduce((a, b) => a + b, 0) / eduScores.length)
    : null;

  return {
    profile,
    athleteUserId,
    upcomingBookings,
    recentAthletic,
    education: {
      totalModules,
      completedModules,
      percentComplete: totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0,
      avgScore,
      recentCompletions: eduProgress
        .filter((p: any) => p.status === "completed" && p.completedAt)
        .sort((a: any, b: any) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
        .slice(0, 3),
    },
  };
}

// ─── Register routes ──────────────────────────────────────────────────────────

export function registerGuardianRoutes(app: Express) {

  // ── POST /api/org/guardians/invite ──────────────────────────────────────────
  // Coach or athlete invites a guardian by email
  app.post("/api/org/guardians/invite", requireAuth, async (req: any, res) => {
    try {
      const profile = req._profile;
      const { inviteEmail, athleteUserId, relationshipType } = req.body;
      if (!inviteEmail) return res.status(400).json({ message: "inviteEmail required" });

      const orgId = profile.organizationId;
      const invitedBy = getUserId(req)!;

      // The athlete to link — either specified (coach) or self (athlete inviting guardian)
      const targetAthleteId = athleteUserId ?? invitedBy;

      // Check if invite already exists
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

      // Check if there's a user account for this email already
      let guardianUserId = "";
      const existingUser = await db.select().from(userProfiles)
        .where(drizzleSql`lower(${userProfiles.email}) = lower(${inviteEmail})`)
        .limit(1);

      if (existingUser.length > 0) {
        guardianUserId = existingUser[0].userId;

        // Ensure guardian profile record exists
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
        // Update existing pending invite
        await db.update(athleteGuardianLinks)
          .set({ inviteToken, status: "pending", activatedAt: null })
          .where(eq(athleteGuardianLinks.id, existing[0].id));
      } else {
        // Create new invite link
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
          },
          activatedAt: guardianUserId ? new Date() : null,
        });
      }

      // TODO: Send invite email via SendGrid
      // sendGuardianInviteEmail({ email: inviteEmail, token: inviteToken, orgId });

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
  // Guardian accepts invite via token
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

      // Create guardian profile if needed
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

      // Activate link
      await db.update(athleteGuardianLinks)
        .set({ guardianUserId: userId, status: "active", activatedAt: new Date() })
        .where(eq(athleteGuardianLinks.id, link.id));

      // Update role to GUARDIAN if not coach/admin
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
  // Coach: list all guardian links for the org
  app.get("/api/org/guardians", requireCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const links = await db.select().from(athleteGuardianLinks)
        .where(eq(athleteGuardianLinks.orgId, profile.organizationId))
        .orderBy(desc(athleteGuardianLinks.createdAt));

      // Enrich with guardian profile info
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
  // Coach: update link status or permissions
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
  // Guardian: get all linked athletes + summaries
  app.get("/api/org/guardian/portal", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const userId = getUserId(req)!;
      const orgId = profile.organizationId;

      // Get all active links for this guardian
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
        })))
      );

      // Unread guardian notifications
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

  // ── GET /api/org/guardian/athlete/:userId ──────────────────────────────────
  // Guardian: detailed view of one linked athlete
  app.get("/api/org/guardian/athlete/:userId", requireGuardianOrCoach, async (req: any, res) => {
    try {
      const profile = req._profile;
      const guardianUserId = getUserId(req)!;
      const { userId } = req.params;
      const orgId = profile.organizationId;

      // Verify guardian is linked to this athlete
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
      res.json(snapshot);
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
  // Internal: send a notification to all guardians of an athlete
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

  // ── GET /api/org/guardian/accept ─────────────────────────────────────────
  // Public token-based invite acceptance landing (used before auth)
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

  // ── GET /api/org/guardian/athlete/:userId/guardians (coach-only) ────────────
  // Coach: see guardians linked to a specific athlete
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
