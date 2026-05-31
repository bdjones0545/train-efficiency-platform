/**
 * Agent SDK — Phase 7
 *
 * Allows developers to define, validate, and publish agents without modifying
 * core platform code. Agents are described as structured metadata; the SDK
 * validates definitions and builds marketplace-ready templates from them.
 *
 * SDK usage:
 *   1. Define your agent using the AgentDefinition interface
 *   2. Validate with validateAgentDefinition()
 *   3. Submit via /api/developer/submit
 *   4. Platform reviews → approves → publishes
 */

import { db } from "../db";
import { agentTemplates, agentSubmissions, developerAccounts, agentLifecycleEvents } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ─── Agent Definition Interface ───────────────────────────────────────────────

export interface AgentDefinition {
  // Identity
  name: string;                       // "Football Recruiting Agent"
  description: string;                // 2–4 sentence pitch
  department: string;                 // "Growth" | "Retention" | "Operations" | "Communications" | "Research" | "Executive" | "Analytics" | "Recruiting"

  // Capabilities
  capabilities: string[];             // What this agent can do
  executionTypes: string[];           // "lead_followup" | "scheduling" | "retention" | "communication" | "workflow" | "operations" | "research"
  benchmarkCategories: string[];      // Which categories contribute to benchmarks

  // Integrations & Industries
  requiredIntegrations: string[];     // "email" | "crm" | "calendar" | "billing" | "leads" | "reporting"
  supportedIndustries: string[];      // "Sports Performance" | "Gyms" | "Private Coaching" | etc.

  // Governance
  riskLevel: "low" | "medium" | "high" | "critical";
  defaultGovernanceMode: "auto" | "supervised" | "strict";
  requiredPermissions: AgentPermissionRequest[];

  // Versioning
  version: string;                    // semver: "1.0.0"
  changelogNotes?: string;
}

