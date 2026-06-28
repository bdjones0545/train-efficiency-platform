---
Document Type: Architecture
Verification Status: Architecture Specification
Last Reviewed: 2026-06-28
Owner: Engineering
---

# TrainEfficiency Engineering Guide

This document is the primary engineering reference for Claude when working inside the
TrainEfficiency repository. Read this document before making architectural decisions,
modifying production code, or proposing significant changes.

---

## Project Overview

TrainEfficiency is an AI-native coaching operating system for performance coaches,
private facilities, schools, sports organizations, and healthcare providers.

It is not simply a scheduling platform or CRM.

The platform combines:

- CRM
- Scheduling
- Billing
- Athlete Management
- Programming
- Communications
- AI Agents
- Automation
- Analytics
- Knowledge Management
- Organizational Intelligence

The long-term vision is to become the operating system that runs an entire coaching
organization. Every feature should support that vision.

---

## Engineering Philosophy

**Production-first.** This repository powers real organizations.
Reliability is always preferred over novelty.

When modifying existing functionality:

- Preserve backwards compatibility whenever possible
- Avoid breaking APIs
- Prefer surgical fixes over rewrites
- Maintain existing architecture unless a clear improvement exists
- Minimize technical debt
- Reuse existing abstractions before creating new ones

Never remove existing functionality unless explicitly requested.

---

## Development Philosophy

Before implementing a feature, ask:

1. Does this already exist elsewhere?
2. Can an existing component be reused?
3. Will this increase maintenance burden?
4. Is this consistent with the architecture?
5. Is there a simpler solution?

Prefer incremental improvements over large redesigns.

---

## Primary Goals

Every feature should improve one or more of:

- Coach efficiency
- Athlete outcomes
- Organizational intelligence
- Automation
- Data quality
- AI capability
- Revenue generation
- User experience

---

## Core Product Vision

TrainEfficiency should function as an intelligent operating system rather than a
collection of disconnected tools.

Every subsystem should contribute toward:

- Unified organizational data
- Reusable knowledge
- AI-assisted workflows
- Automation
- Intelligent recommendations
- Long-term scalability

Avoid creating isolated features that cannot integrate with the broader platform.

---

## Architectural Principles

- Design around systems rather than pages
- Business logic belongs in backend services
- Keep UI components focused on presentation
- Avoid duplicating business rules
- Maintain clear separation between: UI / API / Domain logic / Persistence / AI orchestration

---

## Code Quality Standards

Every change should prioritize:

- Readability
- Maintainability
- Scalability
- Security
- Performance
- Strong typing
- Deterministic behavior

Avoid clever code. Prefer obvious code.
Future maintainability is more important than saving a few lines.

---

## Debugging Philosophy

Always determine root cause before writing code.
Never patch symptoms without understanding why they occur.

Every debugging task should answer:

- Why did this happen?
- What components are involved?
- Could similar failures exist elsewhere?
- What is the smallest safe fix?

---

## Architecture Overview

### High-Level Architecture

TrainEfficiency follows a full-stack TypeScript architecture.

Primary layers:

```
Client (React)
        │
        ▼
REST API (Express)
        │
        ▼
Business Logic
        │
        ▼
Database (PostgreSQL + Drizzle)
```

AI services, third-party integrations, scheduled jobs, and automation execute alongside
the primary request pipeline but should remain isolated from core business logic
whenever possible.

### Repository Structure

The repository is organized into logical application layers.

#### `client/`

Contains the React frontend.

Responsibilities:

- UI rendering
- Routing
- State management
- Forms
- User interaction
- Dashboard views
- Component composition

The frontend should contain minimal business logic. Business rules belong on the
server whenever possible.

#### `server/`

Contains all backend functionality.

Includes:

- Express routes
- API endpoints
- Authentication
- Business logic
- AI orchestration
- Background jobs
- Stripe
- Meta CAPI
- Gmail
- Slack
- Google Calendar
- Agent systems
- Notification systems
- Scheduling
- CRM logic

Avoid moving backend logic into the frontend.

#### `shared/`

Contains code shared between client and server.

Examples:

- Type definitions
- Shared validation
- Enums
- Constants
- DTOs
- Utility models

Anything duplicated between client and server should be evaluated for inclusion here.

### Request Lifecycle

Typical request flow:

```
Client Request
      ↓
Express Route
      ↓
Authentication
      ↓
Validation
      ↓
Business Logic
      ↓
Database
      ↓
Response
      ↓
Frontend Update
```

Business rules should execute before persistence. Validation should occur before
business rules. Database writes should occur only after all validation succeeds.

### Separation of Responsibilities

**Frontend**

Responsible for:

- User experience
- Display logic
- Form validation
- Loading states
- Error presentation

Should NOT contain:

- Permission logic
- Database decisions
- Pricing calculations
- AI orchestration
- Organization rules

**Backend**

Responsible for:

- Business rules
- Security
- Authorization
- AI coordination
- Database writes
- Integrations
- Validation
- Automation

The backend is the source of truth.

**Database**

Responsible for:

- Persistent storage
- Relationships
- Constraints
- Integrity

Avoid placing business logic inside SQL when it belongs in application code.

### AI Architecture

AI functionality is treated as a platform capability rather than isolated features.

Whenever possible:

- AI services should be modular.
- Prompts should be reusable.
- AI outputs should be validated before persistence.
- AI failures should degrade gracefully.
- AI should enhance workflows rather than become required for basic functionality.

### Integration Philosophy

External services are dependencies—not sources of truth.

Examples include:

- Stripe
- OpenAI
- Gmail
- Slack
- Google Calendar
- Meta APIs

Always validate external responses. Handle retries where appropriate. Gracefully
recover from outages. Do not tightly couple business logic to third-party APIs.

### Scalability Principles

When implementing new features:

- Prefer composition over duplication.
- Prefer reusable services over one-off utilities.
- Keep modules focused on a single responsibility.
- Avoid circular dependencies.
- Minimize coupling between domains.

Every new subsystem should be designed assuming future growth.

### Architectural Rule

If a proposed implementation violates the existing architecture, prefer modifying the
implementation rather than changing the architecture unless explicitly requested.

---

## Major Platform Domains

TrainEfficiency is organized into multiple business domains.

Each domain owns a specific area of responsibility. New functionality should be added
to the appropriate domain whenever possible rather than creating parallel
implementations.

### Organization Management

Responsible for:

- Organizations
- Organization settings
- Multi-tenant isolation
- User roles
- Permissions
- Feature availability
- Organization configuration

Organization boundaries should always be respected.

No organization should be capable of accessing another organization's data.

### Authentication & Identity

Responsible for:

- Authentication
- Session management
- User identity
- Organization resolution
- Authorization
- Administrative permissions

Authentication should remain centralized.

Permission checks should never rely solely on frontend validation.

### CRM & Lead Management

Responsible for:

- Lead capture
- Landing pages
- Funnels
- Lead intelligence
- Lead scoring
- Contact management
- Prospect lifecycle
- Opportunity tracking

Every lead should have a traceable lifecycle.

### Scheduling & Bookings

Responsible for:

