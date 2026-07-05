---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-29
Owner: Engineering
---

# Documentation Audit — Post Version 2

> **Status update (2026-06-29):** This audit is a point-in-time snapshot taken *before*
> the final reconciliation pass. The reconciliation gap it flags in §8 (four documents'
> Recommended-CLAUDE.md-Updates "unapplied") has since been **closed** — those items
> were applied to `CLAUDE.md` or formally deferred with reasons. See the
> **Reconciliation Log** in `docs/version-2-roadmap.md`. The findings below are retained
> as the historical record that motivated that pass.

## Purpose

This document is the post–Version 2 audit of the TrainEfficiency engineering
knowledge base. Version 1 (framework, governance, architecture) and Version 2 (six
source-verified implementation/operations documents) are complete; this audit
evaluates the resulting knowledge base as a whole before Version 3 is scoped.

It is a **documentation-only** assessment. No application source code was modified.
No existing documentation was modified to produce this audit — only this file was
created. The audit is evidence-based: every structural claim was checked against the
repository on 2026-06-29.

---

## Audit Scope & Method

The audit reviewed:

- The Version 1 governance/framework set (`documentation-map.md`, `_template.md`,
  `documentation-status-legend.md`, `documentation-governance.md`,
  `documentation-maturity-model.md`, `documentation-generation-workflow.md`).
- The Version 2 implementation/operations set (`schema.md`, `core-services.md`,
  `agent-catalog.md`, `integrations.md`, `api-conventions.md`, `runbooks.md`).
- `CLAUDE.md` (architecture reference) and `version-2-roadmap.md` (execution plan).
- Root-level legacy documents (`replit.md`, `AUDIT_REPORT.md`,
  `COMMUNICATION_ARCHITECTURE_AUDIT.md`).
- The repository itself, to test architecture-vs-implementation alignment and
  measure coverage.

Repository scale measured during the audit:

| Surface | Measure |
|---|---|
| `server/` TypeScript files | 330 files (~170,000 LOC) |
| `server/` top-level modules | 133 `.ts` files |
| `server/services/` | 81 files |
| `server/frameworks/` | 35 files |
| `client/` TypeScript/TSX files | 325 files |
| `shared/schema.ts` | 5,333 lines, 231 `pgTable` definitions |

Several documented facts were spot-checked directly against source and **confirmed**:
`shared/schema.ts` exists and `server/db/schema.ts` does not; `server/agent-identities.ts`
defines exactly the 9 canonical `*_agent` identities; `requireRole` is defined at
`server/routes.ts:160` and is not exported; `server/financial-metrics.ts` exists at the
documented path.

---

## 1. Documentation Completeness

**Strong for the backend; absent for the frontend.**

Every document promised by the Version 2 roadmap exists, carries the four mandated
standardized sections (Architecture Discrepancies, Recommended CLAUDE.md Updates,
Files Reviewed, Confidence Assessment), and substantiates its verification status
with a Files Reviewed trail.

| Document | Lines | Standardized sections present | Status |
|---|---|---|---|
| `schema.md` | 2,874 | ✅ all four | Verified Against Source |
| `core-services.md` | 1,509 | ✅ all four | Verified Against Source |
| `agent-catalog.md` | 962 | ✅ all four | Verified Against Source |
| `integrations.md` | 959 | ✅ all four | Verified Against Source |
| `api-conventions.md` | 603 | ✅ all four | Verified Against Source |
| `runbooks.md` | 798 | ✅ all four | Partially Verified (Operations) |

**Completeness gap:** the knowledge base documents the server, schema, agents,
integrations, API surface, and operations — but the **client (325 files) is entirely
undocumented**. There is no frontend architecture document covering routing, state
management (TanStack Query patterns), the component/`shadcn` layer, or the
page→API→domain mapping. For an "AI-native operating system" with a large React
surface, this is the single largest completeness gap.

---

## 2. Cross-Document Consistency

**Internally consistent within the Version 2 set; inconsistent at the edges.**

- The Version 2 documents cross-reference each other coherently (e.g.
  `agent-catalog.md` and `api-conventions.md` both reference the `requireRole`
  export restriction; `integrations.md` and `core-services.md` agree on the
  credential-vault model). Findings propagate correctly between documents.
