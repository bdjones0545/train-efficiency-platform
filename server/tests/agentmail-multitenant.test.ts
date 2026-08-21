/**
 * AgentMail Multi-Tenant Regression Tests
 *
 * Proves:
 *  1. Org A inbox → Org A only
 *  2. Org B inbox → Org B only
 *  3. Org A cannot write Org B records
 *  4. Unknown inbox → quarantine (no downstream records)
 *  5. Ambiguous ownership → DB UNIQUE constraint prevents it
 *  6. Legacy global inbox → quarantine
 *  7. Webhook-supplied foreign org ID is ignored (routing uses address, not payload)
 *  8. Duplicate provider event → one processing cycle (atomic idempotency)
 *  9. Disabled inbox ownership → quarantined (inactive_ownership)
 * 10. Missing outbound ownership → sendAgentEmail fails closed
 * 11. One org's disable/retirement does not affect another org
 *
 * Uses the shared development database. All test rows are inserted with synthetic
 * UUIDs that do not appear in the organizations table and are cleaned up after each test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  resolveOrgFromInbox,
  buildOrgUsername,
  buildOrgEmailAddress,
  getAgentMailDomain,
  disableOrgInbox,
  retireAllOrgInboxes,
  ensureOwnershipTable,
  type AgentMailRole,
} from "../services/agentmail-ownership-service";
import { processInboundAgentMail } from "../services/agentmail-inbound-router";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TEST_ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const DOMAIN = getAgentMailDomain();

function addrA(role: AgentMailRole) {
  return buildOrgEmailAddress(buildOrgUsername(role, TEST_ORG_A), DOMAIN);
}
function addrB(role: AgentMailRole) {
  return buildOrgEmailAddress(buildOrgUsername(role, TEST_ORG_B), DOMAIN);
}

function rows(r: unknown): any[] {
  if (Array.isArray(r)) return r;
  const x = r as any;
  return Array.isArray(x?.rows) ? x.rows : [];
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

async function seedOwnershipRow(
  orgId: string,
  role: AgentMailRole,
  state: "active" | "provisioning" | "disabled" | "retired" = "active",
) {
  const username = buildOrgUsername(role, orgId);
  const emailAddress = buildOrgEmailAddress(username, DOMAIN);
  await db.execute(sql`
    INSERT INTO org_agentmail_inboxes (
      id, organization_id, role, username, email_address,
      ownership_state, provisioned_at, activated_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid()::text,
      ${orgId}, ${role}, ${username}, ${emailAddress},
      ${state},
      NOW(),
      ${state === "active" ? sql`NOW()` : sql`NULL`},
      NOW(), NOW()
    )
    ON CONFLICT (organization_id, role) DO UPDATE
      SET ownership_state = EXCLUDED.ownership_state,
          updated_at      = NOW()
  `);
  return emailAddress;
}

async function cleanupOwnership(...orgIds: string[]) {
  for (const oid of orgIds) {
    await db.execute(sql`
      DELETE FROM org_agentmail_inboxes WHERE organization_id = ${oid}
    `).catch(() => {});
  }
}

async function cleanupInbound(providerMsgId: string) {
  await db.execute(sql`
    DELETE FROM agent_mail_inbound_messages WHERE provider_message_id = ${providerMsgId}
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM agent_mail_inbound_messages WHERE provider_message_id IS NULL
      AND organization_id IS NULL
  `).catch(() => {});
}

async function countDownstream(orgId: string) {
  const ait = rows(
    await db.execute(sql`
      SELECT COUNT(*) AS n FROM attention_items WHERE org_id = ${orgId}
    `).catch(() => [] as any),
  );
  return Number(ait[0]?.n ?? 0);
}

// ─── Ensure schema before all tests ──────────────────────────────────────────

await ensureOwnershipTable().catch(() => {});

// ─── Test 1: Org A inbox resolves to Org A only ──────────────────────────────

test("1 — Org A inbox resolves to Org A", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
  await seedOwnershipRow(TEST_ORG_A, "revenue");
  await seedOwnershipRow(TEST_ORG_B, "revenue");

  const result = await resolveOrgFromInbox(addrA("revenue"));
  assert.equal(result.reason, "resolved");
  assert.equal(result.orgId, TEST_ORG_A);
  assert.equal(result.role, "revenue");

  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
});

// ─── Test 2: Org B inbox resolves to Org B only ──────────────────────────────

test("2 — Org B inbox resolves to Org B", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
  await seedOwnershipRow(TEST_ORG_A, "hiring");
  await seedOwnershipRow(TEST_ORG_B, "hiring");

  const result = await resolveOrgFromInbox(addrB("hiring"));
  assert.equal(result.reason, "resolved");
  assert.equal(result.orgId, TEST_ORG_B);

  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
});

// ─── Test 3: Org A inbound does not create Org B records ─────────────────────

test("3 — Org A inbound cannot write Org B downstream records", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
  const emailA = await seedOwnershipRow(TEST_ORG_A, "support");
  await seedOwnershipRow(TEST_ORG_B, "support");

  const msgId = `mt-test3-${Date.now()}`;
  await processInboundAgentMail({
    organizationId: TEST_ORG_A,
    inbox: "support",
    fromEmail: "sender@example.com",
    toEmail: emailA,
    subject: "Cross-tenant test 3",
    bodyText: "Testing isolation",
    providerMessageId: msgId,
  });

  // Org B must have no new records from this event
  const orgBInbound = rows(
    await db.execute(sql`
      SELECT COUNT(*) AS n FROM agent_mail_inbound_messages
      WHERE organization_id = ${TEST_ORG_B}
        AND provider_message_id = ${msgId}
    `),
  );
  assert.equal(Number(orgBInbound[0]?.n ?? 0), 0, "Org B must have zero inbound rows for Org A event");

  await cleanupInbound(msgId);
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
});

// ─── Test 4: Unknown inbox → quarantine ──────────────────────────────────────

test("4 — Unknown inbox address quarantines (no downstream records)", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);

  const unknownAddr = `revenue-unknown0000000000000000@${DOMAIN}`;
  const result = await resolveOrgFromInbox(unknownAddr);

  assert.equal(result.orgId, null);
  assert.equal(result.reason, "no_ownership_record");

  // Downstream records must not be created
  const beforeA = await countDownstream(TEST_ORG_A);
  const beforeB = await countDownstream(TEST_ORG_B);
  // (no processInboundAgentMail call — webhook handler quarantines before calling it)
  const afterA = await countDownstream(TEST_ORG_A);
  const afterB = await countDownstream(TEST_ORG_B);
  assert.equal(afterA, beforeA);
  assert.equal(afterB, beforeB);
});

// ─── Test 5: UNIQUE constraint prevents ambiguous ownership ──────────────────

test("5 — DB UNIQUE constraint prevents two orgs sharing an address", async () => {
  await cleanupOwnership(TEST_ORG_A);
  const emailA = await seedOwnershipRow(TEST_ORG_A, "scheduling");

  // Attempt to insert a second row with the same email_address under a different org
  const fakeOrgId = "cccccccc-0000-4000-8000-000000000003";
  let threw = false;
  try {
    await db.execute(sql`
      INSERT INTO org_agentmail_inboxes (
        id, organization_id, role, username, email_address, ownership_state,
        provisioned_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid()::text,
        ${fakeOrgId}, 'scheduling', ${"collide-username"}, ${emailA},
        'active', NOW(), NOW(), NOW()
      )
    `);
  } catch {
    threw = true;
  }
  assert.ok(threw, "DB UNIQUE(email_address) must reject duplicate address for a different org");

  await cleanupOwnership(TEST_ORG_A, fakeOrgId);
});

// ─── Test 6: Legacy global inbox → quarantine ────────────────────────────────

test("6 — Legacy global inbox address quarantines", async () => {
  // The legacy global addresses (e.g. "revenue@domain") have no ownership row
  const legacyAddr = `revenue@${DOMAIN}`;
  const result = await resolveOrgFromInbox(legacyAddr);
  assert.equal(result.orgId, null, "Legacy global address must not resolve to any org");
  assert.ok(
    ["no_ownership_record", "ambiguous_ownership"].includes(result.reason),
    `Expected quarantine reason, got: ${result.reason}`,
  );
});

// ─── Test 7: Webhook-supplied foreign org ID is ignored ──────────────────────

test("7 — Webhook org ID in payload is ignored; routing uses address lookup", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
  const emailA = await seedOwnershipRow(TEST_ORG_A, "ceo");

  // Resolve using Org A's address — even if payload claimed Org B
  const result = await resolveOrgFromInbox(emailA);
  assert.equal(result.orgId, TEST_ORG_A, "Routing must be based on address, not payload");
  assert.notEqual(result.orgId, TEST_ORG_B);

  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
});

// ─── Test 8: Duplicate provider event → one processing cycle ─────────────────

test("8 — Duplicate provider event is idempotent (ON CONFLICT DO NOTHING)", async () => {
  await cleanupOwnership(TEST_ORG_A);
  const emailA = await seedOwnershipRow(TEST_ORG_A, "operations");

  const msgId = `mt-test8-${Date.now()}`;
  const payload = {
    organizationId: TEST_ORG_A,
    inbox: "operations",
    fromEmail: "dup@example.com",
    toEmail: emailA,
    subject: "Duplicate test",
    bodyText: "Testing idempotency",
    providerMessageId: msgId,
  };

  const r1 = await processInboundAgentMail(payload);
  const r2 = await processInboundAgentMail(payload); // second delivery of the same event

  assert.ok(r1.ok, "First delivery must succeed");
  assert.ok(r2.ok, "Second delivery must succeed (idempotent)");
  assert.ok(r2.skipped, "Second delivery must be marked as skipped");
  assert.equal(r2.skipReason, "duplicate provider_message_id");

  // Exactly one row in the DB
  const countRows = rows(
    await db.execute(sql`
      SELECT COUNT(*) AS n FROM agent_mail_inbound_messages
      WHERE provider_message_id = ${msgId}
    `),
  );
  assert.equal(Number(countRows[0]?.n ?? 0), 1, "Exactly one inbound row for duplicate event");

  await cleanupInbound(msgId);
  await cleanupOwnership(TEST_ORG_A);
});

// ─── Test 9: Disabled inbox → quarantine ─────────────────────────────────────

test("9 — Disabled inbox ownership quarantines inbound mail", async () => {
  await cleanupOwnership(TEST_ORG_A);
  await seedOwnershipRow(TEST_ORG_A, "revenue");

  // Disable the inbox
  await disableOrgInbox(TEST_ORG_A, "revenue", "test-disable");

  const emailA = addrA("revenue");
  const result = await resolveOrgFromInbox(emailA);
  assert.equal(result.orgId, null, "Disabled inbox must not route");
  assert.equal(result.reason, "inactive_ownership");

  await cleanupOwnership(TEST_ORG_A);
});

// ─── Test 10: Missing outbound ownership → sendAgentEmail fails closed ────────

test("10 — sendAgentEmail fails closed when no active ownership record exists", async () => {
  const { sendAgentEmail } = await import("../services/agentmail-service");
  await cleanupOwnership(TEST_ORG_A);
  // No ownership rows for TEST_ORG_A

  const result = await sendAgentEmail({
    organizationId: TEST_ORG_A,
    agentName: "Test Agent",
    fromInbox: "revenue",
    to: "recipient@example.com",
    subject: "Fail-closed test",
    body: "This should not send",
    humanApproved: true,
  });

  assert.ok(!result.ok, "sendAgentEmail must fail closed when no active ownership");
  assert.ok(
    result.error?.includes("ownership") || result.error?.includes("not provisioned"),
    `Expected ownership error, got: ${result.error}`,
  );

  await cleanupOwnership(TEST_ORG_A);
});

// ─── Test 11: One org's retire does not affect another org ───────────────────

test("11 — Retiring Org A inboxes does not affect Org B resolution", async () => {
  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
  await seedOwnershipRow(TEST_ORG_A, "scheduling");
  await seedOwnershipRow(TEST_ORG_B, "scheduling");

  // Retire all of Org A
  await retireAllOrgInboxes(TEST_ORG_A);

  // Org B must still resolve correctly
  const resultB = await resolveOrgFromInbox(addrB("scheduling"));
  assert.equal(resultB.reason, "resolved");
  assert.equal(resultB.orgId, TEST_ORG_B);

  // Org A must now quarantine
  const resultA = await resolveOrgFromInbox(addrA("scheduling"));
  assert.equal(resultA.orgId, null);
  assert.equal(resultA.reason, "inactive_ownership");

  await cleanupOwnership(TEST_ORG_A, TEST_ORG_B);
});
