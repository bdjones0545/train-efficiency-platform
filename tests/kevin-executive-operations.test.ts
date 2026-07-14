/**
 * Kevin Executive Operations Layer — Test Suite (Phase 15)
 *
 * Uses Node's built-in test runner (node:test).
 * Run with: npx tsx --test tests/kevin-executive-operations.test.ts
 *
 * Tests cover:
 *  - Capability registry: existence, schema validation, helpers
 *  - Policy engine: kill switch state management
 *  - Task bus: known agents set
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ─── Capability Registry ──────────────────────────────────────────────────────

import {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  listCapabilityKeys,
  listCapabilitiesByCategory,
  getCapabilityCategories,
  isModeSupported,
  approvalRequired,
  riskIndex,
  serializeCapability,
} from "../server/services/kevin-capability-registry";

describe("Kevin Capability Registry", () => {
  it("has at least 20 capabilities", () => {
    assert.ok(listCapabilityKeys().length >= 20, `Expected ≥20 capabilities, got ${listCapabilityKeys().length}`);
  });

  it("returns null for unknown capability key", () => {
    assert.strictEqual(getCapabilityDefinition("not.a.capability"), null);
  });

  it("email.create_draft has correct risk level and category", () => {
    const cap = getCapabilityDefinition("email.create_draft");
    assert.ok(cap, "email.create_draft must exist");
    assert.strictEqual(cap!.riskLevel, "low");
    assert.strictEqual(cap!.category, "communication");
  });

  it("email.send is high risk and NOT reversible", () => {
    const cap = getCapabilityDefinition("email.send");
    assert.ok(cap, "email.send must exist");
    assert.strictEqual(cap!.riskLevel, "high");
    assert.strictEqual(cap!.isReversible, false);
  });

  it("campaign.request_launch is critical risk", () => {
    const cap = getCapabilityDefinition("campaign.request_launch");
    assert.ok(cap, "campaign.request_launch must exist");
    assert.strictEqual(cap!.riskLevel, "critical");
  });

  it("all capabilities have required fields", () => {
    for (const key of listCapabilityKeys()) {
      const cap = getCapabilityDefinition(key);
      assert.ok(cap, `${key} must return a definition`);
      assert.strictEqual(cap!.key, key);
      assert.ok(cap!.displayName, `${key} must have displayName`);
      assert.ok(cap!.category, `${key} must have category`);
      assert.match(cap!.riskLevel, /^(low|medium|high|critical)$/, `${key} must have valid riskLevel`);
      assert.ok(cap!.supportedModes.length > 0, `${key} must have at least one supportedMode`);
      assert.ok(cap!.executorService, `${key} must have executorService`);
      assert.ok(cap!.timeoutSeconds > 0, `${key} timeoutSeconds must be > 0`);
    }
  });

  it("isModeSupported correctly checks mode", () => {
    assert.strictEqual(isModeSupported("email.create_draft", "draft"), true);
    assert.strictEqual(isModeSupported("email.create_draft", "disabled"), false);
    assert.strictEqual(isModeSupported("not.real", "draft"), false);
  });

  it("riskIndex orders correctly: low < medium < high < critical", () => {
    assert.ok(riskIndex("low") < riskIndex("medium"), "low < medium");
    assert.ok(riskIndex("medium") < riskIndex("high"), "medium < high");
    assert.ok(riskIndex("high") < riskIndex("critical"), "high < critical");
  });

  it("approvalRequired returns true for unknown capability (safe default)", () => {
    assert.strictEqual(approvalRequired("not.real", "low"), true);
  });

  it("approvalRequired is false for email.create_draft at low risk", () => {
    // requiresApprovalAt = "high", low risk should NOT require approval
    assert.strictEqual(approvalRequired("email.create_draft", "low"), false);
  });

  it("approvalRequired is true for email.send at medium risk", () => {
    // email.send requiresApprovalAt = "medium", so medium risk requires approval
    assert.strictEqual(approvalRequired("email.send", "medium"), true);
  });

  it("listCapabilitiesByCategory returns only matching capabilities", () => {
    const comms = listCapabilitiesByCategory("communication");
    assert.ok(comms.length > 0, "communication category must have capabilities");
    for (const c of comms) {
      assert.strictEqual(c.category, "communication");
    }
  });

  it("getCapabilityCategories returns at least 4 categories including communication and scheduling", () => {
    const cats = getCapabilityCategories();
    assert.ok(cats.length >= 4, `Expected ≥4 categories, got ${cats.length}`);
    assert.ok(cats.includes("communication"), "must include communication");
    assert.ok(cats.includes("scheduling"), "must include scheduling");
  });

  it("serializeCapability omits sensitiveData field", () => {
    const cap = getCapabilityDefinition("email.create_draft")!;
    const serialized = serializeCapability(cap);
    assert.ok(!("sensitiveData" in serialized), "sensitiveData should be omitted");
    assert.strictEqual(serialized.key, "email.create_draft");
  });

  it("platform.open_location requires no org scope", () => {
    const cap = getCapabilityDefinition("platform.open_location");
    assert.ok(cap, "platform.open_location must exist");
    assert.strictEqual(cap!.requiresOrgScope, false);
  });

  it("every critical-risk capability requires approval at low risk", () => {
    for (const key of listCapabilityKeys()) {
      const cap = getCapabilityDefinition(key)!;
      if (cap.riskLevel === "critical") {
        assert.strictEqual(
          approvalRequired(key, "low"),
          true,
          `Critical-risk capability ${key} must require approval at low risk`,
        );
      }
    }
  });

  it("no capability has timeoutSeconds > 600", () => {
    for (const key of listCapabilityKeys()) {
      const cap = getCapabilityDefinition(key)!;
      assert.ok(cap.timeoutSeconds <= 600, `${key} timeoutSeconds (${cap.timeoutSeconds}) must be ≤600`);
    }
  });

  it("critical risk capabilities never default to auto mode", () => {
    for (const key of listCapabilityKeys()) {
      const cap = getCapabilityDefinition(key)!;
      if (cap.riskLevel === "critical") {
        assert.notStrictEqual(
          cap.defaultMode,
          "auto",
          `Critical capability ${key} must not default to auto`,
        );
      }
    }
  });

  it("campaign.request_launch always requires approval (requiresApprovalAt=low)", () => {
    assert.strictEqual(approvalRequired("campaign.request_launch", "low"), true);
    assert.strictEqual(approvalRequired("campaign.request_launch", "critical"), true);
  });

  it("email.send is NOT idempotent", () => {
    const cap = getCapabilityDefinition("email.send")!;
    assert.strictEqual(cap.idempotent, false);
  });

  it("ceo.ask_question is idempotent", () => {
    const cap = getCapabilityDefinition("ceo.ask_question")!;
    assert.strictEqual(cap.idempotent, true);
  });

  it("all scheduling capabilities require org scope", () => {
    for (const cap of listCapabilitiesByCategory("scheduling")) {
      assert.strictEqual(cap.requiresOrgScope, true, `${cap.key} must require org scope`);
    }
  });
});

// ─── Policy Engine — Kill Switches ────────────────────────────────────────────

import {
  activateGlobalKill,
  deactivateGlobalKill,
  isGlobalKillActive,
  setOrgKill,
  setCapabilityKill,
  getEmergencyStatus,
} from "../server/services/kevin-policy-engine";

describe("Kevin Policy Engine — Kill Switches", () => {
  before(() => {
    deactivateGlobalKill();
  });

  after(() => {
    deactivateGlobalKill();
    setOrgKill("test-org-123", false);
    setOrgKill("test-org-456", false);
    setCapabilityKill("email.send", false);
    setCapabilityKill("email.create_draft", false);
  });

  it("global kill is inactive by default after deactivate", () => {
    deactivateGlobalKill();
    assert.strictEqual(isGlobalKillActive(), false);
  });

  it("activating global kill sets flag", () => {
    activateGlobalKill();
    assert.strictEqual(isGlobalKillActive(), true);
    deactivateGlobalKill();
  });

  it("deactivating global kill clears flag", () => {
    activateGlobalKill();
    deactivateGlobalKill();
    assert.strictEqual(isGlobalKillActive(), false);
  });

  it("getEmergencyStatus returns correct structure", () => {
    const status = getEmergencyStatus();
    assert.ok("globalKill" in status);
    assert.ok("orgKills" in status);
    assert.ok("capabilityKills" in status);
    assert.ok(Array.isArray(status.orgKills));
    assert.ok(Array.isArray(status.capabilityKills));
  });

  it("org kill appears in emergencyStatus and is removable", () => {
    setOrgKill("test-org-123", true);
    assert.ok(getEmergencyStatus().orgKills.includes("test-org-123"), "should contain org-123");
    setOrgKill("test-org-123", false);
    assert.ok(!getEmergencyStatus().orgKills.includes("test-org-123"), "should not contain org-123 after clear");
  });

  it("capability kill appears in emergencyStatus and is removable", () => {
    setCapabilityKill("email.send", true);
    assert.ok(getEmergencyStatus().capabilityKills.includes("email.send"));
    setCapabilityKill("email.send", false);
    assert.ok(!getEmergencyStatus().capabilityKills.includes("email.send"));
  });

  it("multiple org kills can coexist", () => {
    setOrgKill("org-a", true);
    setOrgKill("org-b", true);
    const status = getEmergencyStatus();
    assert.ok(status.orgKills.includes("org-a"));
    assert.ok(status.orgKills.includes("org-b"));
    setOrgKill("org-a", false);
    setOrgKill("org-b", false);
  });
});

// ─── Task Bus — Pure Logic ─────────────────────────────────────────────────────

import { KNOWN_AGENTS } from "../server/services/kevin-task-bus";

describe("Kevin Task Bus — Known Agents", () => {
  it("includes all primary agents", () => {
    const required = ["agentmail", "ceo_agent", "scheduling_agent", "crm_service", "navigation_registry", "context_service"];
    for (const agent of required) {
      assert.ok(KNOWN_AGENTS.has(agent), `KNOWN_AGENTS must include '${agent}'`);
    }
  });

  it("does not include random strings", () => {
    assert.strictEqual(KNOWN_AGENTS.has("not_real_agent"), false);
    assert.strictEqual(KNOWN_AGENTS.has(""), false);
  });
});