- **Inconsistency — legacy `replit.md` drift.** Four of the six implementation docs
  cite discrepancies against `replit.md` (e.g. the "Unified Business Agent" naming,
  the contact-quality tier taxonomy, "Email Agent Phases 1–10" vs. the Phase 9
  implementation). `replit.md` is an unversioned root document outside the knowledge
  base that still contains stale and conflicting descriptions. It is neither
  classified in the status legend nor reconciled.
- **Inconsistency — legacy root audits.** `AUDIT_REPORT.md` (May 2, 2026) and
  `COMMUNICATION_ARCHITECTURE_AUDIT.md` (June 6, 2026) sit at the repository root
  with no frontmatter and no place in the documentation map. The latter overlaps
  substantially with `integrations.md` and `core-services.md` (communication
  channels), creating two sources of truth for the same subsystem.

---

## 3. Architecture vs. Implementation Alignment

**The Version 2 process worked: discrepancies were found and named honestly.** Each
implementation document surfaced real gaps between `CLAUDE.md`'s intent and the source,
and — critically — distinguished genuine conflicts from documentation gaps where the
source *confirms* the architectural intent (ADR-002 org-scoping, ADR-008 abstraction).

Highest-signal confirmed discrepancies still standing:

1. **Schema location.** `CLAUDE.md`/`replit.md` lineage implied `server/db/schema.ts`;
   the real schema is `shared/schema.ts` (confirmed: `server/db/schema.ts` does not
   exist). `CLAUDE.md` itself no longer hardcodes the wrong path, but `replit.md` and
   the schema.md recommendation trail still reference the old location.
2. **Auth is not centralized in mechanism.** Server-side enforcement holds, but the
   mechanism is duplicated: `requireRole` (unexported), per-file `requireAdmin`
   helpers with inconsistent error bodies, `privilegedOnly`, `requireCoach`/
   `requireOrgUser`. This contradicts the "Authentication should remain centralized"
   claim while preserving the security *intent*.
3. **No response/error envelope or API versioning.** De-facto error shape is
   `{ message }`; routes are flat under `/api/` with no version segment.
4. **Schema changes via `drizzle-kit push` with an empty migration history**, against
   `CLAUDE.md`'s "non-destructive / reversible migrations" intent.
5. **All crons run in-process via `setInterval` in every web process** — a scaling
   correctness factor not addressed by `CLAUDE.md`'s Background Jobs section.
6. **~20 tables created via raw `db.execute(sql\`...\`)`** outside the Drizzle graph
   (e.g. `apex_recommendations`, `pulse_recommendations`, `risk_signals`,
   `hermes_auto_learnings`, `decision_journal_entries`, `software_kb_entries`).

`CLAUDE.md` has been partially reconciled — see §8.

---

## 4. Missing Repository Coverage

| Area | Files (approx) | Documented? |
|---|---|---|
| Database schema | `shared/schema.ts` (231 tables) | ✅ `schema.md` |
| Backend services | `server/services/` (81) + key root modules | ✅ `core-services.md` (representative, not exhaustive) |
| AI agents | `server/agents/`, `server/email-agent/` | ✅ `agent-catalog.md` |
| Integrations | `server/integrations/`, connectors, Composio | ✅ `integrations.md` |
| API/auth conventions | `server/routes.ts`, route files | ✅ `api-conventions.md` |
| Operations | startup, crons, env contract | 🟡 `runbooks.md` (Partially Verified) |
| **Frontend / client** | **`client/` (325 files)** | ❌ **none** |
| **`server/frameworks/`** | **35 files** | ⚠️ partial / unclear |
| **`server/workflows/` + workflow engines** | workflow-orchestrator, graph/job engines | ⚠️ thin |
| **`docs/architecture/` subsystem docs** | scheduling, CRM, billing, etc. | ❌ referenced by map, **directory does not exist** |
| **Testing** | `server/tests`, `__tests__` | ❌ no testing/QA doc |

Two coverage facts deserve emphasis:

