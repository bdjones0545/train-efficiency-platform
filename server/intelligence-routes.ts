import type { Express, Response, NextFunction } from "express";
import { db } from "./db";
import crypto from "crypto";
import { z } from "zod";
import {
  orgUsers,
  orgMemberships,
  orgSessions,
  prLiftEntries,
  prLiftTypes,
  athleteWatchlists,
  athleteIntelligenceAlerts,
  athleteIntelligenceSnapshots,
  athleteExternalAssets,
  prAgentResearchJobs,
} from "@shared/schema";
import { eq, and, desc, gt, lt, lte, isNull, or, sql as drizzleSql, count, gte, ne } from "drizzle-orm";

// ── Auth middleware ───────────────────────────────────────────────────────────
import { resolveOrgSession as _resolveOrgSession } from "./org-auth";

async function requireOrgAuth(req: any, res: Response, next: NextFunction) {
  try {
    const auth = await _resolveOrgSession(req);
    if (!auth) return res.status(401).json({ message: "Not authenticated" });
    req.orgUser = { id: auth.userId };
    req.orgSession = { orgId: auth.orgId, userId: auth.userId };
    req.orgMembership = { role: auth.role, userId: auth.userId, orgId: auth.orgId };
    next();
  } catch {
    res.status(500).json({ message: "Auth error" });
  }
}

function requireCoach(req: any, res: Response, next: NextFunction) {
  if (!req.orgMembership || !["admin", "coach", "staff", "owner"].includes(req.orgMembership.role)) {
    return res.status(403).json({ message: "Coach access required" });
  }
  next();
}

// ── Alert dedup guard ─────────────────────────────────────────────────────────

async function recentAlertExists(orgId: string, athleteUserId: string, alertType: string, withinDays = 7): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);
  const found = await db
    .select({ id: athleteIntelligenceAlerts.id })
    .from(athleteIntelligenceAlerts)
    .where(
      and(
        eq(athleteIntelligenceAlerts.orgId, orgId),
        eq(athleteIntelligenceAlerts.athleteUserId, athleteUserId),
        eq(athleteIntelligenceAlerts.alertType, alertType),
        gt(athleteIntelligenceAlerts.createdAt, cutoff)
      )
    )
    .limit(1);
  return found.length > 0;
}

async function createAlert(params: {
  orgId: string;
  athleteUserId: string;
  coachUserId: string;
  alertType: string;
  severity: string;
  title: string;
  summary?: string;
  metadata?: any;
  sourceUrl?: string;
}) {
  await db.insert(athleteIntelligenceAlerts).values({
    orgId: params.orgId,
    athleteUserId: params.athleteUserId,
    coachUserId: params.coachUserId,
    alertType: params.alertType,
    severity: params.severity,
    title: params.title,
    summary: params.summary,
    metadata: params.metadata || {},
    sourceUrl: params.sourceUrl,
  });
}

// ── Internal analytics checks ─────────────────────────────────────────────────

