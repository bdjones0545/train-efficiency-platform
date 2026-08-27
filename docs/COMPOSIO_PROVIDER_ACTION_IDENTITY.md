# Composio Provider Action Identity and Connection-Authority Contract

This document defines the approved contract for a future Composio implementation. It does not claim that the current runtime complies.

## APPROVED CONTRACT

### Canonical logical action

Every mutating action has an explicit upstream-created, nonblank `logicalProviderActionId`. It is stable for retries of one intended business action and different for a later independent action. The shared executor must never synthesize it from randomness, time, an execution attempt, or a provider receipt.

The canonical identity is:

`org_id + provider_family + logical_provider_action_id + provider_action_version`

`provider_family` is the normalized Composio toolkit slug. Repository code already uses toolkit slugs for the static registry, action discovery, and connected-account matching; broader domain labels would add an unsupported alias layer.

### Canonical toolkit namespace

The closed, repository-evidenced toolkit namespace is:

- `gmail`
- `googlecalendar`
- `slack`
- `googlesheets`
- `github`
- `stripe`

Normalization trims surrounding whitespace and lowercases only. An input is accepted only when that operation produces an exact member of the closed set. Display names and friendly or separator aliases—including `Google Gmail`, `google_gmail`, `google-calendar`, `Google Sheets`, and `github.com`—are rejected. Unknown nonblank strings are also rejected. Canonical uniqueness must not depend on fuzzy provider-name normalization; a new toolkit or supported alias requires an explicit, evidence-backed contract update.

`providerActionVersion` is an explicit authority-controlled revision. A material change to tool/action, target connection or resource, arguments, approved payload, or approval authority cannot silently reuse an older version. This contract does not prescribe content hashing because canonical argument serialization is not established.

The existing random UUID is `providerAttemptId` only. One logical action/version may have several attempts. Composio/provider execution IDs and callback IDs are receipts, not logical identity.

### Retry and lifecycle

Equivalent concurrent callers converge on one canonical logical action. A confirmed provider failure may permit another attempt under the same identity. A later legitimate repetition uses a new logical action ID. A changed authority-bound payload uses a new version or, where business meaning is independently new, a new logical action ID.

Conceptual states are `authorized`, `attempt_authorized`, `invocation_in_progress`, `provider_accepted`, `confirmed_success`, `confirmed_failure`, `uncertain`, `rejected`, and `cancelled`. Providers may use different terminal subsets.

- Authority durable and provider not invoked: safe to resume.
- Invocation begun without confirmed outcome: reconciliation required; blind retry prohibited.
- Confirmed failure: retry may be authorized using a new attempt.
- Confirmed success: persist success before reporting durable completion.
- Possible provider success plus failed local persistence: mark uncertain; never claim exactly-once execution.

### Connected-account authority

Every mutating action resolves a durable server-side connection authorization. Organization-owned connections bind `org_id`, toolkit, connected-account ID, eligibility, and active status. Platform-owned/shared connections require an explicit ownership class and affirmative policy for the tenant; missing organization binding is never implicit global permission.

A caller may request a connection, but the server must verify its existence, ownership/policy, toolkit, active status, and action eligibility. Cross-tenant substitution fails. Status/read views expose only organization-authorized connections and explicitly permitted platform connections.

### Approval and payload binding

Approval-required actions bind organization, logical ID, action version, toolkit/action, authority-relevant connected account, arguments/payload revision, approval ID, and approving principal. V1 approval cannot authorize modified V2. Approval and idempotency are separate: intentionally auto-executable mutations still require canonical identity, a durable claim, and tenant-owned connection authority.

### Specialized request mapping

| Family | Durable logical-ID candidate | Tenant scope | Retry stability | Mutation cardinality | Current version source |
| --- | --- | --- | --- | --- | --- |
| Gmail draft | `composio_gmail_draft_requests.id` | `org_id` | Stable while `draft_queued` retries | One draft creation | Missing |
| Slack alert | `composio_slack_alert_requests.id` | `org_id` | Stable while `alert_queued` retries | One message post | Missing |
| Calendar | `composio_calendar_requests.id` | `org_id` | Stable while `event_queued` retries | One stored create/update/delete action | Missing |
| GitHub issue | `software_improvement_tasks.id` for the governed issue flow | organization ID | Stable while draft-request status retries | One issue creation in the current flow | Missing |