- **`docs/documentation-map.md` references `docs/architecture/` (scheduling, CRM,
  billing, AI platform, governance, Executive OS) — but that directory does not
  exist.** The map promises subsystem documentation the knowledge base never
  delivered. This is both a missing-coverage gap and a broken cross-reference.
- **`core-services.md` documents a representative slice of `server/services/`**, not
  all 81 files plus the 35 `server/frameworks/` files. This is reasonable
  prioritization, but the breadth limit should be stated so the document isn't read
  as exhaustive.

---

## 5. Duplicate Information

- **Communication architecture is documented twice:** the verified `integrations.md`/
  `core-services.md` treatment and the legacy root `COMMUNICATION_ARCHITECTURE_AUDIT.md`.
  These will diverge over time unless the legacy file is retired or explicitly marked
  superseded.
- **Schema location and raw-SQL table inventory** are discussed in both `schema.md`
  (Appendix A) and `core-services.md` (which adds `decision_journal_entries`,
  `software_kb_entries`). The canonical raw-SQL inventory should live in one place
  (schema.md) with others pointing to it.
- **`replit.md`** restates stack, "where things live," and architecture decisions that
  now have authoritative homes in `CLAUDE.md` and the Version 2 docs — duplication
  that is also stale (see §6).

Within the Version 2 set itself, duplication is well-controlled — cross-references are
used instead of copying.

---

## 6. Stale Information

- **`replit.md`** — highest-severity stale artifact. Contains outdated agent naming,
  tier taxonomy, and phase numbering already contradicted by source in four
  implementation docs. Unversioned, unclassified.
- **`AUDIT_REPORT.md` (May 2, 2026)** — a point-in-time product/UX audit, now ~2
  months old, not part of the engineering KB and not maintained.
- **`documentation-status-legend.md` "Applying This Legend" table is stale.** It still
  lists `schema.md`, `agent-catalog.md`, `core-services.md`, `integrations.md` as
  *"Future …"* documents that "start at Architecture Specification," and it **omits
  `api-conventions.md` entirely**. All six now exist and are Verified/Partially
  Verified. The legend's own application table was not updated when Version 2 completed.
- **`schema.md` / `core-services.md` Recommended-Updates trail references a "Where
  things live" section** that exists in `replit.md`, not in `CLAUDE.md` — so those
  recommendations point at a section the target document does not contain.

---

## 7. Verification Metadata Consistency

**Mostly consistent, with one format defect and one stale table.**

- **Frontmatter format inconsistency.** `agent-catalog.md`, `integrations.md`,
  `api-conventions.md`, and `runbooks.md` use the mandated YAML frontmatter block.
  **`schema.md` and `core-services.md` instead use a bold-key header style**
  (`**Document Type:** Implementation`, `**Verification Status:** …`) under an H1
  title. The status legend and `_template.md` require YAML frontmatter; two of six
  implementation docs do not comply, which breaks any future automated metadata
  parsing (a Version 3 goal).
- **Verification status values are otherwise consistent and defensible:** five
  Implementation docs at `Verified Against Source`, `runbooks.md` correctly held at
  `Partially Verified` with production-only items flagged **Requires Production
  Validation** — exactly as the legend prescribes for Operations docs.
- **The legend's classification table is out of date** (see §6) and should be
  refreshed to list all current documents with their actual statuses.

---

## 8. Governance Consistency

**The governance model is sound and was mostly followed — with one material deviation.**

The roadmap's revised "Continuous Reconciliation" process requires that each
implementation document's discrepancies be reconciled into `CLAUDE.md` (recommended or
applied) **before the next document is started**, not batched.

Audit of what was actually applied to `CLAUDE.md`:

| Source document | Recommendations | Applied to `CLAUDE.md`? |
|---|---|---|
| `agent-catalog.md` | 9 canonical identities, fail-closed pattern, `requireRole` restriction, raw-SQL agent tables | ✅ **Applied** (Canonical Agent Identities + Agent Implementation Conventions sections present) |
| `integrations.md` | Expanded integration list, OpenRouter/Composio reality, framework modules, forward-declared `IntegrationType`, credential standard | ✅ **Applied** (External Integrations + Integration Framework reconciled) |
| `schema.md` | Schema path, sub-models, raw-SQL tables, `risk_signals`, `booking_status` uppercase | ⚠️ **Partially / not applied** — `CLAUDE.md` has no schema-path or `booking_status` notes; only a generic raw-SQL-tables note exists |
| `core-services.md` | financial-metrics single-source-of-truth, send-guard chain, opportunity agents, hermes table name, cron wiring | ❌ **Not applied** |
| `api-conventions.md` | Canonical auth chain, de-facto standards, centralization-debt note | ❌ **Not applied** (document explicitly defers: "no `CLAUDE.md` edits are applied by this document") |
| `runbooks.md` | Schema-change mechanism, in-process scheduler caveat, ops pointer, env contract | ❌ **Not applied** ("none applied here") |

**Conclusion:** reconciliation was performed continuously for the first reconciled
documents (agents, integrations) but **the last four documents' recommendations remain
outstanding**. The later documents adopted a "recommend only, defer application"
posture, which is defensible (it preserves `CLAUDE.md` stability and keeps changes
review-gated) but means the governance promise — reconcile before moving on — was
honored in spirit (recommendations were written) but not in completion (edits not
applied). This is the primary open governance item.

Otherwise governance is consistent: document types, ownership, the two-dimensional
status model, and the Files Reviewed citation discipline are applied uniformly.

---

## 9. Documentation Quality

**High.** The Version 2 documents are specific, source-cited, and honest about
uncertainty:

- Claims are traceable to files, line numbers, table names, and constants (e.g.
  `routes.ts:160`, the 8:30 AM cron window, the `MAX_FOLLOW_UPS` constant, the
  92/80/62/38/0 contact-quality scores).
- Each document distinguishes **conflict** from **confirmation** rather than treating
  every difference as a defect — a sign of mature analysis.
- Confidence Assessments are graded (High/Medium/Low) per area, with explicit gaps
  named (e.g. raw-SQL tables Medium, FK relationships Medium, live row counts Low).
- Writing is concise and consistently structured against `_template.md`.

Quality detractors are structural, not substantive: the two non-YAML frontmatters
(§7) and the unretired legacy root documents (§5, §6).

---

## 10. AI-Readiness

**Strong for backend reasoning; blind on the frontend.**

A capable agent (or Claude) loading this knowledge base would be well-equipped to
reason about the schema, agents, integrations, services, API conventions, and
operations — the documents are dense with the exact identifiers, constraints, and
fail-closed patterns an agent needs to make safe changes. The explicit "Does NOT own"
boundaries and discrepancy callouts are especially valuable for preventing wrong-file
edits.

Limits on AI-readiness:

- **No machine-uniform metadata** (two docs break the YAML contract), so automated
  ingestion/validation — a Version 3 goal — cannot yet rely on frontmatter.
- **Frontend is invisible**, so any client-side task would force the agent to read 325
  files cold.
- **Broken `docs/architecture/` pointer** would send an agent to a nonexistent path.
- **Competing sources** (`replit.md`, root audits) could mislead an agent that
  weights them equally with the verified set.

---

## 11. Onboarding Readiness for a Senior Engineer

A senior backend engineer could become productive on the **server** quickly: they
would understand the data model, the agent ecosystem and its identity registry, the
integration governance framework, the de-facto API/auth conventions, and the
operational startup/cron model — including the known sharp edges (push-based schema,
in-process crons, duplicated auth helpers).

They would be **under-served** on: the React frontend (no document at all), the
workflow engine internals, the testing strategy, and subsystem-level architecture
(the promised `docs/architecture/` set). They would also have to learn, by trial,
which root-level documents are authoritative versus stale.

Net: **strong backend onboarding, incomplete full-stack onboarding.**

---

## Executive Summary

Version 2 delivered what it promised: six implementation/operations documents derived
directly from source, each carrying the mandated standardized sections and a citation
trail that substantiates its verification status. Spot-checks against the repository
confirm the documents are accurate where they make claims. The governance model
(two-dimensional status, ownership, continuous reconciliation) is sound and was
applied with discipline.

