---
name: Beta Wave 6 Spec
description: Architecture summary for Beta Wave 6 — First Real Developers, First Royalties & Marketplace Activation
---

## Rule
Wave 6 stops measuring software and starts measuring marketplace reality. No new infrastructure — only participation. All code in server/beta-wave6-routes.ts.

**Why:** Large spec; tracking prevents duplication if Wave 7 extends it.

## New DB Tables (2)
- `developer_pipeline` — id, developer_id, name, email, source, industry, organization, stage (prospect/contacted/interested/registered/published_agent/generated_install/generated_revenue/generated_royalty), contact_date, last_touch, next_action, notes, is_external
- `marketplace_ambassadors` — id, name, type (coach/consultant/gym_owner/agency_owner/influencer), email, organization, invites_sent, developers_recruited, orgs_recruited, installs_generated, revenue_generated, status

## Seeded Data Constants
- `SEEDED_AGENT_IDS` — 9 known seeded agent IDs; filtered out of "real" counts in adoption-audit
- `SEEDED_ORG_ID = "TrainEfficiency"` — platform org; excluded from external activity counts

## Endpoints (11)
| Method | Path | Part |
|--------|------|------|
| GET/POST | /api/developer-pipeline | 1 — developer recruitment CRM |
| PATCH | /api/developer-pipeline/:id | 1 — update stage/next-action |
| DELETE | /api/developer-pipeline/:id | 1 — remove entry |
| GET/POST | /api/marketplace-ambassadors | 2 — ambassador program |
| PATCH | /api/marketplace-ambassadors/:id | 2 — update metrics |
| GET | /api/platform/developer-success | 5 — funnel, blocked devs, drop-off causes |
| GET | /api/platform/adoption-audit | 6 — real vs seeded breakdown across all entities |
| GET | /api/platform/royalty-readiness | 7 — 5-step royalty loop requirements |
| GET | /api/platform/first-success-stories | 9 — candidate/verified story classification |
| GET | /api/platform/founder-kpis | 10 — weekly operating dashboard |
| GET | /api/platform/readiness | 11 — 8-component 0–100 readiness score |
| GET | /api/platform/wave6-scorecard | 12 — all 9 exit criteria |
| GET | /api/platform/wave6-validation | 13 — 7-check infrastructure/activity validation |
| GET | /api/community/hall-of-fame-expansion | 14 — 6 external milestone holders |

## Frontend Pages (3)
- `/admin/developer-recruitment` — 4-tab: Pipeline (stage cards + dev rows), Funnel (bar chart + drop-off), Ambassadors, KPIs (progress cards)
- `/admin/org-recruitment` — 5-tab: Adoption Audit (real vs seeded), Royalty Loop, Success Stories, Wave 6 Score, Validation
- `/admin/marketplace-proof` — 5-tab: External Milestones (6 hall-of-fame cards), Real Installs, Revenue, Royalties, Readiness (8 component bars)

## Exit Criteria (Part 12)
≥5 ext devs registered, ≥3 ext devs publish, ≥10 orgs install, ≥25 real installs, ≥10 reviews, ≥1 real revenue event, ≥1 real royalty event, ≥1 ext dev earns royalty, Marketplace Readiness >50
