---
name: Predictive Intelligence Layer — Phase 5
description: Forecast engine, digital twin, risk/opportunity detection, scenario simulation, strategic plan generation, and Business OS Score. Pulls from bookings/team_training_leads/users tables for real data.
---

## What this covers
- **7 new tables:** `business_forecasts`, `risk_signals`, `opportunity_signals`, `scenario_simulations`, `strategic_plans`, `forecast_accuracy`, `business_twin_state`
- **Service:** `server/services/forecast-engine.ts`
- **Routes:** `server/forecast-routes.ts` → registered inside `registerRoutes()` in `server/routes.ts`
- **Page:** `/admin/forecast` → `client/src/pages/admin-forecast.tsx` — 7 tabs

## Real data sources
Pulls from: `bookings` (revenue, sessions, utilization), `team_training_leads` (lead pipeline), `users` (coach count), `ai_revenue_events` (AI revenue). Falls back to realistic defaults if tables have no data.

## Business OS Score formula
7 weighted inputs (all from existing Phase 2-5 data):
- Memory (Obsidian note count) × 0.15
- Learning (avg agent decision score) × 0.20
- Trust (avg autonomy trust score) × 0.20
- Forecast Accuracy (avg accuracy score) × 0.15
- Autonomy (% of decision types auto-execute) × 0.15
- Operational Efficiency (capacity utilization) × 0.10
- Growth Velocity (revenue trend direction) × 0.05

## Digital twin
`refreshDigitalTwin(orgId)` pulls live data and upserts `business_twin_state`. Auto-refreshed on first load if no state exists. Agents should call `getDigitalTwin(orgId)` before making recommendations.

## Forecast algorithm
Simple compound growth projection: `current × (1 + weeklyGrowthRate)^(days/7)`. Confidence drops with horizon (180d = ~20-40% confidence). Confidence rises with more historical data.

## Scenario simulation
7 preset scenarios with hard-coded impact multipliers in `SCENARIO_IMPACTS` map (no ML — deterministic). Revenue/leads/utilization/profit all computed from baseline digital twin state.

## Strategic plans
Pulls live twin + risks + opps, generates plan JSON, saves to DB + writes to Obsidian `Strategic Plans/` folder. `horizonDays` must be 30, 60, or 90.

**Why:** Obsidian write may fail silently if API is unavailable — plan still saves to DB regardless.
