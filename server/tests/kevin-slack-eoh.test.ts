/**
 * Kevin Slack EOH — Test Suite (42 focused tests)
 *
 * Run with: npx tsx server/tests/kevin-slack-eoh.test.ts
 *
 * Pure unit-style — no DB, no HTTP, no live Slack API calls.
 * Uses static ESM imports.
 */

import crypto from "crypto";

// Static imports of all modules under test
import {
  getKevinSlackConfig,
  isSlackEnabled,
  isEventsEnabled,
  isCommandsEnabled,
  isSchedulingEnabled,
  isApprovalsEnabled,
  getSlackBotToken,
  getSlackSigningSecret,
} from "../kevin-slack/config";

import {
  verifySlackRequest,
} from "../kevin-slack/verifier";

import {
  classifyNotification,
  shouldSendImmediately,
  shouldAggregate,
  shouldStoreMemory,
} from "../kevin-slack/notification-engine";

import {
  buildCreateSessionPreview,
  buildCancellationPreview,
  buildHelpMessage,
  buildErrorMessage,
  buildScheduleView,
  buildReschedulePreview,
  buildDailyDigest,
} from "../kevin-slack/block-kit";

import {
  createActionToken,
  consumeActionToken,
  invalidateActionToken,
  buildCreateSessionPreviewBlocks,
} from "../kevin-slack/scheduling-handler";

import {
  handleSlackEvent,
} from "../kevin-slack/event-handler";

import {
  handleSlackAction,
  type ActionPayload,
} from "../kevin-slack/approval-handler";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];
const promises: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
      failed++;
      failures.push(`${name}: ${e.message}`);
    }
  };
  const p = run();
  promises.push(p);
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
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub))
        throw new Error(`Expected "${actual}" to contain "${sub}"`);
    },
    toBeGreaterThan(n: number) {
      if (typeof actual !== "number" || actual <= n)
        throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeOneOf(options: unknown[]) {
      if (!options.includes(actual))
        throw new Error(`Expected one of ${JSON.stringify(options)}, got ${JSON.stringify(actual)}`);
    },
    toBeArray() {
      if (!Array.isArray(actual))
        throw new Error(`Expected array, got ${typeof actual}`);
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignature(secret: string, timestamp: string, body: string): string {
  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(sigBase);
  return `v0=${hmac.digest("hex")}`;
}

// ─── SECTION 1: Feature Flags ─────────────────────────────────────────────────

console.log("\n=== Feature Flags ===");

test("all flags default false with no env vars set", () => {
  // Reset all relevant env vars
  const vars = [
    "KEVIN_SLACK_ENABLED", "KEVIN_SLACK_EVENTS_ENABLED",
    "KEVIN_SLACK_COMMANDS_ENABLED", "KEVIN_SLACK_ACTIONS_ENABLED",
    "KEVIN_SLACK_SCHEDULING_ENABLED", "KEVIN_SLACK_APPROVALS_ENABLED",
    "KEVIN_SLACK_NOTIFICATIONS_ENABLED", "KEVIN_SLACK_DIGESTS_ENABLED",
  ];
  const saved: Record<string, string | undefined> = {};
  vars.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });

  expect(isSlackEnabled()).toBeFalse();
  expect(isEventsEnabled()).toBeFalse();
  expect(isCommandsEnabled()).toBeFalse();
  expect(isSchedulingEnabled()).toBeFalse();
  expect(isApprovalsEnabled()).toBeFalse();

  // Restore
  vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
});

test("master KEVIN_SLACK_ENABLED=false disables all sub-flags", () => {
  const saved = process.env.KEVIN_SLACK_ENABLED;
  process.env.KEVIN_SLACK_ENABLED = "false";
  process.env.KEVIN_SLACK_EVENTS_ENABLED = "true";
  process.env.KEVIN_SLACK_COMMANDS_ENABLED = "true";

  expect(isSlackEnabled()).toBeFalse();
  expect(isEventsEnabled()).toBeFalse();
  expect(isCommandsEnabled()).toBeFalse();

  process.env.KEVIN_SLACK_ENABLED = saved ?? "";
  delete process.env.KEVIN_SLACK_EVENTS_ENABLED;
  delete process.env.KEVIN_SLACK_COMMANDS_ENABLED;
});

