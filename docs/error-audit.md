# TrainEfficiency Error Audit

**Date:** 2026-07-06
**Branch audited:** `main` @ `8bec897`
**Scope:** Read-only audit. No source code was modified. This PR adds only this report.
**Author:** Automated audit (Claude)

---

## 0. How to reproduce

```bash
npm install
npm run check                                   # tsc against tsconfig.json (server + shared + client)
node node_modules/typescript/bin/tsc -p tsconfig.client.json   # client-only typecheck (what the build runs)
for f in server/tests/*.test.ts; do npx tsx --test "$f"; done   # test suite (node:test)
npm run build                                    # tsx script/build.ts
```

> **Environment note (important for the numbers below).** In the audit sandbox, `npm install`
> hit an intermittent npm bug (`Exit handler never called` / `ENOTEMPTY` on atomic renames) that
> left four declared dependencies unextracted: `openai`, `@octokit/rest`, `composio-core`,
> `@anthropic-ai/claude-code`. Only `openai` is imported broadly, and its absence produced **62
> spurious `Cannot find module 'openai'` errors**. Those are **install artifacts, not code
> defects** — after extracting `openai@6.22.0` manually, the count dropped and the module resolved.
> All counts below are reported **after** removing those artifacts. `npm run build` could not be
> fully exercised in-sandbox for the same reason (missing `fdir`, a Vite transitive dep); this is
> environmental, not a repo defect. Re-run on a clean `npm ci` in CI to confirm.

---

## 1. Headline numbers

| Metric | Value |
|---|---|
| Raw `tsc` diagnostics on first run (incl. install artifacts) | **556** |
| Install-artifact errors removed (`Cannot find module 'openai'`) | **60** |
| **Genuine TypeScript errors (`npm run check`)** | **496** |
| — of which server/shared | 466 |
| — of which client files | 30 (all `TS2802`, see below — client build is clean) |
| Unique error messages (deduplicated by normalized message) | **185** |
| Unique files affected | **120** |
| Distinct TS error codes | 26 |
| Test files: total / pass / fail | 22 / 14 / 8 |
| — real test regressions | **0** (all 8 failures are environmental: 7 need `DATABASE_URL`, 1 needs the app running on :5000) |
| Client typecheck (`tsconfig.client.json`) | **0 errors — passes** |

**Dedup summary:** 496 raw error instances → **185 unique messages** → clustering by root cause
yields roughly **~40 distinct fixable defects** plus one config change that clears ~100 at once.

### Why these went unnoticed
`script/build.ts` only typechecks the **client** (`tsc --noEmit -p tsconfig.client.json`), which
passes. The 466 server-side errors are **never gated by the build or by any CI step**, so they
accumulated silently. This is the single most important structural finding — see Category 8.

---

## 2. Errors by TypeScript code

| Code | Count | Meaning | Primary category |
|---|---:|---|---|
| TS2339 | 195 | Property does not exist on type | Mixed (3, 1, 7) |
| TS2802 | 96 | Set/Map not iterable without `--target ES2015+` | 7 / 8 (config) |
| TS2345 | 35 | Argument type not assignable | 3 / 7 |
| TS7006 | 29 | Parameter implicitly `any` | 7 |
| TS2353 | 22 | Object literal has unknown property (Drizzle inserts) | 3 |
| TS2769 | 20 | No overload matches (Drizzle queries) | 3 |
| TS2322 | 16 | Type not assignable | 3 / 7 |
| TS2551 | 15 | Property misspelled ("did you mean…") | 3 / 7 |
| TS2393 | 12 | **Duplicate function implementation** | 1 / 5 |
| TS2352 | 8 | Unsafe type conversion | 7 |
| TS18047 | 8 | Value possibly `null` | 7 |
| TS1252 | 8 | Iteration flag | 7 |
| TS2538 | 5 | `null`/`undefined` cannot index | 7 |
| TS18048 | 5 | Value possibly `undefined` | 7 |
| TS2304 | 3 | **Cannot find name** (undeclared identifier) | 1 / 4 |
| TS2367 | 3 | **Comparison has no overlap** (always-false logic) | 1 |
| TS2307 | 2 | **Cannot find module** (broken import) | 4 |
| TS2552 | 2 | **Cannot find name** ("did you mean…") | 1 / 4 |
| TS2554 | 2 | Wrong argument count | 3 |
| TS7053 | 2 | Implicit `any` index | 7 |
| TS18046 | 2 | Value is `unknown` | 7 |
| TS2305 | 1 | **Module has no exported member** (`deals`) | 4 |
| TS2448 | 1 | **Block-scoped var used before declaration** (TDZ) | 1 |
| TS2869/2783/2454/1117 | 4 | Misc | 7 |