- Calendars
- Availability
- Booking workflows
- Coach schedules
- Client scheduling
- Appointment management
- Schedule automation

Scheduling logic should remain centralized.

Avoid duplicating booking rules across multiple endpoints.

### Athlete Management

Responsible for:

- Athlete profiles
- Performance history
- Attendance
- Assessments
- Goals
- Progress tracking
- Team membership

Athlete data should remain a long-term historical record.

### Training & Programming

Responsible for:

- Workout creation
- Program builder
- Exercise library
- Templates
- Training blocks
- Progression
- AI-generated programming

Programming logic should be reusable across multiple products whenever possible.

### Nutrition & Education

Responsible for:

- Nutrition modules
- Educational content
- Quizzes
- Learning progress
- Knowledge delivery

Educational content should be versioned when practical.

### Billing & Commerce

Responsible for:

- Stripe
- Wallets
- Subscriptions
- Purchases
- Checkout
- Promotional codes
- Book funnel
- Payment history

Financial data must always prioritize correctness over convenience.

### Communications

Responsible for:

- Email
- SMS
- Notifications
- In-app messaging
- Broadcasts
- Automated communication

Communication services should remain provider-independent whenever possible.

### Automation

Responsible for:

- Event-driven workflows
- Background jobs
- Scheduled tasks
- Trigger pipelines
- Business automation

Automation should execute deterministically and be safe to retry.

### AI Platform

Artificial intelligence is a platform capability rather than a single feature.

Responsible for:

- AI orchestration
- Agent coordination
- Prompt execution
- Tool calling
- Context management
- Knowledge retrieval
- Decision support

AI systems should enhance workflows without becoming the sole source of business truth.

### Executive Operating System

The Executive Operating System provides organizational intelligence.

Examples include:

- Executive dashboards
- CEO Heartbeat
- Revenue analysis
- Growth analysis
- Scheduling analysis
- Client success analysis
- Executive recommendations
- Decision support

These systems summarize organizational data rather than replace operational workflows.

### Governance

Responsible for:

- AI governance
- Organizational policies
- Compliance settings
- Guardrails
- Approval workflows

Governance rules should be enforced consistently across all AI systems.

### External Integrations

Responsible for:

- Stripe
- Gmail
- Slack
- Google Calendar
- GitHub
- Meta
- OpenAI
- Third-party APIs

Integrations should remain isolated behind service abstractions whenever practical.

Business logic should not depend directly on vendor-specific implementations.

### Analytics & Reporting

Responsible for:

- Dashboards
- KPIs
- Performance metrics
- Trend analysis
- Historical reporting
- Operational insights

Analytics should derive from business data rather than become the primary source of
truth.

### Architectural Rule

Before creating a new subsystem, determine whether the functionality naturally
belongs inside one of the existing platform domains.

Expanding an existing domain is generally preferred over introducing a new one.

---

## Technology Stack & External Integrations

This section describes the primary technologies used throughout TrainEfficiency.

When extending the platform, prefer existing technologies over introducing new
dependencies.

### Core Technologies

**Frontend**

Primary technologies include:

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- shadcn/ui

Frontend code should remain strongly typed and component-driven.

Avoid introducing duplicate UI frameworks.

**Backend**

Primary technologies include:

- Node.js
- Express
- TypeScript

The backend serves as the primary application layer and source of truth for all
business logic.

Business rules should remain centralized on the server.

**Database**

Primary database:

- PostgreSQL

ORM:

- Drizzle ORM

General principles:

- UUID primary keys where practical
- Explicit foreign-key relationships
- Strong referential integrity
- Non-destructive migrations
- Backwards-compatible schema evolution

Database schema changes should prioritize long-term maintainability.

### Authentication

Authentication may support multiple identity providers.

Examples include:

- OIDC
- Email/password authentication

Authorization is organization-aware.

Organization isolation is a core security requirement.

### Artificial Intelligence

AI capabilities are foundational to the platform.

Current AI ecosystem includes:

- OpenAI
- Internal AI orchestration
- Multi-agent workflows
- Organizational memory
- Prompt management
- Tool calling
- Knowledge retrieval

AI services should remain modular and reusable.

Prompts should be treated as versioned application assets rather than inline strings
whenever practical.

### Payments

Financial infrastructure is built around Stripe.

Responsibilities include:

- Subscriptions
- One-time purchases
- Wallets
- Checkout
- Promotional offers
- Payment history
- Webhook processing

Webhook processing should remain idempotent.

Financial correctness always takes priority over convenience.

### Communications

Supported communication systems include:

- Gmail
- Email automation
- Slack
- Notifications
- In-app messaging

Communication providers should remain replaceable behind service abstractions.

### Calendar & Scheduling

Scheduling integrates with:

- Google Calendar

Scheduling remains an internal platform responsibility.

External calendars should synchronize with, rather than replace, internal scheduling
logic.

### Marketing

Marketing integrations may include:

- Meta Pixel
- Meta Conversions API

Tracking implementations should prioritize accurate attribution while avoiding
duplicate event reporting.

### Source Control

Version control:

- Git
- GitHub

Changes should be:

- Small
- Reviewable
- Production-safe
- Easy to revert

Large refactors should be avoided unless explicitly requested.

### Deployment Philosophy

Deployments should be:

- Repeatable
- Observable
- Backwards compatible
- Easily reversible

Configuration belongs in environment variables rather than application code.

Secrets must never be committed to the repository.

### Dependency Philosophy

Before adding a new dependency, determine whether:

- Existing platform capabilities already solve the problem.
- Native language features are sufficient.
- An existing library already included in the project can be reused.

Favor reducing dependencies over expanding them.

### External Integration Philosophy

Every external integration should be treated as unreliable.

Code should assume:

- Timeouts
- Network failures
- Rate limits
- Temporary outages
- Partial failures

Critical business workflows should degrade gracefully whenever practical.

External APIs should enhance TrainEfficiency, not become the platform's source of
truth.

---

## Authentication, Authorization & Organization Resolution

Authentication and authorization are foundational systems within TrainEfficiency.

The platform is designed as a multi-tenant application where organizations are the
primary security boundary.

Every authenticated request should resolve an organization before executing business
logic.

### Authentication

Authentication is responsible for establishing user identity.

Supported authentication providers may include:

- OIDC
- Email/password authentication
- Future enterprise identity providers

Authentication establishes identity only.

Authentication alone does not grant authorization.

### Organization Resolution

Every authenticated user belongs to an organization.

Organization resolution determines:

- Organization ID
- User permissions
- Administrative privileges
- Feature availability
- Data access scope

Whenever practical, resolve the organization once and propagate it through the
request lifecycle rather than performing repeated lookups.

Business logic should rely on resolved organization context instead of independently
determining organizational ownership.

### Multi-Tenant Architecture

TrainEfficiency is a multi-tenant platform.

Organizations must remain logically isolated.

Every query, update, and business operation should respect organization boundaries.

Cross-organization access should never occur unless explicitly designed for platform
administration.

When adding new features, organization isolation should be considered a default
requirement rather than an optional enhancement.

### Authorization

