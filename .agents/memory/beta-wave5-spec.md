---
name: Beta Wave 5 Spec
description: Architecture summary for Beta Wave 5 — Network Effects, First Royalties & Marketplace Acceleration
---

## Rule
Wave 5 proves activity compounds. Goal: move from "Emerging" to "Active" marketplace. All code in server/beta-wave5-routes.ts.

**Why:** Large spec; tracking prevents duplication if Wave 6 extends it.

## New DB Tables (2)
- `developer_streaks` — developer_id (unique), agents_published, consecutive_publishing_months, install_milestone, revenue_milestone, tier (bronze/silver/gold/marketplace_builder), first/second/third agent timestamps
- `org_streaks` — org_id (unique), installs_count, active_agents, reviews_submitted, referrals_made, tier (explorer/builder/operator/marketplace_champion), first/second/third install timestamps

## Endpoints (13 + 1 utility)
| Method | Path | Part |
|--------|------|------|
| GET | /api/platform/velocity | 1 — week-by-week growth across all activity types |
| GET | /api/platform/time-to-value | 2 — avg/fastest/slowest time at each activation step |
| GET/POST | /api/developer-streaks | 3 — streak CRUD |
| GET/POST | /api/org-streaks | 4 — streak CRUD |
| POST | /api/streaks/sync | 4 — auto-sync streaks from real table data |
| GET | /api/platform/royalty-milestones | 5 — first royalty through first $1000 |
| GET | /api/platform/cohorts | 6 — 30/60/90d retention by dev/org/agent |
| GET | /api/platform/referral-flywheel | 7 — dev→dev, org→org flows + multiplier score |
| GET | /api/platform/conversion-optimization | 8 — drop-off analysis + top 5 fixes |
| GET | /api/community/hall-of-fame | 9 — 7 milestone winners |
| GET | /api/platform/royalty-proof | 10 — full royalty audit with source evidence |
| GET | /api/platform/momentum | 11 — 0–100 score, Stalled/Emerging/Growing/Accelerating/Self-Sustaining |
| GET | /api/platform/wave5-scorecard | 12/13 — exit criteria tracking |
| GET | /api/platform/marketplace-stage | 14 — 6-stage progression: Infrastructure→Emerging→Active→Growing→Accelerating→Self-Sustaining |

## Key Column Fix
- `agent_templates.average_trust_score` (NOT trust_score) and `average_success_rate` (NOT avg_rating)

## Frontend Page
- `/community/hall-of-fame` — 5-tab: Hall of Fame, Momentum, Retention, Velocity, Stage Details

## Exit Criteria (Part 13)
≥10 devs, ≥10 agents, ≥25 installs, ≥25 reviews, ≥10 referrals, ≥1 royalty, ≥2 repeat publishers, ≥3 repeat installers, dev retention>50%, org retention>50%, momentum>50
