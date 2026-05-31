---
name: Beta Phase Y Spec
description: Architecture for Phase Y — First 10 External Users Operating Plan
---

## Rule
Phase Y is a pure execution layer — no new infrastructure. Every endpoint turns existing platform data into actionable founder instructions. Mandate: do not build another feature until The Final Question = CONFIRMED.

## New DB Table (1)
- `first10_playbooks` — id, template_type (developer/coach/gym_owner/consultant/agency), participant_name, participant_id, sent_at, opened_at, responded_at, activated_at, notes, status

## Endpoints (7)
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | /api/first10-playbooks | Outreach tracking CRUD |
| PATCH | /api/first10-playbooks/:id | Update sent/opened/responded/activated timestamps |
| GET | /api/first10-playbooks/templates | Returns 5 playbook types with baked-in message templates |
| GET | /api/platform/activation-queue | Ranks all participants by urgency — stuck first, then by distance to goal |
| GET | /api/platform/first-revenue-countdown | 6 sequential milestones with per-step blocker text |
| GET | /api/platform/founder-actions | Auto-generates top 10 ranked actions from live data (no AI needed) |
| GET | /api/platform/phase-y-scorecard | 5-criterion exit check; returns finalQuestion = CONFIRMED or NOT YET CONFIRMED |

## Upgraded Endpoint (Wave X)
- `/api/platform/human-validation-report` — added: probability (string), closestParticipant (object), biggestBottleneck (string), recommendedAction (string), estimatedDaysToValidation (number)

## Frontend Page (1)
- `/admin/first-10` — 6-tab page:
  - **Progress Tracker** — stage column summary + per-participant card with milestone timeline (✓ per completed step) and progress bar
  - **Activation Queue** — ranked by urgency score (stuck×50 bonus), next action per person, stuck warning banner
  - **Revenue Countdown** — 6 sequential milestone steps with blocker text, est. days to next
  - **Founder Actions** — top 10 color-coded actions (red=P1, yellow=P2, grey=P3) with reason + type badge; auto-refreshed from live data
  - **Playbooks** — 2 sub-tabs: Message Templates (5 audience types, 2-3 messages each) + Outreach Tracking (sent/opened/responded/activated per entry)
  - **Exit Criteria** — 5-criterion checklist with evidence + Phase Y mandate text when incomplete

## Playbook Templates (baked-in, no DB)
5 types: developer, coach, gym_owner, consultant, agency — 2–3 staged messages per type with [Name] placeholder

## Founder Action Logic
Actions auto-generated from rules against live data (no AI call), in priority order:
1. If 0 participants → invite first dev + org
2. Stuck participants → follow-up per person
3. Published agent with 0 installs → personal match to gym owner
4. Installed org with no review → 1-sentence ask
5. <3 devs or <5 orgs → recruit more
6. 0 feedback → collect friction data
7. External reviews + installs → amplify publicly