The knowledge base is, today, an excellent **backend** engineering reference and a
strong substrate for AI-assisted work on the server. Its weaknesses are at the
boundaries: the **frontend (325 files) is undocumented**, the **promised
`docs/architecture/` subsystem set does not exist** though the map references it, **four
of six documents' Recommended CLAUDE.md Updates remain unapplied**, **two documents use
a non-compliant frontmatter format**, the **status legend's application table is stale**,
and **legacy root documents (`replit.md`, two audit files) compete with the verified set
as unmanaged, partly stale sources of truth.**

None of these are defects in the verified content itself — they are completeness,
reconciliation, and hygiene gaps. They are the natural Version 3 backlog.

---

## Overall Documentation Score

**84 / 100**

Rationale: backend completeness, accuracy, honesty, and structure are excellent
(would score ~92 in isolation). Deductions: frontend coverage absent (−6), unapplied
reconciliations for four docs (−4), metadata/legend inconsistencies (−3), broken
`docs/architecture/` reference (−2), unmanaged legacy/stale root docs (−1).

| Dimension | Score |
|---|---|
| Completeness | 78 |
| Cross-document consistency | 82 |
| Architecture/implementation alignment | 90 |
| Repository coverage | 72 |
| Freedom from duplication | 85 |
| Freedom from staleness | 80 |
| Verification metadata consistency | 80 |
| Governance consistency | 84 |
| Quality | 93 |
| AI-readiness | 85 |
| Onboarding readiness | 82 |

---

## Documentation Coverage Estimate

**≈ 70%** of the repository's meaningful surface is documented.

- Backend (schema, agents, integrations, core services, API, ops): **~85%**
- Frontend (`client/`, 325 files): **~5%**
- Workflow engine internals & `server/frameworks/`: **~40%**
- Testing/QA: **~5%**

Weighted by surface area and the backend-heavy nature of the platform's business
logic, the blended estimate is ~70%.

---

## Repository Understanding Estimate

**≈ 76%.** A reader of this knowledge base would correctly understand the platform's
data model, AI operating system, integration governance, request lifecycle, and
operational model. They would not understand the user-facing application layer, the
workflow execution engine in depth, or the test strategy. The 231-table schema and
the agent/integration governance are the hardest parts of the system to infer from
code alone, and those are precisely the parts that are best documented — so
understanding is weighted toward the high-value areas.

---

## Top 10 Strengths

1. All six Version 2 documents exist, are source-derived, and carry the four mandated
   standardized sections.
2. Claims are traceable to specific files, line numbers, tables, and constants.
3. Discrepancies are reported honestly and separated from confirmations.
4. The 231-table schema is documented in depth, including raw-SQL tables outside
   Drizzle.
5. The AI agent ecosystem is fully cataloged against the canonical 9-identity registry.
6. The integration governance framework (runtime, vault, status service) is documented
   as the concrete realization of ADR-008.
7. `runbooks.md` correctly stays `Partially Verified` and flags production-only items.
8. Confidence is graded per-area with explicit, named gaps.
9. The two-dimensional Document Type / Verification Status model is clear and applied.
10. `CLAUDE.md` was genuinely reconciled for the agent and integration domains, not
    just annotated.

---

## Top 10 Gaps

1. **Frontend is entirely undocumented** (325 client files).
2. **`docs/architecture/` is referenced by the map but does not exist.**
3. **Four of six docs' Recommended CLAUDE.md Updates are unapplied** (schema,
   core-services, api-conventions, runbooks).
4. **Two docs (`schema.md`, `core-services.md`) violate the YAML frontmatter contract.**
5. **The status-legend application table is stale** (lists V2 docs as "Future,"
   omits `api-conventions.md`).
6. **`replit.md` is stale and unmanaged**, yet still contradicted by four docs.
7. **Legacy root audits** (`AUDIT_REPORT.md`, `COMMUNICATION_ARCHITECTURE_AUDIT.md`)
   are unclassified and partly duplicative.
8. **Workflow engine and `server/frameworks/` (35 files) are thinly covered.**
9. **No testing/QA documentation.**
10. **`core-services.md` documents a representative, not exhaustive, slice of 81+35
    service/framework files without stating the breadth limit.**

---

