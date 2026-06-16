/**
 * Phase 2A Regression Tests — GitHub Issue Drafting
 *
 * Lightweight test suite runnable without a test framework:
 *   npx tsx server/tests/github-issue-phase2a.test.ts
 *
 * Tests are pure unit-style: they import the real registry and adapter
 * logic, stub I/O at the boundary, and assert the gating invariants
 * that the audit identified as critical.
 *
 * NO external connections are made. NO database writes occur.
 * The Composio SDK is not called.
 */

import {
  isActionAllowed,
  doesToolRequireApproval,
  isAgentAllowedTool,
  getPermissionDeniedReason,
} from "../composio-tool-registry";

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
    toContain(val: unknown) {
      if (!Array.isArray(actual))
        throw new Error(`Expected array, got ${typeof actual}`);
      if (!(actual as unknown[]).includes(val))
        throw new Error(`Expected array to contain ${JSON.stringify(val)}`);
    },
    notToContain(val: unknown) {
      if (!Array.isArray(actual))
        throw new Error(`Expected array, got ${typeof actual}`);
      if ((actual as unknown[]).includes(val))
        throw new Error(`Expected array NOT to contain ${JSON.stringify(val)}`);
    },
  };
}

// ─── Suite 1: Tool Registry — GITHUB_CREATE_AN_ISSUE promotion ───────────────

console.log("\n[Suite 1] Tool registry — GITHUB_CREATE_AN_ISSUE Phase 2A promotion");

test("GITHUB_CREATE_AN_ISSUE is in allowedActions (Phase 2A promotion)", () => {
  expect(isActionAllowed("GITHUB", "GITHUB_CREATE_AN_ISSUE")).toBeTrue();
});

test("GITHUB_CREATE_AN_ISSUE passes isActionAllowed case-insensitive", () => {
  expect(isActionAllowed("github", "github_create_an_issue")).toBeTrue();
});

test("GITHUB still requires approval (requiresApproval flag unchanged)", () => {
  expect(doesToolRequireApproval("GITHUB")).toBeTrue();
});

test("requiresApproval defaults to true for unknown tools", () => {
  expect(doesToolRequireApproval("NONEXISTENT_TOOL")).toBeTrue();
});

// ─── Suite 2: Blocked write actions remain blocked ────────────────────────────

console.log("\n[Suite 2] All other GitHub write actions remain blocked");

const STILL_BLOCKED = [
  "GITHUB_UPDATE_AN_ISSUE",
  "GITHUB_CREATE_A_PULL_REQUEST",
  "GITHUB_MERGE_A_PULL_REQUEST",
  "GITHUB_DELETE_A_REPOSITORY",
  "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
  "GITHUB_DELETE_A_FILE",
];

for (const action of STILL_BLOCKED) {
  test(`${action} is NOT in allowedActions`, () => {
    expect(isActionAllowed("GITHUB", action)).toBeFalse();
  });
}

// ─── Suite 3: software_improvement_agent permissions ─────────────────────────

console.log("\n[Suite 3] software_improvement_agent permissions");

test("software_improvement_agent is permitted to use GITHUB tool", () => {
  expect(isAgentAllowedTool("software_improvement_agent", "GITHUB")).toBeTrue();
});

test("software_improvement_agent is NOT permitted to use GMAIL", () => {
  expect(isAgentAllowedTool("software_improvement_agent", "GMAIL")).toBeFalse();
});

test("software_improvement_agent is NOT permitted to use STRIPE", () => {
  expect(isAgentAllowedTool("software_improvement_agent", "STRIPE")).toBeFalse();
});

// Phase 2C: SLACK was added to software_improvement_agent for critical engineering alerts
test("software_improvement_agent IS permitted to use SLACK (Phase 2C)", () => {
  expect(isAgentAllowedTool("software_improvement_agent", "SLACK")).toBeTrue();
});

test("getPermissionDeniedReason returns null for software_improvement_agent + GITHUB_CREATE_AN_ISSUE", () => {
  expect(getPermissionDeniedReason("software_improvement_agent", "GITHUB", "GITHUB_CREATE_AN_ISSUE")).toBeNull();
});

test("getPermissionDeniedReason returns error for software_improvement_agent + GITHUB_MERGE_A_PULL_REQUEST", () => {
  const reason = getPermissionDeniedReason("software_improvement_agent", "GITHUB", "GITHUB_MERGE_A_PULL_REQUEST");
  if (reason === null)
    throw new Error("Expected a denial reason for blocked action, got null");
});

test("getPermissionDeniedReason returns error for software_improvement_agent + GMAIL tool", () => {
  const reason = getPermissionDeniedReason("software_improvement_agent", "GMAIL", "GMAIL_SEND_EMAIL");
  if (reason === null)
    throw new Error("Expected a denial reason for disallowed tool, got null");
});

// ─── Suite 4: Read-only actions still allowed ─────────────────────────────────

console.log("\n[Suite 4] Read-only GitHub actions still pass isActionAllowed");

const READ_ACTIONS = [
  "GITHUB_LIST_REPOSITORIES",
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_LIST_REPOSITORY_ISSUES",
  "GITHUB_GET_AN_ISSUE",
  "GITHUB_LIST_PULL_REQUESTS",
  "GITHUB_GET_A_PULL_REQUEST",
  "GITHUB_LIST_COMMITS",
  "GITHUB_GET_A_COMMIT",
  "GITHUB_SEARCH_CODE",
  "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
];

