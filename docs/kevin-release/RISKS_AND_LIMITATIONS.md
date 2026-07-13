---
Document Type: Release / Risk Register
Verification Status: Validated against source (Phases 0–2)
Last Reviewed: 2026-07-13
Owner: Platform Engineering + Kevin Ops
---

# Kevin Control Plane — Known Risks & Limitations

## Known Risks

| # | Risk | Severity | Likelihood | Mitigation (in this release) | Residual action |
|---|------|----------|------------|------------------------------|-----------------|
| R1 | `KEVIN_HERMES_API_KEY` grants full access to the Hermes API Server. If leaked, an attacker could drive Kevin runs. | High | Low | Server-side only; never sent to browser, never logged, redacted in audit payloads; `.env.kevin.local` git-ignored; verified absent from repo & client bundle. | Rotate the key on a schedule; scope Hermes network to private/loopback. |
| R2 | Exposing the Hermes API Server (`:8642`) to the public internet. | High | Low | Docs mandate private network / tunnel / reverse proxy + IP allowlist; loopback default in examples. | Confirm network topology before enabling in prod. |
| R3 | Hermes unavailable while enabled → Console errors. | Low | Medium | Fail-safe: health returns `down`/`degraded`, runs return `503`, timeouts (8s health / 30s run-create) raise `KEVIN_UNAVAILABLE`; rest of platform unaffected. | None required. |
| R4 | Org attribution fallback: users without a `user_profiles.organization_id` resolve to the synthetic org `"platform"`; multiple such admins share run visibility scope. | Medium | Medium | Kevin is ADMIN-only and platform-ops scoped by design; runs are still filtered by resolved org. | Assign real org IDs to admins, or add a dedicated platform-ops org before multi-admin use. |
| R5 | In-memory run rate-limit (20/user/hr) is per-process; a multi-instance deployment multiplies the effective limit. | Low | Low | Single-instance Replit deployment today; consistent with existing in-process cron pattern (CLAUDE.md). | Move to a DB/Redis limiter if horizontally scaled. |
| R6 | SSE proxy passes through Hermes events; a malformed/hostile Hermes stream could send unexpected shapes. | Low | Low | Server maps only known event types, ignores malformed chunks, redacts nothing sensitive from Hermes into audit; client parses defensively. | None required. |
| R7 | Pre-existing repo-wide TypeScript errors (333, none in Kevin) mean a full `npm run check` is red at baseline. | Info | n/a | Kevin surface validated by scoped `tsconfig.kevin*.json` (0 errors) and builds clean. | Baseline debt tracked separately; out of scope for this release. |
| R8 | Pre-existing dependency advisories (25; 10 high — `ws`, `yaml`, `retry-request`). | Medium | n/a | Kevin adds **zero** dependencies, so this release does not change the audit posture. | Address via `npm audit fix` in a separate maintenance PR. |

## Known Limitations

1. **No automated tests ship with Kevin.** The repository has **no test runner
   installed** (no vitest/jest/mocha binary, no test config, no `test` script), so the
   existing `*.test.ts`/`*.spec.ts` files — and any Kevin tests — cannot be executed in
   CI as-is. Validation for this release relied on scoped typecheck + build + manual
   security review. The `server/scripts/kevin-phase0-smoke.ts` script is the functional
   check but requires a live Hermes endpoint and is run manually.
2. **Phase 3 approval UI is not implemented.** When Hermes emits an
   `approval.requested` event, the Console surfaces it as a read-only system line
   ("Phase 3 UI"). Host-tool approvals cannot yet be resolved from TrainEfficiency;
   they must be handled on the Hermes side.
3. **Admin-only, single surface.** Coaches have no access (`coachAccess: "none"`,
   locked 2026-07-13). There is no per-org or per-coach Kevin experience yet.
4. **Migrations are runtime-provisioned, not versioned.** `kevin_audit_events`,
   `kevin_sessions`, and `kevin_runs` are created via idempotent
   `CREATE TABLE IF NOT EXISTS` on first use and are invisible to `drizzle-kit`. There
   is no committed migration file and no down-migration (see ROLLBACK Level 3).
5. **Run reconciliation is pull-based.** Run status is refreshed when the Console polls
   or a status/events request lands; there is no background reconciler, so a run whose
   SSE stream drops may briefly show `running` until the next poll reconciles it.
6. **`package-lock.json` churn is environment-only and intentionally excluded from the
   release commit.** The working tree rewrote `resolved` URLs from Replit's internal
   `package-firewall.replit.local` mirror to `registry.npmjs.org` (no version or
   integrity changes, no packages added/removed). This is unrelated to Kevin and is not
   committed, to avoid perturbing Replit's dependency resolution.

## Explicitly out of scope for this release

- Phase 3 approval resolution flow, Approval Inbox UI.
- Kevin → TE write-back tools / service-credential callback path (§4.5 of the
  architecture doc).
- Multi-instance-safe rate limiting and background run reconciliation.
- Fixing pre-existing repo TypeScript errors and dependency advisories.
