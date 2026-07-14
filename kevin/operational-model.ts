/**
 * Kevin Operational Model — Steps 5 & 6
 *
 * Durable platform record for TrainEfficiency.
 * Populated by calling buildOperationalModel() against the live /docs + /capabilities endpoints.
 *
 * NEVER stores credentials or sensitive payloads.
 * Safe to persist to institutional memory (docs/kevin-operational-model.json).
 */

import type { TrainEfficiencyClient, CapabilityRecord } from "./te-client";
import { obsCapabilityDiscovery } from "./observability";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapabilityEntry {
  key: string;
  version: string;
  description: string;
  category: string;
  riskLevel: string;
  currentEffectiveMode: string;
  permittedRoles: string[];
  approvalPolicy: string;
  executor: string;
  verificationStrategy: string;
  retryBehavior: { maxAttempts: number; backoffMs: number[] };
  idempotent: boolean;
  availability: "available" | "disabled" | "unknown";
  isExecutable: boolean; // false when disabled
}

export interface AgentEntry {
  id: string;
  name: string;
  responsibilities: string[];
  acceptedTaskTypes: string[];
  currentMode: string;
}

export interface OperationalModel {
  platformName: string;
  environment: string;
  baseUrl: string;
  documentationEndpoint: string;
  authenticationMethod: string;
  availableOrganizations: string[];
  capabilityCount: number;
  capabilityCatalog: CapabilityEntry[];
  currentCapabilityModes: Record<string, string>;
  supportedAgents: AgentEntry[];
  intentStates: string[];
  taskStates: string[];
  approvalStates: string[];
  outcomeTypes: string[];
  emergencyControls: string[];
  rateLimits: Record<string, number>;
  knownRestrictions: string[];
  integrationVersion: string;
  lastSuccessfulHealthCheck: string | null;
  lastCapabilityRefresh: string | null;
  buildTimestamp: string;
}

// ─── Known static values from control-plane docs ─────────────────────────────

const INTENT_STATES = [
  "received", "validating", "planned", "awaiting_approval",
  "queued", "executing", "verifying", "completed",
  "partially_completed", "failed", "cancelled", "dead_lettered",
];

const TASK_STATES = [
  "created", "blocked", "queued", "claimed", "executing",
  "awaiting_approval", "awaiting_dependency", "verifying",
  "completed", "failed", "cancelled", "dead_lettered",
];

const APPROVAL_STATES = ["pending", "approved", "rejected", "expired", "cancelled"];

const OUTCOME_TYPES = [
  "intent_completed", "intent_failed", "intent_cancelled",
  "task_completed", "task_failed",
  "draft_created", "draft_approved", "draft_rejected",
  "email_sent", "email_failed",
  "approval_approved", "approval_rejected",
  "policy_denied", "verification_failed", "verification_passed",
];

const EMERGENCY_CONTROLS = [
  "global_kill", "org_kill", "capability_kill",
  "read_only_mode", "circuit_breaker_open",
  "credentials_revoked", "email_auto_disabled", "agent_delegation_paused",
];

const KNOWN_RESTRICTIONS = [
  "Kevin must never receive unrestricted database access",
  "Kevin must never directly modify another agent's memory",
  "Kevin must never bypass existing business services",
  "Kevin must never be given one global 'manage everything' permission",
  "Every action must be an explicit capability with its own policy",
  "Organization ID is always validated server-side — never trusted from Kevin",
  "Emergency kill switches can halt all Kevin operations instantly",
  "agent.* capabilities hit verifyAgentTask() before observe-only check — use ceo.*/platform.* for no-DB verify",
  "riskIndex(level: RiskLevel) takes a level string, not a capability key",
  "approvalRequired(capKey, intentRisk: RiskLevel) requires both arguments",
  "Category 'platform_operations' (not 'platform') is the actual registry name",
];

const KNOWN_AGENTS: AgentEntry[] = [
  {
    id: "agentmail",
    name: "AgentMail",
    responsibilities: ["email draft creation", "email sending", "reply handling", "follow-up sequencing"],
    acceptedTaskTypes: ["email.create_draft", "email.send", "email.create_reply_draft"],
    currentMode: "require_approval",
  },
  {
    id: "ceo_agent",
    name: "CEO Agent",
    responsibilities: ["executive analysis", "risk evaluation", "recommendation review", "platform briefings"],
    acceptedTaskTypes: ["ceo.request_analysis", "ceo.request_briefing", "ceo.ask_question", "ceo.request_decision"],
    currentMode: "recommend",
  },
  {
    id: "scheduling_agent",
    name: "Scheduling Agent",
    responsibilities: ["session creation", "session rescheduling", "conflict detection", "availability queries"],
    acceptedTaskTypes: ["schedule.create_session", "schedule.reschedule_session", "schedule.cancel_session"],
    currentMode: "require_approval",
  },
  {
    id: "crm_service",
    name: "CRM Service",
    responsibilities: ["lead management", "revenue tracking", "deal pipeline", "contact enrichment"],
    acceptedTaskTypes: ["crm.update_lead_stage", "crm.create_deal", "crm.log_interaction"],
    currentMode: "require_approval",
  },
  {
    id: "navigation_registry",
    name: "Navigation Registry",
    responsibilities: ["route resolution", "platform navigation", "location suggestions"],
    acceptedTaskTypes: ["platform.open_location"],
    currentMode: "auto",
  },
  {
    id: "context_service",
    name: "Context Service",
    responsibilities: ["context retrieval", "institutional memory access", "record search"],
    acceptedTaskTypes: ["platform.retrieve_context", "platform.search_records"],
    currentMode: "observe",
  },
];

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build the operational model by querying the live TE control plane.
 * Safe to call at startup and periodically for refresh.
 */
