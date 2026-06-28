---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Version 2 Roadmap

## Purpose

This document is the execution plan for Version 2 of the TrainEfficiency
engineering knowledge base: the transition from architectural specification to
verified implementation documentation.

It defines the order of work, the verification model, and the per-document
reconciliation process. Treat it as a checklist, not a narrative — each step
should be checked off as it completes.

---

## Status

Version 1 is complete: the documentation framework, governance model, engineering
handbook, and architectural documentation (`CLAUDE.md` and the governance docs in
`/docs`) now exist inside the repository.

Version 2 is in progress.

| Document | Status | Completed |
|----------|--------|-----------|
| `docs/schema.md` | ✅ Complete | 2026-06-28 |
| `docs/core-services.md` | ✅ Complete | 2026-06-28 |
| `docs/agent-catalog.md` | ⬜ Not started | — |
| `docs/integrations.md` | ⬜ Not started | — |
| `docs/api-conventions.md` | ⬜ Not started | — |
| `docs/runbooks.md` | ⬜ Not started | — |

---

## Objective

Version 2 transitions the documentation system from architectural specification to
verified implementation documentation.

All implementation documents must be derived directly from repository source code.
The source code — not `CLAUDE.md` — is the source of truth whenever the two
disagree.

---

## Prerequisites

Implementation documentation requires filesystem access to the real TrainEfficiency
repository. This roadmap cannot be executed from an environment that lacks that
access.

Natural-language summaries (e.g. from an agent describing the codebase rather than
exposing it) are not sufficient. Implementation documents must be generated from
raw source files, read directly.

Acceptable environments:

1. A Claude/Agent session running inside the actual TrainEfficiency Replit
   workspace.
2. A local clone of the real TrainEfficiency repository.
3. A chat where the raw source files are pasted directly.

If none of these is available, stop and report the blocker rather than generating
documentation from memory or summary.

---

## Documentation Generation Order

Generate documents in this order. Do not skip ahead — each later document may
depend on context established by an earlier one (e.g. `core-services.md` will
reference tables documented in `schema.md`).

1. `docs/schema.md`
2. `docs/core-services.md`
3. `docs/agent-catalog.md`
4. `docs/integrations.md`
5. `docs/api-conventions.md`
6. `docs/runbooks.md`

Each document follows:

- `CLAUDE.md`
- `docs/_template.md`
- `docs/documentation-status-legend.md`

Each implementation document uses the metadata:

```yaml
---
Document Type: Implementation
Verification Status: Verified Against Source
Last Reviewed: <date generated>
Owner: Engineering
---
```

---

## Continuous Reconciliation (Revised Process)

The original plan batched architectural verification until all six documents were
complete. **This is no longer the process.**

Reconciliation must happen continuously, one document at a time, not deferred to a
single end-of-phase review. Batching risks losing track of which document
surfaced which discrepancy, and lets architectural drift accumulate silently
across six documents before anyone looks at it.

### Revised Workflow

1. Generate one implementation document.
2. Identify architectural discrepancies against `CLAUDE.md` as part of that same
   pass.
3. Recommend — or, if appropriate and approved, apply — `CLAUDE.md` updates before
   moving on.
4. Continue to the next implementation document.

Do not proceed to the next document in the generation order until the current
document's discrepancies have been identified and addressed (recommended or
applied).

### Required Standardized Sections

Every implementation document generated during Version 2 must end with these four
sections, in this order:

**1. Architecture Discrepancies**

Differences between what the source code actually implements and what `CLAUDE.md`
states or implies. Cite the specific `CLAUDE.md` section and the specific source
file/construct that conflicts with it. If there are no discrepancies, say so
explicitly rather than omitting the section.

**2. Recommended CLAUDE.md Updates**

Specific, actionable changes to `CLAUDE.md` suggested by what was found —
phrased as concrete edits (what section, what text changes), not vague
observations. If no updates are warranted, say so explicitly.

**3. Files Reviewed**

Every source file actually read to produce the document. This is the citation
trail that justifies the `Verified Against Source` status — if a fact in the
document can't be traced to a file in this list, it shouldn't be in the document.

**4. Confidence Assessment**

`High` / `Medium` / `Low`, with a short explanation of what limits confidence
(e.g. incomplete file coverage, ambiguous naming, inferred-but-unconfirmed
relationships).

---

## Verification Requirements

Every implementation document should:

- Read repository source directly.
- Cite actual implementation (file paths, table/function/route names).
- Identify discrepancies with architecture as they're found, not after the fact.
- Avoid assumptions — mark uncertainty explicitly as "Unverified" rather than
  guessing.
- Never be generated from memory or from a prior summary of the codebase.

---

## Success Criteria

Version 2 is complete when:

- Every implementation document in the generation order exists.
- Every document is `Verified Against Source`, with a Files Reviewed section that
  substantiates that status.
- Every document's Architecture Discrepancies were identified and reconciled
  (recommended or applied) before the next document was started — not batched at
  the end.
- `CLAUDE.md` has been updated where discrepancies warranted it, while preserving
  its role as the canonical architectural reference and its long-term intent.
- Documentation reflects the current repository, not historical or intended
  behavior.

---

## Version 3 (Preview)

Out of scope for Version 2, but worth tracking for later:

- Automated documentation generation.
- CI documentation validation (fail builds when docs drift from source).
- Dependency graphs.
- Architecture diagrams.
- API reference generation.
- Continuous documentation synchronization.

Version 3 should focus on automation rather than manual documentation passes.

---

## Related Documentation

- `CLAUDE.md` — canonical architectural reference, subject to update during
  reconciliation.
- `docs/_template.md` — structural template for all `/docs` pages.
- `docs/documentation-status-legend.md` — Document Type / Verification Status
  classification system.
- `docs/documentation-governance.md` — how documentation is maintained over time.
- `docs/documentation-maturity-model.md` — the Governance vs.
  Architecture/Implementation/Operations distinction this roadmap builds on.
