/**
 * Readiness Routes — Phase 9
 * ────────────────────────────
 * GET /api/admin/readiness   — Org-wide readiness summary
 */
import type { Express } from "express";
import { storage } from "./storage";

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.() && !req.user) return res.status(401).json({ message: "Unauthorized" });
  next();
}

export function registerReadinessRoutes(app: Express) {

  // GET /api/admin/readiness — org-wide readiness summary
  app.get("/api/admin/readiness", requireAdmin, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;

      const { computeOrgReadinessSummary } = await import("./services/readiness-service");
      const summary = await computeOrgReadinessSummary(orgId);
      return res.json(summary);
    } catch (err: any) {
      console.error("[readiness] org summary error:", err);
      res.status(500).json({ message: "Failed to compute readiness summary", error: err.message });
    }
  });

  // GET /api/admin/readiness/athlete/:athleteUserId — per-athlete readiness bundle
  app.get("/api/admin/readiness/athlete/:athleteUserId", requireAdmin, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const profile = await storage.getUserProfile(userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "No organization" });
      const orgId = profile.organizationId;
      const { athleteUserId } = req.params;

      const { db } = await import("./db");
      const { athleteOnboardingChecklists } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [row] = await db.select()
        .from(athleteOnboardingChecklists)
        .where(and(
          eq(athleteOnboardingChecklists.orgId, orgId),
          eq(athleteOnboardingChecklists.athleteUserId, athleteUserId),
        ))
        .limit(1);

      if (!row) return res.status(404).json({ message: "No onboarding record found for athlete" });

      const { computeReadinessBundle } = await import("./services/readiness-service");
      const bundle = await computeReadinessBundle(orgId, athleteUserId, {
        accountInviteSent: row.accountInviteSent,
        welcomeDraftApproved: row.welcomeDraftApproved,
        pailContextSeeded: row.pailContextSeeded,
        guardianLinked: row.guardianLinked,
        programAssigned: row.programAssigned,
        firstSessionScheduled: row.firstSessionScheduled,
        firstSessionCompleted: row.firstSessionCompleted,
        paymentSetup: row.paymentSetup,
        waiverCompleted: row.waiverCompleted,
        parentEmail: null,
      });

      return res.json(bundle);
    } catch (err: any) {
      console.error("[readiness] athlete bundle error:", err);
      res.status(500).json({ message: "Failed to compute athlete readiness", error: err.message });
    }
  });
}