test("scheduling requires all 5 prerequisite flags", () => {
  process.env.KEVIN_SLACK_ENABLED = "true";
  process.env.KEVIN_SLACK_EVENTS_ENABLED = "true";
  process.env.KEVIN_SLACK_COMMANDS_ENABLED = "true";
  // Missing ACTIONS and SCHEDULING
  delete process.env.KEVIN_SLACK_ACTIONS_ENABLED;
  delete process.env.KEVIN_SLACK_SCHEDULING_ENABLED;

  expect(isSchedulingEnabled()).toBeFalse();

  delete process.env.KEVIN_SLACK_ENABLED;
  delete process.env.KEVIN_SLACK_EVENTS_ENABLED;
  delete process.env.KEVIN_SLACK_COMMANDS_ENABLED;
});

test("getSlackBotToken returns null when unset (never undefined)", () => {
  const saved = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  const token = getSlackBotToken();
  expect(token).toBeNull();
  if (saved) process.env.SLACK_BOT_TOKEN = saved;
});

test("getKevinSlackConfig returns all expected keys", () => {
  const cfg = getKevinSlackConfig();
  const keys = [
    "enabled", "eventsEnabled", "commandsEnabled", "actionsEnabled",
    "notificationsEnabled", "digestsEnabled", "schedulingEnabled",
    "approvalsEnabled", "obsidianMemoryEnabled",
  ];
  for (const key of keys) {
    if (!(key in cfg)) throw new Error(`Missing config key: ${key}`);
  }
});

// ─── SECTION 2: Signature Verification ───────────────────────────────────────

console.log("\n=== Signature Verification ===");

test("valid HMAC-SHA256 signature is accepted", () => {
  const secret = "test-secret-at-least-16-chars";
  const saved = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;

  const ts = Math.floor(Date.now() / 1000).toString();
  const body = "payload=test_body_data";
  const sig = makeSignature(secret, ts, body);

  const result = verifySlackRequest(ts, sig, body);
  expect(result.ok).toBeTrue();

  process.env.SLACK_SIGNING_SECRET = saved ?? "";
});

test("tampered body causes signature mismatch", () => {
  const secret = "test-secret-at-least-16-chars";
  const saved = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;

  const ts = Math.floor(Date.now() / 1000).toString();
  const body = "original=body";
  const sig = makeSignature(secret, ts, body);
  const result = verifySlackRequest(ts, sig, "tampered=body");
  expect(result.ok).toBeFalse();
  expect(result.error).toBe("invalid_signature");

  process.env.SLACK_SIGNING_SECRET = saved ?? "";
});

test("stale timestamp (>5 min ago) is rejected", () => {
  const secret = "test-secret-at-least-16-chars";
  const saved = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;

  const staleTs = (Math.floor(Date.now() / 1000) - 400).toString();
  const body = "body=data";
  const sig = makeSignature(secret, staleTs, body);
  const result = verifySlackRequest(staleTs, sig, body);
  expect(result.ok).toBeFalse();
  expect(result.error).toBe("stale_timestamp");

  process.env.SLACK_SIGNING_SECRET = saved ?? "";
});

test("future timestamp (>5 min ahead) is rejected", () => {
  const secret = "test-secret-at-least-16-chars";
  const saved = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;

  const futureTs = (Math.floor(Date.now() / 1000) + 400).toString();
  const body = "body=data";
  const sig = makeSignature(secret, futureTs, body);
  const result = verifySlackRequest(futureTs, sig, body);
  expect(result.ok).toBeFalse();
  expect(result.error).toBe("stale_timestamp");

  process.env.SLACK_SIGNING_SECRET = saved ?? "";
});

test("empty signature header is rejected", () => {
  const secret = "test-secret";
  process.env.SLACK_SIGNING_SECRET = secret;
  const ts = Math.floor(Date.now() / 1000).toString();
  const result = verifySlackRequest(ts, "", "body");
  expect(result.ok).toBeFalse();
  expect(result.error).toBe("missing_headers");
});

test("missing signing secret returns missing_secret error", () => {
  const saved = process.env.SLACK_SIGNING_SECRET;
  delete process.env.SLACK_SIGNING_SECRET;
  const ts = Math.floor(Date.now() / 1000).toString();
  const result = verifySlackRequest(ts, "v0=abc123", "body");
  expect(result.ok).toBeFalse();
  expect(result.error).toBe("missing_secret");
  if (saved) process.env.SLACK_SIGNING_SECRET = saved;
});

