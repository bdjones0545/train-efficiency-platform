# Cross-Agent Coordination Identity Contract

This document records the approved product contract for Cross-Agent Coordination. It is a contract for a future implementation, not a claim that the current runtime already complies.

## Approved product contract

The canonical identity of one coordination action is:

`org_id + action_type + canonical_resource_type + canonical_resource_id + coordination_generation`

- Tenant scope is mandatory. Identical resource, action, and generation strings in different organizations remain distinct.
- Canonical resource types currently covered by this contract are `prospect`, `lead`, and `gmail_thread`.
- `prospect_id` takes precedence over conversation context and produces `prospect:<prospect_id>`.
- Otherwise, `lead_id` takes precedence over conversation context and produces `lead:<lead_id>`.
- Supplying both prospect and lead is ambiguous and must be rejected unless the caller first selects one explicit canonical resource. Lead and prospect are distinct types even when their textual IDs match.
- When the conversation itself is the target, `gmail_thread_id` produces `gmail_thread:<gmail_thread_id>`. A typed Gmail `source_conversation_id` is the fallback when no provider thread ID exists. An untyped generic source conversation cannot establish identity.
- Within a known Gmail flow, provider thread and internal conversation IDs are aliases for one conversation; the provider thread is preferred. Conversation identifiers remain context when a business resource is present.
- `coordination_generation` is a required, nonblank, opaque ID supplied by the upstream caller before Coordination runs. It is stable across retries of one business generation and changes for a later workflow, campaign, or business cycle. Coordination must not derive it from time, randomness, agent identity, or `source_action_id`.
- Agent identity is excluded from action identity. Different agents intentionally converge on the same canonical row.
- `source_action_id` is trace metadata only.
- `source_agents` is a set of distinct supporters. Ordering is not identity-significant. `support_score` equals the number of distinct agents: retries from one agent do not increment it.
- One active row exists per canonical identity. Resolution closes that generation; it remains historical evidence. A later explicit generation may create a new row for the same tenant/action/resource.
- The first persisted action returns `created` and its canonical registry ID. Later equivalent support returns the same ID with `deduplicated`; support above two may use `merged` as a result label. `merged` never creates a second identity. Concurrent equivalent callers must converge on the same ID, and no caller may report creation when it did not create the canonical row.

There is no universal existing upstream identifier that correctly represents every coordination generation. Future callers must supply `coordinationGeneration` explicitly. Suitable sources include a workflow run, job, request, campaign, queue, or recommendation generation ID only when that ID is stable for retries, distinguishes later legitimate work, is available before side effects, and has the correct business-generation scope. One generation may contain several distinct action/resource identities; the full canonical composite keeps those actions separate.

### Generation-source inventory

| Candidate | Stability and recurrence | Scope/cardinality | Decision |
| --- | --- | --- | --- |
| Workflow run ID | Durable across retries of one run; changes for a later run | Tenant-owned; one run can coordinate several actions | Valid caller source for workflow-driven actions, not universal |
| Background job ID | Durable for one queued job, but retry systems may create replacement jobs | Usually tenant-owned; one job may emit several actions | Valid only when job retry identity is stable by contract |
| Execution ID | Usually created for one execution attempt | May be too late if Coordination must precede execution/side effects | Not a universal source |
| Recommendation ID | Durable upstream record ID | One recommendation commonly queues one downstream action | Valid for recommendation-driven generations only |
| Request ID | Stable only if the caller preserves it across retries | Request-scoped; may be narrower than a business generation | Valid only under an explicit caller idempotency contract |
| Queue ID | Durable queue-record identity | Replacement/requeue behavior may create a new ID | Valid only when requeue means a new generation |
| Campaign ID | Durable business-cycle identity | One campaign can coordinate many resources/actions | Valid for campaign-driven work, not universal |
| Provider event ID | Stable replay identifier | Provider-specific and may describe an event rather than a business generation | Trace/idempotency evidence unless caller proves generation semantics |
| Source record/action ID | Stable trace link in some subsystems | Semantics differ by source | Explicitly excluded by the approved contract |

All acceptable sources are available upstream before Coordination is invoked. Coordination receives their value through the explicit opaque field; it does not inspect or infer the source category.

## Current runtime behavior

The current runtime does not implement this contract:

| Area | Current runtime | Approved contract | Future `0014` work |
| --- | --- | --- | --- |
| Resource identity | Conjunction of whichever optional columns a request supplies | One typed canonical resource with deterministic precedence | Add canonical resource type/ID and reject ambiguity |
| Generation | Absent | Required explicit upstream opaque ID | Persist and validate generation |
| Agent identity | Excluded from matching | Excluded | Preserve exclusion |
| Support score | Counts matching requests | Counts distinct agents | Atomically maintain supporter set/count |
| Source agents | Initialized once; not updated on merge | Set-like distinct evidence | Persist unique supporters atomically |
| Duplicate result | Created result has `actionId: null` | Every success returns canonical ID | Return insertion/convergence result accurately |
| Concurrency | Check-then-insert can create duplicates | Equivalent attempts converge | Atomic insert/conflict handling |
| Runtime DDL | Lazy structural DDL | Formal migrations own durable schema | Remove structural DDL after validation exists |
| Uniqueness | Primary key only | Tenant-scoped active canonical identity | Add contract-exact active uniqueness |
| Legacy rows | No resource discriminator or generation | Canonical resource and generation required | Classify transactionally and fail closed |

`checkCoordination()`, `resolveCoordinationEntry()`, `ensureCoordinationTables()`, route behavior, persistence, and matching remain unchanged during this contract phase.

## Future `0014` implementation requirements

The implementation must use formal, transactional migration ownership and database-backed atomic convergence. It must validate the complete schema contract, preserve tenant isolation, return one canonical registry ID to concurrent callers, and update distinct-agent support without counting retries.

Legacy handling must not fabricate identity:

- A row with exactly one recognizable resource column has a deterministic resource type and ID, but still lacks a generation.
- Prospect plus lead, incompatible multi-resource combinations, and generic untyped conversations are ambiguous.
- Rows without a recognizable resource are impossible to normalize.
- No active legacy row has a reconstructable generation merely from the current schema. Do not synthesize one from `id`, `created_at`, randomness, agent, or `source_action_id`.
- The migration must fail closed when active legacy rows lack a product-approved canonical resource or generation policy.
- Resolved rows may remain immutable historical evidence outside active uniqueness, provided the migration explicitly validates that treatment and does not present them as normalized canonical generations.

## Explicit non-goals

This contract does not create migration `0014`, alter tables or indexes, remove runtime DDL, change production matching or persistence, wire callers, repair legacy data, define non-Gmail conversation aliases, alias leads to prospects, contact providers, or change authorization, billing, or UI behavior.
