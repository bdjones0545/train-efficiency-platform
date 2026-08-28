# Composio Specialized Caller Version Contract

## Decision

`VERSION_CONTRACT_READY`, contract-only. No migration or runtime wiring is included.

All four current specialized mutation families store one single-shot provider payload snapshot and expose no supported in-place payload editor. Their future `providerActionVersion` is therefore a request-owned positive integer: initialize it to `1` atomically with a new exact payload snapshot; preserve it across provider attempts, approval revocation, and reapproval of unchanged payload; increment it only if a future pre-success editor transactionally changes a provider-authority field. Version is available before invocation and must be bound by approval. It is not an attempt number, timestamp, random ID, provider receipt, or inferred JSON hash.

Current APIs do not support payload edits. A revised operation is currently a new request and logical ID. The increment rule defines the safe contract for any future pre-success editor; it does not authorize one now.

## Family evidence

| Family | Logical ID | Fixed action | Exact provider arguments | Current edits | Success |
| --- | --- | --- | --- | --- | --- |
| Gmail draft | `composio_gmail_draft_requests.id` | `GMAIL_CREATE_EMAIL_DRAFT` | `to` from `recipient_email`, `subject`, `body` | none | one draft; exhausted |
| Slack alert | `composio_slack_alert_requests.id` | `SLACK_SEND_MESSAGE` | `channel`, `markdown_text` from `message` | none | one post; exhausted |
| Calendar create | `composio_calendar_requests.id` | `GOOGLECALENDAR_CREATE_EVENT` | `summary`, start, calendar, optional end/duration/attendees/location/description/timezone, meeting-room flag | none | one create; exhausted |
| Calendar update | same request table ID | `GOOGLECALENDAR_UPDATE_EVENT` | target `event_id`, start, calendar, optional summary/end/duration/attendees/location/description/timezone | none | one update; exhausted |
| Calendar delete | same request table ID | `GOOGLECALENDAR_DELETE_EVENT` | target `event_id`, `calendar_id` | none | one delete; exhausted |
| GitHub issue | `software_improvement_tasks.id` | `GITHUB_CREATE_AN_ISSUE` | stored draft `title`, `body`, `labels` | task fields can change, but stored draft has no editor | one issue; exhausted |

Connected account is separately immutable authority. Repository/owner, CC/BCC, attachments, Slack threads/blocks, GitHub assignees/milestones, and recurrence are not current provider arguments and are not invented by this contract.

## Field classification

For Gmail, `recipient_email`, `subject`, and `body` are version-relevant. For Slack, `channel` and `message` are version-relevant. For Calendar, the exact action-specific payload above—including update/delete target identity—is version-relevant. For GitHub, the persisted `github_issue_draft.title/body/labels` snapshot is version-relevant; later edits to source task fields do not mutate that stored provider payload.

Agent/requester, purpose, risk, and approval metadata are governance context. Status, approval queue ID, approving actor/time, rejection/cancellation, and error fields are lifecycle authority/evidence but do not change payload version. Provider IDs, duration, logs, Hermes events, and timestamps are observability/receipts and never version sources.

## Approval, retries, and races

Approval must bind tenant, fixed toolkit/action, exact connected account, request ID, current provider-action version, exact payload snapshot, approval ID, and approving principal. Revocation blocks execution without changing payload version. Reapproval of unchanged payload may retain the version while replacing approval evidence.

A confirmed retryable provider failure keeps request ID and version and creates a new attempt. An uncertain outcome freezes the action; changing the version cannot bypass reconciliation. Immediately before invocation, execution must compare the requested, stored, and approved payload versions and revalidate account/approval authority. Stale V1 cannot execute stored V2.

After confirmed success these families are exhausted. Later content, posts, calendar operations, or issues require a new business request/logical ID. In particular, a Calendar event can receive a later independent update, but that update has a new Calendar request ID. A GitHub task cannot obtain a second issue merely by incrementing its version.

## Transition matrix

| Event | Version | Logical ID |
| --- | --- | --- |
| Provider retry after confirmed retryable failure | same | same |
| Approval revoked/renewed, payload unchanged | same | same |
| Material payload edit before success, if a future editor exists | increment | same |
| Connected-account change before success | increment and reapprove | same intended action |
| Fixed specialized tool/action change | prohibited | new business request if legitimate |
| Confirmed success | terminal | later action uses new ID |
| Uncertain outcome | frozen; bump prohibited | no automatic new action |
| Later independent operation | unrelated | new ID |

## Legacy policy

- Gmail and Slack: `SAFE_INITIAL_VERSION_1`. Rows are insert-only payload snapshots; subsequent writes are lifecycle/receipt/observability fields.
- Calendar: `REQUIRES_DATA_POLICY`. Although writers persist `payload`, it is nullable and approval execution reconstructs arguments from duplicate columns. The reconstruction omits stored duration fields, so equality with the originally queued payload is not universally provable. Only rows with a nonnull snapshot proven equal to execution arguments may be adopted.
- GitHub: `REQUIRES_DATA_POLICY`. Rows with an immutable nonnull `github_issue_draft` snapshot may qualify for version 1 after validation. Rows relying on fallback reconstruction from mutable task fields are ineligible.

No history is fabricated. Ineligible legacy rows remain outside the future canonical ledger until explicit repair/review policy exists.

## Existing runtime gaps and implementation boundary

- None of the four request records stores an explicit version or passes one to the shared executor.
- Approval queue metadata stores arguments but no request-owned version, and specialized approve routes do not validate the queue record or approval version.
- Approval endpoints use ADMIN role as the immediate gate and do not durably bind approving principal/version before invocation (Calendar records approver only after success; Gmail/Slack/GitHub do not store it on the request).
- Current confirmed-failure retries repeat the provider call without canonical action/attempt claiming.
- Calendar queued `payload` can differ from reconstructed execution arguments.
- GitHub source task fields remain editable after draft creation; the stored draft is stable, but legacy null-draft fallback reconstructs from mutable fields.
- Runtime DDL still owns Gmail, Slack, and Calendar request tables and GitHub adjunct columns.

A small prospective field implementation is not cohesive here: it would require formalizing runtime-owned schemas, defining legacy preflight, transactionally binding approval/version, and changing every execution path. Those changes belong in a separately reviewed implementation slice before the provider action/attempt ledger. Migration numbering follows dependency order; no `0017` is created or reserved by this contract.
