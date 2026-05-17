import type { Express, Response, NextFunction } from "express";
import { db } from "./db";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  organizations,
  athleticPrograms,
  prTeamMembers,
  prTeams,
  prLiftEntries,
  athleticBookings,
  orgNotificationPreferences,
} from "@shared/schema";
import { eq, and, gt, ne, desc } from "drizzle-orm";

async function requireOrgAuth(req: any, res: Response, next: NextFunction) {
  const token = req.headers["x-org-auth-token"] as string;
  if (!token) return res.status(401).json({ message: "Not authenticated" });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const sessions = await db
    .select()
    .from(orgSessions)
    .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
    .limit(1);

  if (!sessions.length) return res.status(401).json({ message: "Session expired or invalid" });

  const session = sessions[0];
  await db.update(orgSessions).set({ lastUsedAt: now }).where(eq(orgSessions.id, session.id));

  const foundUsers = await db.select().from(orgUsers).where(eq(orgUsers.id, session.userId)).limit(1);
  if (!foundUsers.length) return res.status(401).json({ message: "User not found" });

  const memberships = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);

  if (!memberships.length) return res.status(401).json({ message: "Not a member of this organization" });

  req.orgAuth = { user: foundUsers[0], membership: memberships[0] };
  req.orgSession = session;
  next();
}

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const notificationPrefsSchema = z.object({
  bookingReminders: z.boolean().optional(),
  prUpdates: z.boolean().optional(),
  teamAnnouncements: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
});

