/**
 * org-ai-infrastructure.ts
 *
 * Idempotent provisioning layer for every organization's AI infrastructure.
 *
 * Provisions:
 *   1. org_ai_governance_settings    — default supervised/collaborative posture
 *   2. org_automation_settings       — safe default automation thresholds
 *   3. org_ai_workforce_settings     — default departments + governance mode
 *   4. agent_capability_policies     — one row per agent identity
 *   5. org_ai_approval_rules         — default approval thresholds by risk level
 *   6. Integration status check      — surfaces "connect required" instead of failing
 *
 * Rules:
 *   - Every operation is guarded: INSERT only if the record doesn't already exist.
 *   - Existing configs are NEVER overwritten — idempotent by design.
 *   - Missing external integrations (Gmail, Calendar) set status = "connect_required".
 *   - All errors are captured per-step; the function never throws.
 *   - Returns a detailed report of what was created / skipped / errored.
 */

import { db } from "../db";
import {
  orgAiGovernanceSettings,
  orgAutomationSettings,
  orgAiWorkforceSettings,
  agentCapabilityPolicies,
  orgAiApprovalRules,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { listAgentIdentities } from "../agent-identities";

export interface OrgInfrastructureReport {
  orgId: string;
  created: string[];
  skipped: string[];
  integrationStatus: Record<string, "connected" | "connect_required">;
  errors: string[];
  durationMs: number;
}

const DEFAULT_INTEGRATION_TYPES = [
  "gmail",
  "google_calendar",
  "slack",
  "openrouter",
] as const;

const DEFAULT_APPROVAL_RULES: Array<{
  riskLevel: string;
  requiresApproval: boolean;
  autoApprove: boolean;
  approvalThreshold: number;
}> = [
  { riskLevel: "low",      requiresApproval: false, autoApprove: true,  approvalThreshold: 0.85 },
  { riskLevel: "medium",   requiresApproval: true,  autoApprove: false, approvalThreshold: 0.75 },
  { riskLevel: "high",     requiresApproval: true,  autoApprove: false, approvalThreshold: 0.90 },
  { riskLevel: "critical", requiresApproval: true,  autoApprove: false, approvalThreshold: 0.99 },
];

export async function ensureOrgAiInfrastructure(
  orgId: string,
): Promise<OrgInfrastructureReport> {
  const t0 = Date.now();
  const report: OrgInfrastructureReport = {
    orgId,
    created: [],
    skipped: [],
    integrationStatus: {},
    errors: [],
    durationMs: 0,
  };

  const tag = `[OrgAiInfra][${orgId}]`;

  // ── 1. Governance settings ──────────────────────────────────────────────────
  try {
    const [existing] = await db
      .select({ id: orgAiGovernanceSettings.id })
      .from(orgAiGovernanceSettings)
      .where(eq(orgAiGovernanceSettings.orgId, orgId));

    if (!existing) {
      await db.insert(orgAiGovernanceSettings).values({
        orgId,
        defaultAutonomyMode: "supervised",
        maximumAllowedRiskLevel: "medium",
        defaultConfidenceThreshold: 0.75,
        operatorReviewRequired: true,
        allowAutonomousCommunication: false,
        allowAutonomousScheduling: false,
        allowAutonomousFinancialActions: false,
        allowResearchAgents: true,
        allowExternalWebAccess: false,
        allowCrossWorkflowMemory: true,
        aiActivityVisibilityMode: "full",
        strictModeEnabled: false,
        emergencyPauseEnabled: false,
      });
      report.created.push("governance_settings");
      console.log(`${tag} created governance_settings`);
    } else {
      report.skipped.push("governance_settings");
    }
  } catch (e: any) {
    const msg = `governance_settings: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
  }

  // ── 2. Automation settings ──────────────────────────────────────────────────
  try {
    const [existing] = await db
      .select({ id: orgAutomationSettings.id })
      .from(orgAutomationSettings)
      .where(eq(orgAutomationSettings.orgId, orgId));

    if (!existing) {
      await db.insert(orgAutomationSettings).values({
        orgId,
        autoSendFirstResponse: false,
        autoSendLowRiskFollowUps: false,
        autoSendBookingConfirmation: false,
        autoOfferSchedulingSlots: false,
        autoBookConfirmedSlots: false,
        minAutoSendConfidence: 0.85,
        minAutoBookingConfidence: 0.90,
        dailyEmailCap: 20,
        dailyBookingCap: 10,
        allowedSendWindowStart: "08:00",
        allowedSendWindowEnd: "20:00",
        requireApprovalForFirstContact: true,
        requireApprovalForNewRecipients: true,
        notifyCoachOnAutoAction: true,
        policyVersion: "1.0.0",
      });
      report.created.push("automation_settings");
      console.log(`${tag} created automation_settings`);
    } else {
      report.skipped.push("automation_settings");
    }
  } catch (e: any) {
    const msg = `automation_settings: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
  }

  // ── 3. AI Workforce settings ────────────────────────────────────────────────
  try {
    const [existing] = await db
      .select({ id: orgAiWorkforceSettings.id })
      .from(orgAiWorkforceSettings)
      .where(eq(orgAiWorkforceSettings.orgId, orgId));

    if (!existing) {
      await db.insert(orgAiWorkforceSettings).values({
        orgId,
        goals: [],
        orgPreset: null,
        enabledDepartments: [
          "communications",
          "scheduling",
          "retention",
          "growth",
          "research",
          "executive",
          "finance",
        ],
        governanceMode: "supervised",
        selectedIntegrations: [],
        selectedWorkflowTemplates: [],
        onboardingCompleted: false,
      });
      report.created.push("workforce_settings");
      console.log(`${tag} created workforce_settings`);
    } else {
      report.skipped.push("workforce_settings");
    }
  } catch (e: any) {
    const msg = `workforce_settings: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
  }

  // ── 4. Agent capability policies (one per agent identity) ───────────────────
  try {
    const identities = listAgentIdentities();
    let policiesCreated = 0;
    let policiesSkipped = 0;

    for (const identity of identities) {
      try {
        const [existing] = await db
          .select({ id: agentCapabilityPolicies.id })
          .from(agentCapabilityPolicies)
          .where(
            and(
              eq(agentCapabilityPolicies.orgId, orgId),
              eq(agentCapabilityPolicies.agentType, identity.agentType),
            ),
          );

        if (!existing) {
          await db.insert(agentCapabilityPolicies).values({
            orgId,
            agentType: identity.agentType,
            capabilityName: identity.name,
            capabilityCategory: identity.toolCategories[0] ?? "internal",
            requiresApproval: identity.defaultAutonomyLevel === "supervised",
            maxAutonomyLevel: identity.defaultAutonomyLevel,
            allowedRiskLevels: identity.defaultRiskTolerance === "low"
              ? ["low"]
              : identity.defaultRiskTolerance === "medium"
                ? ["low", "medium"]
                : ["low", "medium", "high"],
            requiresHumanReview: identity.defaultAutonomyLevel === "supervised",
            escalationRequired: false,
            notes: `Auto-provisioned by ensureOrgAiInfrastructure — ${identity.defaultAutonomyLevel} mode`,
            createdBy: "system",
          });
          policiesCreated++;
        } else {
          policiesSkipped++;
        }
      } catch (agentErr: any) {
        report.errors.push(`capability_policy[${identity.agentType}]: ${agentErr.message}`);
      }
    }

    if (policiesCreated > 0) {
      report.created.push(`capability_policies(${policiesCreated})`);
      console.log(`${tag} created ${policiesCreated} capability policies (${policiesSkipped} skipped)`);
    } else {
      report.skipped.push(`capability_policies(${policiesSkipped})`);
    }
  } catch (e: any) {
    const msg = `capability_policies: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
  }

  // ── 5. Approval rules by risk level ────────────────────────────────────────
  try {
    let rulesCreated = 0;
    let rulesSkipped = 0;

    for (const rule of DEFAULT_APPROVAL_RULES) {
      try {
        const [existing] = await db
          .select({ id: orgAiApprovalRules.id })
          .from(orgAiApprovalRules)
          .where(
            and(
              eq(orgAiApprovalRules.orgId, orgId),
              eq(orgAiApprovalRules.riskLevel, rule.riskLevel),
            ),
          );

        if (!existing) {
          await db.insert(orgAiApprovalRules).values({
            orgId,
            agentId: null,
            riskLevel: rule.riskLevel,
            actionType: null,
            requiresApproval: rule.requiresApproval,
            autoApprove: rule.autoApprove,
            approvalThreshold: rule.approvalThreshold,
          });
          rulesCreated++;
        } else {
          rulesSkipped++;
        }
      } catch (ruleErr: any) {
        report.errors.push(`approval_rule[${rule.riskLevel}]: ${ruleErr.message}`);
      }
    }

    if (rulesCreated > 0) {
      report.created.push(`approval_rules(${rulesCreated})`);
      console.log(`${tag} created ${rulesCreated} approval rules (${rulesSkipped} skipped)`);
    } else {
      report.skipped.push(`approval_rules(${rulesSkipped})`);
    }
  } catch (e: any) {
    const msg = `approval_rules: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
  }

  // ── 6. Integration status check ─────────────────────────────────────────────
  try {
    const { storage } = await import("../storage");
    const connected = await storage.getExternalIntegrations(orgId).catch(() => [] as any[]);
    const connectedSet = new Set(
      connected
        .filter((i: any) => i.status === "connected")
        .map((i: any) => i.integrationType as string),
    );

    for (const intType of DEFAULT_INTEGRATION_TYPES) {
      report.integrationStatus[intType] = connectedSet.has(intType)
        ? "connected"
        : "connect_required";
    }
  } catch (e: any) {
    const msg = `integration_check: ${e.message}`;
    report.errors.push(msg);
    console.error(`${tag} error ${msg}`);
    for (const intType of DEFAULT_INTEGRATION_TYPES) {
      report.integrationStatus[intType] = "connect_required";
    }
  }

  report.durationMs = Date.now() - t0;

  if (report.created.length > 0) {
    console.log(`${tag} provisioning complete — created: [${report.created.join(", ")}] skipped: [${report.skipped.join(", ")}] errors: ${report.errors.length} (${report.durationMs}ms)`);
  } else if (report.errors.length === 0) {
    console.log(`${tag} already provisioned — all ${report.skipped.length} components present (${report.durationMs}ms)`);
  } else {
    console.warn(`${tag} provisioning had ${report.errors.length} error(s) — created: [${report.created.join(", ")}] (${report.durationMs}ms)`);
  }

  return report;
}

/**
 * Backfill all existing orgs with AI infrastructure.
 * Safe to run on startup — idempotent, fire-and-forget.
 */
export async function backfillAllOrgsAiInfrastructure(): Promise<void> {
  try {
    const { db: dbInst } = await import("../db");
    const { organizations } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");

    const raw = await dbInst.execute(sql`SELECT id FROM organizations ORDER BY created_at ASC`);
    const orgs: Array<{ id: string }> = Array.isArray(raw) ? raw : ((raw as any).rows ?? []);

    console.log(`[OrgAiInfra][Backfill] Starting backfill for ${orgs.length} org(s)`);
    let success = 0;
    let errors = 0;

    for (const org of orgs) {
      try {
        const report = await ensureOrgAiInfrastructure(org.id);
        if (report.errors.length > 0) errors++;
        else success++;
      } catch {
        errors++;
      }
    }

    console.log(`[OrgAiInfra][Backfill] Complete — ${success} provisioned, ${errors} with errors`);
  } catch (e: any) {
    console.error(`[OrgAiInfra][Backfill] Fatal error: ${e.message}`);
  }
}