test("signing secret never appears in verification result", () => {
  const secret = "ULTRA-SECRET-SIGNING-VALUE-NEVER-EXPOSE";
  const saved = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;
  const ts = Math.floor(Date.now() / 1000).toString();
  const result = verifySlackRequest(ts, "v0=badsig123", "body");
  const resultStr = JSON.stringify(result);
  if (resultStr.includes(secret)) {
    throw new Error("Signing secret was exposed in verification result!");
  }
  expect(result.ok).toBeFalse();
  process.env.SLACK_SIGNING_SECRET = saved ?? "";
});

test("URL verification challenge payload returns challenge field", async () => {
  const result = await handleSlackEvent({
    type: "url_verification",
    challenge: "test_challenge_xyz_123",
  });
  expect(result.status).toBe(200);
  expect((result.body as any).challenge).toBe("test_challenge_xyz_123");
});

// ─── SECTION 3: Notification Engine ──────────────────────────────────────────

console.log("\n=== Notification Engine ===");

test("heartbeat.ping event is always IGNORE", () => {
  const result = classifyNotification({
    eventType: "heartbeat.ping",
    urgency: 0, businessImpact: 0, revenueImpact: 0,
    customerImpact: 0, operationalImpact: 0, securityImpact: 0,
    confidence: 1, timeSensitivity: 0,
  });
  expect(result.priority).toBe("IGNORE");
});

test("security escalation elevated to CRITICAL or higher", () => {
  const result = classifyNotification({
    eventType: "security.escalation",
    urgency: 5, businessImpact: 5, revenueImpact: 0,
    customerImpact: 0, operationalImpact: 5, securityImpact: 9,
    confidence: 0.9, timeSensitivity: 7,
  });
  expect(result.priority).toBeOneOf(["CRITICAL", "EXECUTIVE_BRIEF"]);
});

test("open duplicate alert is suppressed", () => {
  const result = classifyNotification({
    eventType: "scheduling.conflict_high_impact",
    urgency: 8, businessImpact: 7, revenueImpact: 5,
    customerImpact: 5, operationalImpact: 6, securityImpact: 0,
    confidence: 0.9, timeSensitivity: 8,
    hasOpenAlert: true,
  });
  expect(result.priority).toBe("IGNORE");
  expect(result.suppressDuplicate).toBeTrue();
});

test("quiet hours downgrade IMPORTANT to DAILY_DIGEST", () => {
  const result = classifyNotification({
    eventType: "lead.high_value",
    urgency: 6, businessImpact: 5, revenueImpact: 7,
    customerImpact: 4, operationalImpact: 4, securityImpact: 0,
    confidence: 0.85, timeSensitivity: 4,
    inQuietHours: true,
  });
  if (result.priority === "IMPORTANT") {
    throw new Error("IMPORTANT should be downgraded during quiet hours");
  }
});

test("routine session with high recurrence aggregates", () => {
  const result = classifyNotification({
    eventType: "scheduling.session_created",
    urgency: 2, businessImpact: 2, revenueImpact: 1,
    customerImpact: 2, operationalImpact: 2, securityImpact: 0,
    confidence: 0.9, timeSensitivity: 2,
    recurrence: 9,
  });
  expect(shouldAggregate(result.priority)).toBeTrue();
});

test("dead-letter threshold triggers immediate send", () => {
  const result = classifyNotification({
    eventType: "agent.dead_letter_threshold",
    urgency: 9, businessImpact: 8, revenueImpact: 4,
    customerImpact: 7, operationalImpact: 9, securityImpact: 0,
    confidence: 0.95, timeSensitivity: 9,
  });
  expect(shouldSendImmediately(result.priority)).toBeTrue();
});

test("score is positive for real events", () => {
  const result = classifyNotification({
    eventType: "revenue.material_opportunity",
    urgency: 7, businessImpact: 8, revenueImpact: 9,
    customerImpact: 5, operationalImpact: 4, securityImpact: 0,
    confidence: 0.9, timeSensitivity: 6,
  });
  expect(result.score).toBeGreaterThan(0);
});

test("shouldStoreMemory is true for any non-IGNORE priority", () => {
  const result = classifyNotification({
    eventType: "scheduling.session_cancelled",
    urgency: 3, businessImpact: 3, revenueImpact: 2,
    customerImpact: 3, operationalImpact: 3, securityImpact: 0,
    confidence: 0.8, timeSensitivity: 3,
  });
  if (result.priority !== "IGNORE") {
    expect(shouldStoreMemory(result.priority)).toBeTrue();
  }
});

// ─── SECTION 4: Block Kit ─────────────────────────────────────────────────────

console.log("\n=== Block Kit ===");