export function registerOrgProfileRoutes(app: Express) {
  // ── GET /api/org/profile ────────────────────────────────────────────────
  app.get("/api/org/profile", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const userId = user.id;

      const [org] = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          logoUrl: organizations.logoUrl,
          tagline: organizations.tagline,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      const today = new Date().toISOString().split("T")[0];

      const [allBookings, prEntries, teamMemberships, programs, coachTeams] = await Promise.all([
        db
          .select({ id: athleticBookings.id, date: athleticBookings.date })
          .from(athleticBookings)
          .where(and(eq(athleticBookings.organizationId, orgId), eq(athleticBookings.orgUserId, userId))),
        db
          .select({ id: prLiftEntries.id })
          .from(prLiftEntries)
          .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.userId, userId))),
        db
          .select({ teamId: prTeamMembers.teamId, role: prTeamMembers.role, teamName: prTeams.name })
          .from(prTeamMembers)
          .innerJoin(prTeams, eq(prTeamMembers.teamId, prTeams.id))
          .where(and(eq(prTeamMembers.orgId, orgId), eq(prTeamMembers.userId, userId))),
        db
          .select({ id: athleticPrograms.id, name: athleticPrograms.name, slug: athleticPrograms.slug, type: athleticPrograms.type })
          .from(athleticPrograms)
          .where(and(eq(athleticPrograms.organizationId, orgId), eq(athleticPrograms.active, true))),
        db
          .select({ id: prTeams.id, name: prTeams.name })
          .from(prTeams)
          .where(and(eq(prTeams.orgId, orgId), eq(prTeams.coachUserId, userId))),
      ]);

      const upcomingBookings = allBookings.filter((b) => b.date >= today).length;

      let athleteCount = 0;
      const isCoach = membership.role === "coach" || membership.role === "owner";
      if (isCoach) {
        const athletes = await db
          .select({ id: orgMemberships.id })
          .from(orgMemberships)
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete")));
        athleteCount = athletes.length;
      }

      res.json({
        user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
        membership: {
          role: membership.role,
          status: membership.status,
          createdAt: membership.createdAt,
          orgId: membership.orgId,
        },
        org,
        stats: {
          upcomingBookings,
          totalBookings: allBookings.length,
          prEntries: prEntries.length,
          teams: teamMemberships.length,
          programs: programs.length,
        },
        teams: teamMemberships,
        programs,
        coachTeams: isCoach ? coachTeams : [],
        athleteCount: isCoach ? athleteCount : 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/org/profile ──────────────────────────────────────────────
  app.patch("/api/org/profile", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user } = req.orgAuth;
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      const { name, email } = parsed.data;

      if (email !== user.email) {
        const existing = await db
          .select({ id: orgUsers.id })
          .from(orgUsers)
          .where(and(eq(orgUsers.email, email), ne(orgUsers.id, user.id)))
          .limit(1);
        if (existing.length) return res.status(409).json({ message: "Email already in use by another account" });
      }

      await db.update(orgUsers).set({ name, email, updatedAt: new Date() }).where(eq(orgUsers.id, user.id));

      res.json({ success: true, user: { ...user, name, email } });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/org/profile/password ────────────────────────────────────
  app.patch("/api/org/profile/password", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user } = req.orgAuth;
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      const { currentPassword, newPassword } = parsed.data;

      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

      const newHash = await bcrypt.hash(newPassword, 10);
      await db.update(orgUsers).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(orgUsers.id, user.id));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/org/profile/sessions ──────────────────────────────────────
  app.get("/api/org/profile/sessions", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { membership } = req.orgAuth;
      const currentSession = req.orgSession;
      const now = new Date();

      const sessions = await db
        .select({
          id: orgSessions.id,
          createdAt: orgSessions.createdAt,
          lastUsedAt: orgSessions.lastUsedAt,
          expiresAt: orgSessions.expiresAt,
          keepLoggedIn: orgSessions.keepLoggedIn,
        })
        .from(orgSessions)
        .where(and(eq(orgSessions.userId, currentSession.userId), eq(orgSessions.orgId, membership.orgId), gt(orgSessions.expiresAt, now)))
        .orderBy(desc(orgSessions.lastUsedAt));

      const result = sessions.map((s) => ({
        ...s,
        isCurrent: s.id === currentSession.id,
      }));

      res.json({ sessions: result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/org/profile/logout-all ───────────────────────────────────
  app.post("/api/org/profile/logout-all", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { membership } = req.orgAuth;
      const currentSession = req.orgSession;
      const { includeCurrentSession } = req.body;

      if (includeCurrentSession) {
        await db
          .delete(orgSessions)
          .where(and(eq(orgSessions.userId, currentSession.userId), eq(orgSessions.orgId, membership.orgId)));
      } else {
        await db
          .delete(orgSessions)
          .where(
            and(
              eq(orgSessions.userId, currentSession.userId),
              eq(orgSessions.orgId, membership.orgId),
              ne(orgSessions.id, currentSession.id)
            )
          );
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/org/profile/notifications ─────────────────────────────────
  app.get("/api/org/profile/notifications", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const userId = user.id;

      let [prefs] = await db
        .select()
        .from(orgNotificationPreferences)
        .where(and(eq(orgNotificationPreferences.orgId, orgId), eq(orgNotificationPreferences.userId, userId)))
        .limit(1);

      if (!prefs) {
        const [created] = await db
          .insert(orgNotificationPreferences)
          .values({ orgId, userId })
          .returning();
        prefs = created;
      }

      res.json({ preferences: prefs });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/org/profile/notifications ───────────────────────────────
  app.patch("/api/org/profile/notifications", requireOrgAuth, async (req: any, res: Response) => {
    try {
      const { user, membership } = req.orgAuth;
      const orgId = membership.orgId;
      const userId = user.id;

      const parsed = notificationPrefsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      let [existing] = await db
        .select()
        .from(orgNotificationPreferences)
        .where(and(eq(orgNotificationPreferences.orgId, orgId), eq(orgNotificationPreferences.userId, userId)))
        .limit(1);

      if (!existing) {
        const [created] = await db
          .insert(orgNotificationPreferences)
          .values({ orgId, userId, ...parsed.data })
          .returning();
        return res.json({ preferences: created });
      }

      const [updated] = await db
        .update(orgNotificationPreferences)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(orgNotificationPreferences.orgId, orgId), eq(orgNotificationPreferences.userId, userId)))
        .returning();

      res.json({ preferences: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