Authorization determines what an authenticated user is permitted to do.

Authorization should always execute on the server.

Frontend permission checks exist only to improve user experience.

The backend remains the authoritative enforcement layer.

### Administrative Operations

Administrative endpoints should require explicit verification.

Never assume a user is an administrator solely because a client-side control is
hidden.

Administrative privileges should always be validated through trusted server-side
context.

### Organization Context

Business services should receive organization context as an explicit dependency
whenever practical.

Avoid hidden global state.

Avoid recalculating organization identity multiple times during a request.

Consistent organization context simplifies auditing, debugging, and testing.

### Data Ownership

Every persistent business object should have a clearly defined owner.

Examples include:

- Organization-owned resources
- Coach-owned resources
- Athlete-owned resources
- Shared organizational resources

Ownership should remain explicit throughout the system.

Implicit ownership creates security risks.

### Route Design

Protected routes should generally follow this lifecycle:

1. Authenticate user.
2. Resolve organization.
3. Validate permissions.
4. Validate request.
5. Execute business logic.
6. Persist data.
7. Return response.

Maintaining a consistent request lifecycle improves maintainability and reduces
authorization bugs.

### Background Jobs

Scheduled jobs, automation, and AI agents should execute with explicit organizational
context.

Background processes should never assume a default organization.

Long-running processes must preserve tenant isolation throughout execution.

### Auditability

Security-sensitive actions should be traceable whenever practical.

Examples include:

- Administrative changes
- Billing events
- Permission updates
- Governance modifications
- AI policy changes
- Subscription changes

Operational transparency improves debugging and accountability.

### Security Principles

Never trust:

- Client input
- Client permissions
- Client organization identifiers

Always validate identity, organization membership, and authorization using trusted
server-side data.

### Architectural Rule

If a proposed implementation weakens tenant isolation, bypasses server-side
authorization, or introduces ambiguous ownership, the implementation should be
redesigned before being accepted.

---

## AI Architecture & Agent Operating System

Artificial intelligence is a foundational platform capability within
TrainEfficiency.

AI is not implemented as isolated chatbot features.

Instead, AI operates as an organizational operating system composed of specialized
agents, shared knowledge, reusable tools, governance, and long-term organizational
context.

Every AI feature should strengthen this ecosystem rather than introduce standalone
implementations.

### AI Philosophy

AI should augment human decision making.

The objective is not to replace coaches or administrators.

The objective is to:

- Reduce repetitive work.
- Surface important information.
- Recommend actions.
- Automate routine processes.
- Improve organizational intelligence.
- Increase consistency.
- Accelerate decision making.

Human users remain the final authority for important organizational decisions.

### Agent Architecture

The platform is designed around specialized agents.

Each agent owns a well-defined responsibility.

Examples include:

- Executive agents
- Revenue agents
- Growth agents
- Scheduling agents
- Client Success agents
- Retention agents
- Operational agents

Avoid creating large general-purpose agents when a specialized agent is more
appropriate.

### Agent Responsibilities

Each agent should have:

- Clearly defined inputs.
- Clearly defined outputs.
- Well-defined responsibilities.
- Minimal overlap with other agents.
- Observable execution.
- Predictable behavior.

Agents should cooperate rather than compete.

### Agent Orchestration

Complex workflows may require multiple agents.

Whenever multiple agents participate:

- Responsibilities should remain explicit.
- Data flow should remain traceable.
- Agent execution should be deterministic whenever practical.
- Intermediate reasoning should remain structured.

Agent orchestration should remain easier to understand than the workflow it replaces.

### Organizational Memory

AI should leverage organizational knowledge whenever appropriate.

Examples include:

- Historical decisions
- Organizational preferences
- Coach workflows
- Athlete history
- Business metrics
- Operational patterns
- Previous recommendations

Memory should improve decision quality rather than simply accumulate data.

### Knowledge Management

Knowledge should exist independently of individual prompts.

Prefer reusable knowledge systems over embedding large amounts of context into
prompts.

Knowledge should be:

- Structured
- Searchable
- Reusable
- Versioned when practical

Avoid duplicating institutional knowledge across multiple prompts.

### Tool Calling

Agents should accomplish work through reusable platform tools.

Examples include:

- Database access
- Scheduling
- CRM
- Messaging
- Analytics
- Reporting
- External integrations

Whenever possible, extend existing tools rather than creating new one-off
implementations.

### Prompt Design

Prompts are application assets.

They should be:

- Version controlled
- Reusable
- Modular
- Consistent
- Easy to audit

Avoid embedding complex prompts directly into business logic whenever practical.

### Governance

Every AI system should respect organizational governance.

Governance may include:

- Organizational policies
- Permission boundaries
- Approval workflows
- Safety rules
- Operational constraints

Governance should be enforced consistently regardless of which agent is executing.

### Decision Support

Agents should recommend actions rather than silently execute high-impact
organizational decisions.

Whenever practical:

- Explain recommendations.
- Surface supporting evidence.
- Make reasoning inspectable.
- Preserve human oversight.

Transparency improves organizational trust.

### Failure Handling

AI systems should fail gracefully.

Examples include:

- Service outages
- Invalid responses
- Tool failures
- Context limitations
- Rate limits

Whenever AI is unavailable, core platform functionality should continue whenever
reasonably possible.

### Observability

Agent execution should be observable.

Important information may include:

- Execution status
- Inputs
- Outputs
- Duration
- Errors
- Tool usage
- Recommendations

Observability simplifies debugging and continuous improvement.

### Future Direction

TrainEfficiency is evolving toward an intelligent organizational operating system.

Future AI capabilities should strengthen:

- Organizational memory
- Cross-agent collaboration
- Decision intelligence
- Workflow automation
- Knowledge retrieval
- Predictive analytics
- Executive visibility

New AI functionality should integrate into the existing agent ecosystem rather than
exist as isolated features.

### Architectural Rule

Before implementing a new AI capability, determine whether it belongs within an
existing agent, shared tool, governance system, or knowledge service.

Expanding the existing AI operating system is preferred over introducing disconnected
AI features.

---

## Database Architecture & Data Modeling Philosophy

The PostgreSQL database is the system of record for TrainEfficiency.

Every schema change should preserve data integrity, maintain backwards compatibility
whenever practical, and support long-term platform evolution.

The database models the business—not the user interface.

### Source of Truth

Persistent business data belongs in PostgreSQL.

Application state should not become the long-term source of truth.

AI-generated recommendations, caches, and temporary processing artifacts should only
be persisted when they provide ongoing business value.

### Data Modeling Philosophy

Tables should represent real business concepts.

Examples include:

- Organizations
- Users
- Coaches
- Athletes
- Teams
- Bookings
- Programs
- Subscriptions
- Notifications
- AI executions
- Governance policies

Avoid creating tables that exist solely to support a temporary UI implementation.

### Schema Evolution

Schema changes should be evolutionary rather than disruptive.

Prefer:

- Adding new columns
- Adding new tables
- Introducing new relationships
- Backwards-compatible migrations

Avoid destructive changes unless explicitly planned and validated.

