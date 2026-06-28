---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Documentation Governance

## Purpose

This document defines how engineering documentation is maintained alongside the
TrainEfficiency codebase.

The objective is to ensure documentation remains accurate, trustworthy, and useful
as the platform evolves.

Documentation is considered a production asset rather than an afterthought.

---

## Source of Truth

When the application source code is available, it is the authoritative source of
truth.

Documentation should describe the implementation that exists.

Documentation should never intentionally diverge from production behavior.

---

## Documentation Hierarchy

Priority order:

1. Production source code
2. Database schema
3. CLAUDE.md
4. Domain documentation in `/docs`
5. ADRs
6. Historical documentation

If conflicts exist, investigate rather than assuming documentation is correct.

---

## Documentation Lifecycle

Whenever a change is made to:

- Database schema
- API behavior
- Authentication
- AI agents
- Integrations
- Business domains
- Platform architecture

evaluate whether documentation also requires updating.

Code changes and documentation changes should ideally be reviewed together.

---

## Documentation Ownership

Every subsystem should have a corresponding documentation owner.

Examples:

- Schema → schema.md
- AI Platform → agent-catalog.md
- Integrations → integrations.md
- Core Services → core-services.md
- Architecture → architecture/

The goal is clear ownership rather than duplicated information.

---

## Documentation Review

Documentation should be reviewed whenever:

- Major features are released.
- Significant refactoring occurs.
- APIs change.
- New integrations are added.
- AI architecture evolves.

Documentation drift should be treated as technical debt.

---

## AI-Assisted Documentation

AI may generate documentation drafts.

However:

- Documentation should be grounded in the implementation.
- Uncertainty should be identified explicitly.
- Assumptions should never be presented as facts.

When source code is unavailable, documentation should clearly state that it
reflects architectural intent rather than verified implementation.

---

## Documentation Quality Standards

Good documentation should be:

- Accurate
- Current
- Actionable
- Searchable
- Concise
- Well-structured

Avoid duplicating the same information across multiple documents.

---

## Versioning

Documentation evolves alongside the platform.

Major architectural changes should be reflected through:

- ADR updates
- Documentation revisions
- Repository evolution log entries

Historical context should be preserved when valuable.

---

## Long-Term Vision

The TrainEfficiency documentation system should become a comprehensive engineering
knowledge base.

Its purpose is to enable both human engineers and AI assistants to understand the
platform quickly, make consistent decisions, and preserve institutional knowledge
as the system grows.
