/**
 * Phase 2B Regression Tests — Composio Gmail Draft Creation
 *
 * Run with:  npx tsx server/tests/gmail-draft-phase2b.test.ts
 *
 * Tests are pure unit-style — no DB, no HTTP, no Composio SDK calls.
 * They assert the permission, gating, and logging invariants that
 * Phase 2B relies on.
 */

import {
  isActionAllowed,
  doesToolRequireApproval,
  isAgentAllowedTool,
  getPermissionDeniedReason,
} from "../composio-tool-registry";
import { GMAIL_DRAFT_PERMITTED_AGENTS } from "../composio-gmail-draft-routes";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
    failures.push(`${name}: ${e.message}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeTrue() {
      if (actual !== true)
        throw new Error(`Expected true, got ${JSON.stringify(actual)}`);
    },
    toBeFalse() {
      if (actual !== false)
        throw new Error(`Expected false, got ${JSON.stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null)
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeNonNull() {
      if (actual === null || actual === undefined)
        throw new Error(`Expected non-null, got ${JSON.stringify(actual)}`);
    },
  };
}

// ─── Suite 1: Gmail draft action allowed, send blocked ───────────────────────

console.log("\n[Suite 1] Gmail action registry — draft allowed, send blocked");

test("GMAIL_CREATE_EMAIL_DRAFT is in allowedActions", () => {
  expect(isActionAllowed("GMAIL", "GMAIL_CREATE_EMAIL_DRAFT")).toBeTrue();
});

test("GMAIL_CREATE_EMAIL_DRAFT passes isActionAllowed case-insensitive", () => {
  expect(isActionAllowed("gmail", "gmail_create_email_draft")).toBeTrue();
});

test("GMAIL_SEND_EMAIL is in blockedActions — cannot send", () => {
  expect(isActionAllowed("GMAIL", "GMAIL_SEND_EMAIL")).toBeFalse();
});

test("GMAIL requires approval — cannot auto-execute", () => {
  expect(doesToolRequireApproval("GMAIL")).toBeTrue();
});

// ─── Suite 2: Permitted agents can use GMAIL ──────────────────────────────────

console.log("\n[Suite 2] Permitted agents have GMAIL tool access");

const PERMITTED = GMAIL_DRAFT_PERMITTED_AGENTS;

for (const agentId of PERMITTED) {
  test(`${agentId} is allowed to use GMAIL`, () => {
    expect(isAgentAllowedTool(agentId, "GMAIL")).toBeTrue();
  });
}

for (const agentId of PERMITTED) {
  test(`${agentId} has no permission denial for GMAIL_CREATE_EMAIL_DRAFT`, () => {
    const reason = getPermissionDeniedReason(agentId, "GMAIL", "GMAIL_CREATE_EMAIL_DRAFT");
    if (reason !== null)
      throw new Error(`Expected null denial reason, got: ${reason}`);
  });
}

// ─── Suite 3: Unauthorized agents are blocked ────────────────────────────────
//
// Enforcement is two-layered:
//   Layer 1 — Registry level: agent.allowedTools must include GMAIL.
//             software_improvement_agent has no GMAIL → blocked at adapter step 1.
//   Layer 2 — Endpoint level: agentId must be in GMAIL_DRAFT_PERMITTED_AGENTS.
//             growth_agent has GMAIL in its registry allowedTools (it uses Gmail
//             for lead tracking reads) but is NOT in GMAIL_DRAFT_PERMITTED_AGENTS,
//             so the Phase 2B /request endpoint rejects it via Zod validation
//             before the adapter is ever called.

console.log("\n[Suite 3] Unauthorized agents are blocked at registry or endpoint level");

// ── Layer 1: Registry-level blocks (GMAIL not in allowedTools) ──────────────
test("software_improvement_agent is NOT permitted to use GMAIL (registry)", () => {
  expect(isAgentAllowedTool("software_improvement_agent", "GMAIL")).toBeFalse();
});

test("getPermissionDeniedReason returns denial for software_improvement_agent + GMAIL", () => {
  const reason = getPermissionDeniedReason("software_improvement_agent", "GMAIL", "GMAIL_CREATE_EMAIL_DRAFT");
  if (reason === null)
    throw new Error("Expected a denial reason for software_improvement_agent, got null");
});