Whenever practical, migrations should be safe to deploy without downtime.

### Relationships

Relationships should remain explicit.

Use foreign keys where appropriate.

Clearly define ownership between related entities.

Avoid ambiguous ownership models.

Every major business object should have a clearly identifiable parent or owning
context.

### Multi-Tenant Data

Organization boundaries remain the primary partition of business data.

Whenever appropriate:

- Store organization ownership explicitly.
- Filter by organization context.
- Prevent accidental cross-tenant queries.
- Preserve tenant isolation throughout migrations.

Security should not rely on frontend filtering.

### Identifiers

Identifiers should remain stable throughout the lifetime of an entity.

Avoid exposing implementation-specific identifiers as business meaning.

Business logic should not depend on auto-increment ordering or insertion order.

### Constraints

Prefer enforcing invariants through:

- Database constraints
- Foreign keys
- Unique indexes
- Server-side validation

Do not rely exclusively on frontend validation.

### Indexing Philosophy

Indexes should optimize real query patterns.

Before introducing new indexes, consider:

- Read frequency
- Write cost
- Cardinality
- Existing indexes

Avoid unnecessary indexes that increase maintenance overhead.

### Soft Deletes

Where historical data provides business value, prefer soft deletion over permanent
deletion.

Examples include:

- Financial records
- Athlete history
- Booking history
- Audit records

Deletion strategies should align with business and compliance requirements.

### Auditability

Important business events should remain historically traceable.

Examples include:

- Billing
- Permission changes
- Governance updates
- AI policy modifications
- Subscription lifecycle events

Historical records improve debugging, reporting, and accountability.

### Migrations

Database migrations should be:

- Repeatable
- Deterministic
- Reviewed
- Version controlled
- Reversible whenever practical

Never assume a migration will execute against only one environment.

Production safety should always take priority.

### Performance

Before modifying the schema, consider:

- Query complexity
- Join patterns
- Index usage
- Expected growth
- Reporting workloads

Schema design should support future scale rather than only current requirements.

### Business Rules

The database enforces structural integrity.

Application services enforce business logic.

Avoid embedding complex business workflows directly inside database objects when they
belong in application code.

### Data Integrity

Correctness is more important than convenience.

If application state and persistent data disagree, the persistent database should
generally be considered authoritative until proven otherwise.

### Architectural Rule

Every schema change should answer three questions before implementation:

1. Does this represent a real business concept?
2. Will this remain maintainable as the platform grows?
3. Does this preserve data integrity and tenant isolation?

---

## Development Workflow & Engineering Standards

This section defines how software is designed, implemented, reviewed, tested, and
deployed within TrainEfficiency.

Consistency is preferred over individual coding style.

The objective is to produce reliable, maintainable, production-ready software.

### Feature Development Workflow

Every feature should follow the same process.

1. Understand the business problem.
2. Identify the affected platform domain.
3. Review existing implementations.
4. Determine the smallest maintainable solution.
5. Implement using existing architectural patterns.
6. Validate functionality.
7. Review for security, performance, and maintainability.
8. Verify backwards compatibility.
9. Deploy safely.

Avoid implementing code before understanding the business problem.

### Bug Fix Workflow

Bug fixes should prioritize root cause over symptom suppression.

Standard workflow:

1. Reproduce the issue.
2. Identify root cause.
3. Determine affected systems.
4. Implement the smallest safe correction.
5. Evaluate similar failure points.
6. Validate the fix.
7. Confirm no regression was introduced.

Never merge speculative fixes.

### Code Review Standards

Every code review should evaluate:

- Correctness
- Maintainability
- Readability
- Security
- Performance
- Type safety
- Error handling
- Multi-tenant safety
- Backwards compatibility

Comments should explain why a change is recommended rather than only what should
change.

### Reuse Before Creation

Before adding:

- Components
- Hooks
- Utilities
- Services
- API endpoints
- Database tables
- AI prompts

First determine whether an existing implementation can be extended.

Prefer extending proven systems over introducing duplicate functionality.

### Error Handling

Errors should be:

- Explicit
- Actionable
- Logged appropriately
- Safe for production

Avoid swallowing exceptions.

Avoid exposing sensitive implementation details to users.

User-facing messages should remain understandable while server logs retain
diagnostic detail.

### Logging

Logs should assist future debugging.

Useful logs generally answer:

- What happened?
- Where did it happen?
- Which organization was affected?
- Which user initiated the action?
- Which subsystem executed?
- Did the operation succeed?

Avoid excessive logging that obscures important events.

Never log secrets or sensitive credentials.

### Configuration

Configuration belongs in environment variables or centralized configuration.

Avoid hardcoded:

- API keys
- Secrets
- Environment-specific URLs
- Credentials

Configuration should remain portable across development, staging, and production.

### Testing Philosophy

Testing should focus on business behavior rather than implementation details.

Important areas include:

- Authentication
- Authorization
- Billing
- Scheduling
- AI orchestration
- Database integrity
- External integrations
- Multi-tenant isolation

Critical workflows deserve higher confidence than isolated utility functions.

### Refactoring

Refactoring should improve:

- Readability
- Maintainability
- Reuse
- Simplicity

Refactoring should not introduce unrelated behavioral changes.

Large architectural rewrites require explicit justification.

### Performance

Performance improvements should be evidence-based.

Before optimizing, identify:

- Actual bottlenecks
- Query performance
- Rendering costs
- API latency
- Network usage

Avoid premature optimization.

### Documentation

Complex systems should be documented alongside implementation.

Examples include:

- AI workflows
- Business rules
- Architectural decisions
- Integration behavior
- Migration rationale

Documentation should evolve with the software.

### Production Readiness Checklist

Before deployment verify:

- Functionality is complete.
- Existing behavior remains intact.
- Authentication is enforced.
- Authorization is correct.
- Organization isolation is preserved.
- Error handling is complete.
- Logging is adequate.
- Database migrations are safe.
- External integrations are validated.
- No secrets are exposed.
- No debug code remains.

Every production deployment should leave the system in a better state than before.

### Definition of Done

A feature is not complete because it compiles.

A feature is complete when:

- Business requirements are satisfied.
- Code follows platform architecture.
- Security has been considered.
- Performance has been considered.
- Documentation has been updated when necessary.
- Existing functionality remains unaffected.
- The implementation can be confidently maintained by future engineers.

### Architectural Rule

Every change should improve one or more of the following without degrading the
others:

- Reliability
- Maintainability
- Security
- Performance
- Scalability
- Developer experience
- Organizational intelligence

If a change introduces unnecessary complexity, reconsider the implementation before
merging.

---

## Architectural Decision Records (ADRs)

This section documents important architectural decisions made during the evolution
of TrainEfficiency.

The purpose is to preserve engineering intent.

Future contributors should understand *why* decisions were made before proposing
alternatives.

These records should be updated whenever significant architectural decisions are
introduced.

### ADR-001 — AI-First Platform

**Decision**

TrainEfficiency is designed as an AI-native operating system rather than a
traditional SaaS application with AI features added later.

**Rationale**

AI is a core platform capability.

It should participate in every major business domain rather than exist as an
isolated chatbot.

