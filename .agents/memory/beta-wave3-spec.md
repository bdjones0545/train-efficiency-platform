---
name: Beta Wave 3 Spec
description: Architecture summary for Beta Wave 3 — Marketplace Activation, First Revenue & Flywheel Validation
---

## Rule
Wave 3 validates economic activity — the first real marketplace flywheel loop. All code in server/beta-wave3-routes.ts.

**Why:** Large spec; tracking prevents duplication if Wave 4 extends it.

## Endpoints (13)
| Method | Path | Part |
|--------|------|------|
| GET | /api/platform/marketplace-activation | 1 |
| GET | /api/platform/revenue-milestones | 2 |
| GET | /api/developer/activation | 3 |
| GET | /api/org/activation | 4 |
| GET | /api/platform/revenue-proof | 5 |
| GET | /api/marketplace/conversion | 6 |
| GET | /api/platform/repeat-usage | 7 |
| GET | /api/platform/referral-economy | 8 |
| GET | /api/platform/success-story-candidates | 10 |
| GET | /api/platform/flywheel-monitor | 11 |
| GET | /api/platform/ecosystem-health-index | 12 |
| GET | /api/platform/agent-economy-leaderboard | 9 |
| GET | /api/platform/wave3-scorecard | 13 |

## Frontend Pages
- `/admin/marketplace-activation` — 6-tab activation center: Funnel, Flywheel, Conversion, Milestones, Stickiness, Wave 3 Score
- `/admin/agent-economy` — 5-tab economy page: Leaderboard, Developer Activation, Org Activation, Success Candidates, Revenue Proof

## Key Column Fixes Found
- `agent_templates.maintainer` NOT `developer_id` — use maintainer for grouping publishers
- `org_onboarding_sessions.time_to_first_outcome` NOT `time_to_first_value`
- `ai_revenue_events.outcome_value` NOT `amount`

## Exit Criteria (Part 14)
≥10 devs registered, ≥5 publish, ≥15 orgs, ≥25 installs, ≥100 execs, ≥20 reviews, ≥5 referrals, ≥1 real revenue event, ≥1 royalty event, ≥1 repeat publisher, ≥1 repeat installer
