/**
 * Orchestration Routes — Phase 4
 *
 * API endpoints for:
 *  - Organization event timeline (per-org and per-athlete)
 *  - Organization intelligence state
 *  - Daily operations brief
 *  - Event resolution
 *  - Event bus diagnostics
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  organizationEventLog,
  organizationIntelligenceState,
} from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import {
  getOrgEventTimeline,
  getOrgIntelligenceState,
  resolveEventLog,
  refreshOrgIntelligenceState,
} from "./organization-intelligence-orchestrator";
import { generateDailyOperationsBrief } from "../services/daily-operations-engine";
import { eventBus } from "../events/event-bus";

// ─── Auth helper (mirrors intervention-outcome-routes pattern) ────────────────

function resolveOrgAuth(req: Request): { orgId: string | null; error?: string } {
  const headerToken = req.headers["x-org-auth-token"] as string | undefined;
  if (headerToken) return { orgId: headerToken };
  const profile = (req as any)._profile;
  const orgAuth = (req as any)._orgAuth;
  if (orgAuth?.orgId) return { orgId: orgAuth.orgId };
  if (profile?.organizationId) return { orgId: profile.organizationId };
  return { orgId: null, error: "Organization context required" };
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerOrchestrationRoutes(app: Express): void {

  // ── GET /api/org/intelligence/state ─────────────────────────────────────────
  // Returns the current org-wide intelligence state snapshot
  app.get("/api/org/intelligence/state", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    try {
      const state = await getOrgIntelligenceState(orgId);
      if (!state) {
        // Auto-generate on first access
        await refreshOrgIntelligenceState(orgId);
        const fresh = await getOrgIntelligenceState(orgId);
        return res.json(fresh ?? { orgId, overallHealthScore: 100, message: "State initializing" });
      }
      return res.json(state);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/org/intelligence/state/refresh ─────────────────────────────────
  // Forces a re-computation of the org intelligence state
  app.post("/api/org/intelligence/state/refresh", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    try {
      await refreshOrgIntelligenceState(orgId);
      const state = await getOrgIntelligenceState(orgId);
      return res.json({ success: true, state });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/org/intelligence/event-log ──────────────────────────────────────
  // Returns paginated org event timeline
  app.get("/api/org/intelligence/event-log", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);
    const athleteUserId = req.query.athleteUserId as string | undefined;
    try {
      const events = await getOrgEventTimeline(orgId, athleteUserId, limit);
      return res.json({ events, total: events.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/org/intelligence/athletes/:athleteUserId/timeline ───────────────
  // Returns the intelligence timeline for a specific athlete
  app.get("/api/org/intelligence/athletes/:athleteUserId/timeline", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    const { athleteUserId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit ?? "30")), 100);
    try {
      const events = await getOrgEventTimeline(orgId, athleteUserId, limit);
      return res.json({ athleteUserId, events });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/org/intelligence/event-log/:id/resolve ───────────────────────
  // Marks an event as resolved
  app.patch("/api/org/intelligence/event-log/:id/resolve", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    const { id } = req.params;
    try {
      await resolveEventLog(id);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/org/intelligence/daily-ops ──────────────────────────────────────
  // Returns (or generates) the daily operations brief
  app.get("/api/org/intelligence/daily-ops", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    try {
      const brief = await generateDailyOperationsBrief(orgId);
      return res.json(brief);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/org/intelligence/daily-ops/regenerate ──────────────────────────
  // Force-regenerates the daily ops brief
  app.post("/api/org/intelligence/daily-ops/regenerate", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    try {
      const brief = await generateDailyOperationsBrief(orgId);
      return res.json({ success: true, brief });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/org/intelligence/event-stream ───────────────────────────────────
  // Returns recent events from the in-memory event bus ring buffer
  app.get("/api/org/intelligence/event-stream", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 100);
    try {
      const recentEvents = eventBus.getRecentEvents({ orgId, limit });
      const stats = eventBus.getStats();
      const subscribers = eventBus.getSubscriberList();
      return res.json({ recentEvents, stats, subscribers, orgId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/org/intelligence/escalation-summary ─────────────────────────────
  // Returns athletes with open escalated events
  app.get("/api/org/intelligence/escalation-summary", async (req: Request, res: Response) => {
    const { orgId, error } = resolveOrgAuth(req);
    if (!orgId) return res.status(401).json({ error });
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const escalations = await db.select()
        .from(organizationEventLog)
        .where(and(
          eq(organizationEventLog.orgId, orgId),
          eq(organizationEventLog.eventType, "athlete.escalation.triggered"),
          eq(organizationEventLog.resolutionState, "open"),
          gte(organizationEventLog.createdAt, sevenDaysAgo)
        ))
        .orderBy(desc(organizationEventLog.createdAt))
        .limit(50);

      // Group by athlete
      const byAthlete = new Map<string, { events: typeof escalations; maxLevel: number }>();
      for (const e of escalations) {
        const uid = e.athleteUserId ?? "unknown";
        const existing = byAthlete.get(uid) ?? { events: [], maxLevel: 0 };
        const payload = e.payload as any;
        existing.events.push(e);
        existing.maxLevel = Math.max(existing.maxLevel, payload?.escalationLevel ?? 0);
        byAthlete.set(uid, existing);
      }

      const summary = [...byAthlete.entries()].map(([athleteUserId, data]) => {
        const latestEvent = data.events[0];
        const payload = latestEvent.payload as any;
        return {
          athleteUserId,
          athleteName: payload?.athleteName ?? athleteUserId,
          maxEscalationLevel: data.maxLevel,
          openEventCount: data.events.length,
          latestEscalationAt: latestEvent.createdAt,
          latestReason: payload?.escalationReason,
          unresolvedSignals: payload?.unresolvedSignals ?? [],
        };
      }).sort((a, b) => b.maxEscalationLevel - a.maxEscalationLevel);

      return res.json({ escalations: summary, total: summary.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