**Implications**

- Shared AI infrastructure
- Reusable prompts
- Agent orchestration
- Organizational memory
- Governance
- Tool calling

### ADR-002 — Multi-Tenant by Design

**Decision**

Organizations are the primary security and data isolation boundary.

**Rationale**

Every feature should naturally support multiple organizations.

Tenant isolation must remain consistent throughout the platform.

**Implications**

- Organization-aware authorization
- Organization-scoped queries
- Organization-specific configuration
- Secure tenant isolation

### ADR-003 — Backend Owns Business Logic

**Decision**

Business rules belong on the server.

**Rationale**

The backend is the authoritative source of truth.

Frontend code exists to present information rather than enforce business rules.

**Implications**

- Consistent behavior
- Easier testing
- Improved security
- Better maintainability

### ADR-004 — Modular Domain Architecture

**Decision**

The platform is organized around business domains rather than UI pages.

**Rationale**

Business domains remain stable as the product evolves.

Pages and user interfaces change more frequently.

**Implications**

- Better reuse
- Clear ownership
- Lower coupling
- Easier scaling

### ADR-005 — Incremental Evolution

**Decision**

Prefer evolutionary architecture over large rewrites.

**Rationale**

TrainEfficiency is a production platform.

Stability is more valuable than architectural perfection.

**Implications**

- Small migrations
- Small deployments
- Incremental refactoring
- Lower operational risk

### ADR-006 — AI Agents Have Explicit Responsibilities

**Decision**

Agents should have clearly defined responsibilities.

**Rationale**

Specialized agents are easier to maintain, test, observe, and improve than large
general-purpose agents.

**Implications**

- Clear ownership
- Modular prompts
- Better orchestration
- Easier debugging

### ADR-007 — PostgreSQL Is the Source of Truth

**Decision**

Persistent business state lives in PostgreSQL.

**Rationale**

External APIs, AI services, caches, and temporary processing should never become the
authoritative record for business operations.

**Implications**

- Reliable recovery
- Consistent reporting
- Stable audit history

### ADR-008 — External Services Are Replaceable

**Decision**

Third-party providers should be abstracted behind platform services whenever
practical.

**Rationale**

Vendor lock-in increases long-term maintenance costs.

Business logic should remain independent of individual providers.

**Implications**

- Easier migrations
- Cleaner architecture
- Better testing
- Improved resilience

### ADR-009 — Production Safety Takes Priority

**Decision**

Production stability outweighs development convenience.

**Rationale**

TrainEfficiency supports real organizations.

Every deployment should minimize operational risk.

**Implications**

- Safe migrations
- Small changes
- Careful reviews
- Rollback planning

### ADR-010 — Reuse Before Expansion

**Decision**

Extend existing systems before introducing new abstractions.

**Rationale**

Platform consistency is more valuable than rapidly increasing the number of
components.

**Implications**

- Lower maintenance burden
- Fewer duplicate implementations
- Simpler architecture
- More consistent developer experience

### Future ADRs

Every major architectural decision should be documented using this format:

- Decision
- Rationale
- Implications

The objective is to preserve institutional knowledge rather than relying on tribal
knowledge or historical memory.

---

## Known Technical Debt, Design Constraints & Future Improvements

This section documents known technical debt, architectural constraints, operational
limitations, and planned improvements.

Technical debt is not considered failure.

Technical debt represents conscious engineering tradeoffs made to deliver business
value.

Future contributors should understand these tradeoffs before proposing large
architectural changes.

### Guiding Principle

Not every imperfection should be fixed immediately.

Prioritize improvements based on:

- Customer impact
- Reliability
- Security
- Maintainability
- Platform scalability

Avoid refactoring solely for aesthetic reasons.

### Known Technical Debt

Some areas of the platform intentionally favor stability over architectural
perfection.

Examples may include:

- Legacy route organization
- Large service files
- Historical compatibility layers
- Incremental migrations
- Transitional APIs
- Temporary feature flags

These should be improved incrementally rather than rewritten wholesale.

### Large Files

Some files may be larger than ideal due to the historical evolution of the platform.

Do not automatically split or rewrite large files.

Before proposing decomposition, evaluate:

- Coupling
- Deployment risk
- Testing complexity
- Existing abstractions
- Business impact

Large files alone are not sufficient justification for major refactoring.

### Backwards Compatibility

Existing production behavior is valuable.

Avoid:

- Breaking public APIs
- Changing response formats
- Renaming stable interfaces
- Removing supported workflows

Compatibility should generally be preserved unless a migration strategy exists.

### External Integrations

Several platform capabilities depend on external providers.

Examples include:

- Payment providers
- Email providers
- Calendar providers
- Messaging providers
- AI providers

External integrations should remain modular to reduce vendor lock-in and simplify
future replacements.

### AI Evolution

The AI platform will continue to evolve.

Future work may include:

- Richer organizational memory
- Improved agent collaboration
- Additional governance capabilities
- Better decision support
- Expanded automation
- More capable tool orchestration

New AI capabilities should integrate into the existing platform rather than creating
isolated AI features.

### Performance Improvements

Future optimization should be driven by measurement.

Potential areas include:

- Database query optimization
- API latency
- Background processing
- Frontend rendering
- Agent execution efficiency
- Reporting performance

Avoid premature optimization.

### Documentation

Repository documentation should evolve alongside the software.

Whenever significant architecture changes occur, update:

- CLAUDE.md
- ADRs
- API documentation
- Database documentation
- Integration documentation

Outdated documentation is considered technical debt.

### Refactoring Philosophy

Refactoring should be:

- Incremental
- Measurable
- Safe
- Well-tested
- Backwards compatible

Avoid "big bang" rewrites.

The preferred approach is continuous improvement through small, production-safe
changes.

### Platform Vision

TrainEfficiency is expected to grow significantly in capability.

Future improvements should strengthen:

- Platform consistency
- Reusable components
- AI operating system
- Organizational intelligence
- Automation
- Observability
- Scalability

Every major enhancement should move the platform closer to this vision.

### Architectural Rule

When encountering technical debt:

1. Understand why it exists.
2. Evaluate customer impact.
3. Assess deployment risk.
4. Prefer incremental improvements.
5. Preserve production stability.

Stability and long-term maintainability are generally more valuable than short-term
architectural purity.

---

## Engineering Decision Framework

When multiple technically correct solutions exist, contributors should use the
following framework to determine the preferred implementation.

The objective is long-term platform health rather than short-term implementation
speed.

### Decision Priority

When evaluating competing implementations, prioritize in this order:

1. Correctness
2. Security
3. Reliability
4. Maintainability
5. Simplicity
6. Reusability
7. Performance
8. Developer Experience
9. Feature Velocity

Never sacrifice correctness for convenience.

### Reuse Before Creation

Before introducing:

- New services
- Components
- Hooks
- Utilities
- Database tables
- Routes
- AI agents
- Prompts

Determine whether an existing implementation can be extended.

Expanding an existing system is generally preferred over creating parallel
functionality.

### Favor Platform Thinking

Every implementation should strengthen the platform.

