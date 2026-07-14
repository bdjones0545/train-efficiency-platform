/**
 * Kevin Executive Capability Registry — Phase 2
 *
 * Single source of truth for every action Kevin may request.
 * Each capability is fully typed with:
 *   - unique key and display metadata
 *   - category
 *   - risk classification
 *   - permitted roles
 *   - supported capability modes
 *   - approval requirements by risk
 *   - executor service binding
 *   - verification strategy
 *   - timeout and retry policy
 *   - idempotency requirements
 *
 * Design: capability definitions are code-defined constants (immutable).
 * Per-org mode settings live in the existing `kevin_capabilities` DB table.
 * New capabilities default to `require_approval` (safe default).
 *
 * Add new capabilities here without changing Kevin's core orchestration logic.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type CapabilityMode = "disabled" | "observe" | "recommend" | "draft" | "require_approval" | "auto";
export type CapabilityCategory =
  | "communication"
  | "agent_management"
  | "scheduling"
  | "crm_revenue"
  | "platform_operations"
  | "ceo_interface";

export type VerificationStrategy =
  | "existence_check"        // verify the artifact/record exists
  | "schema_check"           // verify agent output matches expected schema
  | "delivery_check"         // verify delivery status (email, notification)
  | "conflict_check"         // verify no resource conflict exists
  | "ownership_check"        // verify org-owned record changed
  | "route_access_check"     // verify user has route access
  | "no_verification"        // low-risk read-only ops
  | "custom";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];       // delay per attempt in ms
  retryOn: string[];         // error codes that warrant retry
}

export interface CapabilityDefinition {
  key: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;

  // Risk
  riskLevel: RiskLevel;

  // Access control
  permittedRoles: string[];                     // TE roles allowed to initiate

  // Supported modes (what modes this capability can run in)
  supportedModes: CapabilityMode[];

  // Default mode (applied when org has no override)
  defaultMode: CapabilityMode;

  // Whether this capability creates an approval before acting
  requiresApprovalAt: RiskLevel;               // approve if intent risk >= this

  // Organization isolation requirement
  requiresOrgScope: boolean;

  // Which TE service/module executes this
  executorService: string;

  // How to verify the outcome
  verificationStrategy: VerificationStrategy;

  // Rollback behavior
  isReversible: boolean;
  rollbackDescription?: string;

  // Timing
  timeoutSeconds: number;
  retryPolicy: RetryPolicy;

  // Idempotency
  idempotent: boolean;

  // Audit metadata
  auditRequired: boolean;
  sensitiveData: boolean;     // redact payload fields in audit log
}

// ─── Capability catalogue ─────────────────────────────────────────────────────

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {

  // ──────────────────────────────────────────────────────────────────────────
  // COMMUNICATION
  // ──────────────────────────────────────────────────────────────────────────

  "email.create_draft": {
    key: "email.create_draft",
    displayName: "Create Email Draft",
    description: "Ask AgentMail to create a new outbound email draft using organizational context.",
    category: "communication",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "draft", "require_approval", "auto"],
    defaultMode: "draft",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Delete the draft from AgentMail queue.",
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT", "SERVICE_UNAVAILABLE"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "email.reply_draft": {
    key: "email.reply_draft",
    displayName: "Create Reply Draft",
    description: "Ask AgentMail to create a reply draft to an existing conversation.",
    category: "communication",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "draft", "require_approval", "auto"],
    defaultMode: "draft",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Delete the draft from AgentMail queue.",
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "email.send": {
    key: "email.send",
    displayName: "Send Email",
    description: "Send an approved AgentMail draft. Requires explicit human approval unless auto mode is enabled.",
    category: "communication",
    riskLevel: "high",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "delivery_check",
    isReversible: false,
    timeoutSeconds: 120,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: false,
    auditRequired: true,
    sensitiveData: true,
  },

  "email.forward": {
    key: "email.forward",
    displayName: "Forward Email",
    description: "Forward an email to another recipient via AgentMail.",
    category: "communication",
    riskLevel: "high",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "delivery_check",
    isReversible: false,
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: false,
    auditRequired: true,
    sensitiveData: true,
  },

  "email.archive": {
    key: "email.archive",
    displayName: "Archive Email",
    description: "Archive a message in the AgentMail inbox.",
    category: "communication",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Unarchive the message.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "ceo.send_brief": {
    key: "ceo.send_brief",
    displayName: "Send CEO Brief",
    description: "Trigger the CEO Agent to send an executive briefing.",
    category: "ceo_interface",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["recommend", "draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "ceo_agent",
    verificationStrategy: "delivery_check",
    isReversible: false,
    timeoutSeconds: 120,
    retryPolicy: { maxAttempts: 2, backoffMs: [10000, 30000], retryOn: ["TIMEOUT"] },
    idempotent: false,
    auditRequired: true,
    sensitiveData: false,
  },

  "ceo.ask_question": {
    key: "ceo.ask_question",
    displayName: "Ask CEO Agent a Question",
    description: "Submit a question to the CEO Agent for analysis and response.",
    category: "ceo_interface",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "draft", "require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "ceo_agent",
    verificationStrategy: "schema_check",
    isReversible: true,
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "ceo.request_decision": {
    key: "ceo.request_decision",
    displayName: "Request CEO Decision",
    description: "Ask the CEO Agent to evaluate options and produce a decision recommendation.",
    category: "ceo_interface",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["recommend", "draft", "require_approval", "auto"],
    defaultMode: "recommend",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "ceo_agent",
    verificationStrategy: "schema_check",
    isReversible: true,
    timeoutSeconds: 90,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 20000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "ceo.escalate_issue": {
    key: "ceo.escalate_issue",
    displayName: "Escalate Issue to CEO Agent",
    description: "Escalate a risk or critical situation to the CEO Agent for immediate review.",
    category: "ceo_interface",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["recommend", "require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "ceo_agent",
    verificationStrategy: "schema_check",
    isReversible: true,
    timeoutSeconds: 45,
    retryPolicy: { maxAttempts: 3, backoffMs: [5000, 15000, 30000], retryOn: ["TIMEOUT", "SERVICE_UNAVAILABLE"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  "agent.assign_task": {
    key: "agent.assign_task",
    displayName: "Assign Task to Agent",
    description: "Create and assign a structured task to a TE specialist agent.",
    category: "agent_management",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["recommend", "draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "schema_check",
    isReversible: true,
    rollbackDescription: "Cancel the task if it has not yet started.",
    timeoutSeconds: 300,
    retryPolicy: { maxAttempts: 2, backoffMs: [10000, 30000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.change_priority": {
    key: "agent.change_priority",
    displayName: "Change Agent Task Priority",
    description: "Update the priority of an existing agent task.",
    category: "agent_management",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "ownership_check",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.request_analysis": {
    key: "agent.request_analysis",
    displayName: "Request Agent Analysis",
    description: "Ask a specialist agent to perform data analysis and return structured findings.",
    category: "agent_management",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "draft", "require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "schema_check",
    isReversible: true,
    timeoutSeconds: 120,
    retryPolicy: { maxAttempts: 2, backoffMs: [10000, 30000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.request_recommendation": {
    key: "agent.request_recommendation",
    displayName: "Request Agent Recommendation",
    description: "Ask a specialist agent to generate a strategic recommendation.",
    category: "agent_management",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "schema_check",
    isReversible: true,
    timeoutSeconds: 120,
    retryPolicy: { maxAttempts: 2, backoffMs: [10000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.review_output": {
    key: "agent.review_output",
    displayName: "Review Agent Output",
    description: "Inspect and evaluate the output of a completed agent task.",
    category: "agent_management",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "no_verification",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: true,
    auditRequired: false,
    sensitiveData: false,
  },

  "agent.pause_task": {
    key: "agent.pause_task",
    displayName: "Pause Agent Task",
    description: "Pause an in-progress agent task.",
    category: "agent_management",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "ownership_check",
    isReversible: true,
    rollbackDescription: "Resume the task.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.resume_task": {
    key: "agent.resume_task",
    displayName: "Resume Agent Task",
    description: "Resume a previously paused agent task.",
    category: "agent_management",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "ownership_check",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "agent.cancel_task": {
    key: "agent.cancel_task",
    displayName: "Cancel Agent Task",
    description: "Cancel a pending or in-progress agent task.",
    category: "agent_management",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "agent_task_bus",
    verificationStrategy: "ownership_check",
    isReversible: false,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // SCHEDULING
  // ──────────────────────────────────────────────────────────────────────────

  "schedule.create_session": {
    key: "schedule.create_session",
    displayName: "Create Scheduled Session",
    description: "Create a new coaching session in the TrainEfficiency scheduling system.",
    category: "scheduling",
    riskLevel: "medium",
    permittedRoles: ["ADMIN", "COACH"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "scheduling_agent",
    verificationStrategy: "conflict_check",
    isReversible: true,
    rollbackDescription: "Cancel the created session.",
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT", "CONFLICT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "schedule.reschedule_session": {
    key: "schedule.reschedule_session",
    displayName: "Reschedule Session",
    description: "Move an existing session to a new time slot.",
    category: "scheduling",
    riskLevel: "medium",
    permittedRoles: ["ADMIN", "COACH"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "scheduling_agent",
    verificationStrategy: "conflict_check",
    isReversible: true,
    rollbackDescription: "Restore the original session time.",
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT", "CONFLICT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "schedule.cancel_session": {
    key: "schedule.cancel_session",
    displayName: "Cancel Session",
    description: "Cancel an existing coaching session.",
    category: "scheduling",
    riskLevel: "high",
    permittedRoles: ["ADMIN", "COACH"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "scheduling_agent",
    verificationStrategy: "ownership_check",
    isReversible: false,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "schedule.find_availability": {
    key: "schedule.find_availability",
    displayName: "Find Availability",
    description: "Query the scheduling system for available time slots.",
    category: "scheduling",
    riskLevel: "low",
    permittedRoles: ["ADMIN", "COACH"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "scheduling_agent",
    verificationStrategy: "no_verification",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: false,
    sensitiveData: false,
  },

  "schedule.assign_coach": {
    key: "schedule.assign_coach",
    displayName: "Assign Coach to Session",
    description: "Assign a specific coach to an existing session.",
    category: "scheduling",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "scheduling_agent",
    verificationStrategy: "ownership_check",
    isReversible: true,
    rollbackDescription: "Unassign the coach.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // CRM & REVENUE
  // ──────────────────────────────────────────────────────────────────────────

  "lead.create": {
    key: "lead.create",
    displayName: "Create Lead",
    description: "Create a new team training lead record.",
    category: "crm_revenue",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "crm_service",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Delete the created lead.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000, 10000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "lead.update": {
    key: "lead.update",
    displayName: "Update Lead",
    description: "Update fields on an existing team training lead.",
    category: "crm_revenue",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "crm_service",
    verificationStrategy: "ownership_check",
    isReversible: true,
    rollbackDescription: "Revert the previous field values.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "lead.assign": {
    key: "lead.assign",
    displayName: "Assign Lead",
    description: "Assign a lead to a specific coach or team member.",
    category: "crm_revenue",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "crm_service",
    verificationStrategy: "ownership_check",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "lead.request_followup": {
    key: "lead.request_followup",
    displayName: "Request Lead Follow-Up",
    description: "Ask AgentMail to prepare a follow-up outreach for an inactive lead.",
    category: "crm_revenue",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval", "auto"],
    defaultMode: "draft",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Delete the draft.",
    timeoutSeconds: 60,
    retryPolicy: { maxAttempts: 2, backoffMs: [5000, 15000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "campaign.create_draft": {
    key: "campaign.create_draft",
    displayName: "Create Campaign Draft",
    description: "Generate an outreach campaign draft for a target segment.",
    category: "crm_revenue",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["draft", "require_approval"],
    defaultMode: "draft",
    requiresApprovalAt: "medium",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Delete the campaign draft.",
    timeoutSeconds: 120,
    retryPolicy: { maxAttempts: 2, backoffMs: [10000, 30000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "campaign.request_launch": {
    key: "campaign.request_launch",
    displayName: "Request Campaign Launch",
    description: "Submit an approved campaign for sending. Always requires human approval.",
    category: "crm_revenue",
    riskLevel: "critical",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval"],
    defaultMode: "require_approval",
    requiresApprovalAt: "low",
    requiresOrgScope: true,
    executorService: "agentmail",
    verificationStrategy: "delivery_check",
    isReversible: false,
    timeoutSeconds: 300,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: false,
    auditRequired: true,
    sensitiveData: true,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // PLATFORM OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────

  "platform.open_location": {
    key: "platform.open_location",
    displayName: "Navigate to Location",
    description: "Return a structured navigation action directing the user to a specific TE interface.",
    category: "platform_operations",
    riskLevel: "low",
    permittedRoles: ["ADMIN", "COACH", "STAFF"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: false,
    executorService: "navigation_registry",
    verificationStrategy: "route_access_check",
    isReversible: true,
    timeoutSeconds: 10,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: true,
    auditRequired: false,
    sensitiveData: false,
  },

  "platform.retrieve_context": {
    key: "platform.retrieve_context",
    displayName: "Retrieve Platform Context",
    description: "Retrieve structured context from one or more TE domains.",
    category: "platform_operations",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "context_service",
    verificationStrategy: "no_verification",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: false,
    sensitiveData: false,
  },

  "platform.create_attention_item": {
    key: "platform.create_attention_item",
    displayName: "Create Attention Item",
    description: "Surface a structured item in the TrainEfficiency Attention Inbox.",
    category: "platform_operations",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["recommend", "draft", "require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "attention_inbox",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Dismiss or archive the attention item.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000, 10000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "platform.create_approval": {
    key: "platform.create_approval",
    displayName: "Create Approval Request",
    description: "Create a structured approval record for a human decision.",
    category: "platform_operations",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "approval_service",
    verificationStrategy: "existence_check",
    isReversible: true,
    rollbackDescription: "Cancel the approval request.",
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 2, backoffMs: [3000], retryOn: ["TIMEOUT"] },
    idempotent: true,
    auditRequired: true,
    sensitiveData: false,
  },

  "platform.inspect_job": {
    key: "platform.inspect_job",
    displayName: "Inspect Background Job",
    description: "Retrieve the status and logs of a TrainEfficiency background job.",
    category: "platform_operations",
    riskLevel: "low",
    permittedRoles: ["ADMIN"],
    supportedModes: ["observe", "recommend", "auto"],
    defaultMode: "auto",
    requiresApprovalAt: "critical",
    requiresOrgScope: true,
    executorService: "job_inspector",
    verificationStrategy: "no_verification",
    isReversible: true,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: true,
    auditRequired: false,
    sensitiveData: false,
  },

  "platform.retry_failed_job": {
    key: "platform.retry_failed_job",
    displayName: "Retry Failed Job",
    description: "Re-queue a failed background job for re-execution.",
    category: "platform_operations",
    riskLevel: "medium",
    permittedRoles: ["ADMIN"],
    supportedModes: ["require_approval", "auto"],
    defaultMode: "require_approval",
    requiresApprovalAt: "high",
    requiresOrgScope: true,
    executorService: "job_inspector",
    verificationStrategy: "existence_check",
    isReversible: false,
    timeoutSeconds: 30,
    retryPolicy: { maxAttempts: 1, backoffMs: [], retryOn: [] },
    idempotent: false,
    auditRequired: true,
    sensitiveData: false,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getCapabilityDefinition(key: string): CapabilityDefinition | null {
  return CAPABILITY_REGISTRY[key] ?? null;
}

export function listCapabilityKeys(): string[] {
  return Object.keys(CAPABILITY_REGISTRY);
}

export function listCapabilitiesByCategory(category: CapabilityCategory): CapabilityDefinition[] {
  return Object.values(CAPABILITY_REGISTRY).filter((c) => c.category === category);
}

export function getCapabilityCategories(): CapabilityCategory[] {
  const cats = new Set<CapabilityCategory>();
  for (const cap of Object.values(CAPABILITY_REGISTRY)) {
    cats.add(cap.category);
  }
  return [...cats];
}

/**
 * Returns true if the requested mode is supported by this capability definition.
 */
