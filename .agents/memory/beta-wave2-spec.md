---
name: Beta Wave 2 Spec
description: Architecture summary for the Beta Wave 2 build — tables, endpoints, pages, exit criteria
---

## Rule
Beta Wave 2 = Flywheel Activation, Early Revenue & Marketplace Traction. All code lives in server/beta-wave2-routes.ts and client/src/pages/admin-community.tsx.

**Why:** Large spec built in one session; tracking here avoids rebuilding from scratch if Wave 3 needs to extend it.

## New DB Tables (6)
- `marketplace_launch_programs` — per-agent launch checklist tracking completion_score
- `developer_referrals` — dev-to-dev recruitment referrals
- `org_referrals` — org-to-org recruitment referrals
- `marketplace_announcements` — community announcements (pinnable, typed)
- `developer_updates` — developer posts about their agents
- `agent_release_notes` — per-agent versioned release notes

## Endpoints (16)
| Method | Path | Part |
|--------|------|------|
| GET | /api/platform/developer-recruitment | 1 |
| GET | /api/platform/org-recruitment | 2 |
| GET/POST/PATCH | /api/marketplace/launch-programs | 3 |
| GET | /api/marketplace/growth | 4 |
| GET | /api/platform/revenue-validation | 5 |
| GET | /api/marketplace/retention | 6 |
| GET | /api/marketplace/recommendation-performance | 7 |
| GET | /api/platform/success-stories | 8 |
| GET/POST | /api/referrals/developer | 9 |
| GET/POST | /api/referrals/org | 9 |
| GET | /api/platform/flywheel-acceleration | 10 |
| GET | /api/marketplace/maturity | 11 |
| GET/POST | /api/community/announcements | 12 |
| GET/POST | /api/community/developer-updates | 12 |
| GET/POST | /api/community/release-notes | 12 |
| GET | /api/platform/beta-wave2-scorecard | 13 |

## Frontend
- `/community` — 6-tab community page: Announcements, Agent Updates, Release Notes, Success Stories, Wave 2 Progress, Maturity Model
- Sidebar entry under AI Monitoring section

## Exit Criteria (Part 14)
≥10 developers publish agents, ≥20 orgs install agents, ≥50 installs, ≥200 executions, ≥25 reviews, ≥10 verified case studies, ≥5 revenue events, ≥1 royalty payout, Liquidity≥50, Beta≥70, Maturity=Active+

## Key Fix
`ai_revenue_events` column is `outcome_value` (integer), NOT `amount`. Always use `outcome_value` in revenue queries.
