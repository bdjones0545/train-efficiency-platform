---
Document Type: Release / PR Report
Verification Status: Validated against source (Phases 0–2)
Last Reviewed: 2026-07-13
Owner: Platform Engineering + Kevin Ops
---

# Kevin Control Plane — Release Report (PR-ready)

**Production release audit of the Kevin ↔ TrainEfficiency integration, Phases 0–2.**

## 1. Branch & commit

| Field | Value |
|-------|-------|
| Release branch | `feature/kevin-control-plane-release` |
| Base | `main` @ `cb3c6ed` (== `origin/main`) |
| Commit | `7533baaa85bf9c2841e61574c01112e3b8aca47c` |
| Commit title | `feat(kevin): control-plane integration (Phases 0–2) — Hermes BFF, admin Console` |
| Diff size | 22 files changed, +3437 / −2 |
| Push status | **Pending** — blocked on GitHub credentials in the audit environment; branch/commit ready locally. |

## 2. Changed file summary

**New — server (BFF / services):**
- `server/kevin-routes.ts` — `/api/kevin/*` endpoints (health, capabilities, config-status, audit, runs CRUD, SSE events, stop). Every route guarded by `isAuthenticated + requireKevinAccess`.
- `server/services/kevin-hermes-client.ts` — server-only Hermes API Server client (holds `KEVIN_HERMES_API_KEY`, redacts base URL, timeouts, fail-safe health aggregation, SSE event mapping).
- `server/services/kevin-run-service.ts` — run/session persistence, idempotent create via `client_request_id`, reconcile, stop, in-memory rate limit.
- `server/services/kevin-audit-service.ts` — append-only, fail-open audit with secret-key payload redaction + health sampling.
- `server/services/kevin-context-builder.ts` — aggregate-only run instructions (explicitly no secrets/PII).
- `server/middleware/require-kevin-access.ts` — ADMIN-only, fail-closed.
- `server/scripts/kevin-phase0-smoke.ts` — offline-safe smoke check.

**New — client:**
- `client/src/pages/admin-kevin.tsx` — Kevin Console (health, capabilities, ops chat + SSE, recent runs, audit). Never receives Hermes creds/URLs.

**New — shared / config / docs:**
- `shared/kevin/types.ts`; `tsconfig.kevin.json`, `tsconfig.kevin-phase0.json` (scoped typecheck gates).
- `docs/kevin-hermes-integration-architecture.md` (design of record).
- `docs/kevin-release/{DEPLOYMENT_CHECKLIST,ROLLBACK,RISKS_AND_LIMITATIONS,RELEASE_REPORT}.md`.

**Modified (additive):**
- `client/src/App.tsx` (+1 route), `client/src/components/app-sidebar.tsx` (+nav), `client/src/components/command-palette.tsx` (+entry) — all ADMIN/advanced-only.
- `server/routes.ts` (+4: registers Kevin routes at the end).
- `.env.example` (+documents 3 KEVIN_* vars, no values), `.gitignore` (+`.env.kevin.local`), `package.json` (raise tsc heap for typecheck).

