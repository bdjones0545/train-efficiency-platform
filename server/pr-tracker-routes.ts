import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import multer from "multer";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  prTeams,
  prTeamMembers,
  prLiftTypes,
  prLiftEntries,
  prImportJobs,
} from "@shared/schema";
import { eq, and, desc, inArray, gt, lt, sql } from "drizzle-orm";
import { triggerNotificationEvent } from "./services/notification-automation";

const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_LIFT_TYPES = [
  { name: "Back Squat", category: "Lower Body", unit: "lbs" },
  { name: "Front Squat", category: "Lower Body", unit: "lbs" },
  { name: "Bench Press", category: "Upper Body", unit: "lbs" },
  { name: "Deadlift", category: "Lower Body", unit: "lbs" },
  { name: "Power Clean", category: "Olympic", unit: "lbs" },
  { name: "Hang Clean", category: "Olympic", unit: "lbs" },
  { name: "Clean", category: "Olympic", unit: "lbs" },
  { name: "Snatch", category: "Olympic", unit: "lbs" },
  { name: "Vertical Jump", category: "Athletic", unit: "inches" },
  { name: "Broad Jump", category: "Athletic", unit: "inches" },
  { name: "10 Yard Sprint", category: "Speed", unit: "seconds" },
  { name: "20 Yard Sprint", category: "Speed", unit: "seconds" },
  { name: "40 Yard Dash", category: "Speed", unit: "seconds" },
  { name: "Pro Agility", category: "Speed", unit: "seconds" },
  { name: "Pull-Ups", category: "Upper Body", unit: "reps" },
];

const CSV_LIFT_MAP: Record<string, string> = {
  back_squat: "Back Squat",
  bench_press: "Bench Press",
  deadlift: "Deadlift",
  power_clean: "Power Clean",
  hang_clean: "Hang Clean",
  front_squat: "Front Squat",
  clean: "Clean",
  snatch: "Snatch",
  vertical_jump: "Vertical Jump",
  broad_jump: "Broad Jump",
  ten_yard_sprint: "10 Yard Sprint",
  twenty_yard_sprint: "20 Yard Sprint",
  forty_yard_dash: "40 Yard Dash",
  pro_agility: "Pro Agility",
  pull_ups: "Pull-Ups",
};

function generateJoinCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

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

  if (!sessions.length) return res.status(401).json({ message: "Session expired. Please log in again." });

  const session = sessions[0];
  await db.update(orgSessions).set({ lastUsedAt: now }).where(eq(orgSessions.id, session.id));

  const foundUsers = await db.select().from(orgUsers).where(eq(orgUsers.id, session.userId)).limit(1);
  if (!foundUsers.length) return res.status(401).json({ message: "User not found" });

  const memberships = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
    .limit(1);

  req.orgUser = foundUsers[0];
  req.orgSession = session;
  req.orgMembership = memberships[0] || null;
  next();
}

function requireCoach(req: any, res: Response, next: NextFunction) {
  if (!req.orgMembership || req.orgMembership.role !== "coach") {
    return res.status(403).json({ message: "Coach access required" });
  }
  next();
}

async function seedDefaultLiftTypes(orgId: string, programId: string) {
  const existing = await db
    .select()
    .from(prLiftTypes)
    .where(and(eq(prLiftTypes.orgId, orgId), eq(prLiftTypes.programId, programId)))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(prLiftTypes).values(
    DEFAULT_LIFT_TYPES.map((lt) => ({
      orgId,
      programId,
      name: lt.name,
      category: lt.category,
      unit: lt.unit,
      isDefault: true,
    }))
  );
}

function safeUser(user: any) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return { headers, rows };
}

