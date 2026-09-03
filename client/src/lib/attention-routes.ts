const VALID_ATTENTION_ROUTES = new Set([
  "/admin", "/admin/attention", "/admin/agent-tools", "/admin/workflows",
  "/admin/business-brain", "/admin/athlete-leads", "/admin/team-training-deals",
  "/admin/team-training-leads", "/admin/outreach-queue", "/admin/trigger-audit",
  "/admin/financial-reconciliation", "/admin/financial-failures", "/admin/financial-brain",
  "/admin/operator-actions", "/admin/retention-workflows", "/admin/workflow-orchestrator",
  "/admin/agent-ops", "/admin/branding", "/admin/configuration", "/admin/subscription",
  "/admin/stripe", "/admin/media", "/command-center", "/coach", "/coach/users",
  "/coach/availability", "/coach/transactions", "/coach/business-plan",
  "/coach/communications", "/scheduling", "/scheduling/agent", "/bookings",
  "/settings", "/sessions", "/portal", "/wallet",
]);

const LEGACY_ATTENTION_ROUTE_MAP: Record<string, string> = {
  "/admin/clients": "/coach/users",
  "/admin/leads": "/admin/athlete-leads",
  "/admin/subscriptions": "/admin/subscription",
  "/schedule": "/scheduling",
  "/attention-inbox": "/admin/attention",
  "/admin/attention-inbox": "/admin/attention",
  "/admin/schedule": "/scheduling",
};

export function resolveAttentionActionRoute(url: string | null | undefined): string | null {
  if (!url) return null;
  if (VALID_ATTENTION_ROUTES.has(url)) return url;
  return LEGACY_ATTENTION_ROUTE_MAP[url] ?? null;
}