These IDs can serve as `logicalProviderActionId` only for the stated single mutation. None currently carries an immutable `providerActionVersion`, and none propagates canonical identity into the shared executor. If a future request record can represent multiple provider mutations, it needs a mutation discriminator or separate logical IDs.

Generic mutating callers must supply both identity fields. A caller without durable business identity is ineligible for the future canonical execution path.

### Callback and reconciliation identity

Callbacks bind server-side persisted canonical action identity, attempt ID, and provider/Composio event ID. Duplicate delivery of the same event converges; callback-provided tenant data is not authority. Provider execution IDs may correlate an uncertain attempt only after server-side binding.

The installed runtime exposes action execution plus connected-account/tool discovery. The audited code contains no demonstrated execution lookup, client idempotency key, callback receiver, or durable callback identity. Those capabilities remain unproven and must not be invented. Until a provider-supported lookup or receipt correlation is verified, uncertain outcomes require manual/provider-specific reconciliation.

### Identity decision matrix

| Scenario | Classification / rule |
| --- | --- |
| Same org, logical ID/version, tool/account/args retry | SAME; new attempt only |
| Same org and logical ID, different version | DISTINCT canonical version |
| Different logical IDs, identical payload | DISTINCT |
| Same logical ID/version in two organizations | DISTINCT |
| Same logical ID/version, different account | Authority mismatch; reject stale identity/version |
| Same logical ID/version, changed tool | Authority mismatch; reject |
| Same logical ID/version, changed arguments | Authority mismatch; reject |
| Same Gmail request retry | SAME after version exists |
| Same Slack request retry | SAME after version exists |
| Same Calendar request retry | SAME after version exists |
| Same GitHub task issue retry | SAME after version exists |
| Retry after confirmed failure | SAME logical identity; new authorized attempt |
| Action after uncertain outcome | No blind retry; reconcile |
| Later legitimate similar mutation | DISTINCT logical ID |

### Tenant-scoped reads

Composio status uses the same organization connection-authorization selection as execution. Hermes unprocessed queries require a resolved organization: resolved organization means tenant-filtered query; missing or failed resolution means fail closed with no data, never a global fallback.

## CURRENT UNSAFE RUNTIME

- `executeComposioAction` generates a random per-call UUID and accepts no logical ID/version.
- Generic requests accept client-controlled `entityId` but no durable business identity.
- Google Sheets includes auto-executable create/update/clear mutations.
- Connection lookup selects the first globally active toolkit match without tenant authority.
- Provider invocation precedes best-effort action logging, leaving an ambiguous crash window.
- Specialized IDs and approvals are not passed into the shared executor as canonical authority.
- `composio_action_log` and the Gmail, Slack, and Calendar request tables are runtime-created.
- Status exposes the global connected-account inventory.
- Hermes unprocessed lookup can fall back to an unscoped query after organization resolution failure.
- No audited callback/reconciliation path closes uncertain provider outcomes.

All those runtime paths remain unchanged in this contract phase.

## FUTURE `0016` IMPLEMENTATION REQUIREMENTS

The smallest dependency-correct order is:

1. Formalize tenant-authoritative connected-account ownership, including explicit platform-owned policy and read-only validation. Do not enable canonical mutations until this authority exists.
2. Add the canonical logical-action and attempt ledger with immutable authority/payload binding, lifecycle transitions, durable pre-invocation claim, uncertainty handling, and callback receipt convergence.
3. Map specialized request families and generic eligible callers into that ledger using explicit identity/version fields.
4. Only then remove Composio runtime DDL, formalize the specialized tables as appropriate, and wire tenant-scoped status and fail-closed Hermes reads.

Future migration work must inspect legacy state and fail closed rather than invent identity, version, tenant ownership, or provider outcome. Formal migrations own durable schema; runtime validates/degrades and performs no structural DDL.

## Explicit non-goals

This phase does not create `0016`, change provider execution, alter account selection, call Composio, modify runtime DDL or schema, wire callbacks, redesign the approval plane, deploy, or push.