---

## 3. Categorized findings

### 1. Production runtime risks — **CRITICAL**
**Count:** ~40 error instances → **~15 distinct defects**, of which **6 are reachable
`ReferenceError`/logic crash paths.**

These are the crown jewels of the audit: TypeScript is reporting undeclared identifiers, TDZ
violations, and always-false comparisons that will **throw or silently misbehave at runtime** on
real endpoints (the server runs via `tsx`/`esbuild`, which do **not** typecheck, so these ship).

| Location | Defect | Runtime effect |
|---|---|---|
| `server/routes.ts:25154` | `gte` used but not imported (line 36 import list omits it; other handlers do a local `await import`) | `ReferenceError: gte is not defined` on the org AI-learning-events endpoint |
| `server/routes.ts:16034` | `fromEmail` referenced before its `const` declaration (TDZ) | `ReferenceError: Cannot access 'fromEmail' before initialization` on the booking-application email path |
| `server/routes.ts:12614` | `openai` used but no `openai` binding in scope | `ReferenceError: openai is not defined` on the revenue-intelligence recommendations endpoint |
| `server/routes.ts:8622` | `adminProfile` undeclared (optional chaining does **not** protect an undeclared identifier) | `ReferenceError` on the team-quote email path |
| `server/agents/scheduling-agent.ts:97–98` | Status compared against lowercase `"confirmed"/"completed"/"cancelled"` while the enum is uppercase `"CONFIRMED"/…` → **no overlap, always false** | Appointment-status filtering silently never matches; dependent counts/logic are dead |
| `server/integrations/gmail.ts:164,207` | `gmailClassifyReply` does `await import("../openai")` — `server/openai` does not exist. Function **is reachable** (imported by `routes.ts`, `agent-tools/implementations.ts`, `services/gmail-agent-service.ts`) | Throws when classifying an inbound Gmail reply |
| `server/storage.ts` (12×) | Six `DatabaseStorage` methods each **defined twice** (`createOutreachDraft`, `getOutreachDraft`, `updateOutreachDraft`, `getOutreachEvents`, `getAgentActions`, `updateAgentAction`) | Later definition silently wins; if bodies differ, wrong behavior. Likely cascades into the 21 `does not exist on DatabaseStorage` errors |
| `server/agent-billing-engine.ts:78` / `orchestration/organization-intelligence-orchestrator.ts:531` | `RoyaltyDistribution` / `OrganizationEventLog` types not found | Type unresolved; runtime impact depends on usage |

**Likely root cause:** hand-edits during the skill-chain work removed/renamed imports and helpers
without a typecheck gate to catch them; copy-paste duplication in `storage.ts`.
**Fix strategy:** targeted, one-line-each fixes (add the missing import/binding, fix the TDZ order,
correct the enum casing, delete the duplicate method bodies, point the Gmail import at the real
module). Each is independently testable and reversible.
**Risk level:** **CRITICAL** (reachable production endpoints; silent logic failure).

---

### 2. Security / authz risks — **LOW (nothing new proven)**
**Count:** 0 confirmed from this audit; 1 test unrunnable in-sandbox.

- The Phase 1B–1I **authorization static-guard tests all PASS** (`phase1b`…`phase1i-authz`,
  `org-isolation-helpers`, `phase1c-org-isolation`, `hotfix-admin-setup`) — the org-isolation and
  route-auth invariants they encode still hold on `main`.
- `admin-auth.test.ts` is an **integration** test that expects the app on `http://localhost:5000`;
  in-sandbox that port is macOS ControlCenter/AirPlay (returns `403`), so all 14 sub-assertions
  fail spuriously. **Not evidence of an authz gap** — needs the app actually running.
- Caveat: many `TS2339` errors are untyped `req`/`session`/object access. Untyped auth context can
  *mask* authz mistakes, but none were proven here.

**Fix strategy:** run `admin-auth.test.ts` against a real server in CI before drawing conclusions.
**Risk level:** LOW / unknown. (Marketplace/org authorization work is explicitly **out of scope** —
see the backlog memory items; do not start it here.)

---

### 3. Data / schema / Drizzle issues — **HIGH**
**Count:** ~100+ instances (`TS2353` 22, `TS2769` 20, `TS2339` on schema columns 38, Stripe-drift
`TS2339` ~20, `TS2305` 1, plus subsets of `TS2345`/`TS2551`/`TS2554`).