export function registerPrTrackerRoutes(app: Express) {
  // ── Org Auth ──────────────────────────────────────────────────────────────

  app.post("/api/org-auth/signup", async (req: any, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6),
        confirmPassword: z.string(),
        role: z.enum(["athlete", "coach"]).default("athlete"),
        orgId: z.string().min(1),
        programId: z.string().optional(),
        joinCode: z.string().optional(),
      });
      const body = schema.parse(req.body);
      if (body.password !== body.confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
      }

      const normalizedEmail = body.email.trim().toLowerCase();

      // Find or create org_user
      let [existingUser] = await db
        .select()
        .from(orgUsers)
        .where(eq(orgUsers.email, normalizedEmail))
        .limit(1);

      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const passwordHash = await bcrypt.hash(body.password, 10);
        const [newUser] = await db
          .insert(orgUsers)
          .values({ name: body.name.trim(), email: normalizedEmail, passwordHash })
          .returning();
        userId = newUser.id;
        existingUser = newUser;
      }

      // Find or create membership for this org
      const [existingMembership] = await db
        .select()
        .from(orgMemberships)
        .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, body.orgId)))
        .limit(1);

      let membership;
      if (existingMembership) {
        membership = existingMembership;
      } else {
        const [newMembership] = await db
          .insert(orgMemberships)
          .values({ orgId: body.orgId, userId, role: body.role, status: "active" })
          .returning();
        membership = newMembership;
      }

      // Handle join code
      if (body.joinCode && body.programId) {
        const [team] = await db
          .select()
          .from(prTeams)
          .where(and(eq(prTeams.joinCode, body.joinCode.toUpperCase()), eq(prTeams.orgId, body.orgId)))
          .limit(1);
        if (team) {
          const [existingMember] = await db
            .select()
            .from(prTeamMembers)
            .where(and(eq(prTeamMembers.teamId, team.id), eq(prTeamMembers.userId, userId)))
            .limit(1);
          if (!existingMember) {
            await db.insert(prTeamMembers).values({ orgId: body.orgId, teamId: team.id, userId, role: "athlete" });
          }
        }
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.insert(orgSessions).values({
        orgId: body.orgId,
        userId,
        tokenHash,
        expiresAt,
        keepLoggedIn: true,
      });

      await db.update(orgUsers).set({ lastLoginAt: new Date() }).where(eq(orgUsers.id, userId));

      res.json({ token: rawToken, user: safeUser(existingUser), membership });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: err.errors });
      res.status(500).json({ message: err.message || "Signup failed" });
    }
  });

  app.post("/api/org-auth/login", async (req: any, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(1),
        keepLoggedIn: z.boolean().optional().default(false),
        orgId: z.string().min(1),
      });
      const body = schema.parse(req.body);
      const normalizedEmail = body.email.trim().toLowerCase();

      const [user] = await db.select().from(orgUsers).where(eq(orgUsers.email, normalizedEmail)).limit(1);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });

      const valid = await bcrypt.compare(body.password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });

      const [membership] = await db
        .select()
        .from(orgMemberships)
        .where(and(eq(orgMemberships.userId, user.id), eq(orgMemberships.orgId, body.orgId)))
        .limit(1);

      if (!membership) {
        return res.status(403).json({ message: "You are not a member of this organization" });
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const ttl = body.keepLoggedIn ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + ttl);

      await db.insert(orgSessions).values({
        orgId: body.orgId,
        userId: user.id,
        tokenHash,
        expiresAt,
        keepLoggedIn: body.keepLoggedIn,
      });

      await db.update(orgUsers).set({ lastLoginAt: new Date() }).where(eq(orgUsers.id, user.id));

      res.json({ token: rawToken, user: safeUser(user), membership });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Invalid input" });
      res.status(500).json({ message: err.message || "Login failed" });
    }
  });

  app.post("/api/org-auth/logout", requireOrgAuth, async (req: any, res) => {
    try {
      await db.delete(orgSessions).where(eq(orgSessions.tokenHash, req.orgSession.tokenHash));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Logout failed" });
    }
  });

  app.get("/api/org-auth/me", requireOrgAuth, async (req: any, res) => {
    res.json({ user: safeUser(req.orgUser), membership: req.orgMembership, orgId: req.orgSession.orgId });
  });

  // ── PR Tracker ────────────────────────────────────────────────────────────

  app.get("/api/pr-tracker/bootstrap", requireOrgAuth, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId required" });

      await seedDefaultLiftTypes(orgId, programId);

      const liftTypes = await db
        .select()
        .from(prLiftTypes)
        .where(and(eq(prLiftTypes.orgId, orgId), eq(prLiftTypes.programId, programId)));

      const teams = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.orgId, orgId), eq(prTeams.programId, programId)));

      const isCoach = req.orgMembership?.role === "coach";

      let entries: any[];
      if (isCoach) {
        entries = await db
          .select()
          .from(prLiftEntries)
          .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.programId, programId)))
          .orderBy(desc(prLiftEntries.createdAt))
          .limit(50);
      } else {
        entries = await db
          .select()
          .from(prLiftEntries)
          .where(
            and(
              eq(prLiftEntries.orgId, orgId),
              eq(prLiftEntries.programId, programId),
              eq(prLiftEntries.userId, req.orgUser.id)
            )
          )
          .orderBy(desc(prLiftEntries.createdAt))
          .limit(100);
      }

      // Get team member counts
      const teamIds = teams.map((t) => t.id);
      let teamMemberCounts: Record<string, number> = {};
      if (teamIds.length > 0) {
        const members = await db
          .select()
          .from(prTeamMembers)
          .where(and(eq(prTeamMembers.orgId, orgId), inArray(prTeamMembers.teamId, teamIds)));
        for (const m of members) {
          teamMemberCounts[m.teamId] = (teamMemberCounts[m.teamId] || 0) + 1;
        }
      }

      // Athlete's team memberships
      let myTeamIds: string[] = [];
      if (!isCoach) {
        const myMemberships = await db
          .select()
          .from(prTeamMembers)
          .where(and(eq(prTeamMembers.userId, req.orgUser.id), eq(prTeamMembers.orgId, orgId)));
        myTeamIds = myMemberships.map((m) => m.teamId);
      }

      // Enrich entries with lift type names
      const liftTypeMap = Object.fromEntries(liftTypes.map((lt) => [lt.id, lt]));
      const enrichedEntries = entries.map((e) => ({
        ...e,
        liftTypeName: liftTypeMap[e.liftTypeId]?.name ?? "Unknown",
        unit: liftTypeMap[e.liftTypeId]?.unit ?? e.unit,
      }));

      // Athlete count (for coach)
      let athleteCount = 0;
      if (isCoach) {
        const allMembers = await db
          .select()
          .from(orgMemberships)
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete")));
        athleteCount = allMembers.length;
      }

      res.json({
        user: safeUser(req.orgUser),
        membership: req.orgMembership,
        liftTypes,
        teams: teams.map((t) => ({ ...t, memberCount: teamMemberCounts[t.id] || 0 })),
        entries: enrichedEntries,
        myTeamIds,
        athleteCount,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Bootstrap failed" });
    }
  });

  app.get("/api/pr-tracker/teams", requireOrgAuth, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId required" });

      const teams = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.orgId, orgId), eq(prTeams.programId, programId)));
      res.json(teams);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pr-tracker/teams", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const schema = z.object({
        programId: z.string().min(1),
        name: z.string().min(1),
        sport: z.string().optional(),
        season: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const orgId = req.orgSession.orgId;
      const joinCode = generateJoinCode();

      const [team] = await db
        .insert(prTeams)
        .values({
          orgId,
          programId: body.programId,
          coachUserId: req.orgUser.id,
          name: body.name,
          sport: body.sport,
          season: body.season,
          joinCode,
        })
        .returning();

      await db.insert(prTeamMembers).values({
        orgId,
        teamId: team.id,
        userId: req.orgUser.id,
        role: "coach",
      });

      res.json(team);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Invalid input" });
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pr-tracker/teams/join", requireOrgAuth, async (req: any, res) => {
    try {
      const schema = z.object({ joinCode: z.string().min(1), programId: z.string().min(1) });
      const body = schema.parse(req.body);
      const orgId = req.orgSession.orgId;

      const [team] = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.joinCode, body.joinCode.trim().toUpperCase()), eq(prTeams.orgId, orgId)))
        .limit(1);

      if (!team) return res.status(404).json({ message: "Team not found. Check the join code." });

      const [existing] = await db
        .select()
        .from(prTeamMembers)
        .where(and(eq(prTeamMembers.teamId, team.id), eq(prTeamMembers.userId, req.orgUser.id)))
        .limit(1);

      if (!existing) {
        await db.insert(prTeamMembers).values({
          orgId,
          teamId: team.id,
          userId: req.orgUser.id,
          role: "athlete",
        });
      }

      res.json({ team });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "joinCode required" });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pr-tracker/lift-types", requireOrgAuth, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.query.programId as string;
      if (!programId) return res.status(400).json({ message: "programId required" });

      await seedDefaultLiftTypes(orgId, programId);
      const types = await db
        .select()
        .from(prLiftTypes)
        .where(and(eq(prLiftTypes.orgId, orgId), eq(prLiftTypes.programId, programId)));
      res.json(types);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pr-tracker/entries", requireOrgAuth, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.query.programId as string;
      const targetUserId = req.query.userId as string | undefined;
      if (!programId) return res.status(400).json({ message: "programId required" });

      const isCoach = req.orgMembership?.role === "coach";
      const userId = targetUserId && isCoach ? targetUserId : req.orgUser.id;

      const entries = await db
        .select()
        .from(prLiftEntries)
        .where(
          and(
            eq(prLiftEntries.orgId, orgId),
            eq(prLiftEntries.programId, programId),
            eq(prLiftEntries.userId, userId)
          )
        )
        .orderBy(desc(prLiftEntries.createdAt))
        .limit(200);

      const liftTypes = await db
        .select()
        .from(prLiftTypes)
        .where(and(eq(prLiftTypes.orgId, orgId), eq(prLiftTypes.programId, programId)));
      const liftTypeMap = Object.fromEntries(liftTypes.map((lt) => [lt.id, lt]));

      res.json(entries.map((e) => ({ ...e, liftTypeName: liftTypeMap[e.liftTypeId]?.name ?? "Unknown", unit: liftTypeMap[e.liftTypeId]?.unit ?? e.unit })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pr-tracker/entries", requireOrgAuth, async (req: any, res) => {
    try {
      const schema = z.object({
        programId: z.string().min(1),
        liftTypeId: z.string().min(1),
        value: z.number().positive(),
        entryDate: z.string().min(1),
        notes: z.string().optional(),
        teamId: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const orgId = req.orgSession.orgId;

      const liftType = await db.select().from(prLiftTypes).where(and(eq(prLiftTypes.id, body.liftTypeId), eq(prLiftTypes.orgId, orgId))).limit(1);
      if (!liftType.length) return res.status(404).json({ message: "Lift type not found" });

      const [entry] = await db
        .insert(prLiftEntries)
        .values({
          orgId,
          programId: body.programId,
          userId: req.orgUser.id,
          liftTypeId: body.liftTypeId,
          value: body.value,
          unit: liftType[0].unit,
          entryDate: body.entryDate,
          notes: body.notes,
          teamId: body.teamId,
        })
        .returning();

      // Fire PR automation: check if this is a new personal record
      (async () => {
        try {
          const prevBest = await db.select().from(prLiftEntries)
            .where(and(
              eq(prLiftEntries.orgId, orgId),
              eq(prLiftEntries.userId, req.orgUser.id),
              eq(prLiftEntries.liftTypeId, body.liftTypeId),
              lt(prLiftEntries.id, entry.id),
            ))
            .orderBy(desc(prLiftEntries.value))
            .limit(1);

          const isNewPr = !prevBest.length || entry.value > prevBest[0].value;
          const improvementPct = prevBest.length
            ? ((entry.value - prevBest[0].value) / prevBest[0].value) * 100
            : undefined;

          await triggerNotificationEvent(isNewPr ? "new_pr" : "pr_added", {
            orgId,
            userId: req.orgUser.id,
            liftName: liftType[0].name,
            liftValue: entry.value,
            liftUnit: entry.unit,
            previousBest: prevBest[0]?.value,
            improvementPct,
          });
        } catch {}
      })();

      res.json({ ...entry, liftTypeName: liftType[0].name });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: err.errors });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pr-tracker/athletes", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.query.programId as string;

      const memberships = await db
        .select()
        .from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "athlete")));

      const userIds = memberships.map((m) => m.userId);
      if (!userIds.length) return res.json([]);

      const athletes = await db.select().from(orgUsers).where(inArray(orgUsers.id, userIds));

      const recentEntries = programId
        ? await db
            .select()
            .from(prLiftEntries)
            .where(and(eq(prLiftEntries.orgId, orgId), eq(prLiftEntries.programId, programId)))
            .orderBy(desc(prLiftEntries.createdAt))
        : [];

      const entryCountByUser: Record<string, number> = {};
      const latestEntryByUser: Record<string, any> = {};
      for (const e of recentEntries) {
        entryCountByUser[e.userId] = (entryCountByUser[e.userId] || 0) + 1;
        if (!latestEntryByUser[e.userId]) latestEntryByUser[e.userId] = e;
      }

      const teamMembers = await db.select().from(prTeamMembers).where(eq(prTeamMembers.orgId, orgId));
      const userTeams: Record<string, string[]> = {};
      for (const tm of teamMembers) {
        if (!userTeams[tm.userId]) userTeams[tm.userId] = [];
        userTeams[tm.userId].push(tm.teamId);
      }

      res.json(
        athletes.map((a) => ({
          ...safeUser(a),
          membership: memberships.find((m) => m.userId === a.id),
          entryCount: entryCountByUser[a.id] || 0,
          latestEntry: latestEntryByUser[a.id] || null,
          teamIds: userTeams[a.id] || [],
        }))
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pr-tracker/import-csv", requireOrgAuth, requireCoach, upload.single("file"), async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const programId = req.body.programId;
      if (!programId) return res.status(400).json({ message: "programId required" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const csvText = req.file.buffer.toString("utf-8");
      const { headers, rows } = parseCSV(csvText);

      await seedDefaultLiftTypes(orgId, programId);
      const liftTypes = await db
        .select()
        .from(prLiftTypes)
        .where(and(eq(prLiftTypes.orgId, orgId), eq(prLiftTypes.programId, programId)));
      const liftTypeByName = Object.fromEntries(liftTypes.map((lt) => [lt.name.toLowerCase(), lt]));

      const errors: { row: number; message: string }[] = [];
      let successCount = 0;

      // Get all teams for this program
      const programTeams = await db
        .select()
        .from(prTeams)
        .where(and(eq(prTeams.orgId, orgId), eq(prTeams.programId, programId)));
      const teamByName: Record<string, any> = Object.fromEntries(programTeams.map((t) => [t.name.toLowerCase(), t]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        try {
          const name = row.name?.trim();
          const email = row.email?.trim().toLowerCase();
          if (!name || !email) {
            errors.push({ row: rowNum, message: "Missing name or email" });
            continue;
          }

          // Find or create org_user
          let [existingUser] = await db.select().from(orgUsers).where(eq(orgUsers.email, email)).limit(1);
          let userId: string;
          if (existingUser) {
            userId = existingUser.id;
          } else {
            const tmpPassword = await bcrypt.hash(crypto.randomBytes(8).toString("hex"), 10);
            const [newUser] = await db
              .insert(orgUsers)
              .values({ name, email, passwordHash: tmpPassword })
              .returning();
            userId = newUser.id;
          }

          // Find or create membership
          const [existingMembership] = await db
            .select()
            .from(orgMemberships)
            .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)))
            .limit(1);
          if (!existingMembership) {
            await db.insert(orgMemberships).values({ orgId, userId, role: "athlete", status: "active" });
          }

          // Handle team
          if (row.team?.trim()) {
            const teamName = row.team.trim();
            const teamKey = teamName.toLowerCase();
            if (!teamByName[teamKey]) {
              const joinCode = generateJoinCode();
              const [newTeam] = await db
                .insert(prTeams)
                .values({ orgId, programId, coachUserId: req.orgUser.id, name: teamName, sport: row.sport?.trim(), joinCode })
                .returning();
              teamByName[teamKey] = newTeam;
            }
            const team = teamByName[teamKey];
            const [existingMember] = await db
              .select()
              .from(prTeamMembers)
              .where(and(eq(prTeamMembers.teamId, team.id), eq(prTeamMembers.userId, userId)))
              .limit(1);
            if (!existingMember) {
              await db.insert(prTeamMembers).values({ orgId, teamId: team.id, userId, role: "athlete" });
            }
          }

          // Create PR entries for numeric columns
          const today = new Date().toISOString().split("T")[0];
          for (const [col, liftName] of Object.entries(CSV_LIFT_MAP)) {
            const val = row[col];
            if (!val || isNaN(Number(val))) continue;
            const liftType = liftTypeByName[liftName.toLowerCase()];
            if (!liftType) continue;
            const teamKey = row.team?.trim().toLowerCase() ?? "";
            const team = teamByName[teamKey];
            await db.insert(prLiftEntries).values({
              orgId,
              programId,
              userId,
              liftTypeId: liftType.id,
              value: Number(val),
              unit: liftType.unit,
              entryDate: today,
              teamId: team?.id ?? null,
            });
          }

          successCount++;
        } catch (rowErr: any) {
          errors.push({ row: rowNum, message: rowErr.message });
        }
      }

      const [job] = await db
        .insert(prImportJobs)
        .values({
          orgId,
          programId,
          coachUserId: req.orgUser.id,
          filename: req.file.originalname,
          status: "done",
          rowCount: rows.length,
          successCount,
          errorCount: errors.length,
          errors,
        })
        .returning();

      res.json({ job, successCount, errorCount: errors.length, errors });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
