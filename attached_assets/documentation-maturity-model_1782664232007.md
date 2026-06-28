---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Documentation Maturity Model

## Document Classes

Documentation is classified along two independent dimensions — see
`docs/documentation-status-legend.md` for the full reference:

- **Document Type** — what kind of document it is: Governance, Architecture,
  Implementation, Operations, or Reference.
- **Verification Status** — how confident we are that it reflects reality: `N/A`,
  `Architecture Specification`, `Partially Verified`, `Verified Against Source`, or
  `Verified Against Production`.

**Governance documents** (`Document Type: Governance`) describe how documentation
itself is created, organized, and maintained. They do not describe
TrainEfficiency's implementation, so they are always authoritative and always
carry `Verification Status: N/A`.

Examples: `documentation-map.md`, `_template.md`,
`documentation-generation-workflow.md`, `documentation-governance.md`, this
document, `documentation-status-legend.md`.

**Architecture, Implementation, and Operations documents** describe
TrainEfficiency itself — vision, architecture, subsystems, schema, agents,
integrations, runbooks. These must be verified against the real codebase (or
production system) before they can be trusted as fact, and their
`Verification Status` progresses:

`Architecture Specification` → `Partially Verified` → `Verified Against Source` →
`Verified Against Production`

Examples: `CLAUDE.md` (Architecture), and future pages such as `schema.md`,
`agent-catalog.md`, `core-services.md`, `integrations.md` (Implementation).

A document's type determines whether the verification lifecycle applies to it at
all — do not apply it to governance documents, and do not treat architecture or
implementation documents as automatically authoritative.

---

## Current Status

The TrainEfficiency documentation currently represents the intended architecture
and engineering standards of the platform.

Until it has been validated against the production repository, portions of this
documentation should be treated as architectural specification rather than
verified implementation.

This distinction is intentional.

---

## Documentation Levels

### Level 1 — Vision

Describes the long-term direction of the platform.

Examples:

- Founder Principles
- Engineering Philosophy
- Platform Vision

These documents are largely implementation-independent.

### Level 2 — Architecture

Describes how the platform is intended to be organized.

Examples:

- Business Domains
- AI Architecture
- Authentication Model
- Database Philosophy

These documents evolve slowly.

### Level 3 — Implementation

Describes what currently exists in the repository.

Examples:

- Schema
- Services
- Agent Catalog
- Integrations
- API Conventions

These documents should be derived directly from the source code.

### Level 4 — Operations

Describes how the production system is operated.

Examples:

- Runbooks
- Deployment
- Monitoring
- Incident Response
- Maintenance

These documents evolve with operational practices.

---

## Repository Verification

Once the complete TrainEfficiency repository is available:

1. Scan the codebase.
2. Compare implementation against architecture.
3. Mark discrepancies.
4. Update documentation.
5. Record significant differences in ADRs when appropriate.

The objective is convergence between architecture and implementation.

---

## Verification Status

Each documentation page includes a `Verification Status` field in its frontmatter.

See `docs/documentation-status-legend.md` for the full set of possible values and
the `Document Type` field they pair with.

This allows contributors to understand the confidence level of each document.

---

## Long-Term Goal

The TrainEfficiency knowledge base should ultimately become a living engineering
reference where architectural vision, implementation details, and operational
knowledge remain aligned over time.

Documentation should evolve continuously as the platform evolves.