Avoid building one-off solutions for isolated use cases.

Ask:

- Can another subsystem benefit from this?
- Is this solving a broader platform problem?
- Will this reduce future engineering effort?

### Keep Systems Cohesive

Each module should have a clearly defined responsibility.

Avoid components or services that accumulate unrelated behavior over time.

High cohesion improves maintainability.

### Minimize Coupling

Reduce unnecessary dependencies between domains.

Whenever practical:

- Communicate through well-defined interfaces.
- Avoid hidden dependencies.
- Avoid circular references.
- Preserve module independence.

### Prefer Evolution Over Replacement

Existing production systems should evolve incrementally.

Avoid replacing working systems simply because a cleaner design exists.

Incremental improvement reduces operational risk.

### Build for Scale

Assume successful features will grow.

When designing systems, consider:

- Increased users
- Larger organizations
- More data
- Additional AI agents
- More integrations
- Higher automation volume

Architecture should anticipate growth without becoming unnecessarily complex.

### Optimize for Understanding

Code is read more often than it is written.

Favor:

- Clear naming
- Explicit logic
- Predictable behavior
- Small, focused functions
- Self-documenting code

Avoid clever implementations that reduce readability.

### Production-First Mindset

Every change should assume:

- Real customers
- Live production data
- Concurrent users
- Partial failures
- External service outages

Implementations should remain robust under real-world conditions.

### AI-Assisted Development

AI should accelerate engineering without replacing engineering judgment.

Every AI-generated implementation should still be evaluated for:

- Correctness
- Security
- Performance
- Platform consistency
- Maintainability

Generated code is a starting point, not automatically production-ready.

### Documentation Philosophy

Whenever an important architectural decision is made:

- Update ADRs.
- Update CLAUDE.md when appropriate.
- Update API documentation if affected.
- Update schema documentation if affected.

Documentation should evolve with the codebase.

### Definition of Excellent Engineering

Excellent engineering within TrainEfficiency means producing software that:

- Solves the correct problem.
- Integrates naturally into the platform.
- Remains understandable months later.
- Can be safely extended.
- Improves the overall system.
- Reduces future complexity.
- Supports long-term organizational intelligence.

### Final Engineering Principle

When uncertain between two implementations, choose the solution that leaves the
platform in a healthier state for the next engineer.

Every contribution should improve the system, not merely add functionality.

---

## Founder Principles

These principles guide long-term decision making across TrainEfficiency.

When multiple implementation approaches are possible, contributors should prefer the
solution most consistent with these principles.

These principles are intentionally long-lived and should evolve slowly.

### Build Platforms, Not Features

Individual features are valuable only when they strengthen the platform.

Avoid isolated implementations.

New capabilities should integrate naturally into the broader ecosystem.

Every major feature should become reusable infrastructure whenever practical.

### AI Should Amplify Expertise

Artificial intelligence exists to amplify coaches, administrators, clinicians, and
organizations.

The objective is better decisions, greater consistency, and reduced repetitive work.

AI should increase human capability rather than replace professional judgment.

### Knowledge Should Compound

Every interaction should increase organizational knowledge.

Examples include:

- Athlete history
- Coach behavior
- Organizational preferences
- AI recommendations
- Operational insights
- Historical decisions

Knowledge should accumulate over time and improve future decisions.

### Data Should Flow Across Domains

Information collected in one subsystem should strengthen others whenever
appropriate.

Examples include:

- CRM improving scheduling
- Scheduling improving retention
- Athlete performance improving programming
- AI improving executive reporting
- Communications improving engagement

Avoid unnecessary information silos.

### Automation Should Remove Friction

Automation exists to eliminate repetitive operational work.

Automation should:

- Save time
- Reduce errors
- Increase consistency
- Improve organizational efficiency

Automation should never obscure important business decisions.

### Simplicity Wins

Complexity should only exist where it delivers meaningful value.

Prefer:

- Clear workflows
- Predictable behavior
- Consistent architecture
- Reusable systems

Complexity should emerge from business requirements, not engineering preferences.

### Production Reliability Is Non-Negotiable

TrainEfficiency supports real organizations.

Reliability always takes priority over novelty.

New functionality should not compromise existing production behavior.

### Harden Before Expanding

Strengthen existing systems before introducing new ones.

Improve:

- Reliability
- Documentation
- Performance
- Observability
- Maintainability

A stable platform compounds faster than a rapidly expanding one.

### Design for Long-Term Ownership

Every implementation should remain understandable years after it is written.

Avoid designs that require historical knowledge to maintain.

Future engineers should be able to extend the platform confidently.

### Institutional Knowledge Is an Asset

Knowledge should belong to the platform rather than individual contributors.

Document:

- Architecture
- Decisions
- Business rules
- AI behavior
- Operational procedures

Reduce reliance on tribal knowledge whenever possible.

### The Platform Learns

Every subsystem should contribute to organizational intelligence.

The long-term objective is not simply storing information.

The objective is helping organizations make progressively better decisions through
accumulated knowledge and AI-assisted insight.

### Build for the Next Decade

Short-term implementation speed should not compromise long-term platform health.

When making architectural decisions, consider:

- Future scale
- Future AI capabilities
- Future integrations
- Future organizations
- Future engineering teams

TrainEfficiency should become easier to extend as it grows, not harder.

### Final Principle

Every meaningful contribution should leave the platform more capable, more
maintainable, more intelligent, and easier for the next engineer to understand than
it was before.

---

## Critical Systems & Modification Rules

Certain systems form the operational backbone of TrainEfficiency.

Changes to these systems require a higher standard of review because they affect
multiple platform domains.

Contributors should understand downstream impact before modifying these areas.

### Authentication & Authorization

Critical because it affects:

- Every authenticated request
- Organization resolution
- Permissions
- Multi-tenant isolation
- Administrative operations

When modifying authentication:

- Preserve backwards compatibility whenever practical.
- Verify tenant isolation.
- Validate authorization paths.
- Review every affected endpoint.

### Database Schema

Schema changes affect every layer of the application.

Before modifying the schema:

- Identify all dependent services.
- Review existing migrations.
- Evaluate production impact.
- Preserve data integrity.
- Consider rollback strategies.

Avoid destructive schema changes unless explicitly approved.

### AI Platform

The AI platform is shared infrastructure.

Changes may affect:

- Multiple agents
- Organizational memory
- Prompt execution
- Tool calling
- Executive reporting
- Governance

Avoid introducing agent-specific behavior into shared AI infrastructure.

### Scheduling

Scheduling impacts:

- Coaches
- Athletes
- Organizations
- Notifications
- Billing
- Calendar synchronization

Scheduling changes should be evaluated across the complete booking lifecycle.

### Billing

Financial systems require exceptional caution.

Examples include:

- Stripe
- Wallets
- Subscriptions
- Promotional codes
- Checkout
- Webhooks

Financial correctness takes priority over feature velocity.

Webhook processing should remain deterministic and idempotent.

### Executive Operating System

Executive dashboards and organizational intelligence depend upon data from many
domains.

Changes should preserve:

- Metric consistency
- Historical reporting
- Agent outputs
- Organizational summaries

