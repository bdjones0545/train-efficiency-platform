# Composio Google Sheets logical action identity

## Decision

The current Google Sheets surface is `SHEETS_IDENTITY_CONTRACT_PARTIAL`: the canonical rules are closed, but the sole production mutation caller is `BOTH_MISSING`. The generic executor must not manufacture identity. A future business layer must persist a Sheets mutation request, with a caller-owned ID and positive immutable payload revision, before provider execution.

Canonical identity remains:

`org_id + googlesheets + logical_provider_action_id + provider_action_version`

This document does not create a ledger, migration, provider call, callback, or runtime enforcement path.

## Complete production call graph

Repository-wide search found one mutation entry point and no direct Sheets-specific service, workflow, automation, Hermes, or agent invocation:

`POST /api/composio/execute` (`server/composio-routes.ts`)
→ authenticated COACH/ADMIN tenant resolution (`resolveOrgIdOrThrow`)
→ caller body validated only as agent/tool/action/opaque `inputParams` plus optional `entityId`
→ `requestComposioAction` (`server/composio-action-adapter.ts`)
→ registry permission/action checks and autonomy policy
→ optional generic `autonomous_action_queue` row if policy requires approval, otherwise auto-execution
→ `executeComposioAction` (`server/services/composio-service.ts`)
→ authoritative organization/account resolution under `0016`
→ Composio `/tools/execute/{action}`
→ best-effort `composio_action_log`, timeline, and Hermes observability writes.

The route supplies no logical action ID or action version. `entityId` is a provider entity/account-selection input, not business identity. Adapter `logId`, approval queue ID, action-log ID, and Hermes event ID are generated execution/observability identifiers. They are not stable retry identity. Growth, lead-intake, and CEO-heartbeat agents are permitted to use the toolkit, but no production source directly calls a Sheets mutation for them.

## Registry classification

| Action | Class | Business semantics | Current triggering object | Current status |
|---|---|---|---|---|
| `GOOGLESHEETS_BATCH_GET` | READ_ONLY | Query | Generic HTTP request | Mutation ledger not applicable |
| `GOOGLESHEETS_GET_SPREADSHEET` | READ_ONLY | Query | Generic HTTP request | Mutation ledger not applicable |
| `GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW` | READ_ONLY | Query | Generic HTTP request | Mutation ledger not applicable |
| `GOOGLESHEETS_SHEET_FROM_JSON` | MUTATION | UNKNOWN; may append/import or replace depending opaque arguments | Generic HTTP request only | MISSING |
| `GOOGLESHEETS_UPDATE_SPREADSHEET_ROW` | MUTATION | UNKNOWN; repository does not prove one-shot versus state synchronization | Generic HTTP request only | MISSING |
| `GOOGLESHEETS_CREATE_SPREADSHEET` | MUTATION | ONE_SHOT_EVENT | Generic HTTP request only | MISSING |
| `GOOGLESHEETS_CREATE_GOOGLE_SHEET` | MUTATION | ONE_SHOT_EVENT (worksheet creation by registry naming) | Generic HTTP request only | MISSING |
| `GOOGLESHEETS_CLEAR_VALUES` | MUTATION | ONE_SHOT_EVENT unless a future business owner explicitly defines synchronization | Generic HTTP request only | MISSING |

The server registry is the classification authority. A caller cannot declare an unknown action to be read-only or mutating.

## Durable-object evidence and readiness

The generic HTTP request is ephemeral. No workflow job, export request, automation action, campaign, report, task, scheduler run, persisted Sheets request, or immutable approval revision is linked before invocation. The generic approval row, when policy chooses approval, is created by the adapter and contains mutable opaque input metadata; the auto-executable path has no such row. It is therefore not a universal caller-owned Sheets action identity/version.

| Caller | Operation | Durable business object | Logical ID | Version | Status |
|---|---|---|---|---|---|
| `POST /api/composio/execute` | `SHEET_FROM_JSON` | none | MISSING | MISSING | MISSING |
| `POST /api/composio/execute` | `UPDATE_SPREADSHEET_ROW` | none | MISSING | MISSING | MISSING |
| `POST /api/composio/execute` | `CREATE_SPREADSHEET` | none | MISSING | MISSING | MISSING |
| `POST /api/composio/execute` | `CREATE_GOOGLE_SHEET` | none | MISSING | MISSING | MISSING |
| `POST /api/composio/execute` | `CLEAR_VALUES` | none | MISSING | MISSING | MISSING |

## Business identity, resources, and attempts

