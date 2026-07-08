---
name: Phase 9 — Billing & Waiver Readiness
description: Readiness service, route, and UI for billing/waiver/operational athlete readiness
---

## What was built

- `server/services/readiness-service.ts` — computeBillingReadiness, computeWaiverReadiness, computeOperationalReadiness, computeEnrichedReadinessState, computeReadinessBundle, computeOrgReadinessSummary
- `server/readiness-routes.ts` — GET /api/admin/readiness, GET /api/admin/readiness/athlete/:id; registered as registerReadinessRoutes() after registerAthleteReadinessRoutes() in routes.ts
- `admin-athlete-onboarding.tsx` — extended with 7-state readiness, readiness score bar, Financial/Legal/Operational dimension grid, new tiles (Ready to Train, Billing Issues, Waiver Issues, Avg Readiness), ReadinessDot component
- `server/services/ceo-heartbeat-service.ts` — step 9 readiness metrics (billing blocked, waiver blocked, low avg score)
- `server/routes.ts` — Phase 9 block inserted before "Compute per-record alerts"; summary stats extended with readyToTrain/billingBlocked/waiverBlocked/operationallyBlocked/averageReadinessScore

## Key schema facts

- No dedicated waiver platform — `waiverReadiness.required` is always `false`, TODO note for future
- Billing readiness checks: `users.stripeCustomerId`, `userSubscriptions` (status='active', orgId scoped), `athleteOnboardingChecklists.paymentSetup`, `users.balanceCents`
- Operational score (0–100): accountInviteSent(10) + welcomeDraftApproved(8) + pailContextSeeded(5) + guardianLinked(5) + programAssigned(20) + firstSessionScheduled(20) + paymentSetup(20) + waiverCompleted(7) + firstSessionCompleted(5) = 100

## 7-state readiness machine (priority order)

1. `actively_training` — firstSessionCompleted
2. `needs_onboarding` — accountInviteSent = false
3. `needs_program` — programAssigned = false
4. `needs_first_session` — programAssigned but !firstSessionScheduled
5. `needs_billing` — !billing.ready after session scheduled
6. `needs_waiver` — waiver.required && !waiver.signed
7. `ready_to_train` — all checks pass

## Routes registration rule

- `registerAthleteReadinessRoutes` = athlete physical readiness (workout checkins, risk flags) — separate from Phase 9
- `registerReadinessRoutes` = Phase 9 onboarding billing/waiver/operational readiness
- Both registered after `registerGuardianRoutes` in routes.ts

**Why:** waiver.required=false keeps existing athletes unblocked until a real waiver platform is integrated; billing.ready = paymentSetup OR activeMembership so legacy athletes already have billing but no Stripe still pass.
