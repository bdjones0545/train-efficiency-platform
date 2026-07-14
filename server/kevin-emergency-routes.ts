/**
 * Kevin Emergency Control Routes — Phase 6
 *
 * Emergency kill switches, capability management, intent monitoring,
 * and the full capability registry admin interface.
 *
 * Auth: isAuthenticated + requireKevinAccess (ADMIN role only)
 * Base: /api/admin/kevin/emergency + /api/admin/kevin/intents + /api/admin/kevin/registry
 */

import type { Express, Request, Response } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireKevinAccess } from "./middleware/require-kevin-access";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  activateGlobalKill,
  deactivateGlobalKill,
  isGlobalKillActive,
  setOrgKill,
  setCapabilityKill,
  getEmergencyStatus,
} from "./services/kevin-policy-engine";
import {
  logKevinEmergency,
  getObservabilitySnapshot,
  getAlertThresholds,
} from "./services/kevin-observability-service";
import {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  serializeCapability,
  listCapabilityKeys,
  listCapabilitiesByCategory,
  getCapabilityCategories,
} from "./services/kevin-capability-registry";
import {
  listIntents,
  getIntentById,
  cancelIntent,
  getIntentStats,
} from "./services/kevin-intent-service";
import { getTasksForIntent } from "./services/kevin-task-bus";
import { listKevinDrafts } from "./services/kevin-agentmail-bridge";
import { recordKevinAuditEvent } from "./services/kevin-audit-service";

function extractRows(result: unknown): any[] {
  return Array.isArray((result as any)?.rows)
    ? (result as any).rows
    : Array.isArray(result)
      ? (result as any[])
      : [];
}

async function resolveOrgId(req: any): Promise<string | null> {
  const direct = req.user?.claims?.orgId ?? req.user?.organizationId;
  if (direct) return String(direct);
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  try {
    const result = await db.execute(sql`
      SELECT organization_id FROM user_profiles WHERE user_id = ${userId} LIMIT 1
    `);
    const rows = extractRows(result);
    return rows[0]?.organization_id ? String(rows[0].organization_id) : null;
  } catch {
    return null;
  }
}

