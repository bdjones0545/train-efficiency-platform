---
name: Kevin Slack Executive Operations Hub
description: Full spec for the Kevin Slack EOH — 13 service files, routes, admin page, 44 tests.
---

## Architecture

- **13 service files** under `server/kevin-slack/`: `config.ts`, `verifier.ts`, `block-kit.ts`, `notification-engine.ts`, `identity-service.ts`, `conversation-state.ts`, `audit-service.ts`, `obsidian-bridge.ts`, `scheduling-handler.ts`, `command-router.ts`, `event-handler.ts`, `digest-service.ts`, `approval-handler.ts`
- **Main routes**: `server/kevin-slack-routes.ts` — 3 inbound Slack endpoints + 7 admin + 1 internal notify
- **Admin page**: `client/src/pages/admin-kevin-slack.tsx` — route `/admin/kevin-slack`, 5 tabs
- **Tests**: `server/tests/kevin-slack-eoh.test.ts` — 44 tests, all pass

## Route wiring

Routes are registered in `registerRoutes()` via `bootstrapKevinSlackTables()` + `registerKevinSlackRoutes(app)` after `startKevinEventWorker()`. The sed insert used unicode-escaped comment text (`u2500u2500u2500`) — cosmetic only, code is correct.

## Key invariants

- **All flags default false**. Master `KEVIN_SLACK_ENABLED` must be true before any sub-flag is checked (`isEventsEnabled()`, `isCommandsEnabled()`, etc.).
- **Signing secret never in logs or responses**. `verifySlackRequest()` returns `{ok:false, error:"missing_secret"|"stale_timestamp"|"invalid_signature"|"missing_headers"}`.
- **Action tokens are opaque** — 16-byte random hex, stored in memory Map with 15-min TTL. `consumeActionToken()` returns null for unknown/expired. `invalidateActionToken()` removes immediately.
- **Bot loop prevention** — event_handler silently returns 200 with zero API calls if `event.bot_id` is set or `event.subtype === "bot_message"`.
- **Cross-org isolation** — every token carries `orgId`; handlers must verify `token.orgId === identity.orgId` before executing.
- **CLIENT role blocked from scheduling writes** — `buildCreateSessionPreviewBlocks()` checks role before building confirmation UI.

## Approval handler gate

Line 58 gate originally blocked `acknowledge_alert` and `dismiss_action` (they aren't scheduling actions and `isApprovalsEnabled()` defaults false). Fixed by adding `alwaysAllowedActions` list checked before the gate. Always-allowed: `acknowledge_alert`, `dismiss_action`, `cancel_session_abort`, `open_dashboard`, `open_url`, `open_approvals`.

## DB tables (lazy-created via `bootstrapKevinSlackTables()`)

- `kevin_slack_identity_mappings` — Slack↔TE user links; `mappingStatus` IN ('pending','verified','revoked','disabled')
- `kevin_slack_conversation_state` — multi-step conversation flows
- `kevin_slack_event_dedup` — dedup keyed on `(team_id, event_id)` — must scope by team_id or cross-workspace collisions
- `kevin_slack_action_audit` — every action with auth result + outcome
- `kevin_slack_digest_runs` — idempotency for daily digests
- `kevin_slack_notification_log` — suppress duplicate notifications

## 7-stage activation

Stage 1: ENABLED + EVENTS_ENABLED (verify only)
Stage 2: COMMANDS_ENABLED (read-only commands)
Stage 3: ACTIONS_ENABLED + SCHEDULING_ENABLED (scheduling writes)
Stage 4: NOTIFICATIONS_ENABLED
Stage 5: DIGESTS_ENABLED
Stage 6: APPROVALS_ENABLED
Stage 7: OBSIDIAN_MEMORY_ENABLED

**Why:** Staged rollout lets operations team verify each capability independently. Setting `KEVIN_SLACK_ENABLED=false` immediately disables ALL Slack behavior with zero TE platform impact.
