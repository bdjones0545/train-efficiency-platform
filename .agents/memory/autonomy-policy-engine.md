---
name: Autonomy Policy Engine
description: Architecture decisions and gotchas for the org-level agent autonomy system.
---

## Rule
All dangerous automation settings default to **false** (safe by default). The policy engine must pass all 11 checks before returning `auto_execute`.

**Why:** Prevents accidental auto-sends on new org setups. Settings are opt-in per org.

**How to apply:** Never change defaults to `true` without explicit user confirmation.

## 11 Policy Checks (in order)
1. Emergency pause (governance settings) → `blocked`
2. Lead suppression / unsubscribe → `blocked`
3. Sensitive language in body text → `blocked`
4. Risk level == high → `approval_required`
5. Action type setting enabled (autoSendFirstResponse, autoSendLowRiskFollowUps, etc.) → `approval_required`
6. Confidence >= threshold → `approval_required`
7. First contact + requireApprovalForFirstContact → `approval_required`
8. New recipient + requireApprovalForNewRecipients → `approval_required`
9. Within allowed send window → `approval_required`
10. Daily cap not exceeded → `approval_required`
11. No duplicate action in last hour → `approval_required`

## Key Files
- `server/services/autonomy-policy-engine.ts` — core evaluator + `getOrCreateOrgAutomationSettings` + audit logger
- `server/services/agent-action-executor.ts` — 5-min polling loop, registered in `server/index.ts`
- `server/routes.ts` — routes: GET/PATCH /api/admin/autonomy/settings, GET /api/admin/autonomy/decisions, GET /api/admin/autonomy/stats, POST /api/admin/autonomy/evaluate, POST /api/admin/autonomy/executor/run
- `client/src/pages/admin-autonomy-controls.tsx` — full UI: toggle controls, sliders, send window, approval gates, decision log, safety rules panel
- DB tables: `org_automation_settings` (UNIQUE on org_id), `agent_autonomy_decisions` (indexed on org_id+created_at and action_id)

## Sensitive language patterns
15 regex patterns: refund, invoice, payment, billing, charge, legal, lawsuit, attorney, medical, diagnos*, injury, hospital, terminat*, cancell*ation, contract.
