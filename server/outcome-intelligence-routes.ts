/**
 * Outcome Intelligence Routes
 * REST endpoints for outcome tracking, rule effectiveness, manual outcome editing,
 * and employment applicant management.
 */

import type { Express } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { agentCommunicationOutcomes, employmentApplicants } from "@shared/schema";
import { isAuthenticated } from "./replitAuth";

async function getAdminOrgId(req: any): Promise<string | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const { storage } = await import("./storage");
  const user = await storage.getUser(userId);
  return user?.orgId ?? null;
}

export async function registerOutcomeIntelligenceRoutes(app: Express) {

  // ─── GET /api/outcomes/dashboard — full outcome metrics by domain ──────────
  app.get("/api/outcomes/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getOutcomeDashboard } = await import("./services/outcome-intelligence-service");
      const data = await getOutcomeDashboard(orgId);
      res.json(data);
    } catch (e: any) {
      console.error("[outcomes] dashboard error:", e);
      res.status(500).json({ message: "Failed to load outcome dashboard" });
    }
  });

  // ─── GET /api/outcomes/sent — list sent messages with outcomes ─────────────
  app.get("/api/outcomes/sent", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { domain } = req.query as Record<string, string>;
      const { getSentMessages } = await import("./services/outcome-intelligence-service");
      const rows = await getSentMessages(orgId, domain);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch sent messages" });
    }
  });

  // ─── PATCH /api/outcomes/:id — manual outcome update ──────────────────────
  app.patch("/api/outcomes/:id", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { outcomeStatus, revenueCents } = req.body ?? {};
      if (!outcomeStatus) return res.status(400).json({ message: "outcomeStatus is required" });

      const [row] = await db.select({ id: agentCommunicationOutcomes.id })
        .from(agentCommunicationOutcomes)
        .where(and(eq(agentCommunicationOutcomes.id, id), eq(agentCommunicationOutcomes.orgId, orgId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Outcome not found" });

      const { updateOutcomeManual } = await import("./services/outcome-intelligence-service");
      await updateOutcomeManual({ outcomeId: id, orgId, outcomeStatus, revenueCents });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update outcome" });
    }
  });

  // ─── GET /api/outcomes/rule-effectiveness — rule effectiveness scores ──────
  app.get("/api/outcomes/rule-effectiveness", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { agentRuleEffectiveness, agentMessageLearningRules } = await import("@shared/schema");
      const rows = await db.select({
        eff: agentRuleEffectiveness,
        rule: agentMessageLearningRules,
      })
        .from(agentRuleEffectiveness)
        .leftJoin(agentMessageLearningRules, eq(agentRuleEffectiveness.ruleId, agentMessageLearningRules.id))
        .where(eq(agentRuleEffectiveness.orgId, orgId))
        .orderBy(desc(agentRuleEffectiveness.effectivenessScore));
      res.json(rows.map((r) => ({
        ...r.eff,
        ruleText: r.rule?.ruleText ?? null,
        ruleType: r.rule?.ruleType ?? null,
      })));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch rule effectiveness" });
    }
  });

  // ─── POST /api/outcomes/recalculate — manually trigger recalculation ───────
  app.post("/api/outcomes/recalculate", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { recalculateRuleEffectivenessForOrg } = await import("./services/outcome-intelligence-service");
      await recalculateRuleEffectivenessForOrg(orgId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to recalculate" });
    }
  });

  // ─── Employment Applicants CRUD ───────────────────────────────────────────

  app.get("/api/employment-applicants", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const rows = await db.select().from(employmentApplicants)
        .where(eq(employmentApplicants.orgId, orgId))
        .orderBy(desc(employmentApplicants.createdAt));
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch applicants" });
    }
  });

  app.post("/api/employment-applicants", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { firstName, lastName, email, phone, roleAppliedFor, experienceLevel, certifications, location, source, notes, resumeUrl } = req.body ?? {};
      if (!firstName || !lastName || !email) return res.status(400).json({ message: "firstName, lastName, email required" });
      const [row] = await db.insert(employmentApplicants).values({
        orgId, firstName, lastName, email, phone: phone ?? null, roleAppliedFor: roleAppliedFor ?? null,
        experienceLevel: experienceLevel ?? null, certifications: certifications ?? null,
        location: location ?? null, source: source ?? null, notes: notes ?? null, resumeUrl: resumeUrl ?? null,
      }).returning();
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to create applicant" });
    }
  });

  app.patch("/api/employment-applicants/:id", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const allowed = ["firstName", "lastName", "email", "phone", "roleAppliedFor", "experienceLevel", "certifications", "location", "source", "status", "notes", "resumeUrl"] as const;
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      const [row] = await db.update(employmentApplicants).set(updates)
        .where(and(eq(employmentApplicants.id, id), eq(employmentApplicants.orgId, orgId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Applicant not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update applicant" });
    }
  });

  app.delete("/api/employment-applicants/:id", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      await db.delete(employmentApplicants)
        .where(and(eq(employmentApplicants.id, id), eq(employmentApplicants.orgId, orgId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to delete applicant" });
    }
  });

  // ─── GET /api/outcomes/autonomy-readiness/:domain — outcome-aware autonomy ─
  app.get("/api/outcomes/autonomy-readiness/:domain", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { domain } = req.params;
      const { getOutcomeAutonomyReadiness } = await import("./services/outcome-intelligence-service");
      const data = await getOutcomeAutonomyReadiness(orgId, domain);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to get autonomy readiness" });
    }
  });
}