async function checkPrProgress(orgId: string, athleteUserId: string, coachUserId: string, watchlist: any) {
  if (!watchlist.monitorPrProgress) return;

  const liftTypes = await db.select().from(prLiftTypes).where(eq(prLiftTypes.orgId, orgId));
  const liftMap: Record<string, string> = {};
  liftTypes.forEach((lt) => { liftMap[lt.id] = lt.name; });

  const entries = await db
    .select()
    .from(prLiftEntries)
    .where(and(eq(prLiftEntries.userId, athleteUserId), eq(prLiftEntries.orgId, orgId)))
    .orderBy(desc(prLiftEntries.entryDate));

  if (entries.length === 0) return;

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(now.getDate() - 60);

  // Check inactivity
  const lastEntry = entries[0];
  const lastDate = new Date(lastEntry.entryDate);
  const daysSinceLast = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceLast >= 30) {
    const alreadyExists = await recentAlertExists(orgId, athleteUserId, "inactivity", 14);
    if (!alreadyExists) {
      await createAlert({
        orgId, athleteUserId, coachUserId,
        alertType: "inactivity",
        severity: daysSinceLast >= 45 ? "important" : "moderate",
        title: `No training entries in ${daysSinceLast} days`,
        summary: `${await getAthleteName(athleteUserId)} has not logged any PR entries in the past ${daysSinceLast} days. Last entry was on ${lastEntry.entryDate}.`,
        metadata: { daysSinceLast, lastEntryDate: lastEntry.entryDate },
      });
    }
  }

  // Check PR spikes — per lift type
  if (!watchlist.monitorPrProgress) return;

  const byLift: Record<string, { recent: number[]; older: number[]; bestRecent: number; bestOlder: number; liftName: string }> = {};
  for (const e of entries) {
    const liftName = liftMap[e.liftTypeId] || e.liftTypeId;
    if (!byLift[e.liftTypeId]) {
      byLift[e.liftTypeId] = { recent: [], older: [], bestRecent: 0, bestOlder: 0, liftName };
    }
    const entryDate = new Date(e.entryDate);
    if (entryDate >= thirtyDaysAgo) {
      byLift[e.liftTypeId].recent.push(e.value);
    } else if (entryDate >= sixtyDaysAgo) {
      byLift[e.liftTypeId].older.push(e.value);
    }
  }

  for (const [liftTypeId, data] of Object.entries(byLift)) {
    if (data.recent.length === 0 || data.older.length === 0) continue;
    const bestRecent = Math.max(...data.recent);
    const bestOlder = Math.max(...data.older);
    if (bestOlder === 0) continue;
    const improvement = (bestRecent - bestOlder) / bestOlder;
    if (improvement >= 0.12) {
      const alreadyExists = await recentAlertExists(orgId, athleteUserId, "pr_spike", 14);
      if (!alreadyExists) {
        const pct = Math.round(improvement * 100);
        await createAlert({
          orgId, athleteUserId, coachUserId,
          alertType: "pr_spike",
          severity: improvement >= 0.2 ? "important" : "moderate",
          title: `PR spike: ${data.liftName} up ${pct}%`,
          summary: `${await getAthleteName(athleteUserId)}'s ${data.liftName} improved ${pct}% in the last 30 days (${bestOlder} → ${bestRecent}).`,
          metadata: { liftTypeId, liftName: data.liftName, oldBest: bestOlder, newBest: bestRecent, improvementPct: pct },
        });
      }
      break; // One spike alert per check
    }
  }
}

async function checkTrainingConsistency(orgId: string, athleteUserId: string, coachUserId: string, watchlist: any) {
  if (!watchlist.monitorTrainingConsistency) return;

  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const entries = await db
    .select({ entryDate: prLiftEntries.entryDate })
    .from(prLiftEntries)
    .where(and(
      eq(prLiftEntries.userId, athleteUserId),
      eq(prLiftEntries.orgId, orgId),
      gte(prLiftEntries.entryDate, eightWeeksAgo.toISOString().split("T")[0])
    ));

  if (entries.length === 0) return;

  // Count per 2-week window
  const now = new Date();
  const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14);
  const fourWeeksAgo = new Date(now); fourWeeksAgo.setDate(now.getDate() - 28);
  const sixWeeksAgo = new Date(now); sixWeeksAgo.setDate(now.getDate() - 42);

  let recentCount = 0, prevCount = 0, olderCount = 0;
  for (const e of entries) {
    const d = new Date(e.entryDate);
    if (d >= twoWeeksAgo) recentCount++;
    else if (d >= fourWeeksAgo) prevCount++;
    else if (d >= sixWeeksAgo) olderCount++;
  }

  // Meaningful drop: had activity before, now significantly less
  const avgOlder = (prevCount + olderCount) / 2;
  if (avgOlder >= 4 && recentCount <= 1) {
    const alreadyExists = await recentAlertExists(orgId, athleteUserId, "attendance_drop", 14);
    if (!alreadyExists) {
      await createAlert({
        orgId, athleteUserId, coachUserId,
        alertType: "attendance_drop",
        severity: "moderate",
        title: `Training activity dropped significantly`,
        summary: `${await getAthleteName(athleteUserId)} averaged ${Math.round(avgOlder)} entries per 2 weeks previously, but only ${recentCount} in the last 2 weeks.`,
        metadata: { recentCount, prevCount, olderCount },
      });
    }
  }
}