Avoid breaking longitudinal reporting.

### Integrations

External integrations should remain isolated.

Changes to provider-specific implementations should not require modifications
throughout the application.

Maintain clear abstraction boundaries.

### Background Jobs

Scheduled jobs and automation should remain:

- Observable
- Retry-safe
- Organization-aware
- Idempotent whenever practical

Background execution should never assume interactive user context.

### Shared Infrastructure

Exercise caution when modifying:

- Shared utilities
- Shared services
- Shared types
- Validation libraries
- Middleware
- Configuration systems

Small changes in shared infrastructure may have platform-wide consequences.

### Public APIs

Before changing API behavior:

Evaluate:

- Existing clients
- Response contracts
- Error formats
- Version compatibility
- Third-party integrations

Breaking API contracts should require explicit justification.

### Before Modifying Critical Systems

Always ask:

1. Which platform domains depend on this?
2. Could another subsystem be affected?
3. Does this impact production data?
4. Does this affect tenant isolation?
5. Does this change API behavior?
6. Does this require documentation updates?

If the answer to any of these is "yes," perform additional review before
implementation.

### Platform Stability Rule

Changes to foundational systems should be:

- Small
- Well understood
- Thoroughly validated
- Backwards compatible whenever practical

Platform stability should always outweigh implementation convenience.

---

## Business Domain Glossary

This glossary defines the core business concepts used throughout TrainEfficiency.

Contributors should use these terms consistently in code, documentation, APIs,
prompts, and user-facing features.

Avoid introducing multiple names for the same business concept.

### Organization

The highest-level tenant within the platform.

An organization owns:

- Coaches
- Athletes
- Teams
- Programs
- Schedules
- Bookings
- AI configuration
- Governance
- Billing
- Organizational data

Organizations are the primary security boundary.

### Coach

A professional responsible for managing athletes, programs, schedules,
communication, and organizational operations.

Coaches operate within organizations.

### Athlete

An individual receiving coaching services.

Athletes may participate in:

- Training
- Assessments
- Attendance
- Performance tracking
- Programming
- Communication
- Scheduling

Athlete history should remain longitudinal.

### Team

A logical grouping of athletes.

Teams may be used for:

- Programming
- Scheduling
- Reporting
- Attendance
- Communication

### Program

A structured training plan delivered to athletes.

Programs may include:

- Exercises
- Sessions
- Progressions
- Blocks
- AI-generated recommendations

Programs are business assets rather than UI constructs.

### Booking

A scheduled interaction between coaches and athletes or clients.

Bookings may influence:

- Scheduling
- Billing
- Notifications
- Attendance
- Reporting

### Client

The paying customer for services.

Depending on the organization, the client may be:

- An athlete
- A parent
- A team representative
- An organization

Client and athlete are not always the same entity.

### Lead

A prospective customer who has entered the organization's acquisition pipeline.

Leads progress through stages before becoming clients.

Lead history should remain measurable.

### Funnel

A structured acquisition workflow that guides prospective customers from initial
interest to conversion.

Funnels may include:

- Landing pages
- Forms
- AI interactions
- Scheduling
- Checkout
- Follow-up automation

### Executive Operating System

The organizational intelligence layer.

Responsible for:

- Executive dashboards
- Organizational health
- Department summaries
- Recommendations
- Operational insight

### AI Agent

A specialized AI component responsible for a defined operational responsibility.

Agents should have:

- Clear ownership
- Defined inputs
- Defined outputs
- Observable execution

### Organizational Memory

Accumulated knowledge used to improve future recommendations and decision making.

Examples include:

- Historical activity
- Preferences
- Decisions
- Operational trends
- AI context

### Governance

Organizational policies controlling AI behavior, permissions, automation, and
operational constraints.

Governance ensures AI actions remain aligned with organizational requirements.

### Automation

A workflow executed automatically in response to business events or schedules.

Automation should be:

- Predictable
- Observable
- Safe to retry
- Organization-aware

### Integration

A connection between TrainEfficiency and an external platform.

Examples include:

- Payment providers
- Communication providers
- Calendar providers
- AI providers
- Marketing platforms

Integrations extend the platform but do not become its source of truth.

### Organizational Intelligence

Insights generated by combining operational data, historical context, analytics, and
AI recommendations.

Organizational intelligence is a primary product objective.

### Platform

TrainEfficiency itself.

When documentation refers to "the platform," it refers to the complete software
ecosystem rather than an individual feature or module.

### Ubiquitous Language

When introducing new functionality, prefer existing business terminology.

If a new business concept is introduced, update this glossary so the entire platform
continues using a shared language.

---

## AI Agent Catalog

This section documents the major AI agents within TrainEfficiency.

Each agent owns a specific operational domain.

Avoid creating overlapping responsibilities between agents.

When implementing new AI functionality, determine whether it belongs within an
existing agent before creating a new one.

### Executive Agent

**Purpose**

Provides executive-level organizational intelligence.

**Responsibilities**

- Organizational health
- Cross-domain summaries
- Executive recommendations
- Decision support
- Strategic reporting

**Inputs**

- Organization-wide operational data
- Department agent outputs
- Business metrics

**Outputs**

- Executive dashboards
- Organizational recommendations
- Strategic summaries

### Revenue Agent

**Purpose**

Improve organizational revenue performance.

**Responsibilities**

- Revenue analysis
- Subscription insights
- Financial trends
- Revenue opportunities

**Never Own**

- Scheduling
- CRM workflows
- Athlete programming

### Growth Agent

**Purpose**

Improve customer acquisition and organizational growth.

**Responsibilities**

- Lead intelligence
- Funnel performance
- Conversion analysis
- Marketing recommendations
- Growth opportunities

### Scheduling Agent

**Purpose**

Optimize scheduling operations.

**Responsibilities**

- Calendar intelligence
- Booking optimization
- Availability analysis
- Schedule utilization

Scheduling logic should remain centralized.

### Client Success Agent

**Purpose**

Improve customer outcomes after conversion.

**Responsibilities**

- Client engagement
- Risk detection
- Success metrics
- Follow-up recommendations

### Retention Agent

**Purpose**

Reduce client churn.

**Responsibilities**

- Churn prediction
- Retention recommendations
- Renewal opportunities
- Long-term engagement

### Governance Agent

**Purpose**

Ensure AI systems remain compliant with organizational policies.

**Responsibilities**

- Policy evaluation
- Rule enforcement
- AI permissions
- Governance validation

This agent protects organizational trust.

### Executive Operating System

Acts as the coordination layer rather than an individual operational agent.

Responsible for:

- Combining departmental insights
- Organizational summaries
- Executive dashboards
- Cross-domain recommendations

### AgentMail

Provides AI-driven communication capabilities.

Responsibilities may include:

- Email generation
- Inbox processing
- Communication automation
- Organizational messaging

Communication should always remain organization-aware.

### Hermes Knowledge System

Responsible for organizational learning.

Responsibilities include:

- Knowledge accumulation
- Context retrieval
- Organizational memory
- Historical reasoning
- Knowledge reuse