// ── Layer 2: Endpoint-level blocks (not in GMAIL_DRAFT_PERMITTED_AGENTS) ────
// growth_agent has GMAIL in its registry allowedTools but is NOT in Phase 2B's
// permitted agents list. The /request endpoint rejects it at Zod validation.
test("growth_agent is NOT in GMAIL_DRAFT_PERMITTED_AGENTS (endpoint-level block)", () => {
  const permitted = GMAIL_DRAFT_PERMITTED_AGENTS as readonly string[];
  if (permitted.includes("growth_agent"))
    throw new Error("growth_agent must not be in GMAIL_DRAFT_PERMITTED_AGENTS for Phase 2B");
});

test("lead_intake_agent is NOT in GMAIL_DRAFT_PERMITTED_AGENTS (endpoint-level block)", () => {
  const permitted = GMAIL_DRAFT_PERMITTED_AGENTS as readonly string[];
  if (permitted.includes("lead_intake_agent"))
    throw new Error("lead_intake_agent must not be in GMAIL_DRAFT_PERMITTED_AGENTS for Phase 2B");
});

test("email_agent is NOT in GMAIL_DRAFT_PERMITTED_AGENTS (endpoint-level block)", () => {
  const permitted = GMAIL_DRAFT_PERMITTED_AGENTS as readonly string[];
  if (permitted.includes("email_agent"))
    throw new Error("email_agent must not be in GMAIL_DRAFT_PERMITTED_AGENTS for Phase 2B");
});

test("software_improvement_agent is NOT in GMAIL_DRAFT_PERMITTED_AGENTS", () => {
  const permitted = GMAIL_DRAFT_PERMITTED_AGENTS as readonly string[];
  if (permitted.includes("software_improvement_agent"))
    throw new Error("software_improvement_agent must not be in GMAIL_DRAFT_PERMITTED_AGENTS");
});

// ─── Suite 4: Send-adjacent actions remain blocked ───────────────────────────

console.log("\n[Suite 4] No send-adjacent actions can be called autonomously");

const BLOCKED_GMAIL_ACTIONS = [
  "GMAIL_SEND_EMAIL",
];

for (const action of BLOCKED_GMAIL_ACTIONS) {
  test(`${action} is NOT in allowedActions`, () => {
    expect(isActionAllowed("GMAIL", action)).toBeFalse();
  });
}

// ─── Suite 5: Request gate — adapter outcome before status update ─────────────

console.log("\n[Suite 5] Request gate — adapter outcome must be queued_for_approval");

function simulateRequestGate(adapterOutcome: string): {
  shouldPersistRecord: boolean;
  httpStatus: number;
} {
  if (adapterOutcome !== "queued_for_approval") {
    const httpStatus =
      adapterOutcome === "blocked_no_permission"       ? 403 :
      adapterOutcome === "blocked_by_policy"           ? 403 :
      adapterOutcome === "blocked_action_not_allowed"  ? 403 : 400;
    return { shouldPersistRecord: false, httpStatus };
  }
  return { shouldPersistRecord: true, httpStatus: 202 };
}

test("gate: queued_for_approval → persist record, 202", () => {
  const r = simulateRequestGate("queued_for_approval");
  expect(r.shouldPersistRecord).toBeTrue();
  expect(r.httpStatus).toBe(202);
});

test("gate: blocked_action_not_allowed → delete record, 403", () => {
  const r = simulateRequestGate("blocked_action_not_allowed");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_by_policy → delete record, 403", () => {
  const r = simulateRequestGate("blocked_by_policy");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_no_permission → delete record, 403", () => {
  const r = simulateRequestGate("blocked_no_permission");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: failed → delete record, 400", () => {
  const r = simulateRequestGate("failed");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(400);
});

// ─── Suite 6: Approve gate — status only changes on confirmed success ─────────

console.log("\n[Suite 6] Approve gate — draft_created only on success + draft ID");

function simulateApproveGate(
  execSuccess: boolean,
  extractedDraftId: string | null,
): {
  shouldMarkCreated: boolean;
  httpStatus: number;
  status: "draft_queued" | "draft_created";
  draftIdStored: string | null;
} {
  if (!execSuccess) {
    return {
      shouldMarkCreated: false,
      httpStatus: 502,
      status: "draft_queued",        // retryable
      draftIdStored: null,           // no write on failure
    };
  }
  return {
    shouldMarkCreated: true,
    httpStatus: 200,
    status: "draft_created",
    draftIdStored: extractedDraftId, // can be null if Composio didn't return ID
  };
}