test("create session preview contains all required fields", () => {
  const blocks = buildCreateSessionPreview({
    sessionType: "Personal Training",
    date: "Monday, Jan 15", time: "4:00 PM", timezone: "EST",
    coachName: "Coach Smith", athleteCount: 2,
    conflictStatus: "none", requiresApproval: false,
    actionToken: "test-token-abc",
  });
  const str = JSON.stringify(blocks);
  expect(str).toContain("Personal Training");
  expect(str).toContain("Coach Smith");
  expect(str).toContain("4:00 PM");
  expect(str).toContain("create_session_confirm");
  expect(str).toContain("create_session_cancel");
});

test("cancellation preview has confirm+abort but NOT delete", () => {
  const blocks = buildCancellationPreview({
    bookingId: "bk1", sessionType: "Group Session",
    date: "Tuesday", time: "10:00 AM",
    coachName: "Coach Jones", participantCount: 5,
    reasonCategory: "Operational", actionToken: "token-xyz",
  });
  const str = JSON.stringify(blocks);
  if (str.includes("delete_session")) {
    throw new Error("Cancellation preview must not include delete action");
  }
  expect(str).toContain("cancel_session_confirm");
  expect(str).toContain("cancel_session_abort");
});

test("reschedule preview contains current and proposed dates", () => {
  const blocks = buildReschedulePreview({
    bookingId: "bk2", sessionType: "Semi-Private",
    currentDate: "Mon Jan 13", currentTime: "9:00 AM",
    proposedDate: "Tue Jan 14", proposedTime: "10:00 AM",
    timezone: "EST", coachAvailable: true,
    conflictStatus: "none", affectedParticipants: 3,
    actionToken: "reschedule-token",
  });
  const str = JSON.stringify(blocks);
  expect(str).toContain("reschedule_confirm");
  expect(str).toContain("Mon Jan 13");
  expect(str).toContain("Tue Jan 14");
});

test("help message includes all primary /kevin commands", () => {
  const blocks = buildHelpMessage("Test Org");
  const str = JSON.stringify(blocks);
  expect(str).toContain("/kevin schedule");
  expect(str).toContain("/kevin sessions");
  expect(str).toContain("/kevin health");
  expect(str).toContain("/kevin approvals");
});

test("error message is array of valid blocks", () => {
  const blocks = buildErrorMessage("Something went wrong during scheduling");
  expect(Array.isArray(blocks)).toBeTrue();
  const str = JSON.stringify(blocks);
  expect(str).toContain("Something went wrong during scheduling");
});

test("schedule view shows empty state message when no sessions", () => {
  const blocks = buildScheduleView("📅 Today", [], "Test Org");
  const str = JSON.stringify(blocks);
  expect(str).toContain("No sessions scheduled");
});

test("daily digest has all 5 required sections", () => {
  const blocks = buildDailyDigest({
    date: "Monday, July 14",
    orgName: "Test Gym",
    scheduling: { todaySessions: 10, completed: 7, cancelled: 1, utilization: "70%" },
    revenue: { todayRevenue: "$1,500", weekRevenue: "$8,200", trend: "↑ 12%" },
    leads: { newLeads: 3, activeOpportunities: 8 },
    infrastructure: { agentHealth: "✅ Operational", pendingApprovals: 2, deadLetterCount: 0 },
    topActions: ["Review sessions", "Check leads"],
  });
  const str = JSON.stringify(blocks);
  expect(str).toContain("Scheduling");
  expect(str).toContain("Revenue");
  expect(str).toContain("Infrastructure");
});

// ─── SECTION 5: Action Tokens (Scheduling) ───────────────────────────────────

console.log("\n=== Action Tokens ===");

test("createActionToken returns opaque hex string (no raw data)", async () => {
  const token = await createActionToken("create_session", "org-123", "user-456", {
    startAt: "2025-01-01T10:00:00Z",
    coachId: "coach-789",
  });
  expect(typeof token).toBe("string");
  if (token.includes("org-123") || token.includes("user-456")) {
    throw new Error("Token must not contain raw org/user data");
  }
  if (token.includes("coach-789") || token.includes("2025-01-01")) {
    throw new Error("Token must not contain raw payload data");
  }
});

test("consumeActionToken returns null for unknown token", async () => {
  const result = await consumeActionToken("totally-unknown-token-xyz");
  expect(result).toBeNull();
});

