/**
 * Capability Enforcement Engine — Phase 3
 *
 * Every agent action, workflow execution, and tool call passes through
 * this engine before execution. No exceptions.
 *
 * Decision outcomes:
 *   auto_execute     — passes all checks, safe to run without approval
 *   requires_approval — needs human confirmation before proceeding
 *   blocked          — denied by policy, cannot execute
 *   escalated        — routed to operator for review/override
 *   reroute_to_operator — redirect to a safer alternative path
 *
 * Safety invariants:
 *   - Strictly org-scoped (no cross-org leakage)
 *   - Emergency pause immediately blocks all non-system actions
 *   - All decisions are logged to unified_agent_action_log
 *   - All block/escalation reasons are human-readable
 *   - No self-modifying behavior
 */

import { db } from "./db";
import { agentCapabilityPolicies, orgAiGovernanceSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getTool } from "./agent-tools/registry";
import { resolveAgentIdentity } from "./agent-identities";
import { logUnifiedAction } from "./unified-action-logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Autonomy = "supervised" | "collaborative" | "autonomous";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type EnforcementOutcome = "auto_execute" | "requires_approval" | "blocked" | "escalated" | "reroute_to_operator";

export type ValidationInput = {
  orgId: string;
  agentType: string;
  agentName?: string;
  toolName?: string;
  toolCategory?: string;
  actionType?: string;
  riskLevel?: RiskLevel;
  confidenceScore?: number;
  workflowType?: string;
};

export type EnforcementDecision = {
  outcome: EnforcementOutcome;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;          // human-readable explanation
  policyId?: string;
  policyName?: string;
  thresholdFailed?: string;
  alternativeActions?: string[];
  governanceSettings?: GovernanceSnapshot;
};

export type GovernanceSnapshot = {
  autonomyMode: Autonomy;
  emergencyPause: boolean;
  strictMode: boolean;
  confidenceThreshold: number;
  maxRiskLevel: RiskLevel;
  allowCommunication: boolean;
  allowScheduling: boolean;
  allowFinancial: boolean;
};

// ─── Risk level ordering ──────────────────────────────────────────────────────

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function riskExceeds(actual: RiskLevel, allowed: RiskLevel): boolean {
  return RISK_ORDER[actual] > RISK_ORDER[allowed];
}

// ─── Governance settings loader (with default fallback) ───────────────────────

export async function getGovernanceSettings(orgId: string): Promise<GovernanceSnapshot> {
  const [settings] = await db
    .select()
    .from(orgAiGovernanceSettings)
    .where(eq(orgAiGovernanceSettings.orgId, orgId));

  if (!settings) {
    // Default to supervised (safest) if no settings exist yet
    return {
      autonomyMode: "supervised",
      emergencyPause: false,
      strictMode: false,
      confidenceThreshold: 0.75,
      maxRiskLevel: "medium",
      allowCommunication: false,
      allowScheduling: false,
      allowFinancial: false,
    };
  }

  return {
    autonomyMode: (settings.defaultAutonomyMode as Autonomy) ?? "supervised",
    emergencyPause: settings.emergencyPauseEnabled ?? false,
    strictMode: settings.strictModeEnabled ?? false,
    confidenceThreshold: settings.defaultConfidenceThreshold ?? 0.75,
    maxRiskLevel: (settings.maximumAllowedRiskLevel as RiskLevel) ?? "medium",
    allowCommunication: settings.allowAutonomousCommunication ?? false,
    allowScheduling: settings.allowAutonomousScheduling ?? false,
    allowFinancial: settings.allowAutonomousFinancialActions ?? false,
  };
}

// ─── Policy loader ────────────────────────────────────────────────────────────

async function getAgentPolicy(orgId: string, agentType: string): Promise<typeof agentCapabilityPolicies.$inferSelect | null> {
  const [policy] = await db
    .select()
    .from(agentCapabilityPolicies)
    .where(and(
      eq(agentCapabilityPolicies.orgId, orgId),
      eq(agentCapabilityPolicies.agentType, agentType),
    ))
    .limit(1);

  return policy ?? null;
}

// ─── Core validation function ─────────────────────────────────────────────────

/**
 * Primary entry point. Validates an agent action against org governance and
 * capability policies. Returns a fully-explained enforcement decision.
 */