A valid logical ID is created before execution, tenant-scoped, stable across retry, unique to one intended mutation, and different for a later legitimate repetition. The smallest future requirement is a persisted business-layer Sheets mutation request with a stable request ID. A later independent append, update, clear, spreadsheet creation, or worksheet creation requires a new request ID.

Provider resources—spreadsheet ID, worksheet ID/title, range, row/column—and values describe authority and target. They do not explain why an operation exists. Two legitimate business requests may target the same spreadsheet and range. Consequently spreadsheet ID, spreadsheet plus range, worksheet plus row, worksheet title, payload hash, timestamp, time bucket, provider receipt, `entityId`, adapter `logId`, or random execution UUID is not logical business identity.

Retries deliberately receive different attempt IDs while retaining the same logical ID/version. The current `crypto.randomUUID()` values are attempt/log/queue/event identifiers only.

## Version and immutable authority

A future upstream request must own a positive safe-integer `provider_action_version`. Unchanged retry retains it. Before confirmed success, any material provider-authority revision increments it. Stale requested versions must be rejected before provider-attempt authorization. Version is not recurrence, attempt count, approval generation, timestamp, physical row state, receipt, or arguments hash.

Because the generic route accepts opaque `inputParams`, exact provider parameter names are not proven locally. For each future caller, every argument actually sent to Composio must be captured in an immutable authority descriptor. The following evidenced dimensions are version-relevant when the chosen action uses them:

- bound server action/tool;
- spreadsheet target;
- worksheet/sheet target or title;
- range or row/column target;
- values or JSON import body;
- create title/name;
- clear target;
- provider modes, formatting, or insertion options actually present in that caller's request.

Changing target or values requires a new version. Observability IDs, timing, duration, logs, Hermes state, retry disposition, and provider receipts are lifecycle fields, not payload authority. Same logical ID/version with another action or connected account is an authority mismatch. An intentional account change requires a new version and renewed authority; account ID does not enter logical identity.

## Operation semantics

- Append/import: retry uses the same ID/version; later independent record/export uses a new ID. Row content is not identity without a proven business uniqueness rule.
- Update: repository intent is UNKNOWN. It must not be assumed idempotent or state-synchronizing. A future owner must declare one-shot request or explicit desired-state generation.
- Clear: still requires canonical identity/version even if repetition appears operationally idempotent.
- Create spreadsheet/worksheet: confirmed success exhausts the request. A version bump cannot create another resource; later creation needs a new logical ID.

## Approval and account policy

The registry sets Sheets `requiresApproval=false`, but the autonomy policy may still return `approval_required`. No-human-approval never means no authority. Every mutation still needs trusted tenant resolution, an `0016`-authorized account, caller-owned logical identity/version, exact immutable authority, and future action/attempt claims. No synthetic approval is introduced. If generic approval is used in future, its principal, ID, scope, payload revision, action, and account must be durably bound.

The same logical ID/version in two organizations produces distinct canonical identities. An organization cannot select another tenant's connection. Platform-owned connections require explicit organization policy.

## Lifecycle semantics and current negative controls

- Confirmed retryable failure: same ID/version, explicitly authorized new attempt.
- Uncertain/in-progress/provider-accepted: reconcile; do not retry. Version bump cannot escape uncertainty.
- Confirmed success: terminal for the logical action across all versions; later work needs a new logical ID.
- Current duplicate race: no pre-provider action claim exists. Two concurrent equivalent generic requests can each invoke the provider.
- Current ordering: tenant/account resolution occurs immediately before provider invocation; only afterward are best-effort log/timeline/Hermes writes attempted.
- Persistence failure after provider success can therefore leave no reliable completion evidence and permit a blind external retry. The existing lifecycle contract classifies this as uncertain; this phase does not implement reconciliation.

## Future eligibility

A future mutating Sheets caller is eligible only with valid organization, canonical `googlesheets`, a known server-side mutation action, tenant-authorized account, nonblank caller-owned durable logical ID, positive safe-integer version, and a complete immutable authority descriptor. Missing identity/version fails closed. Arbitrary `entityId` and generated execution IDs are never fallbacks.

The upstream Sheets business request owns business intent: request ID, organization, requested action, immutable payload revisions, account selection/authority reference, and business approval/cancellation state. The future provider action/attempt ledger exclusively owns canonical claims, attempt authorization/history, invocation-in-progress, provider acceptance, provider terminal outcomes, uncertainty, receipts, and retry gating. An upstream request may project a terminal or uncertain provider outcome for product display or business workflow decisions, but that projection is not execution authority and must not duplicate or replace the ledger lifecycle.

No current mutation caller meets these requirements. No migration is introduced. The upstream request model may consume `0018`; numbering follows actual dependency order. Provider action/attempt ledger work remains later.