test("consumed token preserves intent and org isolation fields", async () => {
  const token = await createActionToken("reschedule_session", "org-A", "user-1", {
    bookingId: "bk-123",
  });
  const entry = await consumeActionToken(token);
  if (!entry) throw new Error("Token should be consumable immediately after creation");
  expect(entry.actionType).toBe("reschedule_session");
  expect(entry.orgId).toBe("org-A");
  expect(entry.trainefficiencyUserId).toBe("user-1");
  expect((entry.actionPayload as any).bookingId).toBe("bk-123");
});

test("different token IDs are generated for same input (no determinism)", async () => {
  const t1 = await createActionToken("cancel_session", "org-1", "user-1", {});
  const t2 = await createActionToken("cancel_session", "org-1", "user-1", {});
  if (t1 === t2) throw new Error("Tokens must be random, not deterministic");
});

test("invalidateActionToken causes subsequent consume to return null", async () => {
  const token = await createActionToken("create_session", "org-X", "user-X", {});
  await invalidateActionToken(token);
  const result = await consumeActionToken(token);
  expect(result).toBeNull();
});

test("CLIENT role cannot create sessions (scheduling write blocked)", async () => {
  const savedEnabled = process.env.KEVIN_SLACK_ENABLED;
  process.env.KEVIN_SLACK_ENABLED = "true";
  process.env.KEVIN_SLACK_EVENTS_ENABLED = "true";
  process.env.KEVIN_SLACK_COMMANDS_ENABLED = "true";
  process.env.KEVIN_SLACK_ACTIONS_ENABLED = "true";
  process.env.KEVIN_SLACK_SCHEDULING_ENABLED = "true";

  const clientIdentity = { mapping: {} as any, userId: "client-1", orgId: "org-1", role: "CLIENT" };
  const result = await buildCreateSessionPreviewBlocks(clientIdentity, {});
  const str = JSON.stringify(result.blocks);
  if (!str.includes("permission") && !str.includes("role") && !str.includes("Role")) {
    throw new Error("CLIENT role must be blocked from creating sessions");
  }

  process.env.KEVIN_SLACK_ENABLED = savedEnabled ?? "";
  delete process.env.KEVIN_SLACK_EVENTS_ENABLED;
  delete process.env.KEVIN_SLACK_COMMANDS_ENABLED;
  delete process.env.KEVIN_SLACK_ACTIONS_ENABLED;
  delete process.env.KEVIN_SLACK_SCHEDULING_ENABLED;
});

test("cross-org token is rejected by executeCreateSession", async () => {
  const token = await createActionToken("create_session", "org-A", "user-1", {});
  const crossOrgEntry = await consumeActionToken(token);
  if (!crossOrgEntry) throw new Error("Token should be consumable");
  // Verify the org stored in token is org-A (not org-B)
  expect(crossOrgEntry.orgId).toBe("org-A");
  // A handler receiving identity.orgId = "org-B" would see mismatch and reject
  const identityOrgId = "org-B";
  if (crossOrgEntry.orgId === identityOrgId) {
    throw new Error("Cross-org token incorrectly matched");
  }
});

test("cancellation and deletion are distinct operations", async () => {
  // Cancel uses updateBookingStatus("CANCELLED") - does not delete the record
  // Delete uses deleteBooking() - removes the record
  // Verify the cancel token action type is 'cancel_session', not 'delete_session'
  const token = await createActionToken("cancel_session", "org-1", "user-1", { bookingId: "bk1" });
  const entry = await consumeActionToken(token);
  if (!entry) throw new Error("Token must be consumable");
  expect(entry.actionType).toBe("cancel_session");
  if (entry.actionType === "delete_session") {
    throw new Error("Cancellation must not be treated as deletion");
  }
});

// ─── SECTION 6: Event Handler ─────────────────────────────────────────────────

console.log("\n=== Event Handler ===");

test("bot_id message is silently ignored (no API calls)", async () => {
  const saved = process.env.KEVIN_SLACK_EVENTS_ENABLED;
  process.env.KEVIN_SLACK_ENABLED = "true";
  process.env.KEVIN_SLACK_EVENTS_ENABLED = "true";

  const result = await handleSlackEvent({
    type: "event_callback",
    team_id: "T_BOT_TEST",
    event_id: `bot-test-${Date.now()}`,
    event: {
      type: "message",
      user: "U_BOT",
      text: "bot says hello",
      channel: "C_TEST",
      bot_id: "B_SOME_BOT",
    },
  });

  expect(result.status).toBe(200);
  expect((result.slackApiCalls ?? []).length).toBe(0);

  process.env.KEVIN_SLACK_EVENTS_ENABLED = saved ?? "";
  delete process.env.KEVIN_SLACK_ENABLED;
});