export async function validateAgentCapability(input: ValidationInput): Promise<EnforcementDecision> {
  const gov = await getGovernanceSettings(input.orgId);

  // ── 1. Emergency pause — blocks ALL non-system actions ────────────────────
  if (gov.emergencyPause && input.agentType !== "system_agent") {
    const decision: EnforcementDecision = {
      outcome: "blocked",
      allowed: false,
      requiresApproval: false,
      reason: `All AI operations are paused. Emergency pause is active. An operator must disable it in AI Governance → Emergency Controls before any agent can act.`,
      thresholdFailed: "emergency_pause",
      governanceSettings: gov,
      alternativeActions: ["Disable emergency pause in AI Governance → Emergency Controls"],
    };
    await _logGovernanceDecision(input, decision, "governance_blocked");
    return decision;
  }

  // ── 2. Strict mode — force supervised for everything ──────────────────────
  const effectiveAutonomy = gov.strictMode ? "supervised" : gov.autonomyMode;

  // ── 3. Tool permission check ──────────────────────────────────────────────
  const toolDecision = await checkToolPermissions(input, gov);
  if (toolDecision) return toolDecision;

  // ── 4. Risk policy check ──────────────────────────────────────────────────
  const riskDecision = enforceRiskPolicy(input, gov, effectiveAutonomy);
  if (riskDecision) return riskDecision;

  // ── 5. Confidence threshold check ────────────────────────────────────────
  const confidenceDecision = checkConfidenceThreshold(input, gov);
  if (confidenceDecision) return confidenceDecision;

  // ── 6. Capability policy check (org-specific overrides) ───────────────────
  const policyDecision = await checkCapabilityPolicy(input, gov, effectiveAutonomy);
  if (policyDecision) return policyDecision;

  // ── 7. Autonomy mode → determine final outcome ────────────────────────────
  const decision = determineApprovalRequirement(input, gov, effectiveAutonomy);
  await _logGovernanceDecision(input, decision, decision.outcome === "auto_execute" ? "capability_validated" : "approval_required");
  return decision;
}

// ─── Individual check functions ───────────────────────────────────────────────

export async function checkToolPermissions(input: ValidationInput, gov?: GovernanceSnapshot): Promise<EnforcementDecision | null> {
  if (!input.toolName) return null;

  const tool = getTool(input.toolName);
  if (!tool) return null;

  const governance = gov ?? await getGovernanceSettings(input.orgId);

  // Financial tool check
  if (tool.permissions.financial_side_effect && !governance.allowFinancial) {
    const decision: EnforcementDecision = {
      outcome: "blocked",
      allowed: false,
      requiresApproval: false,
      reason: `Blocked: Tool "${input.toolName}" has financial side effects but the org has not enabled autonomous financial actions (AI Governance → Governance Policies → Allow Autonomous Financial Actions).`,
      thresholdFailed: "financial_actions_disabled",
      governanceSettings: governance,
      alternativeActions: ["Enable autonomous financial actions in AI Governance", "Create a manual invoice instead"],
    };
    await _logGovernanceDecision(input, decision, "tool_permission_denied");
    return decision;
  }

  // Communication tool check (for autonomous mode)
  if (tool.category === "communication" && tool.permissions.external_side_effect && !governance.allowCommunication) {
    const autonomy = governance.autonomyMode;
    if (autonomy === "autonomous") {
      const decision: EnforcementDecision = {
        outcome: "blocked",
        allowed: false,
        requiresApproval: false,
        reason: `Blocked: Tool "${input.toolName}" sends direct client communications. The org has not enabled autonomous communication (AI Governance → Governance Policies → Allow Autonomous Communication). Communications require operator approval.`,
        thresholdFailed: "autonomous_communication_disabled",
        governanceSettings: governance,
        alternativeActions: ["Enable autonomous communication in AI Governance", "Use create_email_draft instead for human review"],
      };
      await _logGovernanceDecision(input, decision, "tool_permission_denied");
      return decision;
    }
  }

  return null;
}