export function registerKevinEmergencyRoutes(app: Express): void {
  const auth = [isAuthenticated, requireKevinAccess] as any[];

  // ── Emergency status ─────────────────────────────────────────────────────

  app.get("/api/admin/kevin/emergency/status", ...auth, (_req: Request, res: Response) => {
    res.json(getEmergencyStatus());
  });

  /**
   * POST /api/admin/kevin/emergency/global-kill
   * Immediately disable all Kevin actions org-wide.
   * { active: true | false }
   */
  app.post("/api/admin/kevin/emergency/global-kill", ...auth, async (req: any, res: Response) => {
    const { active } = req.body ?? {};
    if (typeof active !== "boolean") {
      return res.status(400).json({ message: "active (boolean) required" });
    }
    if (active) {
      activateGlobalKill();
    } else {
      deactivateGlobalKill();
    }

    const orgId = await resolveOrgId(req);
    void recordKevinAuditEvent({
      orgId: orgId ?? "platform",
      userId: req.user?.claims?.sub ?? req.user?.id ?? null,
      eventType: active ? "emergency.global_kill_activated" : "emergency.global_kill_deactivated",
      payload: { activatedBy: req.user?.claims?.sub ?? "admin" },
    });

    res.json({ ok: true, globalKill: active, status: getEmergencyStatus() });
  });

  /**
   * POST /api/admin/kevin/emergency/org-kill
   * Suspend Kevin for a specific organization.
   * { org_id, active }
   */
  app.post("/api/admin/kevin/emergency/org-kill", ...auth, async (req: any, res: Response) => {
    const { org_id, active } = req.body ?? {};
    if (!org_id || typeof active !== "boolean") {
      return res.status(400).json({ message: "org_id and active (boolean) required" });
    }
    setOrgKill(org_id, active);

    void recordKevinAuditEvent({
      orgId: org_id,
      userId: req.user?.claims?.sub ?? req.user?.id ?? null,
      eventType: active ? "emergency.org_kill_set" : "emergency.org_kill_cleared",
      payload: { targetOrgId: org_id },
    });

    res.json({ ok: true, orgId: org_id, active, status: getEmergencyStatus() });
  });

  /**
   * POST /api/admin/kevin/emergency/capability-kill
   * Suspend a specific capability globally.
   * { capability_key, active }
   */
  app.post("/api/admin/kevin/emergency/capability-kill", ...auth, async (req: any, res: Response) => {
    const { capability_key, active } = req.body ?? {};
    if (!capability_key || typeof active !== "boolean") {
      return res.status(400).json({ message: "capability_key and active (boolean) required" });
    }
    setCapabilityKill(capability_key, active);

    const orgId = await resolveOrgId(req);
    void recordKevinAuditEvent({
      orgId: orgId ?? "platform",
      userId: req.user?.claims?.sub ?? req.user?.id ?? null,
      eventType: active ? "emergency.capability_kill_set" : "emergency.capability_kill_cleared",
      payload: { capabilityKey: capability_key },
    });

    res.json({ ok: true, capabilityKey: capability_key, active, status: getEmergencyStatus() });
  });

  // ── Capability registry ──────────────────────────────────────────────────

  /**
   * GET /api/admin/kevin/registry
   * Full capability registry with optional category filter.
   */
  app.get("/api/admin/kevin/registry", ...auth, (req: Request, res: Response) => {
    const category = req.query.category as string | undefined;
    const keys = listCapabilityKeys();
    const emergencyStatus = getEmergencyStatus();

    const capabilities = keys
      .map((k) => getCapabilityDefinition(k)!)
      .filter((d) => !category || d.category === category)
      .map((d) => ({
        ...serializeCapability(d),
        isKilled: emergencyStatus.capabilityKills.includes(d.key),
      }));

    res.json({
      capabilities,
      total: capabilities.length,
      categories: getCapabilityCategories(),
      emergencyStatus,
    });
  });

  /**
   * GET /api/admin/kevin/registry/:key
   */
  app.get("/api/admin/kevin/registry/:key", ...auth, (req: Request, res: Response) => {
    const cap = getCapabilityDefinition(req.params.key);
    if (!cap) return res.status(404).json({ message: "Capability not found" });
    const emergencyStatus = getEmergencyStatus();
    return res.json({
      ...serializeCapability(cap),
      isKilled: emergencyStatus.capabilityKills.includes(cap.key),
    });
  });

  // ── Intent management ────────────────────────────────────────────────────

  /**
   * GET /api/admin/kevin/intents
   */
  app.get("/api/admin/kevin/intents", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const state = req.query.state as string | undefined;
    const capabilityKey = req.query.capability as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const intents = await listIntents(orgId, {
      state: state as any,
      capabilityKey,
      limit,
      offset,
    });
    const stats = await getIntentStats(orgId);
    return res.json({ intents, stats, limit, offset });
  });

  /**
   * GET /api/admin/kevin/intents/:id
   */
  app.get("/api/admin/kevin/intents/:id", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const intent = await getIntentById(req.params.id, orgId);
    if (!intent) return res.status(404).json({ message: "Intent not found" });

    const tasks = await getTasksForIntent(intent.id);
    return res.json({ intent, tasks });
  });

  /**
   * POST /api/admin/kevin/intents/:id/cancel
   */
  app.post("/api/admin/kevin/intents/:id/cancel", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const reason = String(req.body?.reason ?? "Cancelled by administrator").slice(0, 500);
    const ok = await cancelIntent(req.params.id, orgId, reason);
    if (!ok) return res.status(404).json({ message: "Intent not found or already terminal" });
    return res.json({ ok: true, intentId: req.params.id });
  });

  /**
   * GET /api/admin/kevin/intents/stats
   */
  app.get("/api/admin/kevin/intent-stats", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });
    const stats = await getIntentStats(orgId);
    return res.json(stats);
  });

  // ── Approval management ──────────────────────────────────────────────────

  /**
   * GET /api/admin/kevin/exec-approvals
   */
  app.get("/api/admin/kevin/exec-approvals", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const status = req.query.status as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    try {
      const result = await db.execute(sql`
        SELECT id, capability_key, action_summary, action_reason, risk_level,
               is_reversible, status, producer_agent, kevin_confidence,
               decided_by, decided_at, created_at, expires_at, intent_id
        FROM kevin_exec_approvals
        WHERE org_id = ${orgId}
          ${status ? sql`AND status = ${status}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
      const approvals = extractRows(result);
      return res.json({ approvals, total: approvals.length });
    } catch {
      return res.json({ approvals: [], total: 0 });
    }
  });

  /**
   * POST /api/admin/kevin/exec-approvals/:id/decide
   * { decision: 'approved' | 'rejected', notes }
   */
  app.post("/api/admin/kevin/exec-approvals/:id/decide", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const { decision, notes } = req.body ?? {};
    if (!["approved", "rejected", "changes_requested"].includes(decision)) {
      return res.status(400).json({ message: "decision must be approved, rejected, or changes_requested" });
    }

    const userId = req.user?.claims?.sub ?? req.user?.id;

    try {
      await db.execute(sql`
        UPDATE kevin_exec_approvals
        SET status = ${decision},
            decided_by = ${userId ?? "admin"},
            decided_at = NOW(),
            decision_notes = ${notes ? String(notes).slice(0, 500) : null},
            updated_at = NOW()
        WHERE id = ${req.params.id} AND org_id = ${orgId}
          AND status = 'pending'
      `);

      void recordKevinAuditEvent({
        orgId,
        userId,
        eventType: `exec_approval.${decision}`,
        payload: { approvalId: req.params.id, decision, notes: notes?.slice?.(0, 200) ?? null },
      });

      return res.json({ ok: true, approvalId: req.params.id, decision });
    } catch (e: any) {
      return res.status(500).json({ message: e?.message ?? "Decision failed" });
    }
  });

  // ── AgentMail bridge monitoring ──────────────────────────────────────────

  /**
   * GET /api/admin/kevin/agentmail-drafts
   */
  app.get("/api/admin/kevin/agentmail-drafts", ...auth, async (req: any, res: Response) => {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const drafts = await listKevinDrafts(orgId, Number(req.query.limit ?? 20));
    return res.json({ drafts });
  });

  // ── Policy engine status ─────────────────────────────────────────────────

  /**
   * GET /api/admin/kevin/policy-status
   * Returns kill switch status + rate limit windows + circuit breaker state.
   */
  app.get("/api/admin/kevin/policy-status", ...auth, async (req: any, res: Response) => {
    const { getCircuitState } = await import("./services/kevin-circuit-breaker");
    const emergencyStatus = getEmergencyStatus();
    const circuitState = getCircuitState();

    const orgId = await resolveOrgId(req);
    let recentIntents = 0;
    if (orgId) {
      try {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count FROM kevin_intents
          WHERE org_id = ${orgId} AND created_at > NOW() - INTERVAL '1 minute'
        `);
        recentIntents = Number(extractRows(result)[0]?.count ?? 0);
      } catch {}
    }

    return res.json({
      emergencyStatus,
      circuitState,
      recentIntentCount: recentIntents,
      policyChecks: [
        "identity", "org_existence", "emergency_kill", "circuit_breaker",
        "capability_exists", "capability_mode", "org_status", "user_role",
        "resource_ownership", "rate_limit", "idempotency", "mode_selection",
        "mode_supported", "approval_check", "decision",
      ],
    });
  });

  // ── Org Capability Settings (Phase 3) ──────────────────────────────────────

  /**
   * GET /api/admin/kevin/org-capability-settings
   * List all capability settings for the current org (or all orgs for superadmin).
   */
  app.get("/api/admin/kevin/org-capability-settings", isAuthenticated, requireKevinAccess, async (req: Request, res: Response) => {
    try {
      const orgId = req.query.org_id ? String(req.query.org_id) : null;
      const rows = orgId
        ? extractRows(await db.execute(sql`
            SELECT * FROM kevin_org_capability_settings
            WHERE org_id = ${orgId}
            ORDER BY capability_key
          `))
        : extractRows(await db.execute(sql`
            SELECT * FROM kevin_org_capability_settings
            ORDER BY org_id, capability_key
          `));
      return res.json({ settings: rows, total: rows.length });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fetch org settings", error: err.message });
    }
  });

  /**
   * PUT /api/admin/kevin/org-capability-settings/:capabilityKey
   * Upsert a capability setting for an org.
   */
  app.put("/api/admin/kevin/org-capability-settings/:capabilityKey", isAuthenticated, requireKevinAccess, async (req: Request, res: Response) => {
    const capabilityKey = req.params.capabilityKey;
    const body = req.body ?? {};
    const orgId = String(body.org_id ?? "");
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const executionMode = String(body.execution_mode ?? "require_approval");
    const enabled = body.enabled !== false;
    const maxVolumePerHour = Number(body.max_volume_per_hour ?? 10);
    const approvalPolicy = String(body.approval_policy ?? "always");
    const allowedScope = String(body.allowed_scope ?? "org");

    try {
      await db.execute(sql`
        INSERT INTO kevin_org_capability_settings
          (org_id, capability_key, enabled, execution_mode, max_volume_per_hour,
           approval_policy, allowed_scope, configured_by, updated_at)
        VALUES
          (${orgId}, ${capabilityKey}, ${enabled}, ${executionMode}, ${maxVolumePerHour},
           ${approvalPolicy}, ${allowedScope}, ${"admin"}, NOW())
        ON CONFLICT (org_id, capability_key) DO UPDATE SET
          enabled              = EXCLUDED.enabled,
          execution_mode       = EXCLUDED.execution_mode,
          max_volume_per_hour  = EXCLUDED.max_volume_per_hour,
          approval_policy      = EXCLUDED.approval_policy,
          allowed_scope        = EXCLUDED.allowed_scope,
          configured_by        = EXCLUDED.configured_by,
          updated_at           = NOW()
      `);
      return res.json({ ok: true, orgId, capabilityKey, executionMode, enabled });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to update setting", error: err.message });
    }
  });

  /**
   * POST /api/admin/kevin/org-capability-settings/seed-defaults
   * Seed default capability settings for an org using Phase 3 safe defaults.
   */
  app.post("/api/admin/kevin/org-capability-settings/seed-defaults", isAuthenticated, requireKevinAccess, async (req: Request, res: Response) => {
    const orgId = String(req.body?.org_id ?? "");
    if (!orgId) return res.status(400).json({ message: "org_id required" });

    const defaults: Array<{ key: string; mode: string }> = [
      { key: "platform.retrieve_context",  mode: "observe" },
      { key: "platform.open_location",     mode: "auto" },
      { key: "ceo.request_analysis",       mode: "recommend" },
      { key: "ceo.request_briefing",       mode: "recommend" },
      { key: "ceo.ask_question",           mode: "recommend" },
      { key: "agent.request_analysis",     mode: "recommend" },
      { key: "agent.request_recommendation", mode: "recommend" },
      { key: "email.create_draft",         mode: "draft" },
      { key: "email.create_reply_draft",   mode: "draft" },
      { key: "email.submit_for_approval",  mode: "draft" },
      { key: "email.request_revision",     mode: "draft" },
      { key: "agent.assign_task",          mode: "require_approval" },
      { key: "email.send",                 mode: "require_approval" },
      { key: "schedule.create_session",    mode: "require_approval" },
      { key: "schedule.reschedule_session", mode: "require_approval" },
      { key: "lead.create",               mode: "require_approval" },
      { key: "lead.update",               mode: "require_approval" },
      { key: "schedule.cancel_session",    mode: "disabled" },
      { key: "agent.pause_task",           mode: "disabled" },
      { key: "agent.cancel_task",          mode: "disabled" },
      { key: "campaign.request_launch",    mode: "disabled" },
    ];

    let seeded = 0;
    for (const d of defaults) {
      try {
        await db.execute(sql`
          INSERT INTO kevin_org_capability_settings (org_id, capability_key, execution_mode, enabled)
          VALUES (${orgId}, ${d.key}, ${d.mode}, ${d.mode !== "disabled"})
          ON CONFLICT (org_id, capability_key) DO NOTHING
        `);
        seeded++;
      } catch { /* skip */ }
    }
    return res.json({ ok: true, orgId, seeded, total: defaults.length });
  });

  // ── Observability Snapshot (Phase 17) ─────────────────────────────────────

  /**
   * GET /api/admin/kevin/observability
   */
  app.get("/api/admin/kevin/observability", isAuthenticated, requireKevinAccess, (_req: Request, res: Response) => {
    return res.json({
      snapshot: getObservabilitySnapshot(),
      alertThresholds: getAlertThresholds(),
      note: "Rolling in-memory counters reset on server restart",
    });
  });
}
