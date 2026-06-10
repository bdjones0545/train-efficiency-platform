---
name: Agent Quality Scoring + Trust Tiers
description: Per-agent trust scores (7/30/90d), 5 trust tiers, rejection spike detection, manual overrides, CEO Heartbeat integration.
---

## Tables
- `agent_quality_scores` — UNIQUE(org_id, agent_name, communication_domain, window_days); communication_domain NOT NULL DEFAULT 'all' (avoids NULL in UNIQUE index)
- `agent_trust_overrides` — UNIQUE(org_id, agent_name, communication_domain); admin-set tier takes precedence over computed tier

## Scoring Formula (100 pts max)
```
approval_rate × 35
+ (1 − rejection_rate) × 25
+ (1 − edit_rate) × 15          # edit_rate = edited / approved, not edited / total
+ (1 − failure_rate) × 15
+ min(learning_conversion_rate, 1) × 10
cap at 50 if rejection_spike
```

## Trust Tiers
| Tier | Condition |
|------|-----------|
| restricted | rejection_spike OR manual override |
| training | total_actions < 5 OR score < 35 |
| assisted | score 35–55 |
| trusted | score 55–75 |
| high_trust | score ≥ 75 |

## Rejection Spike
7-day rejection rate > 30-day rejection rate × 1.5 AND ≥ 3 rejections in 7 days → tier = restricted, score capped at 50.

## Guardrail Policy
- training/assisted/restricted: requiresApproval = true always
- high_trust: isAutoEligible = true, but still needs explicit org auto-send permission (existing orgAutomationSettings gate)
- Never auto-sends without org permission regardless of tier

## Key Files
- `server/services/agent-quality-service.ts` — computeAgentQualityScores(), getAgentQualityReport(), getTrustTierForAgent(), getAgentQualityRisks()
- `server/agent-quality-routes.ts` — 7 endpoints under /api/admin/agent-quality/*
- `client/src/pages/admin-agent-quality.tsx` — page at /admin/agent-quality
- CEO Heartbeat page — agentQualityRisks query + quality card with link to /admin/agent-quality

**Why:** communicationDomain must default to 'all' (string) not NULL so composite UNIQUE constraint works in PostgreSQL.
