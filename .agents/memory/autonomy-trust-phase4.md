---
name: Autonomy Trust Layer — Phase 4
description: Per-decision-type autonomy scoring, trust registry, action queue, and override learning. Sits on top of the older autonomy-policy-engine (which does boolean policy approval per-send). Phase 4 is the evolving trust score system.
---

## What this covers
- **3 new tables:** `decision_trust_registry`, `autonomous_action_queue`, `autonomy_overrides`
- **Service:** `server/services/autonomy-scoring-service.ts`
- **Routes:** `server/autonomy-trust-routes.ts` → registered inside `registerRoutes()` in `server/routes.ts`
- **Page:** `/admin/autonomy` → `client/src/pages/admin-autonomy-trust.tsx`
- **Existing (do not conflict):** `/admin/autonomy-controls` uses `autonomy-policy-engine.ts` (boolean policy evaluator); Phase 4 is a separate scoring/trust layer

## Autonomy score formula
```
rawScore =
  successRate * 0.40            // 40%
  + min(executions/100, 1) * 20  // 20% frequency
  + (1 - overrideRate) * 20      // 20% confidence
  + min(revenueInfluenced/500000, 1) * 10  // 10% revenue
  - riskPenalty                  // low=0, medium=8, high=22, critical=45

score = clamp(0, min(rawScore, riskCeiling))
riskCeiling: low=100, medium=75, high=50, critical=25
```

## Mode thresholds
- 76–100 → Auto Execute
- 51–75  → Recommend + Queue
- 26–50  → Recommend
- 0–25   → Observe Only

## Default seed data
12 decision types seeded by `seedTrustRegistry(orgId)` on first dashboard load.
Uses `ON CONFLICT (org_id, decision_type) DO NOTHING` — safe to call repeatedly.

## Route base path
All endpoints under `/api/autonomy-trust/*` — 15 total.

**Why:** Separate from `/api/admin/autonomy/*` (the older policy engine routes) to avoid conflict and allow independent evolution of each system.

**How to apply:** When adding new agent actions that should earn autonomy over time, call `evaluateDecision(orgId, decisionType)` from the scoring service to get the current mode, then `queueAction()` to log it (auto-executes if mode=execute and risk≠critical).
