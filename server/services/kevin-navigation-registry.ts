/**
 * Kevin Navigation Registry — Phase 3
 *
 * Allowlisted navigation destinations Kevin may suggest.
 * Kevin MUST NOT generate arbitrary URLs.
 * Every returned route must be validated against this registry.
 * Role + feature checks must be performed before returning a suggestion.
 *
 * Structured suggestion shape:
 *   { type: "navigation_suggestion", label, route, reason }
 *
 * The user MUST click the suggestion — no automatic browser redirects.
 */

export type NavEntry = {
  intent: string;
  route: string;
  requiredRoles: string[];
  requiredFeature?: string;
  label: string;
  description: string;
};

export type NavSuggestion = {
  type: "navigation_suggestion";
  intent: string;
  label: string;
  route: string;
  reason: string;
};

const NAV_REGISTRY: NavEntry[] = [
  {
    intent: "configure_gmail",
    route: "/admin/integrations",
    requiredRoles: ["ADMIN"],
    label: "Open Gmail integration settings",
    description: "Configure the Gmail agent for outbound email",
  },
  {
    intent: "configure_slack",
    route: "/admin/integrations",
    requiredRoles: ["ADMIN"],
    label: "Open Slack integration settings",
    description: "Configure the Slack integration for team notifications",
  },
  {
    intent: "configure_calendar",
    route: "/admin/integrations",
    requiredRoles: ["ADMIN"],
    label: "Open Google Calendar integration settings",
    description: "Configure calendar integration for scheduling",
  },
  {
    intent: "configure_composio",
    route: "/admin/composio",
    requiredRoles: ["ADMIN"],
    label: "Open Composio tool settings",
    description: "Manage external tool connections through Composio",
  },
  {
    intent: "review_agentmail",
    route: "/admin/agentmail",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Review AgentMail drafts",
    description: "Review and approve AI-drafted emails",
  },
  {
    intent: "manage_approvals",
    route: "/admin/attention-inbox",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Open approval inbox",
    description: "Review and take action on pending agent recommendations",
  },
  {
    intent: "review_attention_inbox",
    route: "/admin/attention-inbox",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Open Attention Inbox",
    description: "View prioritized alerts and action items",
  },
  {
    intent: "view_kevin_console",
    route: "/admin/kevin",
    requiredRoles: ["ADMIN"],
    label: "Open Kevin Intelligence Console",
    description: "View Kevin status, signals, and integration health",
  },
  {
    intent: "configure_scheduling",
    route: "/admin/scheduling-command-center",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Open Scheduling Command Center",
    description: "Manage session scheduling and coach capacity",
  },
  {
    intent: "manage_coaches",
    route: "/admin/coaches",
    requiredRoles: ["ADMIN"],
    label: "Manage coaches",
    description: "Add, edit, or deactivate coach profiles",
  },
  {
    intent: "manage_athletes",
    route: "/admin/athletes",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Manage athletes",
    description: "View and manage athlete profiles",
  },
  {
    intent: "review_integrations",
    route: "/admin/integrations",
    requiredRoles: ["ADMIN"],
    label: "Review all integrations",
    description: "Check the status of all connected external services",
  },
  {
    intent: "review_billing",
    route: "/admin/billing",
    requiredRoles: ["ADMIN"],
    label: "Review billing settings",
    description: "Manage subscription and payment settings",
  },
  {
    intent: "view_ceo_heartbeat",
    route: "/admin/ceo-heartbeat",
    requiredRoles: ["ADMIN"],
    label: "View CEO Heartbeat",
    description: "Review the executive agent coordination dashboard",
  },
  {
    intent: "view_command_center",
    route: "/command-center",
    requiredRoles: ["ADMIN", "COACH"],
    label: "Open Command Center",
    description: "See the real-time business overview",
  },
  {
    intent: "view_ai_infrastructure",
    route: "/admin/ai-infrastructure",
    requiredRoles: ["ADMIN"],
    label: "View AI Infrastructure",
    description: "Review agent activation and AI system health",
  },
];

const ALLOWED_INTENTS = new Set(NAV_REGISTRY.map((e) => e.intent));
const ALLOWED_ROUTES = new Set(NAV_REGISTRY.map((e) => e.route));

/**
 * Resolve a navigation intent for a given user role.
 * Returns null if the intent is unknown, restricted, or the route is not in the allowlist.
 */
export function resolveNavSuggestion(opts: {
  intent: string;
  userRole: string;
  reason?: string;
}): NavSuggestion | null {
  const entry = NAV_REGISTRY.find((e) => e.intent === opts.intent);
  if (!entry) return null;
  if (!ALLOWED_ROUTES.has(entry.route)) return null;
  if (!entry.requiredRoles.includes(opts.userRole)) return null;

  return {
    type: "navigation_suggestion",
    intent: entry.intent,
    label: entry.label,
    route: entry.route,
    reason: opts.reason || entry.description,
  };
}

/**
 * Validate that a route returned by Kevin is in the allowlist.
 * Kevin must NEVER generate arbitrary routes — always validate before use.
 */
export function isAllowedRoute(route: string): boolean {
  return ALLOWED_ROUTES.has(route);
}

export function isAllowedIntent(intent: string): boolean {
  return ALLOWED_INTENTS.has(intent);
}

/**
 * Returns all nav entries accessible to a given role (for console display).
 */
export function listNavEntriesForRole(role: string): NavEntry[] {
  return NAV_REGISTRY.filter((e) => e.requiredRoles.includes(role));
}

export { NAV_REGISTRY };