Representative examples:
- `server/agent-telemetry-sdk.ts:116` — insert specifies `totalExecutions`, not in the table's
  insert type (schema drift).
- `server/agent-tools/action-mapper.ts:117,179` — insert specifies `entityType`, not in the type.
- `server/services/outcome-bridge-service.ts:13` — `import { deals } from "@shared/schema"` —
  **no `deals` export** (renamed/removed table).
- 38× property access on `PgTableWithColumns<{ name: "org_users"; … }>` for columns that don't
  exist on the current schema definition.
- ~20× Stripe SDK v20 type drift: `current_period_end`, `.subscription`, `Invoice`,
  `Response<Subscription>` — the accessed shape changed between Stripe API versions.

**Affected files (top):** `storage.ts`, `athlete-intelligence-routes.ts`, `agent-telemetry-sdk.ts`,
`agent-tools/action-mapper.ts`, `outcome-bridge-service.ts`, `education-phase2-routes.ts`, `routes.ts`.
**Likely root cause:** schema/table definitions and Stripe SDK evolved; call sites and inserts
weren't updated in lockstep (again, no typecheck gate).
**Fix strategy:** reconcile each insert/query against `@shared/schema`; treat Stripe drift as its
**own** PR that verifies against the pinned Stripe API version before touching payment code.
**Risk level:** HIGH (data-integrity + payments), but **not** all quick — split into schema-column
fixes vs. Stripe-typing fixes.

---

### 4. Broken imports / missing exports — **HIGH (small, surgical)**
**Count:** 3 pure import breaks (+ the undeclared-name items counted in Category 1).

- `server/integrations/gmail.ts` → `../openai` (module does not exist) — **reachable** (see Cat 1).
- `server/services/outcome-bridge-service.ts:13` → `deals` not exported from `@shared/schema`.
- `server/routes.ts:12614` → `openai` binding missing in scope.

**Fix strategy:** repoint to the correct module/export or restore the deleted wrapper. Tiny diffs.
**Risk level:** HIGH impact / LOW effort.

---

### 5. Dead code / unmounted code — **MEDIUM**
**Count:** ~6 (the earlier copies of the 6 duplicated `storage.ts` methods are unreachable).

- `storage.ts` duplicate methods: the **first** definition of each duplicated method is dead (JS
  keeps the last). Safe to delete once verified identical; if they differ, that's a Category-1 bug.
- No conclusively unmounted **route** was proven from typecheck alone. `gmailClassifyReply` looked
  like a candidate but is **NOT dead** — it is imported in three places.

**Fix strategy:** delete the redundant method bodies after diffing the two copies.
**Risk level:** MEDIUM (only risky if the duplicate bodies diverge).

---

### 6. Test-only issues — **LOW (no real regressions)**
**Count:** 8 failing test files, **0 real regressions**.

- 7 failures are `Error: DATABASE_URL must be set` at import time (`apex-agent`, `connector-layer`,
  `gmail-draft-phase2b`, `send-path-audit`, `slack-alert-phase2c`, `stripe-webhook`,
  `tool-workflow-safety`). These import DB-touching modules eagerly; they need a database URL.
- 1 failure (`admin-auth`) needs the app running on :5000 (see Category 2).
- The 14 static-source-guard tests (authz/org-isolation/promo/receipt/secrets) **all pass**.
- Separately: `**/*.test.ts` is **excluded** from `tsconfig.json`, so test files are never
  typechecked and may harbor their own type errors (not counted in the 496).

**Fix strategy:** provide `DATABASE_URL` (or a test DB) and a running server in CI; consider a
`test` script and splitting unit (static-guard) vs integration tests.
**Risk level:** LOW.

---

### 7. TypeScript strictness / noise — **LOW**
**Count:** ~180 instances.

- `TS2802` ×96 — Set/Map iteration. **Root cause is config, not code:** `tsconfig.json` sets no
  `target`, so it defaults to ES3 and flags every `for…of`/spread over Set/Map. The **client**
  tsconfig sets `target: ES2020` and these vanish (0 client errors there). The server runs via
  `esbuild`/`tsx` with a modern target, so these **never affect runtime**. All 30 "client" errors
  in `npm run check` are this code.
- `TS7006` ×29 (implicit `any` params), `TS18047`/`TS18048`/`TS18046` ×15 (possibly null/undefined),
  `TS2352` ×8 (conversions), `TS1252` ×8, `TS2538`/`TS7053` misc.

