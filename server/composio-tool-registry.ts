/**
 * Composio Tool Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines:
 *   1. COMPOSIO_TOOLS     — supported tools and their allowed actions
 *   2. AGENT_PERMISSIONS  — which agents may use which tools
 *   3. Helper utilities   — permission checking, tool lookup
 *
 * Rules:
 *   - No agent automatically gains access to every tool.
 *   - Stripe is read-only in Phase 1 — no write actions.
 *   - GitHub is write-protected for all agents except Software Improvement Agent,
 *     and even then only through human-approved paths.
 */

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export type ComposioToolId =
  | "GMAIL"
  | "GOOGLECALENDAR"
  | "SLACK"
  | "GOOGLESHEETS"
  | "GITHUB"
  | "STRIPE";

export interface ComposioToolDefinition {
  id: ComposioToolId;
  displayName: string;
  category: "communication" | "calendar" | "productivity" | "development" | "payments";
  description: string;
  readOnly: boolean;
  requiresApproval: boolean;
  allowedActions: string[];
  blockedActions: string[];
}

export const COMPOSIO_TOOLS: Record<ComposioToolId, ComposioToolDefinition> = {
  GMAIL: {
    id: "GMAIL",
    displayName: "Gmail",
    category: "communication",
    description: "Send, draft, and read emails via Gmail",
    readOnly: false,
    requiresApproval: true,
    allowedActions: [
      "GMAIL_CREATE_EMAIL_DRAFT",
      "GMAIL_FETCH_EMAILS",
      "GMAIL_GET_PROFILE",
      "GMAIL_LIST_THREADS",
      "GMAIL_GET_THREAD",
      "GMAIL_REPLY_TO_THREAD",
    ],
    blockedActions: [
      "GMAIL_SEND_EMAIL",
    ],
  },

  GOOGLECALENDAR: {
    id: "GOOGLECALENDAR",
    displayName: "Google Calendar",
    category: "calendar",
    description: "Read and write calendar events through human-approved workflows",
    readOnly: false,
    requiresApproval: true,
    allowedActions: [
      // Read actions — executed directly (no approval gate in read endpoints)
      "GOOGLECALENDAR_LIST_CALENDARS",
      "GOOGLECALENDAR_EVENTS_LIST",        // correct v3.1 slug (GOOGLECALENDAR_LIST_EVENTS does not exist)
      "GOOGLECALENDAR_EVENTS_GET",         // correct v3.1 slug (GOOGLECALENDAR_GET_EVENT does not exist)
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
      "GOOGLECALENDAR_FIND_EVENT",
      // Write actions — routed through approval queue only; requiresApproval: true guarantees
      // these can never auto-execute from the adapter.
      "GOOGLECALENDAR_CREATE_EVENT",
      "GOOGLECALENDAR_UPDATE_EVENT",
      "GOOGLECALENDAR_DELETE_EVENT",
    ],
    blockedActions: [
      // Destructive bulk operations — permanently blocked
      "GOOGLECALENDAR_CLEAR_CALENDAR",
      "GOOGLECALENDAR_CALENDARS_DELETE",
      "GOOGLECALENDAR_BATCH_EVENTS",
    ],
  },

  SLACK: {
    id: "SLACK",
    displayName: "Slack",
    category: "communication",
    description: "Post messages and read channels in Slack",
    readOnly: false,
    requiresApproval: true,
    allowedActions: [
      "SLACK_SEND_MESSAGE",
      "SLACK_LIST_CHANNELS",
      "SLACK_LIST_MEMBERS_IN_CHANNEL",
      "SLACK_GET_CHANNEL_INFO",
      "SLACK_CREATE_CHANNEL",
      "SLACK_INVITE_USER_TO_CHANNEL",
      "SLACK_FETCH_CONVERSATION_HISTORY",
    ],
    blockedActions: [],
  },

  GOOGLESHEETS: {
    id: "GOOGLESHEETS",
    displayName: "Google Sheets",
    category: "productivity",
    description: "Read from and write to Google Sheets",
    readOnly: false,
    requiresApproval: false,
    allowedActions: [
      "GOOGLESHEETS_BATCH_GET",
      "GOOGLESHEETS_GET_SPREADSHEET",
      "GOOGLESHEETS_SHEET_FROM_JSON",
      "GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW",
      "GOOGLESHEETS_UPDATE_SPREADSHEET_ROW",
      "GOOGLESHEETS_CREATE_SPREADSHEET",
      "GOOGLESHEETS_CREATE_GOOGLE_SHEET",
      "GOOGLESHEETS_CLEAR_VALUES",
    ],
    blockedActions: [],
  },

  GITHUB: {
    id: "GITHUB",
    displayName: "GitHub",
    category: "development",
    // Phase 2A: GITHUB_CREATE_AN_ISSUE is the sole write action permitted under
    // explicit human approval. All other write actions remain blocked. The tool
    // is still classified readOnly for all autonomous paths; the create-issue
    // action is only reachable after requiresApproval forces an approval queue
    // entry and an ADMIN explicitly executes it.
    description: "Read repositories, issues, and PRs. One write action (create issue) permitted only through explicit human approval.",
    readOnly: true,
    requiresApproval: true,
    allowedActions: [
      "GITHUB_LIST_REPOSITORIES",
      "GITHUB_GET_A_REPOSITORY",
      "GITHUB_LIST_REPOSITORY_ISSUES",
      "GITHUB_GET_AN_ISSUE",
      "GITHUB_LIST_PULL_REQUESTS",
      "GITHUB_GET_A_PULL_REQUEST",
      "GITHUB_LIST_COMMITS",
      "GITHUB_GET_A_COMMIT",
      "GITHUB_SEARCH_CODE",
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
      // Phase 2A: promoted from blockedActions — routable through approval queue only.
      // requiresApproval: true above guarantees this can never auto-execute.
      "GITHUB_CREATE_AN_ISSUE",
    ],
    blockedActions: [
      // All other write actions remain blocked — no Phase 2A promotion.
      "GITHUB_UPDATE_AN_ISSUE",
      "GITHUB_CREATE_A_PULL_REQUEST",
      "GITHUB_MERGE_A_PULL_REQUEST",
      "GITHUB_DELETE_A_REPOSITORY",
      "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
      "GITHUB_DELETE_A_FILE",
    ],
  },

  STRIPE: {
    id: "STRIPE",
    displayName: "Stripe",
    category: "payments",
    description: "Read-only access to Stripe data. No financial mutations.",
    readOnly: true,
    requiresApproval: true,
    allowedActions: [
      "STRIPE_LIST_CUSTOMERS",
      "STRIPE_RETRIEVE_CUSTOMER",
      "STRIPE_LIST_SUBSCRIPTIONS",
      "STRIPE_RETRIEVE_SUBSCRIPTION",
      "STRIPE_LIST_INVOICES",
      "STRIPE_RETRIEVE_INVOICE",
      "STRIPE_LIST_CHARGES",
      "STRIPE_RETRIEVE_CHARGE",
      "STRIPE_LIST_PAYMENT_INTENTS",
    ],
    blockedActions: [
      "STRIPE_CREATE_CUSTOMER",
      "STRIPE_UPDATE_CUSTOMER",
      "STRIPE_DELETE_CUSTOMER",
      "STRIPE_CREATE_SUBSCRIPTION",
      "STRIPE_CANCEL_SUBSCRIPTION",
      "STRIPE_CREATE_PAYMENT_INTENT",
      "STRIPE_CONFIRM_PAYMENT_INTENT",
      "STRIPE_CREATE_REFUND",
      "STRIPE_CREATE_PAYOUT",
    ],
  },
};