async function checkResearchDue(orgId: string, athleteUserId: string, coachUserId: string, watchlist: any) {
  if (!watchlist.monitorStats && !watchlist.monitorMedia && !watchlist.monitorPublicProfiles) return;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentJobs = await db
    .select({ id: prAgentResearchJobs.id })
    .from(prAgentResearchJobs)
    .where(and(
      eq(prAgentResearchJobs.athleteUserId, athleteUserId),
      eq(prAgentResearchJobs.orgId, orgId),
      gt(prAgentResearchJobs.createdAt, sevenDaysAgo)
    ))
    .limit(1);

  if (recentJobs.length > 0) return; // Already researched recently

  // Check if we have any approved assets at all (only alert if there's something to monitor)
  const approvedAssets = await db
    .select({ id: athleteExternalAssets.id })
    .from(athleteExternalAssets)
    .where(and(
      eq(athleteExternalAssets.athleteUserId, athleteUserId),
      eq(athleteExternalAssets.orgId, orgId),
      eq(athleteExternalAssets.status, "approved")
    ))
    .limit(1);

  if (approvedAssets.length === 0) return; // No approved assets to monitor

  const alreadyExists = await recentAlertExists(orgId, athleteUserId, "research_due", 7);
  if (!alreadyExists) {
    await createAlert({
      orgId, athleteUserId, coachUserId,
      alertType: "research_due",
      severity: "info",
      title: "Research refresh recommended",
      summary: `No public profile research has been run in over 7 days. Run a refresh to check for new highlights, updated stats, or roster changes.`,
      metadata: {},
    });
  }
}

async function getAthleteName(athleteUserId: string): Promise<string> {
  const [user] = await db.select({ name: orgUsers.name }).from(orgUsers).where(eq(orgUsers.id, athleteUserId)).limit(1);
  return user?.name || "This athlete";
}

// ── Full monitoring check for one watchlist ───────────────────────────────────

export async function runMonitoringCheck(watchlistId: string) {
  const [watchlist] = await db
    .select()
    .from(athleteWatchlists)
    .where(eq(athleteWatchlists.id, watchlistId))
    .limit(1);
  if (!watchlist || !watchlist.isActive) return;

  const { orgId, athleteUserId, coachUserId } = watchlist;

  try {
    await Promise.all([
      checkPrProgress(orgId, athleteUserId, coachUserId, watchlist),
      checkTrainingConsistency(orgId, athleteUserId, coachUserId, watchlist),
      checkResearchDue(orgId, athleteUserId, coachUserId, watchlist),
    ]);
  } catch (e) {
    console.error("[Intelligence] Check error:", e);
  }

  const now = new Date();
  const freq = watchlist.frequency;
  const nextCheck = new Date(now);
  if (freq === "daily") nextCheck.setDate(nextCheck.getDate() + 1);
  else if (freq === "every_3_days") nextCheck.setDate(nextCheck.getDate() + 3);
  else nextCheck.setDate(nextCheck.getDate() + 7);

  await db
    .update(athleteWatchlists)
    .set({ lastCheckedAt: now, nextCheckAt: nextCheck, updatedAt: now })
    .where(eq(athleteWatchlists.id, watchlistId));
}

// ── Scheduled monitoring cron ─────────────────────────────────────────────────

