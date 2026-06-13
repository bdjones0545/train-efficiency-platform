---
name: Hermes Sprint 2 — Closed-Loop Intelligence
description: Architecture decisions for Sprint 2 — Hermes as active heartbeat agent, recommendation engine, unified queue, feedback loop.
---

# Hermes Sprint 2 — Closed-Loop Intelligence

## Core decisions

**Auth in standalone route files:** `requireRole` is defined only inside `server/routes.ts` and is never exported. Standalone route files (hermes-routes, email-audit-routes, communication-intelligence-routes, etc.) must define a local `requireAdmin(req, res): boolean` guard that checks `req.user` is present. Never import `requireRole` from the auth module — it will throw a SyntaxError at startup.

**Why:** `requireRole` in routes.ts uses a local `getUserRole()` helper that is also private. Exporting it would require exporting storage dependencies too.

**How to apply:** Every new standalone route file must use this pattern:
```ts
function requireAdmin(req: Request, res: Response): boolean {
  if (!(req as any).user) { res.status(401).json({ message: "Not authenticated" }); return false; }
  return true;
}
// Inside handler: if (!requireAdmin(req, res)) return;
```

## Key file locations
- Hermes recommendation engine: `server/services/hermes-recommendation-engine.ts`
- Unified action queue service: `server/services/unified-action-queue.ts`
- Hermes API routes: `server/hermes-routes.ts` (registered in server/index.ts)
- Hermes step in heartbeat: step 6 inside `coordinateAgents()` in ceo-heartbeat-service.ts

## DB tables created at runtime (not in schema.ts)
- `hermes_recommendations` — stores every generated recommendation (confidence, source, status, traceability IDs)
- `hermes_recommendation_feedback` — records approve/reject/edit/dismiss outcomes per recommendation; used to adjust future confidence via historical approval rate

## Traceability chain
`hermes_recommendations.id` → `autonomous_action_queue.source_action_id` (source_system='hermes')
`autonomous_action_queue.id` → `hermes_recommendation_feedback.action_queue_id`
`autonomous_action_queue.source_conversation_id` → `gmail_conversations.id`

## Confidence threshold
`CONFIDENCE_QUEUE_THRESHOLD = 0.70` — recommendations below this are stored but not queued in autonomous_action_queue. Adjust as constant in hermes-recommendation-engine.ts.

## Signal sources evaluated per cycle
1. Gmail open conversations with inbound reply older than outbound (follow_up)
2. Blocked outbound emails in last 24h (policy_review)
3. Team training prospects stale > 7 days (prospect_outreach)
4. autonomous_action_queue items awaiting_review > 48h (approval_needed)
5. workflow_runs failures > 3 in 24h (engineering_review)
