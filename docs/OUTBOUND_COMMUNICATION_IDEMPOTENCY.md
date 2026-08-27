# Outbound Communication Idempotency

## APPROVED PRODUCT CONTRACT

### Common envelope and send classes

Every idempotent outbound business communication must receive an explicit, nonblank, caller-supplied `logicalSendId`. It is tenant-scoped, is created upstream before provider execution, stays stable across retries of one intended communication, and changes for a later legitimate communication. The send layer must never synthesize it from timestamps or randomness, derive it from a provider message ID, or replace it with recipient/time-bucket fingerprinting.

The canonical send classes are `transactional`, `human_approved`, `automated_outreach`, and `direct_agent`. The common logical identity is:

`org_id + send_class + logical_send_id`

A real tenant is mandatory; blank, default, global, unknown, or otherwise synthetic tenant identities fail closed.

### Human-approved identity and payload version

Human-approved sends additionally bind:

`org_id + authority_type + authority_id + logical_send_id + approved_payload_version`

`authority_type` is required because IDs from the AgentMail reply queue, Gmail actions, and future authority tables may occupy overlapping ID domains. Existing durable approval objects must be reused rather than replaced.

`approvedPayloadVersion` is an explicit, stable, caller-supplied version or digest of the exact approval-controlled payload. This contract does not invent an automatic content hash. Any future digest scheme must first define canonical serialization and align it with the approval system.

For AgentMail replies, the approval-controlled representation must cover the recipient, subject, selected body (edited body when present, otherwise draft body), sending inbox/agent account, provider inbound message/thread context, and attachment descriptors if attachments are introduced. Today the flow has no attachment input. For Gmail actions, it must cover recipient, subject, approved draft body, Gmail thread/account context, and attachment descriptors if supported.

The same approved payload and retry retain one human-approved identity. Authority-relevant edits after approval are not authorized by the old version. Reapproval produces a new approved version and may proceed under the applicable logical-send policy; whether it also represents a new `logicalSendId` depends on whether the product intends a retry of the same communication or a later communication.

### Provider attempts, lifecycle, and crash window

Provider-attempt identity is subordinate to logical business-send identity. A logical send exists before an attempt. A failed attempt does not create a new logical send, and another attempt is allowed only when class retry policy permits. Provider IDs are receipts attached to attempts, never pre-send identity.

The future durable lifecycle must represent these concepts, without requiring every existing subsystem to adopt these exact labels:

- claimed/authorized to attempt
- provider attempt in progress
- provider confirmed success
- provider confirmed failure
- uncertain/unknown provider outcome
- suppressed/blocked

A claim with no provider call may resume according to policy. Confirmed failure may be retried according to class policy. Durable confirmed success suppresses retry. If the provider may have succeeded but the local result is uncertain, the send becomes `uncertain_provider_outcome`; blind retry is prohibited until provider reconciliation or explicit human/system resolution.

This is not a universal exactly-once delivery claim. External-provider crash windows make that promise unavailable without provider reconciliation guarantees.

### Fail-closed composition

The future ordering is:

1. authenticate and resolve a real tenant
2. verify approval and approved payload version when required
3. verify existing suppression authorities
4. verify outbound audit/idempotency schema readiness
5. durably claim the logical send
6. create/execute the provider attempt
7. durably record the provider result

If tenant identity, approval binding, suppression state, audit schema, or the durable logical-send claim cannot be verified or persisted, the provider must not be called.

The new plane composes with, and does not replace, emergency pause, opt-out state, notification preferences, daily caps, AgentMail autonomous-send policy, approval/reply state, follow-up effect authority, or Attendance report history.

## CURRENT RUNTIME BEHAVIOR

### AgentMail human-approved replies

`agent_mail_reply_queue` is the existing durable, tenant-scoped authority object; its row ID is available in the authenticated approve and send routes. Approval principal is persisted as `approved_by`. The approved content is the row's recipient, subject, selected draft/edited body, inbox/agent sender, inbound provider message ID, and thread ID.

The current approve route records approval but no immutable payload version. The edit route can still change `edited_body` after approval, so current approval is not cryptographically or structurally bound to the later payload. The send route performs a tenant-scoped pre-read, rejects `status === 'sent'`, and requires `approval_status === 'approved'`, then passes message fields to `replyFromAgentInbox` or `sendAgentEmail`. It does not propagate the reply queue ID, a logical send ID, or an approved payload version into the provider service. The provider receipt is returned as `messageId` and persisted only after the provider call. A crash in that window can cause an unrecorded successful send and later resend.

This is the cleanest first implementation slice because it has one narrow route, a formal durable reply authority, explicit human approval, tenant scoping, and a provider boundary. Its missing propagation and crash safety are precisely bounded.

### Gmail human-approved actions

`gmail_agent_actions.id` is a durable, tenant-scoped action authority. Approval principal is persisted in `approved_by`; subject, recipient, body/result, and Gmail thread are present. The edit-and-approve route changes the action payload and approves it together, but there is no explicit approved payload version or logical-send ID. Gmail execution appears in multiple routes/bulk paths, and current provider idempotency material is attempt-time based rather than stable business identity. Gmail is viable later, but its broader execution surface makes it a larger first slice than AgentMail replies.

### Legacy fingerprint and fail-open behavior

The current generic SendGrid recipient/type/time-bucket fingerprint is:

**LEGACY HEURISTIC — NOT CANONICAL BUSINESS IDENTITY**

It omits tenant identity from its hash and is unsafe as cross-tenant authority. It remains unchanged in this contract phase.

Current behaviors that future implementation must prohibit include audit/readiness failure being treated as allowed, suppression lookup failure being treated as not suppressed, fingerprint/claim failure allowing provider execution, and audit-write failure still returning sent success. They are documented here, not changed by this contract commit.

## FUTURE IMPLEMENTATION REQUIREMENTS

The first implementation slice is **AGENTMAIL HUMAN-APPROVED SENDS FIRST**. It must remain limited to AgentMail reply-queue sends and must:

- introduce formal durable schema authority through a separately reviewed migration
- accept an upstream stable `logicalSendId`
- persist and validate an explicit approved payload version
- prevent post-approval payload mutation from using the old approval
- propagate tenant, reply queue authority, logical send identity, and payload version to the send boundary
- claim atomically before provider execution and record provider attempts separately
- fail closed before provider execution when authority, suppression, schema, or claim checks fail
- record uncertain outcome and block blind retry across the provider/local-commit crash window
- preserve all existing suppression and AgentMail policy authorities

Gmail, transactional SendGrid, automated outreach/follow-ups, and direct-agent sends are separate implementation slices. They must not be silently unified merely because they share this envelope.

Existing outbound audit rows generally cannot be assigned trustworthy canonical logical-send IDs retroactively. A future migration must distinguish historical observability from new canonical logical-send authority, preserve history, and never fabricate IDs for legacy rows.

No production send behavior, provider call, runtime DDL, or database schema is changed by this contract.