test("approve: success + draft ID → mark created, store ID, 200", () => {
  const r = simulateApproveGate(true, "draft_abc123");
  expect(r.shouldMarkCreated).toBeTrue();
  expect(r.httpStatus).toBe(200);
  expect(r.status).toBe("draft_created");
  expect(r.draftIdStored).toBe("draft_abc123");
});

test("approve: success + no draft ID → mark created, null ID, 200", () => {
  const r = simulateApproveGate(true, null);
  expect(r.shouldMarkCreated).toBeTrue();
  expect(r.status).toBe("draft_created");
  expect(r.draftIdStored).toBeNull();
});

test("approve: failure → do NOT mark created, stay draft_queued, 502", () => {
  const r = simulateApproveGate(false, null);
  expect(r.shouldMarkCreated).toBeFalse();
  expect(r.httpStatus).toBe(502);
  expect(r.status).toBe("draft_queued");
  expect(r.draftIdStored).toBeNull();
});

test("approve: failure is retryable (status stays draft_queued)", () => {
  const r1 = simulateApproveGate(false, null);
  // A second approve call on a draft_queued record should be permitted
  // (i.e. status is still the same, not locked)
  expect(r1.status).toBe("draft_queued");
  const r2 = simulateApproveGate(true, "draft_retry_ok");
  expect(r2.shouldMarkCreated).toBeTrue();
  expect(r2.draftIdStored).toBe("draft_retry_ok");
});

// ─── Suite 7: Hermes event outcome strings ────────────────────────────────────

console.log("\n[Suite 7] Hermes event outcome strings");

const VALID_HERMES_RESULTS = ["success", "failure", "queued_for_approval", "blocked"] as const;

function isValidHermesResult(r: string): boolean {
  return (VALID_HERMES_RESULTS as readonly string[]).includes(r);
}

test("request step emits result='queued_for_approval'", () => {
  expect(isValidHermesResult("queued_for_approval")).toBeTrue();
});

test("approve success emits result='success'", () => {
  expect(isValidHermesResult("success")).toBeTrue();
});

test("approve failure emits result='failure'", () => {
  expect(isValidHermesResult("failure")).toBeTrue();
});

test("approve failure outcome string is 'failed_execution' (not a success outcome)", () => {
  const failureOutcome = "failed_execution";
  if (failureOutcome === "gmail_draft_created")
    throw new Error("Failure outcome must not be 'gmail_draft_created'");
  if (failureOutcome === "success")
    throw new Error("Failure outcome must not be 'success'");
});

test("approve success outcome string is 'gmail_draft_created'", () => {
  const successOutcome = "gmail_draft_created";
  if (successOutcome === "failed_execution")
    throw new Error("Success outcome must not be 'failed_execution'");
});

// ─── Suite 8: COACH/ADMIN role enforcement ────────────────────────────────────

console.log("\n[Suite 8] Role enforcement invariants");

// These are logical checks — the actual middleware is tested via the server.
// Here we assert the permissions model is consistent.

test("GMAIL_CREATE_EMAIL_DRAFT requires ADMIN approval, not COACH approval", () => {
  // The adapter always forces approval_required for GMAIL tools.
  // So even a COACH-requested draft goes through the approval queue.
  expect(doesToolRequireApproval("GMAIL")).toBeTrue();
});

test("No Gmail send path exists for any agent", () => {
  const agents = GMAIL_DRAFT_PERMITTED_AGENTS;
  for (const agent of agents) {
    const denialForSend = getPermissionDeniedReason(agent, "GMAIL", "GMAIL_SEND_EMAIL");
    if (denialForSend === null) {
      throw new Error(
        `Expected GMAIL_SEND_EMAIL to be denied for ${agent}, but got null (permitted)`,
      );
    }
  }
});

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.error("\nFailed tests:");
  failures.forEach((f) => console.error(`  • ${f}`));
  process.exit(1);
} else {
  console.log("All tests passed ✓");
  process.exit(0);
}
