# Composio Provider Action and Attempt Ledger Contract

## Decision

`CONTRACT_ONLY_FIRST`. Migration `0017` is intentionally not created.

The connected-account authority prerequisite is now formalized by `0016`, but the audited callers do not yet supply the complete canonical identity approved in `COMPOSIO_PROVIDER_ACTION_IDENTITY.md`. Gmail draft, Slack alert, Calendar request, and governed GitHub issue flows have stable durable request IDs but no immutable provider-action version. Generic mutations, including Google Sheets, have neither a durable logical action ID nor a version. Inventing either in the executor would collapse retries and new business actions or silently change approval authority.

The installed application runtime uses Composio's REST execution endpoint directly. The audited repository and installed integration expose no proven idempotency-key parameter, execution-status lookup, or callback/reconciliation contract that could safely turn an indeterminate invocation into a retryable failure. Provider-specific terminal semantics are likewise not established. These are implementation gates, not values a migration can infer.

## Canonical records

A future formal migration should own separate logical-action and attempt records.

The logical action has one immutable identity:

`org_id + provider_family + logical_provider_action_id + provider_action_version`

It also binds the exact toolkit action, tenant-authorized connected-account ID, explicit approved arguments revision, approval ID/principal where applicable, lifecycle status, and timestamps. The exact identity is unique. Provider receipts, random attempt UUIDs, agent IDs, and callback event IDs are excluded from uniqueness.

Each attempt belongs to exactly one logical action and has a positive attempt number, lifecycle status, provider execution/event receipts where available, classified failure data, and timestamps. `(action_id, attempt_number)` is unique. At most one blocking attempt may exist for an action; blocking statuses are `attempt_authorized`, `invocation_in_progress`, `provider_accepted`, and `uncertain`.

No schema is specified as implementation-ready until the caller version source, authority binding representation, and provider reconciliation semantics are proved. Formal migrations remain the only authority for durable schema; runtime code must validate or degrade and must not repair structural drift.

## Claim and invocation protocol

Equivalent concurrent requests first converge on the logical identity. In one transaction the service validates immutable authority, creates or locks the action, and creates a durable `attempt_authorized` attempt. A retry that finds that same pre-invocation attempt resumes it rather than creates another.

Immediately before the provider call, the service locks the records, revalidates current connected-account and approval authority, and transitions the attempt to `invocation_in_progress`. No provider call occurs before that durable transition. Once invocation has begun, a crash or persistence ambiguity is `uncertain`; blind retry is prohibited.

A proven synchronous result may transition the attempt to `confirmed_success` or `confirmed_failure`. An asynchronous acknowledgement transitions to `provider_accepted` and remains nonterminal. A retryable confirmed attempt failure leaves the logical action `authorized`; a separate, explicit retry policy decision may then authorize a new numbered attempt. Retryability is never inferred from failure alone. Logical-action `confirmed_failure` means the overall action is permanently failed and is terminal. Confirmed success, permanent failure, rejection, and cancellation are terminal. Durable terminal state must be committed before success is reported upstream.

## Callback and reconciliation

A callback may converge only through a server-persisted binding of logical action ID, attempt ID, and provider event ID. Callback tenant fields and provider event IDs alone are never authority. Duplicate delivery of the same bound event converges. Conflicting or unknown receipts fail closed for reconciliation.

Until a provider-supported lookup or receipt-correlation capability is verified, `invocation_in_progress`, `provider_accepted`, and `uncertain` block another attempt and require manual or provider-specific reconciliation.

## Audited caller classification

| Caller family | Class | Logical ID | Immutable version | Eligibility |
| --- | --- | --- | --- | --- |
| Gmail draft creation | synchronous mutation, provider finality unproved | request ID | missing | blocked |
| Slack message | communication side effect, provider finality unproved | alert ID | missing | blocked |
| Calendar create/update/delete | mutation, provider finality unproved | request ID | missing | blocked |
| Governed GitHub issue creation | mutation, provider finality unproved | task ID | missing | blocked |
| Google Sheets create/update/clear | mutation | missing | missing | blocked |
| Generic `/api/composio/execute` mutations | provider semantics depend on selected action | missing | missing | blocked |
| Calendar and scheduling reads | read-only | not required by mutation ledger | not required | outside ledger |
| Hermes emitter | downstream observability only | n/a | n/a | not an execution caller |

Auto-executable does not mean idempotent. Approval and idempotency remain independent gates.

## Current negative controls

The existing shared executor calls `/tools/execute/{action}` before `writeComposioActionLog`. That log is runtime-created, best effort, and swallows persistence failures. It has no logical identity/version or pre-invocation claim. Therefore identical retries can invoke the provider twice, and provider success followed by local persistence failure can be returned as success with no durable canonical outcome. The contract tests reproduce both unsafe shapes with a fake provider/persistence boundary; runtime behavior is deliberately unchanged in this slice.

## Required follow-up before `0017`

1. Each mutating caller must define and persist its caller-owned logical ID and immutable version source, including approval/payload revision rules.
2. Each used provider action must be classified with evidence for synchronous finality, asynchronous acceptance, receipt shape, and supported reconciliation lookup or explicit manual policy.
3. The implementation design must prove transaction/locking behavior for concurrent claim, pre-invocation authority revalidation, terminal persistence, and callback convergence.
4. Legacy preflight policy must reject ambiguous active state without fabricating identity, version, tenant, authority, or provider outcome.

No production/provider calls, runtime changes, schema changes, or historical repair are part of this contract closure.