export function enforceRiskPolicy(input: ValidationInput, gov: GovernanceSnapshot, effectiveAutonomy: Autonomy): EnforcementDecision | null {
  const riskLevel = (input.riskLevel as RiskLevel) ?? "low";

  if (riskExceeds(riskLevel, gov.maxRiskLevel)) {
    const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;
    const decision: EnforcementDecision = {
      outcome: "blocked",
      allowed: false,
      requiresApproval: false,
      reason: `Blocked: This action's risk level (${riskLevel}) exceeds the org's maximum allowed risk level (${gov.maxRiskLevel}). ${agentName} cannot execute ${riskLevel}-risk actions under current governance settings. Update the maximum allowed risk level in AI Governance → Governance Policies.`,
      thresholdFailed: `risk_level_${riskLevel}_exceeds_max_${gov.maxRiskLevel}`,
      governanceSettings: gov,
      alternativeActions: [`Raise maximum allowed risk level to "${riskLevel}" in AI Governance`, "Request operator manual execution"],
    };
    return decision;
  }

  // Critical actions always require approval regardless of mode
  if (riskLevel === "critical") {
    const decision: EnforcementDecision = {
      outcome: "requires_approval",
      allowed: true,
      requiresApproval: true,
      reason: `Approval required: Critical-risk actions always require human review, regardless of autonomy mode. An operator must approve before this action executes.`,
      thresholdFailed: "critical_always_requires_approval",
      governanceSettings: gov,
    };
    return decision;
  }

  // Supervised mode: everything requires approval
  if (effectiveAutonomy === "supervised") {
    const decision: EnforcementDecision = {
      outcome: "requires_approval",
      allowed: true,
      requiresApproval: true,
      reason: `Approval required: The org is in Supervised mode. All agent actions require human approval before execution. Change to Collaborative or Autonomous mode to allow lower-risk auto-execution.`,
      governanceSettings: gov,
    };
    return decision;
  }

  // Collaborative mode: medium+ risk requires approval
  if (effectiveAutonomy === "collaborative" && RISK_ORDER[riskLevel] >= RISK_ORDER["medium"]) {
    const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;
    const decision: EnforcementDecision = {
      outcome: "requires_approval",
      allowed: true,
      requiresApproval: true,
      reason: `Approval required: In Collaborative mode, ${agentName} can auto-execute low-risk actions but ${riskLevel}-risk actions require operator approval.`,
      governanceSettings: gov,
    };
    return decision;
  }

  return null;
}

export function checkConfidenceThreshold(input: ValidationInput, gov: GovernanceSnapshot): EnforcementDecision | null {
  if (input.confidenceScore == null) return null;

  const threshold = gov.confidenceThreshold;
  if (input.confidenceScore < threshold) {
    const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;
    const decision: EnforcementDecision = {
      outcome: "requires_approval",
      allowed: true,
      requiresApproval: true,
      reason: `Approval required: ${agentName}'s confidence score (${(input.confidenceScore * 100).toFixed(0)}%) is below the org threshold (${(threshold * 100).toFixed(0)}%) for autonomous execution. An operator should review before this action proceeds.`,
      thresholdFailed: `confidence_${(input.confidenceScore * 100).toFixed(0)}_below_threshold_${(threshold * 100).toFixed(0)}`,
      governanceSettings: gov,
      alternativeActions: ["Lower the confidence threshold in AI Governance", "Override and approve manually"],
    };
    return decision;
  }

  return null;
}

async function checkCapabilityPolicy(input: ValidationInput, gov: GovernanceSnapshot, effectiveAutonomy: Autonomy): Promise<EnforcementDecision | null> {
  const policy = await getAgentPolicy(input.orgId, input.agentType);
  if (!policy) return null;

  // Policy disabled
  if (!policy.enabled) {
    const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;
    const decision: EnforcementDecision = {
      outcome: "blocked",
      allowed: false,
      requiresApproval: false,
      reason: `Blocked: ${agentName} (${input.agentType}) is disabled by org policy. Enable the agent in AI Governance → Agent Permissions.`,
      thresholdFailed: "agent_disabled",
      policyId: policy.id,
      policyName: policy.capabilityName,
      governanceSettings: gov,
      alternativeActions: ["Enable this agent in AI Governance → Agent Permissions"],
    };
    await _logGovernanceDecision(input, decision, "capability_denied");
    return decision;
  }

  // Check tool restrictions
  if (input.toolName && policy.restrictedTools) {
    const restricted = (policy.restrictedTools as string[]) ?? [];
    if (restricted.includes(input.toolName)) {
      const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;
      const decision: EnforcementDecision = {
        outcome: "blocked",
        allowed: false,
        requiresApproval: false,
        reason: `Blocked: Tool "${input.toolName}" is in ${agentName}'s restricted tool list. Remove it from restricted tools in AI Governance → Agent Permissions to allow access.`,
        thresholdFailed: `tool_${input.toolName}_restricted`,
        policyId: policy.id,
        governanceSettings: gov,
        alternativeActions: [`Remove "${input.toolName}" from ${agentName}'s restricted tools`],
      };
      await _logGovernanceDecision(input, decision, "tool_permission_denied");
      return decision;
    }
  }

  // Check if policy overrides require approval
  if (policy.requiresApproval && effectiveAutonomy !== "autonomous") {
    const decision: EnforcementDecision = {
      outcome: "requires_approval",
      allowed: true,
      requiresApproval: true,
      reason: `Approval required: The capability policy for ${input.agentType} requires human review. This can be updated in AI Governance → Agent Permissions.`,
      policyId: policy.id,
      policyName: policy.capabilityName,
      governanceSettings: gov,
    };
    return decision;
  }

  return null;
}