## Highest-Priority Improvements

1. **Apply or formally close the four outstanding `CLAUDE.md` reconciliations.** Either
   make the edits (schema path/booking_status, financial-metrics single-source-of-truth
   + send-guard chain, API canonical-chain + centralization-debt note, schema-change
   mechanism + in-process scheduler caveat) or record an explicit decision deferring
   them, so the continuous-reconciliation promise is closed out.
2. **Refresh `documentation-status-legend.md`'s application table** to list all current
   documents with their real statuses, including `api-conventions.md`.
3. **Normalize frontmatter** in `schema.md` and `core-services.md` to the mandated YAML
   block.
4. **Resolve the `docs/architecture/` reference** — either create the subsystem docs or
   amend `documentation-map.md` to stop promising them.
5. **Triage legacy root documents** — give `replit.md` and the two root audits
   frontmatter and a "Superseded by …" pointer, or retire them into an archive.
6. **Write a frontend architecture document** (`docs/client-architecture.md`).

---

## Recommended Version 3 Roadmap

Version 3 should shift from *manual authoring* to *coverage closure + automation*,
building on the now-stable backend baseline.

**Phase 3.1 — Reconciliation & Hygiene Closeout (fast, low-risk)**
- Apply/close the four outstanding `CLAUDE.md` reconciliations (§8).
- Normalize frontmatter; refresh the legend's application table.
- Fix or remove the `docs/architecture/` reference; triage/retire legacy root docs.

**Phase 3.2 — Coverage Completion**
- `docs/client-architecture.md` (routing, TanStack Query patterns, component layer,
  page→API map).
- `docs/workflow-engine.md` (orchestrator, graph/job engines, queue, registry seeder).
- `docs/testing.md` (test layout, what is and isn't covered).
- The promised `docs/architecture/` subsystem set (scheduling, CRM, billing, AI
  platform, governance, Executive OS), or a decision to fold them into existing docs.

**Phase 3.3 — Automation (the original Version 3 preview)**
- CI documentation validation: fail builds when frontmatter is missing/malformed or
  when documented identifiers (table names, agent IDs, route paths) disappear from
  source.
- Drift detection between `shared/schema.ts` and `schema.md`, and between
  `server/agent-identities.ts` and `agent-catalog.md`.
- Generated artifacts: dependency graphs, architecture diagrams, API reference.

**Phase 3.4 — Production Validation**
- Promote `runbooks.md` from `Partially Verified` toward `Verified Against Production`
  by validating the **[RPV]**-marked items against the live environment.

Automation in 3.3 should be gated on 3.1 (uniform metadata is a prerequisite for
machine validation).

---

## Final Recommendation — Reference Implementation Status

**Recommended, with conditions.** The TrainEfficiency knowledge base is a strong
candidate to serve as the reference pattern for documenting future repositories. Its
durable, transferable strengths are the model worth replicating:

- the two-dimensional Document Type / Verification Status classification,
- the source-first generation workflow with a mandatory Files Reviewed citation trail,
- the four standardized closing sections (Discrepancies / Recommended Updates / Files
  Reviewed / Confidence) on every implementation document, and
- continuous reconciliation against a canonical architecture reference.

These should be lifted as the template for other repositories now.

The **conditions** before it is held up as an exemplar of a *complete* knowledge base:
close the four outstanding reconciliations, achieve uniform metadata, cover the
frontend, and resolve the broken `docs/architecture/` promise. Until then, promote it
as a reference for **process and structure** — which it does exemplary work on — rather
than as a reference for **end-to-end coverage**, which it has not yet achieved.

---

## Related Documentation

- `docs/version-2-roadmap.md` — the completed Version 2 execution plan this audit follows.
- `docs/documentation-status-legend.md` — classification model (needs the §6/§7 refresh).
- `docs/documentation-governance.md` — maintenance model this audit applies.
- `docs/documentation-map.md` — entry point (contains the broken `docs/architecture/`
  reference noted in §4).
- `CLAUDE.md` — architecture reference; reconciliation state assessed in §8.

---

## Last Updated

Date: 2026-06-29

Author: Engineering (post–Version 2 documentation audit)

Version: 1.0