**Fix strategy:** the `TS2802` block is cleared by a **one-line** `target` addition (Category 8).
The rest is low-value churn — defer.
**Risk level:** LOW.

---

### 8. Documentation / config issues — **HIGH LEVERAGE**
**Count:** 3 structural issues.

1. **`tsconfig.json` has no `target`** → defaults to ES3 → all 96 `TS2802`. Adding
   `"target": "ES2020"` (matching `tsconfig.client.json`) removes ~100 errors with **zero code
   change** and no runtime effect.
2. **The build only typechecks the client.** `script/build.ts` runs `tsc -p tsconfig.client.json`
   only; the 466 server errors are never gated. This is why the backlog grew. A CI step that runs
   `npm run check` (server) is needed — **but only after** the Category-1 crashes are fixed, or it
   will block every build.
3. **Install fragility / declared-but-unresolved deps in this environment**: `openai`,
   `@octokit/rest`, `composio-core`, `@anthropic-ai/claude-code` (and Vite's `fdir`) failed to
   extract under the npm bug. Verify a clean `npm ci` in CI resolves all of them.

**Risk level:** HIGH leverage, LOW risk (config/process).

---

## 4. Top 10 highest-leverage fixes

Ordered by (impact ÷ effort × safety). Items 1–8 are small, isolated, reversible diffs.

1. **Add `"target": "ES2020"` to `tsconfig.json`.** Clears all 96 `TS2802` in one line; no runtime
   change. *(config)*
2. **`routes.ts:25154` — import `gte`.** Stops a live `ReferenceError` on the AI-learning-events
   endpoint. *(runtime crash)*
3. **`routes.ts:12614` — add the missing `openai` binding.** Stops a crash on the revenue-
   intelligence recommendations endpoint. *(runtime crash)*
4. **`routes.ts:16034` — fix `fromEmail` TDZ (declare before use).** Stops a crash on the booking-
   application email path. *(runtime crash)*
5. **`routes.ts:8622` — define/repair `adminProfile`.** Stops a crash on the team-quote email path.
   *(runtime crash)*
6. **`scheduling-agent.ts:97–98` — fix status casing.** Restores appointment-status logic that is
   currently always-false. *(silent logic bug)*
7. **`storage.ts` — remove the 6 duplicated methods.** Eliminates ambiguity and likely cascades away
   the 21 `does not exist on DatabaseStorage` errors. *(correctness)*
8. **`gmail.ts` — repoint `../openai` to the real module (or `openai`).** Stops Gmail-reply
   classification from throwing. *(runtime crash)*
9. **`outcome-bridge-service.ts:13` + missing names (`deals`, `RoyaltyDistribution`,
   `OrganizationEventLog`).** Fix the broken imports/exports. *(imports)*
10. **Add a CI `npm run check` (server) gate — _after_ 1–9 land.** Prevents regressions from silently
    re-accumulating. *(process)*

---

## 5. Do NOT fix yet (out of scope / deferred / risky)

- **The ~180 strictness/noise errors** (`TS7006` implicit-any, possibly-null, conversions). High
  churn across many files, low value, easy to introduce regressions. Defer to a dedicated,
  incremental strictness pass.
- **Stripe type-drift (`TS2339` ×~20).** Touches payment code; must be verified against the pinned
  Stripe API version first. Its **own** PR, not part of a broad cleanup.
- **The ~116 general `TS2339`/`TS2345` type mismatches.** Case-by-case; many are likely harmless.
  Triage separately.
- **Marketplace / org authorization work.** Explicitly out of scope (and tracked in existing backlog
  memory). Do not start it under this audit.
- **Turning server typecheck into a hard CI gate — until the Category-1 crashes are fixed.**
  Otherwise it red-lights every build.
- **The 8 "failing" tests.** They are environmental (missing `DATABASE_URL` / no running server),
  not code regressions. Fix the CI harness, not the code.

---

## 6. Is anything production-critical?

**Yes.** Category 1 contains **reachable production crash paths** — undeclared identifiers and a TDZ
violation on live routes (`gte`, `openai`, `fromEmail`, `adminProfile`), a Gmail-reply classifier
that imports a non-existent module, and duplicated storage methods. There is also a **silent logic
bug** in the scheduling agent (always-false status comparison). Because the server ships via
`esbuild`/`tsx` (no typecheck), these are **not** caught before deploy. Recommend fixing Top-10
items 1–8 first, as small independent PRs, before any broader cleanup.