export function isModeSupported(capKey: string, mode: CapabilityMode): boolean {
  const cap = CAPABILITY_REGISTRY[capKey];
  if (!cap) return false;
  return cap.supportedModes.includes(mode);
}

/**
 * Risk level ordering (lowest to highest).
 */
const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

export function riskIndex(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

/**
 * Returns true if the intent risk meets or exceeds the requiresApprovalAt threshold.
 */
export function approvalRequired(capKey: string, intentRisk: RiskLevel): boolean {
  const cap = CAPABILITY_REGISTRY[capKey];
  if (!cap) return true; // unknown capability — require approval
  return riskIndex(intentRisk) >= riskIndex(cap.requiresApprovalAt);
}

/**
 * For the Kevin Action API: serialize a capability definition to a safe public shape.
 */
export function serializeCapability(cap: CapabilityDefinition) {
  return {
    key: cap.key,
    displayName: cap.displayName,
    description: cap.description,
    category: cap.category,
    riskLevel: cap.riskLevel,
    permittedRoles: cap.permittedRoles,
    supportedModes: cap.supportedModes,
    defaultMode: cap.defaultMode,
    isReversible: cap.isReversible,
    rollbackDescription: cap.rollbackDescription ?? null,
    requiresApprovalAt: cap.requiresApprovalAt,
    timeoutSeconds: cap.timeoutSeconds,
    idempotent: cap.idempotent,
    auditRequired: cap.auditRequired,
    executorService: cap.executorService,
    verificationStrategy: cap.verificationStrategy,
  };
}