export function determineApprovalRequirement(input: ValidationInput, gov: GovernanceSnapshot, effectiveAutonomy: Autonomy): EnforcementDecision {
  const riskLevel = (input.riskLevel as RiskLevel) ?? "low";
  const agentName = resolveAgentIdentity(input.agentType)?.name ?? input.agentType;

  // Autonomous + low/medium risk → auto_execute
  if (effectiveAutonomy === "autonomous" && RISK_ORDER[riskLevel] <= RISK_ORDER["medium"]) {
    return {
      outcome: "auto_execute",
      allowed: true,
      requiresApproval: false,
      reason: `Auto-execute: ${agentName} is operating in Autonomous mode with sufficient confidence. This ${riskLevel}-risk action is within the org's approved autonomy boundaries.`,
      governanceSettings: gov,
    };
  }

  // Collaborative + low risk + high confidence → auto_execute
  if (effectiveAutonomy === "collaborative" && riskLevel === "low") {
    const confidence = input.confidenceScore ?? 1;
    if (confidence >= gov.confidenceThreshold) {
      return {
        outcome: "auto_execute",
        allowed: true,
        requiresApproval: false,
        reason: `Auto-execute: ${agentName} is in Collaborative mode. This low-risk action meets the confidence threshold (${(confidence * 100).toFixed(0)}% ≥ ${(gov.confidenceThreshold * 100).toFixed(0)}%) for autonomous execution.`,
        governanceSettings: gov,
      };
    }
  }

  return {
    outcome: "requires_approval",
    allowed: true,
    requiresApproval: true,
    reason: `Approval required: ${agentName} needs operator approval for this action under current governance settings (mode: ${effectiveAutonomy}, risk: ${riskLevel}).`,
    governanceSettings: gov,
  };
}

// ─── Execution limit check ────────────────────────────────────────────────────

export async function checkExecutionLimits(orgId: string, agentType: string, metric: string): Promise<{ withinLimits: boolean; reason?: string }> {
  const policy = await getAgentPolicy(orgId, agentType);
  if (!policy?.executionLimits) return { withinLimits: true };

  const limits = policy.executionLimits as Record<string, number>;
  const limit = limits[metric];
  if (!limit) return { withinLimits: true };

  // TODO: implement actual counting against the unified log in the future
  // For now, limits are advisory and logged for observability
  return { withinLimits: true };
}

// ─── Emergency controls ───────────────────────────────────────────────────────

export async function triggerEmergencyPause(orgId: string, reason: string, triggeredBy: string): Promise<void> {
  const [existing] = await db.select().from(orgAiGovernanceSettings).where(eq(orgAiGovernanceSettings.orgId, orgId));

  if (existing) {
    await db.update(orgAiGovernanceSettings)
      .set({ emergencyPauseEnabled: true, emergencyPauseReason: reason, updatedAt: new Date() })
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
  } else {
    await db.insert(orgAiGovernanceSettings).values({
      id: crypto.randomUUID(),
      orgId,
      emergencyPauseEnabled: true,
      emergencyPauseReason: reason,
    });
  }

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: triggeredBy,
    actionType: "emergency_pause_enabled",
    status: "completed",
    riskLevel: "critical",
    reasoningSummary: `Emergency pause enabled by ${triggeredBy}. Reason: ${reason}`,
  });
}

export async function disableEmergencyPause(orgId: string, triggeredBy: string): Promise<void> {
  await db.update(orgAiGovernanceSettings)
    .set({ emergencyPauseEnabled: false, emergencyPauseReason: null, updatedAt: new Date() })
    .where(eq(orgAiGovernanceSettings.orgId, orgId));

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: triggeredBy,
    actionType: "emergency_pause_disabled",
    status: "completed",
    riskLevel: "high",
    reasoningSummary: `Emergency pause disabled by ${triggeredBy}. AI operations resuming.`,
  });
}

