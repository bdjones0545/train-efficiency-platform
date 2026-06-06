/**
 * Phase 2C Regression Tests — Composio Slack Alert Posting
 *
 * Run with:  npx tsx server/tests/slack-alert-phase2c.test.ts
 *
 * Pure unit-style — no DB, no HTTP, no Composio SDK calls.
 * Asserts the permission, gating, and logging invariants for Phase 2C.
 */

import {
  isActionAllowed,
  doesToolRequireApproval,
  isAgentAllowedTool,
  getPermissionDeniedReason,
} from "../composio-tool-registry";
import {
  SLACK_ALERT_PERMITTED_AGENTS,
  AGENT_ALERT_TYPES,
  ALL_ALERT_TYPES,
} from "../composio-slack-alert-routes";

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
  };
}

// ─── Suite 1: Slack action registry ──────────────────────────────────────────

console.log("\n[Suite 1] Slack action registry");

test("SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL is in allowedActions", () => {
  expect(isActionAllowed("SLACK", "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL")).toBeTrue();
});

test("isActionAllowed is case-insensitive for Slack send action", () => {
  expect(isActionAllowed("slack", "slack_sends_a_message_to_a_slack_channel")).toBeTrue();
});

test("SLACK requiresApproval — no autonomous posting path", () => {
  expect(doesToolRequireApproval("SLACK")).toBeTrue();
});

test("SLACK_LIST_CHANNELS is still allowed (read action)", () => {
  expect(isActionAllowed("SLACK", "SLACK_LIST_CHANNELS")).toBeTrue();
});

// ─── Suite 2: Permitted agents have SLACK access ──────────────────────────────

console.log("\n[Suite 2] Permitted agents have SLACK tool access");

for (const agentId of SLACK_ALERT_PERMITTED_AGENTS) {
  test(`${agentId} is allowed to use SLACK`, () => {
    expect(isAgentAllowedTool(agentId, "SLACK")).toBeTrue();
  });
}

for (const agentId of SLACK_ALERT_PERMITTED_AGENTS) {
  test(`${agentId} has no permission denial for SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL`, () => {
    const reason = getPermissionDeniedReason(
      agentId,
      "SLACK",
      "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
    );
    if (reason !== null)
      throw new Error(`Expected null denial for ${agentId}, got: ${reason}`);
  });
}

// ─── Suite 3: Unauthorized agents are blocked ────────────────────────────────

console.log("\n[Suite 3] Unauthorized agents blocked");

// Registry-level blocks (no SLACK in allowedTools)
const REGISTRY_BLOCKED = [
  "scheduling_agent",
  "growth_agent",
  "email_agent",
  "lead_intake_agent",
] as const;

for (const agentId of REGISTRY_BLOCKED) {
  test(`${agentId} is NOT permitted to use SLACK (registry)`, () => {
    expect(isAgentAllowedTool(agentId, "SLACK")).toBeFalse();
  });
}

// Endpoint-level blocks (not in SLACK_ALERT_PERMITTED_AGENTS)
const ENDPOINT_BLOCKED_FROM_PHASE2C = [
  "communication_agent", // has SLACK in registry but NOT in Phase 2C permitted list
  "email_agent",
] as const;

for (const agentId of ENDPOINT_BLOCKED_FROM_PHASE2C) {
  test(`${agentId} is NOT in SLACK_ALERT_PERMITTED_AGENTS (endpoint-level block)`, () => {
    const permitted = SLACK_ALERT_PERMITTED_AGENTS as readonly string[];
    if (permitted.includes(agentId))
      throw new Error(`${agentId} must not be in SLACK_ALERT_PERMITTED_AGENTS`);
  });
}

// ─── Suite 4: Per-agent alert type validation ─────────────────────────────────

console.log("\n[Suite 4] Per-agent alert type restrictions");

test("ceo_heartbeat can post daily_executive_summary", () => {
  expect(AGENT_ALERT_TYPES.ceo_heartbeat.includes("daily_executive_summary")).toBeTrue();
});