// ─── Agent Identifiers ────────────────────────────────────────────────────────

export type ComposioAgentId =
  | "ceo_heartbeat"
  | "executive_agent"
  | "revenue_agent"
  | "scheduling_agent"
  | "growth_agent"
  | "software_improvement_agent"
  | "email_agent"
  | "lead_intake_agent"
  | "communication_agent";

// ─── Agent Permissions ────────────────────────────────────────────────────────

export interface AgentPermissionEntry {
  agentId: ComposioAgentId;
  displayName: string;
  description: string;
  allowedTools: ComposioToolId[];
}

export const AGENT_PERMISSIONS: Record<ComposioAgentId, AgentPermissionEntry> = {
  ceo_heartbeat: {
    agentId: "ceo_heartbeat",
    displayName: "CEO Heartbeat Agent",
    description: "Orchestrates daily business intelligence across all systems",
    allowedTools: ["GMAIL", "GOOGLECALENDAR", "SLACK", "GOOGLESHEETS"],
  },
  executive_agent: {
    agentId: "executive_agent",
    displayName: "Executive Agent",
    description: "Sends internal executive and operational Slack alerts (Phase 2C)",
    allowedTools: ["SLACK"],
  },
  revenue_agent: {
    agentId: "revenue_agent",
    displayName: "Revenue Agent",
    description: "Manages revenue recovery, deal pipeline, and prospect outreach",
    // Phase 2C: SLACK added for critical revenue alerts (approval-required)
    allowedTools: ["GMAIL", "GOOGLECALENDAR", "SLACK"],
  },
  scheduling_agent: {
    agentId: "scheduling_agent",
    displayName: "Scheduling Agent",
    description: "Handles session booking, calendar management, and availability",
    allowedTools: ["GOOGLECALENDAR", "GMAIL"],
  },
  growth_agent: {
    agentId: "growth_agent",
    displayName: "Growth Agent",
    description: "Manages lead tracking, growth metrics, and reporting",
    allowedTools: ["GOOGLESHEETS", "GMAIL"],
  },
  software_improvement_agent: {
    agentId: "software_improvement_agent",
    displayName: "Software Improvement Agent",
    description: "Monitors code quality, issues, and engineering health",
    // Phase 2C: SLACK added for critical engineering alerts (approval-required)
    allowedTools: ["GITHUB", "SLACK"],
  },
  email_agent: {
    agentId: "email_agent",
    displayName: "Email Agent",
    description: "Drafts and manages outbound email communications",
    allowedTools: ["GMAIL"],
  },
  lead_intake_agent: {
    agentId: "lead_intake_agent",
    displayName: "Lead Intake Agent",
    description: "Processes and enriches incoming leads",
    allowedTools: ["GMAIL", "GOOGLESHEETS"],
  },
  communication_agent: {
    agentId: "communication_agent",
    displayName: "Communication Agent",
    description: "Handles multi-channel communication and outreach",
    allowedTools: ["GMAIL", "SLACK"],
  },
};