**Intentionally excluded:** `package-lock.json` — churn is environment-only (`resolved` URLs rewritten from Replit's `package-firewall.replit.local` mirror to `registry.npmjs.org`; no version/integrity/package changes). Unrelated to Kevin; left uncommitted.

## 3. Database migrations

- **No Drizzle migration, no `shared/schema.ts` change, no `db:push` required.**
- Three tables self-provision via idempotent `CREATE TABLE IF NOT EXISTS` on first use
  (consistent with CLAUDE.md "tables outside the Drizzle graph"):
  `kevin_audit_events`, `kevin_sessions`, `kevin_runs` (+ supporting indexes, incl.
  unique idempotency index on `(org_id, client_request_id)`).
- Down-migration (optional, destructive) documented in `ROLLBACK.md` Level 3.

## 4. Environment variables

New (BFF-only, server-side): `KEVIN_INTEGRATION_ENABLED` (optional, default `false`),
`KEVIN_HERMES_BASE_URL` (required when enabled), `KEVIN_HERMES_API_KEY` (required when
enabled, secret). Full matrix — purpose, required/optional, consumer, format,
server-side — in `DEPLOYMENT_CHECKLIST.md §1`. No new dependencies.

## 5. Test results

- **Automated tests: not executed — none runnable.** The repo has no test runner
  installed (no vitest/jest/mocha binary, no test config, no `test` script) and ships
  no Kevin tests. This is a pre-existing repo condition, documented as a known
  limitation.
- **Functional smoke:** `server/scripts/kevin-phase0-smoke.ts` validates the
  unconfigured/fail-safe path offline and health/capabilities against a live Hermes;
  run manually during deploy verification (see checklist §3).

## 6. Typecheck results

| Gate | Result |
|------|--------|
| `tsc -p tsconfig.kevin-phase0.json` (Kevin server+client+shared scope) | **PASS — 0 errors** |
| `tsc -p tsconfig.kevin.json` (Kevin + UI + auth + shared) | **PASS — 0 errors** |
| Production build `npm run build` (esbuild server + Vite client) | **PASS (exit 0)** — Kevin bundled; 2 warnings, both in pre-existing non-Kevin files |
| Full-repo `npm run check` (`tsc`) | **RED at baseline: 333 pre-existing errors, ZERO in Kevin files** (top: `routes.ts` 82). This is why the scoped gates exist; Kevin introduces no new errors. |

## 7. Security validation results

- **Server-side-only credentials:** browser never references `KEVIN_HERMES_*` and never
  imports the Hermes client module (grep-verified); only a redacted `scheme://host` is
  returned to the client.
- **AuthZ:** all 9 `/api/kevin/*` routes double-guarded (`isAuthenticated` +
  `requireKevinAccess`); ADMIN-only, fail-closed (`403 KEVIN_ADMIN_ONLY`); coach access
  locked off.
- **Fail-safe:** default-off flag; unconfigured/down/timeouts return safe
  `unconfigured`/`503`; audit and table bootstrap are fail-open and never block or crash.
- **Auditability:** append-only `kevin_audit_events` records health (sampled),
  capabilities, config, and run start/stop; payloads redact key/secret/token/password/authorization.
- **Secret scan:** CLEAN. The real 64-char `KEVIN_HERMES_API_KEY` appears in no repo
  file; `.env.kevin.local` is git-ignored and absent from index/history; `.env.example`
  key/URL fields are empty; no OpenAI/Slack/GitHub/Orgo/Hermes credential literals; no
  local machine paths; the only "internal URL" strings are illustrative placeholders in
  docs/`.env.example`.
- **Dependency audit:** 25 pre-existing advisories (10 high — `ws`, `yaml`,
  `retry-request`). Kevin adds **zero** dependencies → release does not change the audit
  posture; advisories tracked for a separate maintenance PR.

## 8. Rollback procedure

Three levels (full detail in `ROLLBACK.md`):
1. **Flag off** (seconds, no deploy): `KEVIN_INTEGRATION_ENABLED=false` + restart.
2. **Code revert** (one deploy): `git revert -m 1 <merge_sha>` — clean because all Kevin
   changes are new files or additive edits.
3. **Drop tables** (optional, destructive): `DROP TABLE kevin_runs/kevin_sessions/kevin_audit_events`.

Blast radius: no write path into any existing business table; cannot affect athlete,
billing, scheduling, or org data.

## 9. Known risks

R1 API-key value (server-only, redacted, rotate) · R2 don't expose Hermes port publicly
· R3 Hermes-down handled fail-safe · R4 `"platform"` org fallback shares run scope
across profile-less admins · R5 per-process rate limit under multi-instance · R6 SSE
passthrough parsed defensively · R7 baseline repo tsc red (not Kevin) · R8 pre-existing
dep advisories (not Kevin). Full table in `RISKS_AND_LIMITATIONS.md`.

## 10. Known limitations

No automated tests / no test runner in repo · Phase 3 approval-resolution UI not built
(approvals shown read-only) · admin-only single surface · runtime-provisioned
(unversioned) migrations · pull-based run reconciliation · lockfile churn excluded.

## 11. Deployment readiness assessment

**READY for review and staged deployment behind the default-off flag.** The change is
additive, feature-flagged, fails safe, preserves every stated architecture invariant,
adds no dependencies, requires no schema migration, and carries a clean secret scan and
clean Kevin-scoped typecheck + build. The two red signals (full-repo tsc, dependency
advisories) are pre-existing baseline conditions that this release neither introduces
nor worsens. Residual gap: no executable automated test coverage (repo-wide condition).

## 12. Exact next steps before merge

1. **Push the branch** (needs GitHub auth in the environment):
   `git push -u origin feature/kevin-control-plane-release`
2. **Open a PR** into `main` (do not merge yet):
   `gh pr create --base main --head feature/kevin-control-plane-release --title "feat(kevin): control-plane integration (Phases 0–2)" --body-file docs/kevin-release/RELEASE_REPORT.md`
3. **Human review** of `kevin-routes.ts`, `require-kevin-access.ts`, and
   `kevin-hermes-client.ts` (auth + credential boundary).
4. **Provision Hermes** (profile `kevin` up; note `API_SERVER_KEY`).
5. **Set Replit Secrets** `KEVIN_HERMES_BASE_URL` + `KEVIN_HERMES_API_KEY`; leave
   `KEVIN_INTEGRATION_ENABLED` unset for the first deploy.
6. **Merge**, deploy, then run the checklist §3–§4 verification. Flip
   `KEVIN_INTEGRATION_ENABLED=true` only after the off-state smoke passes.

> Not done by this audit (per instructions): no merge, no Replit deploy, no production
> data changes, no secret changes.
