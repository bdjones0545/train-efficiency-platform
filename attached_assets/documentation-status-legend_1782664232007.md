---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Documentation Status Legend

The TrainEfficiency knowledge base classifies every document along two independent
dimensions: **Document Type** (what kind of document it is) and **Verification
Status** (how confident we are that it matches reality). A single overloaded status
field previously conflated these — this legend replaces that with the
two-dimensional model below.

---

## Document Type

Describes the *category* of document. This never implies a verification level.

| Icon | Type | Meaning |
|---|---|---|
| ⚙️ | Governance | Engineering process, documentation standards, workflow, or policy |
| 🏛️ | Architecture | Intended platform architecture and design |
| 💻 | Implementation | What currently exists in the repository (schema, services, agents, integrations) |
| 🚀 | Operations | How the production system is run (deployment, runbooks, monitoring, incident response) |
| 📚 | Reference | Glossaries, catalogs, and other lookup material |

---

## Verification Status

Describes how confident we are that a document reflects reality. Only meaningful
for document types that describe TrainEfficiency itself (Architecture,
Implementation, Operations, and some Reference docs). Governance documents are
always `N/A`.

| Icon | Status | Meaning |
|---|---|---|
| ⚪ | N/A | Verification does not apply — the document describes process, not implementation |
| 🔵 | Architecture Specification | Describes intended design; not yet checked against source |
| 🟡 | Partially Verified | Some portions confirmed against the repository; verification incomplete |
| 🟢 | Verified Against Source | Reviewed against the current repository implementation |
| 🟣 | Verified Against Production | Validated against the live production system, in addition to source |

---

## Why Two Dimensions

The prior single-field status conflated "what kind of document is this" with "how
verified is it" — both 🟩 meant "Governance Document" and "Verified Against
Source," which made the legend itself ambiguous.

Document Type and Verification Status now vary independently:

- A Governance doc is always `N/A` — it has nothing to verify against source.
- An Architecture doc starts at `Architecture Specification` and should progress to
  `Verified Against Source` once checked against the real codebase.
- An Implementation doc should be written `Verified Against Source` from the start,
  since implementation docs are meant to describe what exists, not what's intended.
- An Operations doc may reach `Verified Against Production` once validated against
  the live system, not just the repository.

---

## Metadata Convention

Every document in `/docs` and `CLAUDE.md` should open with YAML frontmatter using
this pattern:

```yaml
---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---
```

Substitute `Document Type` and `Verification Status` with the appropriate values
from the tables above. `Last Reviewed` is the date the document was last confirmed
accurate; `Owner` identifies the accountable team or role.

### Example — Governance document

```yaml
---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---
```

### Example — Architecture document (CLAUDE.md)

```yaml
---
Document Type: Architecture
Verification Status: Architecture Specification
Last Reviewed: 2026-06-28
Owner: Engineering
---
```

### Example — Implementation document (future schema.md, agent-catalog.md, etc.)

```yaml
---
Document Type: Implementation
Verification Status: Verified Against Source
Last Reviewed: 2026-06-28
Owner: Engineering
---
```

---

## Applying This Legend

| Document | Document Type | Verification Status |
|---|---|---|
| `CLAUDE.md` | Architecture | Architecture Specification |
| `docs/documentation-map.md` | Governance | N/A |
| `docs/_template.md` | Governance | N/A |
| `docs/documentation-generation-workflow.md` | Governance | N/A |
| `docs/documentation-governance.md` | Governance | N/A |
| `docs/documentation-maturity-model.md` | Governance | N/A |
| `docs/documentation-status-legend.md` | Governance | N/A |
| Future `docs/schema.md`, `docs/agent-catalog.md`, `docs/core-services.md`, `docs/integrations.md` | Implementation | starts `Architecture Specification`, progresses to `Verified Against Source` as confirmed |
| Future `docs/runbooks.md` | Operations | progresses toward `Verified Against Production` |

This table should be kept in sync whenever a new document is added to the
knowledge base.