export interface AgentPermissionRequest {
  type: "crm_access" | "email_access" | "calendar_access" | "billing_access" | "lead_access" | "reporting_access";
  reason: string;
  required: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  riskAssessment: {
    score: number;        // 0–100 (higher = more risk)
    flags: string[];
    approved: boolean;
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateAgentDefinition(def: Partial<AgentDefinition>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const riskFlags: string[] = [];
  let riskScore = 0;

  // Required fields
  if (!def.name?.trim()) errors.push("name is required");
  else if (def.name.length < 3) errors.push("name must be at least 3 characters");
  else if (def.name.length > 80) errors.push("name must be 80 characters or fewer");

  if (!def.description?.trim()) errors.push("description is required");
  else if (def.description.length < 20) errors.push("description must be at least 20 characters");
  else if (def.description.length > 500) errors.push("description must be 500 characters or fewer");

  if (!def.department?.trim()) errors.push("department is required");

  if (!def.capabilities?.length) errors.push("at least one capability is required");
  else if (def.capabilities.length > 15) warnings.push("more than 15 capabilities may reduce benchmark focus");

  if (!def.executionTypes?.length) errors.push("at least one executionType is required");

  const validExecutionTypes = ["lead_followup", "scheduling", "retention", "communication", "workflow", "operations", "research", "recruiting"];
  const invalidExecTypes = (def.executionTypes ?? []).filter(e => !validExecutionTypes.includes(e));
  if (invalidExecTypes.length) errors.push(`invalid executionTypes: ${invalidExecTypes.join(", ")}. Valid: ${validExecutionTypes.join(", ")}`);

  if (!def.version?.match(/^\d+\.\d+\.\d+$/)) errors.push("version must be semver format (e.g. 1.0.0)");

  // Risk assessment
  if (def.riskLevel === "critical") { riskScore += 40; riskFlags.push("Critical risk level — requires platform security review"); }
  else if (def.riskLevel === "high") { riskScore += 25; riskFlags.push("High risk level — requires enhanced governance review"); }
  else if (def.riskLevel === "medium") riskScore += 10;

  const highRiskPerms = (def.requiredPermissions ?? []).filter(p => p.type === "billing_access");
  if (highRiskPerms.length) { riskScore += 30; riskFlags.push("Billing access requested — requires explicit org authorization"); }

  if ((def.requiredIntegrations ?? []).length > 5) { riskScore += 10; warnings.push("Many integrations required — may limit installability"); }

  if (def.defaultGovernanceMode === "auto") { riskScore += 15; riskFlags.push("Auto-execution mode requested — will be overridden by org governance settings"); }

  if (!def.supportedIndustries?.length) warnings.push("No supported industries specified — agent will appear in all categories");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    riskAssessment: {
      score: Math.min(100, riskScore),
      flags: riskFlags,
      approved: riskScore < 50 && errors.length === 0,
    },
  };
}

// ─── Build Template from Definition ──────────────────────────────────────────

export async function buildAgentTemplate(developerId: string, def: AgentDefinition): Promise<typeof agentTemplates.$inferSelect> {
  const agentId = `dev_${developerId.substring(0, 8)}_${def.name.toLowerCase().replace(/[^a-z0-9]/g, "_").substring(0, 20)}`;

  const existing = await db.select().from(agentTemplates).where(eq(agentTemplates.agentId, agentId)).catch(() => []);
  if (existing.length > 0) {
    const [updated] = await db.update(agentTemplates).set({
      agentName: def.name,
      description: def.description,
      department: def.department,
      capabilities: def.capabilities,
      requiredIntegrations: def.requiredIntegrations,
      supportedIndustries: def.supportedIndustries,
      version: def.version,
      status: "pending_review",
      updatedAt: new Date(),
    }).where(eq(agentTemplates.agentId, agentId)).returning();
    return updated;
  }

  const [template] = await db.insert(agentTemplates).values({
    agentId,
    agentName: def.name,
    description: def.description,
    department: def.department,
    capabilities: def.capabilities,
    requiredIntegrations: def.requiredIntegrations,
    supportedIndustries: def.supportedIndustries,
    version: def.version,
    maintainer: developerId,
    status: "pending_review",
    certificationLevel: "uncertified",
    averageRoi: 0,
    averageSuccessRate: 0,
  }).returning();

  return template;
}

// ─── Create Developer Submission ──────────────────────────────────────────────

export async function createDeveloperSubmission(developerId: string, def: AgentDefinition): Promise<{
  submission: typeof agentSubmissions.$inferSelect;
  template: typeof agentTemplates.$inferSelect;
  validation: ValidationResult;
}> {
  const validation = validateAgentDefinition(def);
  const template = await buildAgentTemplate(developerId, def);

  const govReview = {
    riskLevel: def.riskLevel,
    defaultGovernanceMode: def.defaultGovernanceMode,
    requiredPermissions: def.requiredPermissions?.length ?? 0,
    riskScore: validation.riskAssessment.score,
    riskFlags: validation.riskAssessment.flags,
    autoApproved: validation.riskAssessment.approved,
  };

  const [submission] = await db.insert(agentSubmissions).values({
    developerId,
    agentTemplateId: template.id,
    agentDefinition: def as any,
    submissionStatus: "submitted",
    submittedAt: new Date(),
    governanceReview: govReview,
  }).returning();

  // Lifecycle event
  await db.insert(agentLifecycleEvents).values({
    agentId: template.agentId,
    eventType: "submitted",
    toStatus: "submitted",
    notes: `Developer submission created for review — risk score: ${validation.riskAssessment.score}`,
  }).catch(() => {});

  return { submission, template, validation };
}

// ─── Example Agent Definitions ────────────────────────────────────────────────

export const EXAMPLE_AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  football_recruiting: {
    name: "Football Recruiting Agent",
    description: "Automates outreach to high school athletic departments, coaches, and prospects. Manages prospect pipelines, sends personalized recruiting messages, tracks engagement, and schedules campus visits.",
    department: "Recruiting",
    capabilities: ["Prospect discovery", "Personalized recruiting outreach", "Campus visit scheduling", "Pipeline tracking", "Engagement analytics"],
    executionTypes: ["lead_followup", "communication", "scheduling"],
    benchmarkCategories: ["lead_conversion", "scheduling_utilization", "communication_response_rate"],
    requiredIntegrations: ["email_access", "calendar_access", "lead_access"],
    supportedIndustries: ["Sports Performance", "Team Training"],
    riskLevel: "low",
    defaultGovernanceMode: "supervised",
    requiredPermissions: [
      { type: "email_access", reason: "Sends recruiting communications", required: true },
      { type: "lead_access", reason: "Reads and updates prospect pipeline", required: true },
      { type: "calendar_access", reason: "Schedules campus visits", required: false },
    ],
    version: "1.0.0",
    changelogNotes: "Initial release",
  },
  gym_retention: {
    name: "Gym Retention Agent",
    description: "Detects at-risk gym members before they cancel, triggers personalized win-back campaigns, and monitors engagement metrics to protect monthly recurring revenue.",
    department: "Retention",
    capabilities: ["Churn prediction", "Win-back campaigns", "Engagement monitoring", "Member health scoring", "Automated check-ins"],
    executionTypes: ["retention", "communication"],
    benchmarkCategories: ["retention_rate", "revenue_recovered", "churn_reduction"],
    requiredIntegrations: ["email_access", "lead_access"],
    supportedIndustries: ["Gyms", "Rehabilitation", "Corporate Wellness"],
    riskLevel: "low",
    defaultGovernanceMode: "supervised",
    requiredPermissions: [
      { type: "email_access", reason: "Sends retention communications", required: true },
      { type: "lead_access", reason: "Reads member activity data", required: true },
    ],
    version: "1.0.0",
  },
  sponsorship_outreach: {
    name: "Sponsorship Outreach Agent",
    description: "Identifies and pursues corporate sponsorship opportunities for sports organizations. Researches prospects, crafts personalized pitches, and manages the sponsorship sales pipeline.",
    department: "Growth",
    capabilities: ["Sponsor discovery", "Pitch generation", "Pipeline management", "Follow-up sequences", "Deal tracking"],
    executionTypes: ["lead_followup", "communication", "research"],
    benchmarkCategories: ["lead_conversion", "revenue_influence"],
    requiredIntegrations: ["email_access", "lead_access"],
    supportedIndustries: ["Sports Performance", "Team Training"],
    riskLevel: "medium",
    defaultGovernanceMode: "supervised",
    requiredPermissions: [
      { type: "email_access", reason: "Sends sponsorship outreach", required: true },
      { type: "lead_access", reason: "Manages sponsorship pipeline", required: true },
    ],
    version: "1.0.0",
  },
};