Knowledge should improve future decision quality.

### Decision Journal

Maintains important organizational decisions.

Purpose:

- Historical context
- Architectural memory
- Executive reasoning
- Organizational learning

The objective is preserving institutional knowledge.

### Shared AI Infrastructure

All agents share common infrastructure.

Examples include:

- Tool calling
- Prompt execution
- Organizational context
- Authentication
- Governance
- Logging
- Observability

Shared infrastructure should remain generic.

Avoid embedding agent-specific logic into shared components.

### Creating New Agents

Before creating a new agent, ask:

1. Does an existing agent already own this responsibility?
2. Can the existing agent be extended safely?
3. Is the responsibility sufficiently distinct?
4. Will a separate lifecycle improve maintainability?

New agents should exist only when they represent a genuinely new operational domain.

### Coordination Principles

Agents should:

- Cooperate rather than compete.
- Share organizational context.
- Maintain clear ownership.
- Produce structured outputs.
- Remain independently observable.

A well-defined ecosystem of specialized agents is preferred over a small number of
large, generalized agents.

---

## Claude Operating Instructions

This repository is designed to be maintained collaboratively by human engineers and
AI assistants.

Claude should behave as a senior software engineer who understands the platform
architecture, preserves engineering intent, and prioritizes long-term
maintainability.

### Primary Responsibility

Your responsibility is not simply to generate code.

Your responsibility is to improve TrainEfficiency while preserving:

- Production stability
- Platform consistency
- Engineering quality
- Organizational intelligence
- Long-term maintainability

Every recommendation should strengthen the platform.

### Before Making Changes

Before implementing anything:

1. Read this CLAUDE.md.
2. Review relevant documentation in `/docs`.
3. Identify the affected business domain.
4. Determine whether an existing implementation can be extended.
5. Evaluate downstream impact.
6. Choose the smallest maintainable solution.

Avoid implementing before understanding the existing architecture.

### Root Cause First

When debugging:

Never fix symptoms before understanding the root cause.

Always explain:

- What failed
- Why it failed
- Which systems are affected
- Why the proposed solution is safe

Root cause analysis is required before proposing architectural changes.

### Production Safety

Assume:

- Real customers
- Real organizations
- Live production data
- Concurrent users
- Active AI agents
- Background jobs

Avoid recommendations that unnecessarily increase deployment risk.

### Platform Consistency

When multiple valid solutions exist, prefer the solution that is most consistent
with the existing platform architecture.

Consistency is generally more valuable than novelty.

### Backwards Compatibility

Avoid breaking:

- APIs
- Database schema
- Existing workflows
- Integrations
- Organizational data

If a breaking change is unavoidable:

- Explain why.
- Describe migration requirements.
- Identify affected systems.

### Documentation Responsibilities

Whenever architecture changes significantly:

Update:

- CLAUDE.md
- ADRs
- Schema documentation
- API documentation
- Integration documentation

Documentation is considered part of the implementation.

### AI Responsibilities

When working with AI systems:

- Preserve governance.
- Preserve organizational memory.
- Reuse existing tools.
- Avoid duplicate prompts.
- Maintain agent specialization.
- Prefer extending the existing AI ecosystem.

Do not introduce isolated AI features that bypass shared infrastructure.

### Engineering Expectations

When writing code:

- Use strong typing.
- Preserve architectural boundaries.
- Avoid unnecessary abstractions.
- Minimize technical debt.
- Prefer readability.
- Keep implementations deterministic.
- Handle failures gracefully.

### Review Expectations

Before considering work complete, verify:

- Correctness
- Security
- Performance
- Maintainability
- Tenant isolation
- Documentation
- Error handling
- Production safety

Code that compiles is not necessarily production-ready.

### When Unsure

If multiple implementations appear reasonable:

Prefer the solution that:

- Reuses existing systems.
- Simplifies future maintenance.
- Improves platform consistency.
- Preserves production behavior.
- Aligns with the Founder Principles.

### Long-Term Objective

TrainEfficiency is evolving into an AI-native operating system for organizations.

Every meaningful contribution should move the platform toward:

- Better automation
- Better organizational intelligence
- Better engineering quality
- Better scalability
- Better maintainability

without compromising production reliability.

### Final Rule

Leave the repository in a better state than you found it.

Every change should improve the platform—not simply add functionality.

---

## Repository Evolution Log

This section records major milestones in the evolution of TrainEfficiency.

Unlike Architectural Decision Records (ADRs), which explain *why* individual
architectural decisions were made, this log documents *how* the platform has
evolved over time.

The objective is to preserve historical context that helps future contributors
understand the direction of the platform.

Update this log whenever a major capability or architectural milestone is
completed.

### Phase 1 — Coaching Platform Foundation

Primary focus:

- Organizations
- Coaches
- Athletes
- Scheduling
- CRM
- Basic operations

Goal:

Establish a stable operational platform for coaching organizations.

### Phase 2 — Business Operations

Major additions included:

- Billing
- Subscriptions
- Wallet functionality
- Notifications
- Automation
- Reporting
- Organizational management

Goal:

Operate an entire coaching business from a single platform.

### Phase 3 — AI Integration

Major additions included:

- AI-assisted workflows
- Organizational intelligence
- Executive dashboards
- AI recommendations
- Knowledge systems

Goal:

Use AI to augment operational decision making.

### Phase 4 — Agent Operating System

Major additions included:

- Specialized AI agents
- Agent orchestration
- Shared AI infrastructure
- Governance
- Organizational memory
- Executive Operating System

Goal:

Transition from AI features to an AI-native operating system.

### Future Direction

Future milestones may include:

- Expanded organizational intelligence
- Deeper automation
- Cross-agent collaboration
- Predictive analytics
- Enhanced knowledge retrieval
- Additional integrations
- Platform scalability improvements

The platform should evolve through continuous, incremental improvements rather than
disruptive rewrites.

### Historical Context

When reviewing older code:

Do not assume older implementations are incorrect.

Many systems represent earlier architectural phases that continue to provide
production value.

Understand historical context before proposing significant refactoring.

### Living Document

This section should be updated whenever the platform reaches a meaningful
architectural milestone.

The objective is to preserve institutional memory and provide future contributors
with context that is difficult to infer from the codebase alone.

---

## Verification Status

This document is classified `Document Type: Architecture` and currently carries
`Verification Status: Architecture Specification` (see the frontmatter at the top
of this file and `docs/documentation-status-legend.md` for the full classification
system).

It represents the intended architecture of TrainEfficiency and has **not yet been
fully verified against the production source code**.

When the complete repository becomes available, this document should be validated
against the implementation and its `Verification Status` upgraded along the
sequence:

`Architecture Specification` → `Partially Verified` → `Verified Against Source` →
`Verified Against Production`

Implementation should always take precedence over architectural intent until
verification is complete.

Any discrepancies discovered during verification should be documented rather than
silently corrected.

---

## Repository Context

Project-specific architecture, integrations, schema documentation, and conventions
are documented in the `/docs` directory.

Consult those documents before making architectural assumptions.

If project documentation conflicts with this document, project-specific documentation
takes precedence.
