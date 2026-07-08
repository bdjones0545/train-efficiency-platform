---
name: Phase 8 — Parent & Guardian Experience
description: Admin-side guardian management layer; key schema, routing, and service decisions
---

## What was built

- `server/services/guardian-admin-service.ts` — full admin service (list, detail, timeline, preferences, welcome draft, CEO Heartbeat metrics)
- `guardian_communication_preferences` — raw SQL table (created via ensureGuardianPrefsTable() on first call); UNIQUE(guardian_user_id, org_id)
- Admin routes appended to `server/guardian-routes.ts` at bottom of registerGuardianRoutes() — already registered in routes.ts so no change to routes.ts needed
- `client/src/pages/admin-guardians.tsx` — list page at /admin/guardians
- `client/src/pages/admin-guardian-detail.tsx` — detail page at /admin/guardian/:id
- CEO Heartbeat step 8: imports computeGuardianMetricsForOrg from guardian-admin-service

## Key schema facts

- `athleteGuardianLinks`: id, orgId, athleteUserId, guardianUserId, status ('pending'|'active'|'revoked'), invitedByUserId, inviteEmail, inviteToken, permissions (jsonb), createdAt, activatedAt
- Pending guardians have guardianUserId = "pending-{token}" — filter with `!id.startsWith("pending-")`
- `guardian_communication_preferences`: raw SQL table, NOT in shared/schema.ts — always create via ensureGuardianPrefsTable()
- `parentGuardians` table exists in schema: id, orgId, orgUserId, relationshipType

## Routing

- Admin routes: GET/api/admin/guardians, GET/api/admin/guardians/:id, PATCH/api/admin/guardians/:id/preferences, POST/api/admin/guardians/:id/queue-welcome-draft, GET/api/admin/guardian-metrics
- All use requireCoach middleware defined locally in guardian-routes.ts
- registerGuardianRoutes() is called inside registerRoutes() at server/routes.ts — any new admin guardian routes go in guardian-routes.ts, not routes.ts

## Architecture

- Guardian grouping: byGuardianUserId for real accounts, "email:{inviteEmail}" for pending (no real account yet)
- Communication timeline aggregates: athleteGuardianLinks events (invite sent/accepted), guardianNotifications, gmailAgentActions (matched by recipientEmail)
- PAIL context for guardians stored in guardian_communication_preferences.pail_context (text)
- Welcome draft → gmailAgentActions with actionType "propose_draft:guardian_welcome", communicationDomain "guardian_onboarding"

**Why:** Parents are contacts, not primary athletes — all data traces back through athleteGuardianLinks; preferences table kept separate from schema.ts to avoid Drizzle migration complexity.