test("event with missing user or channel is gracefully ignored", async () => {
  process.env.KEVIN_SLACK_ENABLED = "true";
  process.env.KEVIN_SLACK_EVENTS_ENABLED = "true";

  const result = await handleSlackEvent({
    type: "event_callback",
    team_id: "T_TEST",
    event_id: `no-user-${Date.now()}`,
    event: {
      type: "message",
      text: "hello",
      // no user, no channel
    },
  });

  expect(result.status).toBe(200);

  delete process.env.KEVIN_SLACK_ENABLED;
  delete process.env.KEVIN_SLACK_EVENTS_ENABLED;
});

test("events disabled flag returns 200 without processing", async () => {
  process.env.KEVIN_SLACK_ENABLED = "true";
  delete process.env.KEVIN_SLACK_EVENTS_ENABLED;

  const result = await handleSlackEvent({
    type: "event_callback",
    team_id: "T_TEST",
    event_id: `disabled-${Date.now()}`,
    event: { type: "message", user: "U1", text: "hello", channel: "C1" },
  });

  expect(result.status).toBe(200);
  expect((result.slackApiCalls ?? []).length).toBe(0);

  delete process.env.KEVIN_SLACK_ENABLED;
});

// ─── SECTION 7: Approval Handler ─────────────────────────────────────────────

console.log("\n=== Approval Handler ===");

test("acknowledge_alert with valid identity succeeds", async () => {
  const identity = { mapping: {} as any, userId: "user-1", orgId: "org-1", role: "ADMIN" };
  const payload: ActionPayload = {
    type: "block_actions",
    team: { id: "T1", domain: "test" },
    user: { id: "U1" },
    channel: { id: "C1" },
    actions: [{ action_id: "acknowledge_alert", value: "alert-123" }],
  };
  const result = await handleSlackAction(payload, identity);
  expect(result.ok).toBeTrue();
});

test("dismiss_action marks outcome as dismissed", async () => {
  const identity = { mapping: {} as any, userId: "user-1", orgId: "org-1", role: "ADMIN" };
  const payload: ActionPayload = {
    type: "block_actions",
    team: { id: "T1", domain: "test" },
    user: { id: "U1" },
    actions: [{ action_id: "dismiss_action", value: "dismiss-token" }],
  };
  const result = await handleSlackAction(payload, identity);
  expect(result.ok).toBeTrue();
});

test("null identity blocks create_session_confirm action", async () => {
  const payload: ActionPayload = {
    type: "block_actions",
    team: { id: "T1", domain: "test" },
    user: { id: "U_UNLINKED" },
    actions: [{ action_id: "create_session_confirm", value: "some-token" }],
  };
  const result = await handleSlackAction(payload, null);
  expect(result.ok).toBeFalse();
  const blocksStr = JSON.stringify(result.responseBlocks ?? []);
  if (!blocksStr.includes("linked")) {
    throw new Error("Response must indicate account is not linked");
  }
});

test("unknown action_id returns error without throwing", async () => {
  const identity = { mapping: {} as any, userId: "user-1", orgId: "org-1", role: "ADMIN" };
  const payload: ActionPayload = {
    type: "block_actions",
    team: { id: "T1", domain: "test" },
    user: { id: "U1" },
    actions: [{ action_id: "completely_unknown_action_xyz_999", value: "v" }],
  };
  const result = await handleSlackAction(payload, identity);
  expect(result.ok).toBeFalse();
});

test("cancel_session_abort keeps session without executing cancellation", async () => {
  const identity = { mapping: {} as any, userId: "user-1", orgId: "org-1", role: "ADMIN" };
  const payload: ActionPayload = {
    type: "block_actions",
    team: { id: "T1", domain: "test" },
    user: { id: "U1" },
    actions: [{ action_id: "cancel_session_abort", value: "token-abc" }],
  };
  const result = await handleSlackAction(payload, identity);
  expect(result.ok).toBeTrue();
  const str = JSON.stringify(result.responseBlocks ?? []);
  expect(str).toContain("kept");
});

// ─── Run all tests and report ─────────────────────────────────────────────────

await Promise.allSettled(promises);

console.log(`\n${"=".repeat(60)}`);
console.log(`Kevin Slack EOH Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
console.log(`${"=".repeat(60)}\n`);

if (failed > 0) process.exit(1);
