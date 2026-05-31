---
name: Beta Wave X Spec
description: Architecture summary for Beta Wave X — First External Human Validation
---

## Rule
Wave X answers one question: Can someone who is not Bryan Jones successfully participate? No new infrastructure — pure behavioral validation tracking.

**Why:** This is the terminal validation gate before Wave X passes.

## New DB Tables (2)
- `validation_participants` — id, type (developer/org), external_name, external_email, organization, invited_at, activated_at, first_publish_at, first_install_at, first_value_at, first_review_at, first_revenue_at, status (invited/activated/published/installed/reviewed/generating_revenue), notes
- `participant_feedback` — id, participant_id, confused_by, expected, loved, almost_quit, use_again (bool), recommend (bool), pay_for_it (bool), publish_another (bool), overall_rating (1-5), submitted_at

## Endpoints (6)
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | /api/validation-participants | Participant CRUD |
| PATCH/DELETE | /api/validation-participants/:id | Update status (auto-timestamps milestones) |
| GET/POST | /api/participant-feedback | Friction feedback CRUD |
| GET | /api/platform/developer-friction-report | Dev scores, time-to-metrics, confusion/loved/quit themes |
| GET | /api/platform/org-friction-report | Org scores, time-to-install/value/review/revenue |
| GET | /api/platform/human-validation-report | 5-criterion assessment + "The Final Question" answer |
| GET | /api/platform/wave-x-scorecard | 10-metric scorecard, 0–100 score |

## Frontend Page (1)
- `/admin/human-validation` — 6-tab page:
  - **Participants** — list with status badges, milestone timeline (invited/activated/published/installed/reviewed), Update Status dialog (auto-records timestamp on move)
  - **Feedback** — all feedback cards with star ratings, confusion/loved/quit text, yes/no badges
  - **Dev Friction** — scores (would use again/recommend/pay/publish again), time-to-metrics, friction themes (confusion/loved/quit risk)
  - **Org Friction** — same pattern for orgs; time-to-install/value/review/revenue
  - **Validation Report** — "The Final Question" banner + 5 success criteria + time-to metrics + real activity counts
  - **Wave X Score** — 10-metric grid (devs invited/activated, agents, orgs invited/activated, installs, feedback, intent, reviews, revenue)

## Success Criteria (5)
1. Non-founder developer publishes an agent
2. Non-founder organization installs an agent
3. Non-founder user leaves a review
4. Non-founder user generates value (revenue event)
5. Non-founder developer expresses intent to publish another agent (publish_another=true in feedback)

## Key UX Pattern
Updating a participant's status automatically records the milestone timestamp (e.g. status=published → sets first_publish_at=NOW). Submitting feedback auto-sets activated_at if not already set.
