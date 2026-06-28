---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Documentation Map

This document serves as the entry point into the TrainEfficiency engineering
knowledge base.

Read this document first.

Then consult the specialized documentation for implementation details.

---

## Repository Documentation

### CLAUDE.md

Purpose:

Platform vision, engineering philosophy, architecture, AI operating model,
engineering standards, and contributor guidance.

Read before making architectural decisions.

### docs/schema.md

Contains:

- Database schema
- Table ownership
- Relationships
- Index strategy
- Migration philosophy
- Data modeling conventions

Consult before modifying the database.

### docs/agent-catalog.md

Contains:

- Every AI agent
- Responsibilities
- Inputs
- Outputs
- Tools
- Dependencies
- Prompt strategy
- Ownership boundaries

Consult before modifying AI systems.

### docs/core-services.md

Contains:

- Shared services
- Domain services
- Platform infrastructure
- Service ownership
- Dependency relationships

Consult before modifying backend architecture.

### docs/integrations.md

Contains:

- Stripe
- Gmail
- Slack
- Google Calendar
- Meta
- OpenAI
- Webhooks
- Retry behavior
- Failure handling

Consult before modifying integrations.

### docs/api-conventions.md

Contains:

- Route patterns
- Authentication
- Authorization
- Validation
- Response formats
- Error handling
- Versioning conventions

Consult before adding or modifying APIs.

### docs/runbooks.md

Contains:

- Deployments
- Rollbacks
- Incident response
- Monitoring
- Scheduled maintenance
- Operational procedures

Consult during production operations.

### docs/architecture/

Contains detailed architectural documentation for major platform subsystems.

Examples include:

- Scheduling
- CRM
- Billing
- AI Platform
- Governance
- Executive Operating System

Consult before significant architectural work.

---

## Documentation Philosophy

Documentation should evolve with the platform.

Whenever architecture changes significantly:

- Update the relevant document.
- Keep documentation close to implementation.
- Preserve historical context.
- Avoid duplicating information across multiple documents.

Each document should have a clearly defined responsibility.

---

## Contributor Expectations

Contributors should:

1. Read CLAUDE.md.
2. Read the relevant domain documentation.
3. Understand existing architecture.
4. Implement changes.
5. Update documentation when necessary.

Documentation is considered part of the implementation rather than an optional
deliverable.

---

## Knowledge Base Goal

The long-term objective is for every major architectural decision, business
concept, operational workflow, AI capability, and platform subsystem to be
documented well enough that a new senior engineer—or Claude—can become productive
with minimal additional context.

The codebase and documentation should evolve together as a single engineering
system.
