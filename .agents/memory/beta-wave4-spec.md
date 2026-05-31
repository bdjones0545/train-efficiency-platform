---
name: Beta Wave 4 Spec
description: Architecture summary for Beta Wave 4 — Ecosystem Activation, Distribution & First Marketplace Transactions
---

## Rule
Wave 4 creates activity, not just measurement. Goal: move from "infrastructure exists" to "marketplace activity exists". All code in server/beta-wave4-routes.ts.

**Why:** Large spec; tracking prevents duplication if Wave 5 extends it.

## New DB Tables (3)
- `developer_campaigns` — name, audience, channel, messages_sent, responses, registrations, agents_published, installs_generated, revenue_generated, status
- `org_campaigns` — name, audience, channel, invitations, activations, installs, executions, reviews, revenue_impact, status
- `publisher_rewards` — developer_id, milestone, badge_name, badge_color, reached, reached_at, agent_id

## Endpoints (13)
| Method | Path | Part |
|--------|------|------|
| GET | /api/platform/ecosystem-outreach | 1 |
| GET/POST/PATCH | /api/campaigns/developer | 2 |
| GET/POST/PATCH | /api/campaigns/org | 3 |
| GET/POST/PATCH | /api/publisher-rewards | 4 |
| GET | /api/platform/marketplace-revenue | 5 |
| GET | /api/platform/install-activation | 6 |
| GET | /api/platform/friction | 7 |
| GET | /api/platform/referral-growth | 8 |
| GET | /api/platform/transactions | 10 |
| GET | /api/platform/participant-success | 11 |
| GET | /api/platform/activation-score | 12 |
| GET | /api/platform/marketplace-validation | 13 |
| GET | /api/platform/wave4-scorecard | 14 |

## Frontend Pages
- `/admin/ecosystem-outreach` — 6-tab Outreach Center: Funnels, Campaigns, Friction, Validation, Wave 4 Score, Activation Score
- `/community/leaderboards` — 6-tab Leaderboard: Top Agents, Developers, Organizations, Reviewers, Referrers, Revenue

## Exit Criteria (Part 14)
≥5 devs, ≥10 orgs, ≥10 agents, ≥25 installs, ≥10 reviews, ≥5 referrals, ≥1 rev event, ≥1 royalty, ≥1 repeat publisher, ≥1 repeat installer, activation-score > 50, marketplace status = Active
