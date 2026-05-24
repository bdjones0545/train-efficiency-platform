/**
 * Agent Identity System — Phase 3
 *
 * Named AI employee identities that appear consistently across:
 * - unified logs
 * - workflow history
 * - approvals
 * - attention items
 * - dashboards
 *
 * These are deterministic, read-only identity profiles.
 * No autonomous behavior is defined here — only metadata.
 */

export type AgentStatus = "active" | "paused" | "restricted" | "disabled";

export type AgentIdentity = {
  agentType: string;
  name: string;
  role: string;
  department: string;
  description: string;
  avatarInitials: string;
  avatarColor: string; // Tailwind color name
  capabilityManifest: string[];  // human-readable list of what this agent can do
  defaultAutonomyLevel: "supervised" | "collaborative" | "autonomous";
  defaultRiskTolerance: "low" | "medium" | "high";
  toolCategories: string[];
  status: AgentStatus;
};

export const AGENT_IDENTITIES: Record<string, AgentIdentity> = {
  executive_agent: {
    agentType: "executive_agent",
    name: "Atlas",
    role: "Chief Operations Agent",
    department: "Executive Intelligence",
    description: "Analyzes overall business health, synthesizes cross-agent signals, and generates executive briefs and strategic recommendations.",
    avatarInitials: "AT",
    avatarColor: "indigo",
    capabilityManifest: [
      "Generate executive business briefs",
      "Synthesize multi-agent signals",
      "Identify strategic priorities",
      "Track organizational health score",
      "Orchestrate cross-agent workflows",
    ],
    defaultAutonomyLevel: "collaborative",
    defaultRiskTolerance: "low",
    toolCategories: ["analytics", "internal"],
    status: "active",
  },

  retention_agent: {
    agentType: "retention_agent",
    name: "Pulse",
    role: "Client Retention Agent",
    department: "Client Success",
    description: "Monitors client health, detects churn risk, and orchestrates retention workflows with personalized outreach.",
    avatarInitials: "PL",
    avatarColor: "emerald",
    capabilityManifest: [
      "Detect churn risk signals",
      "Create retention outreach drafts",
      "Monitor session attendance patterns",
      "Trigger re-engagement workflows",
      "Track client health scores",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "low",
    toolCategories: ["communication", "crm", "analytics"],
    status: "active",
  },

  growth_agent: {
    agentType: "growth_agent",
    name: "Apex",
    role: "Growth & Revenue Agent",
    department: "Revenue Operations",
    description: "Identifies revenue opportunities, manages lead pipelines, and coordinates team training prospecting campaigns.",
    avatarInitials: "AX",
    avatarColor: "violet",
    capabilityManifest: [
      "Identify upsell opportunities",
      "Manage team training leads",
      "Generate outreach campaigns",
      "Track deal pipeline health",
      "Analyze revenue patterns",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "medium",
    toolCategories: ["communication", "crm", "analytics"],
    status: "active",
  },

  scheduling_agent: {
    agentType: "scheduling_agent",
    name: "Tempo",
    role: "Scheduling Intelligence Agent",
    department: "Operations",
    description: "Optimizes session schedules, manages calendar conflicts, and ensures coach-client session availability.",
    avatarInitials: "TM",
    avatarColor: "blue",
    capabilityManifest: [
      "Optimize session scheduling",
      "Detect scheduling conflicts",
      "Create calendar events",
      "Send session reminders",
      "Analyze coach workload",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "low",
    toolCategories: ["scheduling", "communication"],
    status: "active",
  },

  finance_agent: {
    agentType: "finance_agent",
    name: "Ledger",
    role: "Financial Operations Agent",
    department: "Finance",
    description: "Manages invoicing, payment tracking, subscription health, and financial risk detection.",
    avatarInitials: "LG",
    avatarColor: "amber",
    capabilityManifest: [
      "Create and send invoices",
      "Track payment status",
      "Detect subscription risks",
      "Generate financial summaries",
      "Flag overdue accounts",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "low",
    toolCategories: ["financial", "crm"],
    status: "active",
  },

  communication_agent: {
    agentType: "communication_agent",
    name: "Relay",
    role: "Communications Agent",
    department: "Client Communications",
    description: "Drafts and sends client-facing emails, SMS, and follow-up sequences with organization voice alignment.",
    avatarInitials: "RL",
    avatarColor: "cyan",
    capabilityManifest: [
      "Draft personalized emails",
      "Send approved email campaigns",
      "Send SMS messages",
      "Manage follow-up sequences",
      "Track communication history",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "medium",
    toolCategories: ["communication"],
    status: "active",
  },

  research_agent: {
    agentType: "research_agent",
    name: "Vector",
    role: "Research & Enrichment Agent",
    department: "Intelligence",
    description: "Conducts web research to enrich lead profiles, find decision-maker contacts, and gather prospect intelligence.",
    avatarInitials: "VC",
    avatarColor: "orange",
    capabilityManifest: [
      "Enrich lead contact data",
      "Find decision-maker emails",
      "Research prospect organizations",
      "Validate contact quality",
      "Aggregate intelligence signals",
    ],
    defaultAutonomyLevel: "collaborative",
    defaultRiskTolerance: "low",
    toolCategories: ["research", "crm"],
    status: "active",
  },

  workflow_agent: {
    agentType: "workflow_agent",
    name: "Nexus",
    role: "Workflow Orchestration Agent",
    department: "Operations",
    description: "Manages automated workflow execution, step sequencing, and operator approval routing.",
    avatarInitials: "NX",
    avatarColor: "pink",
    capabilityManifest: [
      "Trigger automated workflows",
      "Route approval requests",
      "Monitor workflow health",
      "Handle workflow branching",
      "Coordinate multi-step sequences",
    ],
    defaultAutonomyLevel: "supervised",
    defaultRiskTolerance: "low",
    toolCategories: ["internal", "workflow"],
    status: "active",
  },

  system_agent: {
    agentType: "system_agent",
    name: "Core",
    role: "System Operations Agent",
    department: "Infrastructure",
    description: "Handles internal system operations, data maintenance, memory lifecycle, and platform health monitoring.",
    avatarInitials: "CR",
    avatarColor: "gray",
    capabilityManifest: [
      "Run memory lifecycle management",
      "Monitor platform health",
      "Manage data integrity",
      "Coordinate background operations",
      "System-level auditing",
    ],
    defaultAutonomyLevel: "autonomous",
    defaultRiskTolerance: "low",
    toolCategories: ["internal"],
    status: "active",
  },
};

export function getAgentIdentity(agentType: string): AgentIdentity | undefined {
  return AGENT_IDENTITIES[agentType];
}

/** Resolve agentName string (e.g. "workflow:retention_recovery") to a named identity */
export function resolveAgentIdentity(agentName: string): AgentIdentity | undefined {
  const normalized = agentName.toLowerCase();
  for (const [type, identity] of Object.entries(AGENT_IDENTITIES)) {
    if (normalized.includes(type) || normalized === identity.name.toLowerCase()) {
      return identity;
    }
  }
  // Fallback: match partial type names
  if (normalized.includes("retention")) return AGENT_IDENTITIES.retention_agent;
  if (normalized.includes("growth") || normalized.includes("revenue")) return AGENT_IDENTITIES.growth_agent;
  if (normalized.includes("schedule") || normalized.includes("scheduling")) return AGENT_IDENTITIES.scheduling_agent;
  if (normalized.includes("finance") || normalized.includes("financial")) return AGENT_IDENTITIES.finance_agent;
  if (normalized.includes("communication") || normalized.includes("email") || normalized.includes("sms")) return AGENT_IDENTITIES.communication_agent;
  if (normalized.includes("research") || normalized.includes("enrich")) return AGENT_IDENTITIES.research_agent;
  if (normalized.includes("workflow") || normalized.includes("nexus")) return AGENT_IDENTITIES.workflow_agent;
  if (normalized.includes("brain") || normalized.includes("executive") || normalized.includes("atlas")) return AGENT_IDENTITIES.executive_agent;
  return AGENT_IDENTITIES.system_agent;
}

export function listAgentIdentities(): AgentIdentity[] {
  return Object.values(AGENT_IDENTITIES);
}