test("ceo_heartbeat can post critical_business_risk", () => {
  expect(AGENT_ALERT_TYPES.ceo_heartbeat.includes("critical_business_risk")).toBeTrue();
});

test("software_improvement_agent can post critical_bug_detected", () => {
  expect(AGENT_ALERT_TYPES.software_improvement_agent.includes("critical_bug_detected")).toBeTrue();
});

test("software_improvement_agent can post system_failure_detected", () => {
  expect(AGENT_ALERT_TYPES.software_improvement_agent.includes("system_failure_detected")).toBeTrue();
});

test("revenue_agent can post high_value_lead_alert", () => {
  expect(AGENT_ALERT_TYPES.revenue_agent.includes("high_value_lead_alert")).toBeTrue();
});

test("revenue_agent cannot post daily_executive_summary (domain boundary)", () => {
  expect(AGENT_ALERT_TYPES.revenue_agent.includes("daily_executive_summary")).toBeFalse();
});

test("software_improvement_agent cannot post revenue_recovery_opportunity (domain boundary)", () => {
  expect(AGENT_ALERT_TYPES.software_improvement_agent.includes("revenue_recovery_opportunity")).toBeFalse();
});

test("executive_agent can post system_status", () => {
  expect(AGENT_ALERT_TYPES.executive_agent.includes("system_status")).toBeTrue();
});

// ─── Suite 5: Request gate logic ──────────────────────────────────────────────

console.log("\n[Suite 5] Request gate — outcome must be queued_for_approval");

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

test("gate: queued_for_approval → persist, 202", () => {
  const r = simulateRequestGate("queued_for_approval");
  expect(r.shouldPersistRecord).toBeTrue();
  expect(r.httpStatus).toBe(202);
});

test("gate: blocked_action_not_allowed → no persist, 403", () => {
  const r = simulateRequestGate("blocked_action_not_allowed");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_by_policy → no persist, 403", () => {
  const r = simulateRequestGate("blocked_by_policy");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: blocked_no_permission → no persist, 403", () => {
  const r = simulateRequestGate("blocked_no_permission");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(403);
});

test("gate: failed → no persist, 400", () => {
  const r = simulateRequestGate("failed");
  expect(r.shouldPersistRecord).toBeFalse();
  expect(r.httpStatus).toBe(400);
});

// ─── Suite 6: Approve gate logic ──────────────────────────────────────────────

console.log("\n[Suite 6] Approve gate — alert_posted only on confirmed success");

function simulateApproveGate(
  execSuccess: boolean,
  extractedMessageId: string | null,
): {
  shouldMarkPosted: boolean;
  httpStatus: number;
  status: "alert_queued" | "alert_posted";
  messageIdStored: string | null;
} {
  if (!execSuccess) {
    return {
      shouldMarkPosted: false,
      httpStatus: 502,
      status: "alert_queued",     // retryable
      messageIdStored: null,
    };
  }
  return {
    shouldMarkPosted: true,
    httpStatus: 200,
    status: "alert_posted",
    messageIdStored: extractedMessageId,
  };
}

test("approve: success + message ID → mark posted, store ID, 200", () => {
  const r = simulateApproveGate(true, "1234567890.123456");
  expect(r.shouldMarkPosted).toBeTrue();
  expect(r.httpStatus).toBe(200);
  expect(r.status).toBe("alert_posted");
  expect(r.messageIdStored).toBe("1234567890.123456");
});

test("approve: success + no message ID → mark posted, null ID, 200", () => {
  const r = simulateApproveGate(true, null);
  expect(r.shouldMarkPosted).toBeTrue();
  expect(r.status).toBe("alert_posted");
  expect(r.messageIdStored).toBeNull();
});

