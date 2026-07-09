/**
 * AgentMail Learning Center Routes
 * Manages learned rules (inferred from feedback) and coach-authored standing instructions.
 * All reads/writes are scoped to the authenticated organization.
 */

import type { Express } from "express";
import { db } from "./db";
import { eq, and, desc, sql as drizzleSql } from "drizzle-orm";

async function getOrgId(req: any): Promise<string | null> {
  try {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return null;
    const { userProfiles } = await import("@shared/schema");
    const [profile] = await db.select({ orgId: userProfiles.organizationId })
      .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return profile?.orgId ?? null;
  } catch {
    return null;
  }
}

async function ensureTable() {
  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS agent_draft_coaching_rules (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id text NOT NULL,
      communication_domain text NOT NULL DEFAULT 'general',
      rule_type text NOT NULL DEFAULT 'instruction',
      rule_text text NOT NULL,
      authored_by text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `);
}

export function registerAgentmailLearningRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): void {
  ensureTable().catch((e) => console.error("[agentmail-learning] table init error:", e));

  // ─── GET summary metrics ────────────────────────────────────────────────────
  app.get("/api/admin/agentmail-learning/summary", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });

      const { agentMessageLearningRules, agentMessageFeedback, agentDraftCoachingRules } = await import("@shared/schema");

      const [rules, coaching, feedback] = await Promise.all([
        db.select().from(agentMessageLearningRules).where(eq(agentMessageLearningRules.orgId, orgId)),
        db.select().from(agentDraftCoachingRules).where(eq(agentDraftCoachingRules.orgId, orgId)),
        db.select({
          communicationDomain: agentMessageFeedback.communicationDomain,
          feedbackTags: agentMessageFeedback.feedbackTags,
          decision: agentMessageFeedback.decision,
        }).from(agentMessageFeedback).where(eq(agentMessageFeedback.orgId, orgId)),
      ]);

      const activeRules = rules.filter((r) => r.status === "active");
      const inactiveRules = rules.filter((r) => r.status !== "active");
      const activeCoaching = coaching.filter((c) => c.isActive);

      const domainRuleCounts: Record<string, number> = {};
      activeRules.forEach((r) => {
        const d = r.communicationDomain ?? "athlete_lead";
        domainRuleCounts[d] = (domainRuleCounts[d] ?? 0) + 1;
      });

      const domainFeedback: Record<string, number> = {};
      feedback.forEach((f) => {
        if (f.decision === "rejected" || f.decision === "edited_and_approved") {
          const d = (f as any).communicationDomain ?? "athlete_lead";
          domainFeedback[d] = (domainFeedback[d] ?? 0) + 1;
        }
      });
      const mostCorrectedDomain = Object.entries(domainFeedback).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const tagCounts: Record<string, number> = {};
      feedback.forEach((f) => {
        const tags = (f.feedbackTags as string[] | null) ?? [];
        tags.forEach((t) => { tagCounts[t] = (tagCounts[t] ?? 0) + 1; });
      });
      const mostCommonTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      res.json({
        totalActiveRules: activeRules.length + activeCoaching.length,
        learnedRules: activeRules.length,
        standingInstructions: activeCoaching.length,
        disabledRules: inactiveRules.length + coaching.filter((c) => !c.isActive).length,
        domainsWithRules: Object.keys(domainRuleCounts).length,
        mostCorrectedDomain,
        mostCommonFeedbackTag: mostCommonTag,
        domainBreakdown: domainRuleCounts,
        totalFeedbackRecords: feedback.length,
      });
    } catch (e: any) {
      console.error("[agentmail-learning] summary error:", e);
      res.status(500).json({ message: "Failed to load summary" });
    }
  });

  // ─── GET context for a domain ───────────────────────────────────────────────
  app.get("/api/admin/agentmail-learning/context", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const domain = (req.query.domain as string) || "athlete_lead";

      const { agentMessageLearningRules, agentDraftCoachingRules } = await import("@shared/schema");

      const [learnedRules, coachingRules] = await Promise.all([
        db.select().from(agentMessageLearningRules)
          .where(and(eq(agentMessageLearningRules.orgId, orgId), eq(agentMessageLearningRules.status, "active")))
          .orderBy(desc(agentMessageLearningRules.confidence)),
        db.select().from(agentDraftCoachingRules)
          .where(and(eq(agentDraftCoachingRules.orgId, orgId), eq(agentDraftCoachingRules.isActive, true)))
          .orderBy(agentDraftCoachingRules.createdAt),
      ]);

      const domainLearned = learnedRules.filter(
        (r) => r.communicationDomain === domain || r.appliesGlobally
      );
      const domainCoaching = coachingRules.filter(
        (r) => r.communicationDomain === domain || r.communicationDomain === "general"
      );

      res.json({
        domain,
        standingInstructions: domainCoaching,
        learnedRules: domainLearned,
        totalRules: domainCoaching.length + domainLearned.length,
      });
    } catch (e: any) {
      console.error("[agentmail-learning] context error:", e);
      res.status(500).json({ message: "Failed to load context" });
    }
  });

  // ─── GET learned rules ──────────────────────────────────────────────────────
  app.get("/api/admin/agentmail-learning/rules", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      // Return enriched rules with performance labels (Phase F)
      try {
        const { getAgentmailRulePerformance } = await import("./services/agentmail-analytics-service");
        const perf = await getAgentmailRulePerformance(orgId);
        // Merge DB fields with performance metadata
        const { agentMessageLearningRules } = await import("@shared/schema");
        const dbRules = await db.select().from(agentMessageLearningRules)
          .where(eq(agentMessageLearningRules.orgId, orgId))
          .orderBy(desc(agentMessageLearningRules.createdAt));
        const perfMap = new Map(perf.learnedRules.map((r: any) => [r.ruleId, r]));
        const enriched = dbRules.map((r) => ({ ...r, ...((perfMap.get(r.id) as any) ?? {}) }));
        return res.json(enriched);
      } catch {
        // Fall back to raw DB query
        const { agentMessageLearningRules } = await import("@shared/schema");
        const rules = await db.select().from(agentMessageLearningRules)
          .where(eq(agentMessageLearningRules.orgId, orgId))
          .orderBy(desc(agentMessageLearningRules.createdAt));
        return res.json(rules);
      }
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch rules" });
    }
  });

  // ─── PATCH learned rule ─────────────────────────────────────────────────────
  app.patch("/api/admin/agentmail-learning/rules/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { status, ruleText, appliesGlobally } = req.body ?? {};
      const { agentMessageLearningRules } = await import("@shared/schema");
      const updates: Record<string, any> = {};
      if (status !== undefined) updates.status = status;
      if (ruleText !== undefined) updates.ruleText = String(ruleText).slice(0, 500);
      if (appliesGlobally !== undefined) updates.appliesGlobally = Boolean(appliesGlobally);
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "No fields to update" });
      await db.update(agentMessageLearningRules).set(updates)
        .where(and(eq(agentMessageLearningRules.id, id), eq(agentMessageLearningRules.orgId, orgId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update rule" });
    }
  });

  // ─── DELETE (archive) learned rule ─────────────────────────────────────────
  app.delete("/api/admin/agentmail-learning/rules/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { agentMessageLearningRules } = await import("@shared/schema");
      await db.update(agentMessageLearningRules).set({ status: "archived" })
        .where(and(eq(agentMessageLearningRules.id, id), eq(agentMessageLearningRules.orgId, orgId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to archive rule" });
    }
  });

  // ─── GET standing instructions ──────────────────────────────────────────────
  app.get("/api/admin/agentmail-learning/instructions", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { agentDraftCoachingRules } = await import("@shared/schema");
      const instructions = await db.select().from(agentDraftCoachingRules)
        .where(eq(agentDraftCoachingRules.orgId, orgId))
        .orderBy(desc(agentDraftCoachingRules.createdAt));
      res.json(instructions);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch instructions" });
    }
  });

  // ─── POST create standing instruction ──────────────────────────────────────
  app.post("/api/admin/agentmail-learning/instructions", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const { communicationDomain, ruleType, ruleText } = req.body ?? {};
      if (!ruleText?.trim()) return res.status(400).json({ message: "ruleText is required" });
      const { agentDraftCoachingRules } = await import("@shared/schema");
      const [created] = await db.insert(agentDraftCoachingRules).values({
        orgId,
        communicationDomain: communicationDomain ?? "general",
        ruleType: ruleType ?? "instruction",
        ruleText: String(ruleText).trim().slice(0, 500),
        authoredBy: userId ?? "admin",
        isActive: true,
      }).returning();
      res.json(created);
    } catch (e: any) {
      console.error("[agentmail-learning] create instruction error:", e);
      res.status(500).json({ message: "Failed to create instruction" });
    }
  });

  // ─── PATCH standing instruction ─────────────────────────────────────────────
  app.patch("/api/admin/agentmail-learning/instructions/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { isActive, ruleText, communicationDomain, ruleType } = req.body ?? {};
      const { agentDraftCoachingRules } = await import("@shared/schema");
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (isActive !== undefined) updates.isActive = Boolean(isActive);
      if (ruleText !== undefined) updates.ruleText = String(ruleText).trim().slice(0, 500);
      if (communicationDomain !== undefined) updates.communicationDomain = communicationDomain;
      if (ruleType !== undefined) updates.ruleType = ruleType;
      await db.update(agentDraftCoachingRules).set(updates as any)
        .where(and(eq(agentDraftCoachingRules.id, id), eq(agentDraftCoachingRules.orgId, orgId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update instruction" });
    }
  });

  // ─── DELETE (soft-archive) standing instruction ─────────────────────────────
  app.delete("/api/admin/agentmail-learning/instructions/:id", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { id } = req.params;
      const { agentDraftCoachingRules } = await import("@shared/schema");
      await db.update(agentDraftCoachingRules).set({ isActive: false, updatedAt: new Date() } as any)
        .where(and(eq(agentDraftCoachingRules.id, id), eq(agentDraftCoachingRules.orgId, orgId)));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to delete instruction" });
    }
  });

  // ─── GET prior contact context for a recipient ─────────────────────────────
  app.get("/api/admin/agentmail-learning/prior-contact", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const email = String(req.query.email ?? "").trim();
      if (!email) return res.status(400).json({ message: "email required" });
      const { getPriorContactContext } = await import("./services/agentmail-prior-contact-context-service");
      const ctx = await getPriorContactContext({ orgId, recipientEmail: email });
      res.json(ctx);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch prior contact context" });
    }
  });

  // ─── GET prior context analytics ────────────────────────────────────────────
  app.get("/api/admin/agentmail-learning/prior-context-analytics", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getAgentmailPriorContextAnalytics } = await import("./services/agentmail-prior-contact-context-service");
      const analytics = await getAgentmailPriorContextAnalytics(orgId);
      res.json(analytics);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch prior context analytics" });
    }
  });

  console.log("[AgentmailLearning] Routes registered");
}
