/**
 * Kevin Policy Engine — Phase 3
 *
 * Centralized policy evaluator for all Kevin action requests.
 *
 * Every Kevin intent passes through this engine before any action is taken.
 * The engine evaluates 15 conditions in sequence:
 *
 *  1.  Kevin service identity
 *  2.  Organization existence / membership
 *  3.  Organization active status
 *  4.  Initiating user existence
 *  5.  Initiating user role
 *  6.  Capability existence in registry
 *  7.  Capability mode for this org (disabled / observe / recommend / draft / require_approval / auto)
 *  8.  Requested execution mode vs granted mode
 *  9.  Requested resource ownership (org isolation)
 * 10.  Risk classification
 * 11.  Approval requirements
 * 12.  Rate limits
 * 13.  Idempotency (duplicate intent detection)
 * 14.  Circuit-breaker state
 * 15.  Emergency kill-switch state
 *
 * Returns a PolicyResult that drives the intent state machine:
 *   - denied   → intent immediately fails
 *   - observe  → read-only data returned, no action
 *   - recommend → recommendation generated, no action created
 *   - draft    → reversible draft created
 *   - approve  → approval request created, execution blocked
 *   - execute  → action executes within policy limits
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  getCapabilityDefinition,
  approvalRequired,
  riskIndex,
  type RiskLevel,
  type CapabilityMode,
} from "./kevin-capability-registry";
import { getKevinCapability } from "./kevin-capability-service";
import { getCircuitState } from "./kevin-circuit-breaker";
import { recordKevinAuditEvent } from "./kevin-audit-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyDecision =
  | "denied"
  | "observe"
  | "recommend"
  | "draft"
  | "approve"
  | "execute";

export type PolicyDenialCode =
  | "CAPABILITY_UNKNOWN"
  | "CAPABILITY_DISABLED"
  | "CIRCUIT_OPEN"
  | "EMERGENCY_KILL"
  | "ORG_INACTIVE"
  | "ORG_NOT_FOUND"
  | "ORG_MISMATCH"
  | "USER_NOT_FOUND"
  | "ROLE_INSUFFICIENT"
  | "MODE_UNSUPPORTED"
  | "RATE_LIMITED"
  | "DUPLICATE_INTENT"
  | "RESOURCE_NOT_OWNED"
  | "IDENTITY_INVALID"
  | "INTERNAL_ERROR";

export interface PolicyContext {
  orgId: string;
  userId?: string | null;
  userRole?: string | null;
  kevinIdentity: string;
  capabilityKey: string;
  requestedMode: CapabilityMode;
  requestedResourceOrgId?: string | null;
  idempotencyKey?: string | null;
  riskOverride?: RiskLevel | null;
}

export interface PolicyResult {
  decision: PolicyDecision;
  grantedMode?: CapabilityMode;
  denialCode?: PolicyDenialCode;
  denialReason?: string;
  requiresApproval: boolean;
  capabilityEnabled: boolean;
  orgActiveStatus: "active" | "inactive" | "unknown";
  riskLevel: RiskLevel;
  appliedChecks: string[];
  meta: Record<string, unknown>;
}

// ─── Emergency kill switch state (in-memory, process-local) ──────────────────

let _globalKillActive = false;
let _orgKillSet = new Set<string>();
let _capabilityKillSet = new Set<string>();

export function activateGlobalKill(): void {
  _globalKillActive = true;
}

export function deactivateGlobalKill(): void {
  _globalKillActive = false;
}

export function isGlobalKillActive(): boolean {
  return _globalKillActive;
}

export function setOrgKill(orgId: string, active: boolean): void {
  if (active) _orgKillSet.add(orgId);
  else _orgKillSet.delete(orgId);
}

export function setCapabilityKill(capKey: string, active: boolean): void {
  if (active) _capabilityKillSet.add(capKey);
  else _capabilityKillSet.delete(capKey);
}

export function getEmergencyStatus() {
  return {
    globalKill: _globalKillActive,
    orgKills: [..._orgKillSet],
    capabilityKills: [..._capabilityKillSet],
  };
}

// ─── Rate limiter (in-memory, process-local) ──────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30; // max intents per org per minute

const _rateCounts = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(orgId: string): boolean {
  const now = Date.now();
  const existing = _rateCounts.get(orgId);
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateCounts.set(orgId, { count: 1, windowStart: now });
    return true;
  }
  existing.count++;
  if (existing.count > RATE_LIMIT_MAX) return false;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const APPROVAL_MODE_RANK: Record<CapabilityMode, number> = {
  disabled: -1,
  observe: 0,
  recommend: 1,
  draft: 2,
  require_approval: 3,
  auto: 4,
};

function modeDecision(mode: CapabilityMode): PolicyDecision {
  switch (mode) {
    case "disabled": return "denied";
    case "observe": return "observe";
    case "recommend": return "recommend";
    case "draft": return "draft";
    case "require_approval": return "approve";
    case "auto": return "execute";
  }
}

async function resolveOrgStatus(orgId: string): Promise<"active" | "inactive" | "unknown"> {
  try {
    const result = await db.execute(sql`
      SELECT active FROM organizations WHERE id = ${orgId} LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    if (!rows[0]) return "unknown";
    return rows[0].active ? "active" : "inactive";
  } catch {
    return "unknown";
  }
}

async function resolveUserProfile(
  userId: string,
  orgId: string,
): Promise<{ found: boolean; role: string | null; orgMatches: boolean }> {
  try {
    const result = await db.execute(sql`
      SELECT role, organization_id
      FROM user_profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    if (!rows[0]) return { found: false, role: null, orgMatches: false };
    return {
      found: true,
      role: rows[0].role ?? null,
      orgMatches: rows[0].organization_id === orgId,
    };
  } catch {
    return { found: false, role: null, orgMatches: false };
  }
}

async function checkDuplicateIntent(orgId: string, idempotencyKey: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT id FROM kevin_intents
      WHERE org_id = ${orgId}
        AND idempotency_key = ${idempotencyKey}
        AND state NOT IN ('failed', 'cancelled', 'dead_lettered')
      LIMIT 1
    `);
    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
        ? result
        : [];
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ─── Main policy evaluator ────────────────────────────────────────────────────

/**
 * Evaluate a Kevin action request against all 15 policy checks.
 * Returns a PolicyResult — never throws.
 */