export async function buildOperationalModel(
  client: TrainEfficiencyClient,
  orgId: string,
  baseUrl: string,
): Promise<OperationalModel> {
  const now = new Date().toISOString();

  // Health check
  let lastHealthCheck: string | null = null;
  try {
    const health = await client.health();
    if (health.status === "operational") lastHealthCheck = now;
  } catch { /* non-fatal */ }

  // Docs
  let docsEndpoint = `${baseUrl}/api/internal/kevin/v1/docs`;
  let integrationVersion = "1.0";
  try {
    const docs = await client.getDocs();
    integrationVersion = (docs.version as string) ?? "1.0";
    docsEndpoint = `${baseUrl}/api/internal/kevin/v1/docs`;
  } catch { /* non-fatal */ }

  // Capabilities
  let caps: CapabilityRecord[] = [];
  let lastCapRefresh: string | null = null;
  try {
    const result = await client.listCapabilities(orgId);
    caps = result.capabilities ?? [];
    lastCapRefresh = now;
    obsCapabilityDiscovery({ count: caps.length });
  } catch { /* non-fatal */ }

  const catalog: CapabilityEntry[] = caps.map((cap) => ({
    key: cap.key,
    version: "1",
    description: cap.description,
    category: cap.category,
    riskLevel: cap.riskLevel,
    currentEffectiveMode: cap.defaultMode,
    permittedRoles: cap.permittedRoles ?? [],
    approvalPolicy: cap.requiresApprovalAt ?? "medium",
    executor: cap.executorService ?? "unknown",
    verificationStrategy: cap.verificationStrategy ?? "no_verification",
    retryBehavior: { maxAttempts: 2, backoffMs: [1000, 3000] },
    idempotent: cap.idempotent ?? false,
    availability: cap.defaultMode === "disabled" ? "disabled" : "available",
    isExecutable: cap.defaultMode !== "disabled",
  }));

  const capModes: Record<string, string> = {};
  for (const cap of catalog) capModes[cap.key] = cap.currentEffectiveMode;

  return {
    platformName: "TrainEfficiency",
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    baseUrl,
    documentationEndpoint: docsEndpoint,
    authenticationMethod: "bearer_token + hmac_sha256_request_signing",
    availableOrganizations: orgId ? [orgId] : [],
    capabilityCount: catalog.length,
    capabilityCatalog: catalog,
    currentCapabilityModes: capModes,
    supportedAgents: KNOWN_AGENTS,
    intentStates: INTENT_STATES,
    taskStates: TASK_STATES,
    approvalStates: APPROVAL_STATES,
    outcomeTypes: OUTCOME_TYPES,
    emergencyControls: EMERGENCY_CONTROLS,
    rateLimits: { intentsPerMinute: 20, tasksPerIntent: 20, delegationDepth: 3 },
    knownRestrictions: KNOWN_RESTRICTIONS,
    integrationVersion,
    lastSuccessfulHealthCheck: lastHealthCheck,
    lastCapabilityRefresh: lastCapRefresh,
    buildTimestamp: now,
  };
}

/**
 * Serialize the operational model to a safe JSON string (no credentials).
 * Safe to write to docs/kevin-operational-model.json or Hermes memory.
 */
export function serializeOperationalModel(model: OperationalModel): string {
  return JSON.stringify(model, null, 2);
}

/**
 * Step 6: Check if a capability is executable (registered AND not disabled).
 * Never treat a disabled capability as executable.
 */
export function isCapabilityExecutable(model: OperationalModel, capabilityKey: string): boolean {
  const entry = model.capabilityCatalog.find((c) => c.key === capabilityKey);
  if (!entry) return false;
  return entry.isExecutable && entry.availability !== "disabled";
}

/**
 * Get the effective mode for a capability, falling back to "disabled" if unknown.
 */
export function getEffectiveMode(model: OperationalModel, capabilityKey: string): string {
  return model.currentCapabilityModes[capabilityKey] ?? "disabled";
}