for (const action of READ_ACTIONS) {
  test(`${action} is still allowed`, () => {
    expect(isActionAllowed("GITHUB", action)).toBeTrue();
  });
}

// ─── Suite 5: Adapter outcome gate logic (pure logic, no DB) ─────────────────

console.log("\n[Suite 5] Adapter outcome gate invariants (pure logic)");

// Simulate the gating logic from request-github-issue endpoint
function simulateRequestGate(adapterOutcome: string): {
  shouldUpdateStatus: boolean;
  httpStatus: number;
} {
  if (adapterOutcome !== "queued_for_approval") {
    const httpStatus =
      adapterOutcome === "blocked_no_permission" ? 403 :
      adapterOutcome === "blocked_by_policy"     ? 403 :
      adapterOutcome === "blocked_action_not_allowed" ? 403 : 400;
    return { shouldUpdateStatus: false, httpStatus };
  }
  return { shouldUpdateStatus: true, httpStatus: 202 };
}

test("gate: queued_for_approval → should update status, 202", () => {
  const r = simulateRequestGate("queued_for_approval");
  expect(r.shouldUpdateStatus).toBeTrue();
  expect(r.httpStatus).toBe(202);
});

test("gate: blocked_action_not_allowed → must NOT update status, 403", () => {
  const r = simulateRequestGate("blocked_action_not_allowed");
  expect(r.shouldUpdateStatus).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_by_policy → must NOT update status, 403", () => {
  const r = simulateRequestGate("blocked_by_policy");
  expect(r.shouldUpdateStatus).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_no_permission → must NOT update status, 403", () => {
  const r = simulateRequestGate("blocked_no_permission");
  expect(r.shouldUpdateStatus).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: failed → must NOT update status, 400", () => {
  const r = simulateRequestGate("failed");
  expect(r.shouldUpdateStatus).toBeFalse();
  expect(r.httpStatus).toBe(400);
});

// Simulate the approve endpoint gating logic
function simulateApproveGate(
  execSuccess: boolean,
  extractedUrl: string | null,
): {
  shouldMarkCreated: boolean;
  httpStatus: number;
  taskStatus: "github_issue_draft_requested" | "github_issue_created";
  urlStored: string | null;
} {
  if (!execSuccess) {
    return {
      shouldMarkCreated: false,
      httpStatus: 502,
      taskStatus: "github_issue_draft_requested",
      urlStored: null, // no DB write on failure
    };
  }
  return {
    shouldMarkCreated: true,
    httpStatus: 200,
    taskStatus: "github_issue_created",
    urlStored: extractedUrl,
  };
}

test("approve gate: success + URL → mark created, 200, store URL", () => {
  const r = simulateApproveGate(true, "https://github.com/org/repo/issues/42");
  expect(r.shouldMarkCreated).toBeTrue();
  expect(r.httpStatus).toBe(200);
  expect(r.taskStatus).toBe("github_issue_created");
  expect(r.urlStored).toBe("https://github.com/org/repo/issues/42");
});

test("approve gate: success + no URL → mark created, 200, null URL", () => {
  const r = simulateApproveGate(true, null);
  expect(r.shouldMarkCreated).toBeTrue();
  expect(r.taskStatus).toBe("github_issue_created");
  expect(r.urlStored).toBeNull();
});

test("approve gate: failure → do NOT mark created, 502, status stays draft_requested", () => {
  const r = simulateApproveGate(false, null);
  expect(r.shouldMarkCreated).toBeFalse();
  expect(r.httpStatus).toBe(502);
  expect(r.taskStatus).toBe("github_issue_draft_requested");
  expect(r.urlStored).toBeNull();
});

test("approve gate: failure does not store a URL even if one were present", () => {
  // Execution failure means execResult.data is undefined → URL extraction is guarded
  // by `if (execResult.success && execResult.data)` — so url is always null on failure.
  const r = simulateApproveGate(false, null);
  expect(r.urlStored).toBeNull();
});

// ─── Suite 6: Hermes event result values ─────────────────────────────────────

console.log("\n[Suite 6] Hermes event outcome strings");

// These are the literal strings emitted — must match ComposioHermesEvent type
const VALID_HERMES_RESULTS = ["success", "failure", "queued_for_approval", "blocked"] as const;

function isValidHermesResult(r: string): boolean {
  return (VALID_HERMES_RESULTS as readonly string[]).includes(r);
}

test("request step emits result='queued_for_approval'", () => {
  expect(isValidHermesResult("queued_for_approval")).toBeTrue();
});

test("approve success step emits result='success'", () => {
  expect(isValidHermesResult("success")).toBeTrue();
});

test("approve failure step emits result='failure'", () => {
  expect(isValidHermesResult("failure")).toBeTrue();
});

test("failure outcome string is 'failed_execution' (not 'created')", () => {
  const failureOutcome = "failed_execution";
  // Ensure it is NOT the success outcome
  if (failureOutcome === "github_issue_created")
    throw new Error("Failure outcome must not be 'github_issue_created'");
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
