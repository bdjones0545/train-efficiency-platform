---
name: Revenue Attribution Architecture
description: How revenue attribution is wired end-to-end; gaps fixed and decisions made during the 12-phase audit.
---

## Attribution Chain
```
gmail_agent_actions (executionLogId=gmailActionId)
  ↓ createOutcomeOnSend()
agent_communication_outcomes (gmail_action_id FK)
  ↓ attributeOutcomeToProspect()
ai_revenue_events (credited_value = equal-split share)
  ↓ deal_id → team_training_deals.final_value
bookings (source_outcome_id → agent_communication_outcomes)
```

## Fix 1 — Booking Attribution FK
- Added `source_outcome_id varchar` to `bookings` table.
- Allows hard-linking a booking to the specific outcome that caused it.
- No automated backfill — new bookings created via approval paths should set this from the outcome id returned by createOutcomeOnSend.
- **Why:** Previously bookings could only be attributed via org+date heuristic join; hard FK is required for accurate attribution when multiple campaigns run simultaneously.

## Fix 2 — execution_log_id Wired in Approval Paths
- All 3 manual approval paths (single approve, bulk approve, edit-send) now call `logActionAsEvent` after send.
- `executionLogId` is set to the `gmail_agent_actions.id` of the sent message.
- CEO Heartbeat can now join: `ai_revenue_events.execution_log_id → gmail_agent_actions.id → created_by_agent`.
- edit-send was also missing `createOutcomeOnSend` entirely — that was added in the same pass.
- **Why:** Previously only auto-execution-engine populated execution_log_id; all human-approved sends created no ai_revenue_events row at all.

## Fix 3 — Equal-Split Multi-Touch Credit
- Added `credited_value integer DEFAULT 0` to `ai_revenue_events`.
- `logMultiTouchAttributionChain` now computes `equalShare = round(wonValue / totalTouches)`.
- Primary (last) touch gets `wonValue - equalShare * assistCount` (remainder to prevent rounding loss).
- Assist touches each get `equalShare`.
- `outcome_value` on the primary event still holds the full deal value for reference.
- **Why:** Previous implementation gave 100% credit to last touch and 0 to assists — a 3-touch deal would report $30k attributed on a $10k deal if queried naively.

## Integrity Finding
- 9/10 `lead_intelligence_profiles` are orphaned (no matching `lead_capture_submissions` row).
- No FK constraint enforces `submission_id → lead_capture_submissions.id`.
- This is from test data. Add a DB constraint if this table needs referential integrity enforced.

## CEO Heartbeat Revenue Gaps (still open)
- `bookings` has no direct price — revenue requires join to `services.price_cents`.
- `ai_revenue_events.execution_log_id` now points to `gmail_agent_actions.id`, not `unified_agent_action_log.id` — so the join is to `gmail_agent_actions`, not to `unified_agent_action_log`.

## Test Coverage
- P3-12 through P3-17 in `server/tests/send-path-audit.test.ts` cover the 3 fixes.
- Total suite: 67 tests (all passing).