export function startIntelligenceCron() {
  const INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
  async function runDueCycles() {
    try {
      const now = new Date();
      const due = await db
        .select()
        .from(athleteWatchlists)
        .where(
          and(
            eq(athleteWatchlists.isActive, true),
            or(isNull(athleteWatchlists.nextCheckAt), lte(athleteWatchlists.nextCheckAt, now))
          )
        )
        .limit(20);

      for (const w of due) {
        await runMonitoringCheck(w.id);
        await new Promise((r) => setTimeout(r, 500)); // gentle throttle
      }
      if (due.length > 0) console.log(`[Intelligence] Processed ${due.length} watchlist checks`);
    } catch (e) {
      console.error("[Intelligence] Cron error:", e);
    }
  }

  setTimeout(runDueCycles, 10_000); // first run 10s after startup
  setInterval(runDueCycles, INTERVAL_MS);
  console.log("[Intelligence] Monitoring cron started");
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerIntelligenceRoutes(app: Express) {

  // POST /api/org/coach/watchlists — add athlete to watchlist
  app.post("/api/org/coach/watchlists", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const schema = z.object({
        athleteUserId: z.string().min(1),
        monitorPublicProfiles: z.boolean().optional(),
        monitorStats: z.boolean().optional(),
        monitorMedia: z.boolean().optional(),
        monitorPrProgress: z.boolean().optional(),
        monitorAttendance: z.boolean().optional(),
        monitorBookingInactivity: z.boolean().optional(),
        monitorTrainingConsistency: z.boolean().optional(),
        frequency: z.enum(["daily", "every_3_days", "weekly"]).optional(),
      });
      const body = schema.parse(req.body);

      // Check if already watching
      const existing = await db
        .select()
        .from(athleteWatchlists)
        .where(and(
          eq(athleteWatchlists.orgId, orgId),
          eq(athleteWatchlists.athleteUserId, body.athleteUserId),
          eq(athleteWatchlists.coachUserId, req.orgUser.id)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Re-activate if previously deactivated
        const [updated] = await db
          .update(athleteWatchlists)
          .set({ isActive: true, ...body, updatedAt: new Date() })
          .where(eq(athleteWatchlists.id, existing[0].id))
          .returning();
        return res.json({ watchlist: updated });
      }

      const [watchlist] = await db
        .insert(athleteWatchlists)
        .values({ orgId, coachUserId: req.orgUser.id, ...body })
        .returning();
      res.json({ watchlist });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /api/org/coach/watchlists/:id — update settings
  app.patch("/api/org/coach/watchlists/:id", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const schema = z.object({
        isActive: z.boolean().optional(),
        monitorPublicProfiles: z.boolean().optional(),
        monitorStats: z.boolean().optional(),
        monitorMedia: z.boolean().optional(),
        monitorPrProgress: z.boolean().optional(),
        monitorAttendance: z.boolean().optional(),
        monitorBookingInactivity: z.boolean().optional(),
        monitorTrainingConsistency: z.boolean().optional(),
        frequency: z.enum(["daily", "every_3_days", "weekly"]).optional(),
      });
      const updates = schema.parse(req.body);
      const [updated] = await db
        .update(athleteWatchlists)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(athleteWatchlists.id, req.params.id), eq(athleteWatchlists.orgId, orgId), eq(athleteWatchlists.coachUserId, req.orgUser.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Watchlist not found" });
      res.json({ watchlist: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/org/coach/watchlists/:id — remove from watchlist
  app.delete("/api/org/coach/watchlists/:id", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      await db
        .update(athleteWatchlists)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(athleteWatchlists.id, req.params.id), eq(athleteWatchlists.orgId, orgId), eq(athleteWatchlists.coachUserId, req.orgUser.id)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/coach/intelligence/watchlists — list all watchlists with athlete info
  app.get("/api/org/coach/intelligence/watchlists", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const { athleteUserId } = req.query;

      let q = db
        .select()
        .from(athleteWatchlists)
        .where(
          and(
            eq(athleteWatchlists.orgId, orgId),
            eq(athleteWatchlists.coachUserId, req.orgUser.id),
            eq(athleteWatchlists.isActive, true),
            ...(athleteUserId ? [eq(athleteWatchlists.athleteUserId, athleteUserId as string)] : [])
          )
        )
        .orderBy(desc(athleteWatchlists.createdAt));

      const watchlists = await q;

      // Enrich with athlete names
      const userIds = [...new Set(watchlists.map((w) => w.athleteUserId))];
      const athletes = userIds.length > 0
        ? await db.select({ id: orgUsers.id, name: orgUsers.name }).from(orgUsers).where(
            userIds.length === 1 ? eq(orgUsers.id, userIds[0]) : drizzleSql`${orgUsers.id} = ANY(ARRAY[${drizzleSql.join(userIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}])`
          )
        : [];

      const athleteMap = Object.fromEntries(athletes.map((a) => [a.id, a.name]));

      const enriched = watchlists.map((w) => ({
        ...w,
        athleteName: athleteMap[w.athleteUserId] || "Unknown Athlete",
      }));

      // Unread alert counts per athlete
      const alertCounts: Record<string, number> = {};
      if (enriched.length > 0) {
        for (const w of enriched) {
          const unread = await db
            .select({ cnt: drizzleSql<number>`count(*)::int` })
            .from(athleteIntelligenceAlerts)
            .where(and(
              eq(athleteIntelligenceAlerts.orgId, orgId),
              eq(athleteIntelligenceAlerts.athleteUserId, w.athleteUserId),
              eq(athleteIntelligenceAlerts.coachUserId, req.orgUser.id),
              eq(athleteIntelligenceAlerts.isRead, false)
            ));
          alertCounts[w.athleteUserId] = unread[0]?.cnt || 0;
        }
      }

      res.json({ watchlists: enriched.map((w) => ({ ...w, unreadAlerts: alertCounts[w.athleteUserId] || 0 })) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/coach/intelligence/alerts — list alerts
  app.get("/api/org/coach/intelligence/alerts", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const { athleteUserId, isRead, severity, alertType, limit = "50" } = req.query as any;

      const conditions: any[] = [
        eq(athleteIntelligenceAlerts.orgId, orgId),
        eq(athleteIntelligenceAlerts.coachUserId, req.orgUser.id),
      ];
      if (athleteUserId) conditions.push(eq(athleteIntelligenceAlerts.athleteUserId, athleteUserId));
      if (isRead === "true") conditions.push(eq(athleteIntelligenceAlerts.isRead, true));
      if (isRead === "false") conditions.push(eq(athleteIntelligenceAlerts.isRead, false));
      if (severity) conditions.push(eq(athleteIntelligenceAlerts.severity, severity));
      if (alertType) conditions.push(eq(athleteIntelligenceAlerts.alertType, alertType));

      const alerts = await db
        .select()
        .from(athleteIntelligenceAlerts)
        .where(and(...conditions))
        .orderBy(desc(athleteIntelligenceAlerts.createdAt))
        .limit(Math.min(parseInt(limit, 10) || 50, 100));

      // Enrich with athlete names
      const userIds = [...new Set(alerts.map((a) => a.athleteUserId))];
      const athletes = userIds.length > 0
        ? await db.select({ id: orgUsers.id, name: orgUsers.name }).from(orgUsers).where(
            userIds.length === 1 ? eq(orgUsers.id, userIds[0]) : drizzleSql`${orgUsers.id} = ANY(ARRAY[${drizzleSql.join(userIds.map(id => drizzleSql`${id}`), drizzleSql`, `)}])`
          )
        : [];
      const athleteMap = Object.fromEntries(athletes.map((a) => [a.id, a.name]));

      const enriched = alerts.map((a) => ({ ...a, athleteName: athleteMap[a.athleteUserId] || "Unknown" }));
      res.json({ alerts: enriched });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/org/coach/intelligence/summary — unread counts + stats
  app.get("/api/org/coach/intelligence/summary", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const coachUserId = req.orgUser.id;

      const [totalWatched, unreadAlerts, importantAlerts] = await Promise.all([
        db.select({ cnt: drizzleSql<number>`count(*)::int` })
          .from(athleteWatchlists)
          .where(and(eq(athleteWatchlists.orgId, orgId), eq(athleteWatchlists.coachUserId, coachUserId), eq(athleteWatchlists.isActive, true))),
        db.select({ cnt: drizzleSql<number>`count(*)::int` })
          .from(athleteIntelligenceAlerts)
          .where(and(eq(athleteIntelligenceAlerts.orgId, orgId), eq(athleteIntelligenceAlerts.coachUserId, coachUserId), eq(athleteIntelligenceAlerts.isRead, false))),
        db.select({ cnt: drizzleSql<number>`count(*)::int` })
          .from(athleteIntelligenceAlerts)
          .where(and(
            eq(athleteIntelligenceAlerts.orgId, orgId),
            eq(athleteIntelligenceAlerts.coachUserId, coachUserId),
            eq(athleteIntelligenceAlerts.isRead, false),
            drizzleSql`${athleteIntelligenceAlerts.severity} IN ('important', 'critical')`
          )),
      ]);

      res.json({
        totalWatched: totalWatched[0]?.cnt || 0,
        unreadAlerts: unreadAlerts[0]?.cnt || 0,
        importantAlerts: importantAlerts[0]?.cnt || 0,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/org/coach/intelligence/run-check/:athleteUserId — manual check
  app.post("/api/org/coach/intelligence/run-check/:athleteUserId", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const { athleteUserId } = req.params;

      const [watchlist] = await db
        .select()
        .from(athleteWatchlists)
        .where(and(
          eq(athleteWatchlists.orgId, orgId),
          eq(athleteWatchlists.athleteUserId, athleteUserId),
          eq(athleteWatchlists.coachUserId, req.orgUser.id),
          eq(athleteWatchlists.isActive, true)
        ))
        .limit(1);

      if (!watchlist) return res.status(404).json({ message: "Athlete not on watchlist" });

      // Run immediately async
      runMonitoringCheck(watchlist.id).catch((e) => console.error("[Intelligence] Manual check failed:", e));

      res.json({ ok: true, message: "Check started" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /api/org/coach/intelligence/alerts/:id/read — mark one read
  app.patch("/api/org/coach/intelligence/alerts/:id/read", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const [updated] = await db
        .update(athleteIntelligenceAlerts)
        .set({ isRead: true })
        .where(and(
          eq(athleteIntelligenceAlerts.id, req.params.id),
          eq(athleteIntelligenceAlerts.orgId, orgId),
          eq(athleteIntelligenceAlerts.coachUserId, req.orgUser.id)
        ))
        .returning();
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      res.json({ alert: updated });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PATCH /api/org/coach/intelligence/alerts/read-all — mark all read
  app.patch("/api/org/coach/intelligence/alerts/read-all", requireOrgAuth, requireCoach, async (req: any, res) => {
    try {
      const orgId = req.orgSession.orgId;
      const { athleteUserId } = req.query;
      const conditions: any[] = [
        eq(athleteIntelligenceAlerts.orgId, orgId),
        eq(athleteIntelligenceAlerts.coachUserId, req.orgUser.id),
        eq(athleteIntelligenceAlerts.isRead, false),
      ];
      if (athleteUserId) conditions.push(eq(athleteIntelligenceAlerts.athleteUserId, athleteUserId as string));
      await db.update(athleteIntelligenceAlerts).set({ isRead: true }).where(and(...conditions));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