// ─── Permission Helpers ───────────────────────────────────────────────────────

export function isAgentAllowedTool(agentId: string, toolId: string): boolean {
  const agent = AGENT_PERMISSIONS[agentId as ComposioAgentId];
  if (!agent) return false;
  return agent.allowedTools.includes(toolId.toUpperCase() as ComposioToolId);
}

export function isActionAllowed(toolId: string, actionName: string): boolean {
  const tool = COMPOSIO_TOOLS[toolId.toUpperCase() as ComposioToolId];
  if (!tool) return false;
  const upper = actionName.toUpperCase();
  if (tool.blockedActions.map(a => a.toUpperCase()).includes(upper)) return false;
  return tool.allowedActions.map(a => a.toUpperCase()).includes(upper);
}

export function getAgentTools(agentId: string): ComposioToolDefinition[] {
  const agent = AGENT_PERMISSIONS[agentId as ComposioAgentId];
  if (!agent) return [];
  return agent.allowedTools.map(t => COMPOSIO_TOOLS[t]).filter(Boolean);
}

export function getPermissionDeniedReason(
  agentId: string,
  toolId: string,
  actionName: string,
): string | null {
  const agent = AGENT_PERMISSIONS[agentId as ComposioAgentId];
  if (!agent) return `Unknown agent: ${agentId}`;

  if (!isAgentAllowedTool(agentId, toolId)) {
    return `Agent "${agent.displayName}" does not have permission to use tool "${toolId}". Allowed tools: ${agent.allowedTools.join(", ")}`;
  }

  const tool = COMPOSIO_TOOLS[toolId.toUpperCase() as ComposioToolId];
  const upper = actionName.toUpperCase();
  if (tool.blockedActions.map(a => a.toUpperCase()).includes(upper)) {
    return `Action "${actionName}" is explicitly blocked for tool "${toolId}" in Phase 1`;
  }
  if (!tool.allowedActions.map(a => a.toUpperCase()).includes(upper)) {
    return `Action "${actionName}" is not in the allowed list for tool "${toolId}"`;
  }

  return null;
}

export function doesToolRequireApproval(toolId: string): boolean {
  const tool = COMPOSIO_TOOLS[toolId.toUpperCase() as ComposioToolId];
  return tool?.requiresApproval ?? true;
}

export function isToolReadOnly(toolId: string): boolean {
  const tool = COMPOSIO_TOOLS[toolId.toUpperCase() as ComposioToolId];
  return tool?.readOnly ?? false;
}

export function getAllAgentPermissions(): AgentPermissionEntry[] {
  return Object.values(AGENT_PERMISSIONS);
}

export function getRegistrySnapshot() {
  return {
    tools: Object.values(COMPOSIO_TOOLS),
    agentPermissions: getAllAgentPermissions(),
    totalTools: Object.keys(COMPOSIO_TOOLS).length,
    totalAgents: Object.keys(AGENT_PERMISSIONS).length,
    phase: 1,
    generatedAt: new Date().toISOString(),
  };
}