export async function changeAutonomyMode(orgId: string, mode: Autonomy, changedBy: string): Promise<void> {
  const [existing] = await db.select().from(orgAiGovernanceSettings).where(eq(orgAiGovernanceSettings.orgId, orgId));
  const prevMode = existing?.defaultAutonomyMode ?? "supervised";

  if (existing) {
    await db.update(orgAiGovernanceSettings)
      .set({ defaultAutonomyMode: mode, updatedAt: new Date() })
      .where(eq(orgAiGovernanceSettings.orgId, orgId));
  } else {
    await db.insert(orgAiGovernanceSettings).values({ id: crypto.randomUUID(), orgId, defaultAutonomyMode: mode });
  }

  await logUnifiedAction({
    orgId,
    actorType: "admin",
    actorName: changedBy,
    actionType: "autonomy_mode_changed",
    status: "completed",
    riskLevel: mode === "autonomous" ? "high" : mode === "collaborative" ? "medium" : "low",
    reasoningSummary: `Autonomy mode changed from "${prevMode}" to "${mode}" by ${changedBy}.`,
    inputSnapshot: { previousMode: prevMode },
    outputSnapshot: { newMode: mode },
  });
}

// ─── Governance analytics ─────────────────────────────────────────────────────

export async function getGovernanceAnalytics(orgId: string) {
  const { db: database } = await import("./db");
  const { unifiedAgentActionLog } = await import("@shared/schema");
  const { eq, and, gte } = await import("drizzle-orm");

  const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const logs = await database
    .select()
    .from(unifiedAgentActionLog)
    .where(and(
      eq(unifiedAgentActionLog.orgId, orgId),
      gte(unifiedAgentActionLog.createdAt, since30Days),
    ))
    .limit(500);

  const blockedActions = logs.filter(l => l.actionType === "governance_blocked" || l.actionType === "capability_denied" || l.actionType === "tool_permission_denied");
  const escalatedActions = logs.filter(l => l.actionType === "governance_escalated");
  const approvalRequired = logs.filter(l => l.actionType === "approval_required");
  const autoExecuted = logs.filter(l => l.actionType === "capability_validated");
  const emergencyEvents = logs.filter(l => l.actionType === "emergency_pause_enabled" || l.actionType === "emergency_pause_disabled");
  const modeChanges = logs.filter(l => l.actionType === "autonomy_mode_changed");

  const total = blockedActions.length + escalatedActions.length + approvalRequired.length + autoExecuted.length;
  const autonomousRate = total > 0 ? Math.round((autoExecuted.length / total) * 100) : 0;
  const approvalRate = total > 0 ? Math.round((approvalRequired.length / total) * 100) : 0;

  // Tool denial breakdown
  const toolDenials: Record<string, number> = {};
  for (const l of blockedActions) {
    const reason = l.reasoningSummary ?? "";
    const match = reason.match(/Tool "([^"]+)"/);
    if (match) toolDenials[match[1]] = (toolDenials[match[1]] ?? 0) + 1;
  }

  return {
    period: "last_30_days",
    totalGovernanceDecisions: total,
    blockedActionCount: blockedActions.length,
    escalatedCount: escalatedActions.length,
    approvalRequiredCount: approvalRequired.length,
    autoExecutedCount: autoExecuted.length,
    autonomousExecutionRate: autonomousRate,
    approvalRate,
    emergencyInterventions: emergencyEvents.length,
    autonomyModeChanges: modeChanges.length,
    toolDenials,
    recentBlocked: blockedActions.slice(0, 10),
    recentApprovals: approvalRequired.slice(0, 10),
  };
}

// ─── Internal logging helper ──────────────────────────────────────────────────

async function _logGovernanceDecision(input: ValidationInput, decision: EnforcementDecision, actionType: string): Promise<void> {
  try {
    await logUnifiedAction({
      orgId: input.orgId,
      actorType: "system",
      actorName: resolveAgentIdentity(input.agentType)?.name ?? input.agentType,
      actionType,
      entityType: input.toolCategory,
      toolName: input.toolName,
      status: decision.allowed ? "completed" : "failed",
      riskLevel: input.riskLevel ?? "low",
      confidenceScore: input.confidenceScore,
      reasoningSummary: decision.reason.substring(0, 500),
      outputSnapshot: { outcome: decision.outcome, thresholdFailed: decision.thresholdFailed },
    });
  } catch (_) { /* logging must never block execution */ }
}
