---
name: V2 Knowledge Base Generation Progress
description: Tracks which docs/agent-catalog.md and other V2 KB documents have been completed and what comes next.
---

# V2 Knowledge Base Progress

## Completed Documents

| File | Lines | Date | Notes |
|---|---|---|---|
| `docs/schema.md` | ~2874 | 2026-06-28 | 208 Drizzle tables + ~20 raw-SQL tables |
| `docs/core-services.md` | ~1509 | 2026-06-28 | Storage interface, routes, middleware |
| `docs/agent-catalog.md` | 962 | 2026-06-28 | All agents, email sub-system, safety gates |

## Key Facts Established While Writing agent-catalog.md

- `hermes` table is `hermes_auto_learnings` (NOT `hermes_learnings`)
- `decision_journal_entries` and `software_kb_entries` are raw-SQL only (not in schema.md Appendix A)
- `apex_recommendations` and `pulse_recommendations` are raw-SQL tables, self-provisioned by each agent on startup
- `retention-agent.ts` and `growth-agent.ts` are v1 compatibility adapters — delegate entirely to pulse/apex
- CEO Orchestrator export must be non-async (returns AsyncGenerator directly)
- `requireRole` is NOT exported from `routes.ts`; external route files define local `requireAdmin`
- `BASE_FOLLOW_UP_DAYS = [3, 7, 14]`, `MAX_FOLLOW_UPS = 3`
- Daily email agent fires at `h === 8 && m >= 30 && m <= 34`; hard cap 10 sends/org/day
- Auto-execution engine hard cap: 3 auto-executions/day; safe types: `send_follow_up`, `generate_draft`, `send_initial_email`
- Contact quality tiers: `direct_coach` (92) > `athletic_director` (80) > `athletics_dept` (62) > `generic` (38) > `invalid` (0)
- Multi-touch attribution: equal-split `creditedValue`; primary touch gets remainder

## Next Documents (from version-2-roadmap.md)

Likely next: `docs/safety-and-policy.md` or `docs/scheduling-system.md` — check `docs/version-2-roadmap.md` for the authoritative order.