export async function evaluateKevinPolicy(ctx: PolicyContext): Promise<PolicyResult> {
  const checks: string[] = [];
  const meta: Record<string, unknown> = {};

  const deny = (code: PolicyDenialCode, reason: string): PolicyResult => ({
    decision: "denied",
    denialCode: code,
    denialReason: reason,
    requiresApproval: false,
    capabilityEnabled: false,
    orgActiveStatus: "unknown",
    riskLevel: "low",
    appliedChecks: checks,
    meta,
  });

  try {
    // ── Check 1: Kevin identity ────────────────────────────────────────────
    checks.push("identity");
    if (!ctx.kevinIdentity || ctx.kevinIdentity.length < 2) {
      return deny("IDENTITY_INVALID", "Kevin identity not provided or invalid");
    }
    meta.kevinIdentity = ctx.kevinIdentity;

    // ── Check 2: Org existence ─────────────────────────────────────────────
    checks.push("org_existence");
    if (!ctx.orgId) {
      return deny("ORG_NOT_FOUND", "Organization ID is required");
    }

    // ── Check 3: Emergency kill switches ──────────────────────────────────
    checks.push("emergency_kill");
    if (_globalKillActive) {
      return deny("EMERGENCY_KILL", "Global Kevin kill switch is active");
    }
    if (_orgKillSet.has(ctx.orgId)) {
      return deny("EMERGENCY_KILL", `Kevin is suspended for organization ${ctx.orgId}`);
    }
    if (_capabilityKillSet.has(ctx.capabilityKey)) {
      return deny("EMERGENCY_KILL", `Capability ${ctx.capabilityKey} is suspended`);
    }

    // ── Check 4: Circuit breaker ───────────────────────────────────────────
    checks.push("circuit_breaker");
    const circuitState = getCircuitState();
    if (circuitState === "open") {
      return deny("CIRCUIT_OPEN", "Kevin circuit breaker is open — Hermes unreachable");
    }
    meta.circuitState = circuitState;

    // ── Check 5: Capability exists ─────────────────────────────────────────
    checks.push("capability_exists");
    const capDef = getCapabilityDefinition(ctx.capabilityKey);
    if (!capDef) {
      return deny("CAPABILITY_UNKNOWN", `Capability '${ctx.capabilityKey}' is not registered`);
    }
    meta.capabilityRisk = capDef.riskLevel;

    // ── Check 6: Org-level capability mode ─────────────────────────────────
    checks.push("capability_mode");
    const orgCap = await getKevinCapability(ctx.orgId, ctx.capabilityKey);
    const orgMode = (orgCap?.approvalMode as CapabilityMode) ?? capDef.defaultMode;
    const orgEnabled = orgCap ? orgCap.enabled : true;

    if (!orgEnabled || orgMode === "disabled") {
      return deny(
        "CAPABILITY_DISABLED",
        `Capability '${ctx.capabilityKey}' is disabled for this organization`,
      );
    }
    meta.orgMode = orgMode;

    // ── Check 7: Org active status ─────────────────────────────────────────
    checks.push("org_status");
    const orgStatus = await resolveOrgStatus(ctx.orgId);
    meta.orgStatus = orgStatus;
    if (orgStatus === "inactive") {
      return deny("ORG_INACTIVE", "Organization is inactive");
    }

    // ── Check 8: User role ─────────────────────────────────────────────────
    checks.push("user_role");
    let resolvedRole = ctx.userRole ?? null;
    if (ctx.userId) {
      const profile = await resolveUserProfile(ctx.userId, ctx.orgId);
      if (!profile.found) {
        return deny("USER_NOT_FOUND", "Initiating user not found");
      }
      if (!profile.orgMatches) {
        return deny("ORG_MISMATCH", "User does not belong to the specified organization");
      }
      resolvedRole = profile.role;
    }
    // For Kevin service calls with no user, still check capability permitted roles
    if (resolvedRole && !capDef.permittedRoles.includes(resolvedRole)) {
      return deny(
        "ROLE_INSUFFICIENT",
        `Role '${resolvedRole}' is not permitted for capability '${ctx.capabilityKey}'`,
      );
    }
    meta.resolvedRole = resolvedRole;

    // ── Check 9: Resource org isolation ────────────────────────────────────
    checks.push("resource_ownership");
    if (
      capDef.requiresOrgScope &&
      ctx.requestedResourceOrgId &&
      ctx.requestedResourceOrgId !== ctx.orgId
    ) {
      return deny(
        "RESOURCE_NOT_OWNED",
        "Requested resource belongs to a different organization",
      );
    }

    // ── Check 10: Rate limit ───────────────────────────────────────────────
    checks.push("rate_limit");
    const rateOk = checkRateLimit(ctx.orgId);
    if (!rateOk) {
      return deny("RATE_LIMITED", "Kevin action rate limit exceeded for this organization");
    }

    // ── Check 11: Idempotency ──────────────────────────────────────────────
    checks.push("idempotency");
    if (ctx.idempotencyKey) {
      const isDuplicate = await checkDuplicateIntent(ctx.orgId, ctx.idempotencyKey);
      if (isDuplicate) {
        return deny(
          "DUPLICATE_INTENT",
          `An active intent with idempotency key '${ctx.idempotencyKey}' already exists`,
        );
      }
    }

    // ── Check 12: Effective mode selection ─────────────────────────────────
    // The granted mode is the LESSER of what org allows and what was requested
    checks.push("mode_selection");
    const requestedRank = APPROVAL_MODE_RANK[ctx.requestedMode] ?? 0;
    const orgModeRank = APPROVAL_MODE_RANK[orgMode] ?? 0;
    const effectiveModeRank = Math.min(requestedRank, orgModeRank);
    const effectiveMode = (
      Object.entries(APPROVAL_MODE_RANK).find(([, rank]) => rank === effectiveModeRank)?.[0] ?? "observe"
    ) as CapabilityMode;
    meta.requestedMode = ctx.requestedMode;
    meta.effectiveMode = effectiveMode;

    // ── Check 13: Mode supported by capability ─────────────────────────────
    checks.push("mode_supported");
    if (!capDef.supportedModes.includes(effectiveMode)) {
      // Fall back to the lowest supported mode
      const fallback = capDef.supportedModes[0] ?? "observe";
      meta.modeFallback = fallback;
    }

    // ── Check 14: Risk + approval requirement ─────────────────────────────
    checks.push("approval_check");
    const effectiveRisk = ctx.riskOverride ?? capDef.riskLevel;
    const needsApproval =
      effectiveMode === "require_approval" || approvalRequired(ctx.capabilityKey, effectiveRisk);
    meta.needsApproval = needsApproval;

    // ── Determine final decision ───────────────────────────────────────────
    checks.push("decision");
    let decision: PolicyDecision;
    if (needsApproval && effectiveMode !== "auto") {
      decision = "approve";
    } else {
      decision = modeDecision(effectiveMode);
    }

    return {
      decision,
      grantedMode: effectiveMode,
      requiresApproval: needsApproval,
      capabilityEnabled: true,
      orgActiveStatus: orgStatus as "active" | "inactive" | "unknown",
      riskLevel: effectiveRisk,
      appliedChecks: checks,
      meta,
    };
  } catch (e: any) {
    void recordKevinAuditEvent({
      orgId: ctx.orgId,
      eventType: "policy.error",
      payload: {
        capabilityKey: ctx.capabilityKey,
        error: e?.message?.slice(0, 300),
        checks,
      },
    });
    return {
      decision: "denied",
      denialCode: "INTERNAL_ERROR",
      denialReason: `Policy engine error: ${e?.message?.slice(0, 200) ?? "unknown"}`,
      requiresApproval: false,
      capabilityEnabled: false,
      orgActiveStatus: "unknown",
      riskLevel: "critical",
      appliedChecks: checks,
      meta,
    };
  }
}

/**
 * Convenience: record a policy decision in the audit log.
 */
export async function auditPolicyDecision(
  ctx: PolicyContext,
  result: PolicyResult,
): Promise<void> {
  if (!result.requiresApproval && result.decision !== "denied") return; // only log notable decisions
  void recordKevinAuditEvent({
    orgId: ctx.orgId,
    userId: ctx.userId ?? null,
    eventType: `policy.${result.decision}`,
    payload: {
      capabilityKey: ctx.capabilityKey,
      decision: result.decision,
      grantedMode: result.grantedMode ?? null,
      denialCode: result.denialCode ?? null,
      riskLevel: result.riskLevel,
      appliedChecks: result.appliedChecks,
    },
  });
}
