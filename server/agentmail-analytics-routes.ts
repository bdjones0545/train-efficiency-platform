/**
 * AgentMail Analytics Routes
 * Provides performance metrics for the AgentMail Learning system.
 */

import type { Express } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { sql as drizzleSql } from "drizzle-orm";

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

async function ensureRuleApplicationsTable() {
  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS agentmail_rule_applications (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id text NOT NULL,
      action_id text NOT NULL,
      rule_source text NOT NULL,
      rule_id text NOT NULL,
      communication_domain text NOT NULL,
      applied_at timestamp DEFAULT now()
    )
  `);
  // Idempotency index — ON CONFLICT DO NOTHING relies on this
  await db.execute(drizzleSql`
    CREATE UNIQUE INDEX IF NOT EXISTS agentmail_rule_apps_dedup
      ON agentmail_rule_applications (action_id, rule_source, rule_id)
  `);
}

export function registerAgentmailAnalyticsRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): void {
  ensureRuleApplicationsTable().catch((e) => console.error("[agentmail-analytics] table init error:", e));

  // ─── Summary ───────────────────────────────────────────────────────────────
  app.get("/api/admin/agentmail-analytics/summary", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const range = (req.query.range as string) || "7d";
      const domain = (req.query.domain as string) || undefined;
      const { getAgentmailSummary } = await import("./services/agentmail-analytics-service");
      const data = await getAgentmailSummary(orgId, range, domain);
      res.json(data);
    } catch (e: any) {
      console.error("[agentmail-analytics] summary error:", e);
      res.status(500).json({ message: "Failed to load analytics summary" });
    }
  });

  // ─── Rule Performance ──────────────────────────────────────────────────────
  app.get("/api/admin/agentmail-analytics/rules", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getAgentmailRulePerformance } = await import("./services/agentmail-analytics-service");
      const data = await getAgentmailRulePerformance(orgId);
      res.json(data);
    } catch (e: any) {
      console.error("[agentmail-analytics] rules error:", e);
      res.status(500).json({ message: "Failed to load rule performance" });
    }
  });

  // ─── Feedback Analytics ────────────────────────────────────────────────────
  app.get("/api/admin/agentmail-analytics/feedback", isAuthenticated, requireRole("ADMIN", "COACH"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const range = (req.query.range as string) || "30d";
      const { getAgentmailFeedbackAnalytics } = await import("./services/agentmail-analytics-service");
      const data = await getAgentmailFeedbackAnalytics(orgId, range);
      res.json(data);
    } catch (e: any) {
      console.error("[agentmail-analytics] feedback error:", e);
      res.status(500).json({ message: "Failed to load feedback analytics" });
    }
  });

  // ─── Trigger attention items (admin only) ──────────────────────────────────
  app.post("/api/admin/agentmail-analytics/attention-items", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { generateAgentmailAttentionItems } = await import("./services/agentmail-analytics-service");
      await generateAgentmailAttentionItems(orgId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[agentmail-analytics] attention items error:", e);
      res.status(500).json({ message: "Failed to generate attention items" });
    }
  });

  console.log("[AgentmailAnalytics] Routes registered");
}
