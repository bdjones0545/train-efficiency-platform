---
name: Dashboard Card Data Shapes
description: Root causes and fixes for home page cards showing "—" or stale best-action recommendations
---

## Revenue card ("—" on home page)

`/api/admin/revenue-summary-v2` nested all values under `metrics: {}`.
`home.tsx` reads `revData?.periodRevenueCents ?? revData?.thisMonth ?? revData?.total` — all top-level.

**Fix:** Added top-level aliases to the `res.json({})` response:
```ts
periodRevenueCents: recognizedRevenueCents,
thisMonth: recognizedRevenueCents,
total: collectedRevenueCents,
growthPct: 0,
```

Also hardened `req.user.claims.sub` → `req.user?.claims?.sub ?? req.user?.id` (email/password auth compat).

## Utilization card ("—" on home page)

`/api/admin/coach-utilization-diagnostic` returned a raw `CoachUtilizationDiagnosticEntry[]` array.
`home.tsx` reads `utilQ.data?.overallUtilization ?? utilQ.data?.utilizationPct` — expects an object.

**Fix:** Wrapped the array in a summary object:
```ts
res.json({
  overallUtilization,   // avg utilizationPct across coaches with availability blocks
  utilizationPct: overallUtilization,
  utilizationPercent: overallUtilization,
  totalCoaches: results.length,
  coachesWithSchedule: coachesWithSchedule.length,
  hasData: results.length > 0,
  coaches: results,    // raw array still available
});
```

## Best Action "No communication integrations" (wrong orgId)

`/api/recommendations` called `generateRecommendations(req.user.orgId, storage)`.
`req.user.orgId` is unreliable for email/password coach auth — may be `undefined` or empty string.
With wrong orgId, `getEffectiveConnectedIntegrations()` DB query finds no Gmail row.

**Fix:** Use profile lookup (same pattern as all other routes):
```ts
const userId = req.user?.claims?.sub ?? req.user?.id;
const profile = await storage.getUserProfile(userId);
const orgId = profile?.organizationId ?? req.user?.orgId;
```

**Why:** `req.user.orgId` is only reliable for Replit OIDC sessions. For custom auth, always use `storage.getUserProfile(userId)` to resolve the canonical orgId.

## General rule

Any route accessible to both ADMIN and COACH roles must use `req.user?.claims?.sub ?? req.user?.id` (optional chaining) and resolve orgId via `storage.getUserProfile(userId)`, never via `req.user.orgId` directly.

ADMIN-only routes that use Replit OIDC exclusively are safe with `req.user.claims.sub` (no optional chaining).