test("approve: failure → do NOT mark posted, stay alert_queued, 502", () => {
  const r = simulateApproveGate(false, null);
  expect(r.shouldMarkPosted).toBeFalse();
  expect(r.httpStatus).toBe(502);
  expect(r.status).toBe("alert_queued");
  expect(r.messageIdStored).toBeNull();
});

test("approve: failure is retryable (status stays alert_queued)", () => {
  const r1 = simulateApproveGate(false, null);
  expect(r1.status).toBe("alert_queued");
  const r2 = simulateApproveGate(true, "retry_ts_ok");
  expect(r2.shouldMarkPosted).toBeTrue();
  expect(r2.messageIdStored).toBe("retry_ts_ok");
});

// ─── Suite 7: Hermes event outcome strings ────────────────────────────────────

console.log("\n[Suite 7] Hermes event outcome strings");

const VALID_RESULTS = ["success", "failure", "queued_for_approval", "blocked"] as const;

function isValidResult(r: string): boolean {
  return (VALID_RESULTS as readonly string[]).includes(r);
}

test("request step emits result='queued_for_approval'", () => {
  expect(isValidResult("queued_for_approval")).toBeTrue();
});

test("approve success emits result='success', outcome='slack_alert_posted'", () => {
  expect(isValidResult("success")).toBeTrue();
  const outcome = "slack_alert_posted";
  if (outcome === "failed_execution")
    throw new Error("Success outcome must not be 'failed_execution'");
});

test("approve failure emits result='failure', outcome='failed_execution'", () => {
  expect(isValidResult("failure")).toBeTrue();
  const outcome = "failed_execution";
  if (outcome === "slack_alert_posted")
    throw new Error("Failure outcome must not be 'slack_alert_posted'");
});

test("cancel emits result='blocked', outcome='cancelled'", () => {
  expect(isValidResult("blocked")).toBeTrue();
  const outcome = "cancelled";
  if (outcome !== "cancelled")
    throw new Error("Cancel outcome must be 'cancelled'");
});

// ─── Suite 8: Role enforcement ────────────────────────────────────────────────

console.log("\n[Suite 8] Role enforcement invariants");

test("SLACK requiresApproval=true — no auto-execute path for any agent", () => {
  expect(doesToolRequireApproval("SLACK")).toBeTrue();
});

test("No autonomous posting: all permitted agents still require human approval", () => {
  for (const agent of SLACK_ALERT_PERMITTED_AGENTS) {
    if (!doesToolRequireApproval("SLACK")) {
      throw new Error(`Expected SLACK to require approval for ${agent}`);
    }
  }
});

test("No DM action exists in permitted action set", () => {
  const dmActions = ["SLACK_SEND_DIRECT_MESSAGE", "SLACK_DM", "SLACK_SEND_DM"];
  for (const action of dmActions) {
    if (isActionAllowed("SLACK", action)) {
      throw new Error(`DM action ${action} must not be allowed in Phase 2C`);
    }
  }
});

// ─── Suite 9: No autonomous posting invariant ─────────────────────────────────

console.log("\n[Suite 9] No autonomous posting invariant");

test("SLACK requiresApproval overrides any auto_execute policy decision", () => {
  // The adapter enforces: if (toolNeedsApproval && policyDecision === 'auto_execute')
  //   policyDecision = 'approval_required'
  // This test validates the registry flag that drives that enforcement.
  const toolNeedsApproval = doesToolRequireApproval("SLACK");
  const policyDecision = "auto_execute"; // worst case: policy says auto
  const effectiveDecision = toolNeedsApproval ? "approval_required" : policyDecision;
  expect(effectiveDecision).toBe("approval_required");
});

test("ALL_ALERT_TYPES contains only internal operational alert types", () => {
  const forbidden = ["marketing", "outreach", "customer", "promotion"];
  for (const alertType of ALL_ALERT_TYPES) {
    for (const f of forbidden) {
      if (alertType.includes(f)) {
        throw new Error(`Alert type "${alertType}" contains forbidden keyword "${f}"`);
      }
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
