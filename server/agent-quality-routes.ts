/**
 * Agent Quality Routes
 * Surfaces per-agent trust scores, tier assignments, manual overrides,
 * and CEO Heartbeat risk signals.
 *
 * All routes: isAuthenticated + requireRole("ADMIN","COACH")
 */

import type { Express } from "express";
import { resolveOrgIdOrThrow } from "./lib/resolve-org-id";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  computeAgentQualityScores,
  getAgentQualityReport,
  getAgentWindowScores,
  getAgentQualityRisks,
  getTrustTierForAgent,
  TRUST_TIERS,
} from "./services/agent-quality-service";

async function getOrgId(req: any): Promise<string> {
  // Trusted server-side org resolution ONLY — never from client query/body/params.
  // Throws OrgResolutionError (converted to 403 by orgErrorMiddleware) when the
  // org cannot be determined from the authenticated session — fail closed.
  return await resolveOrgIdOrThrow(req);
}

export async function registerAgentQualityRoutes(
  app: Express,
  isAuthenticated: any,
  requireRole: any,
): Promise<void> {

  const guard = [isAuthenticated, requireRole("ADMIN", "COACH")];

  // ── GET /api/admin/agent-quality/scores ──────────────────────────────────
  // 30-day aggregate scores for all agents in this org.
  app.get("/api/admin/agent-quality/scores", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const report = await getAgentQualityReport(orgId);
      res.json(report);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── GET /api/admin/agent-quality/scores/:agentName ───────────────────────
  // All windows + domains for one agent.
  app.get("/api/admin/agent-quality/scores/:agentName", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const scores = await getAgentWindowScores(orgId, req.params.agentName);
      res.json(scores);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── POST /api/admin/agent-quality/compute ────────────────────────────────
  // Trigger a full recompute for this org.
  app.post("/api/admin/agent-quality/compute", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const result = await computeAgentQualityScores(orgId);
      res.json({ ok: true, ...result });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── GET /api/admin/agent-quality/risks ───────────────────────────────────
  // CEO Heartbeat risk signals.
  app.get("/api/admin/agent-quality/risks", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      res.json(await getAgentQualityRisks(orgId));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── GET /api/admin/agent-quality/tiers ───────────────────────────────────
  // Effective trust tier for every known agent.
  app.get("/api/admin/agent-quality/tiers", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const report = await getAgentQualityReport(orgId);
      res.json(report.map((r) => ({
        agentName:     r.agent_name,
        effectiveTier: r.effectiveTier,
        qualityScore:  r.quality_score,
        requiresApproval: r.effectiveTier !== "high_trust",
        isAutoEligible:   r.effectiveTier === "high_trust",
        hasOverride:   r.hasOverride,
      })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── POST /api/admin/agent-quality/overrides ──────────────────────────────
  // Set a manual trust tier override for an agent.
  app.post("/api/admin/agent-quality/overrides", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const { agentName, communicationDomain = "all", overrideTier, reason } = req.body;
      if (!agentName || !overrideTier) return res.status(400).json({ message: "agentName and overrideTier required" });
      if (!TRUST_TIERS.includes(overrideTier)) return res.status(400).json({ message: `Invalid tier. Must be one of: ${TRUST_TIERS.join(", ")}` });
      const actor = req.user?.claims?.email ?? req.user?.email ?? "admin";

      await db.execute(sql`
        INSERT INTO agent_trust_overrides (id, org_id, agent_name, communication_domain, override_tier, reason, overridden_by)
        VALUES (gen_random_uuid()::text, ${orgId}, ${agentName}, ${communicationDomain}, ${overrideTier}, ${reason ?? null}, ${actor})
        ON CONFLICT (org_id, agent_name, communication_domain)
        DO UPDATE SET override_tier = EXCLUDED.override_tier,
                      reason = EXCLUDED.reason,
                      overridden_by = EXCLUDED.overridden_by,
                      created_at = NOW()
      `);
      res.json({ ok: true, agentName, overrideTier, communicationDomain });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── DELETE /api/admin/agent-quality/overrides/:agentName ─────────────────
  // Remove a manual override — computed tier takes effect again.
  app.delete("/api/admin/agent-quality/overrides/:agentName", ...guard, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });
      const { communicationDomain = "all" } = req.query as Record<string, string>;
      await db.execute(sql`
        DELETE FROM agent_trust_overrides
        WHERE org_id = ${orgId}
          AND agent_name = ${req.params.agentName}
          AND communication_domain = ${communicationDomain}
      `);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  console.log("[AgentQuality] Routes registered");
}
