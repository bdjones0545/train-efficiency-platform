/**
 * kevin-dispatch-contract.test.ts — Production TE → Kevin dispatch contract tests.
 *
 * Proves the actual signing scheme, headers, base URL, secret resolution,
 * disabled/missing-secret behavior, and that secrets never appear in output.
 *
 * Run: npx tsx --test server/tests/kevin-dispatch-contract.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "crypto";

import {
  buildKevinOutboundSigBase,
  formatKevinOutboundSignatureHeader,
  buildKevinOutboundAuthHeaders,
  verifyKevinOutboundRequest,
  resolveKevinOutboundHmacSecret,
} from "../../shared/kevin/outbound-hmac";

import {
  isKevinCallbackHmacConfigured,
  signKevinOutboundBody,
  verifyKevinCallbackHeaders,
} from "../services/kevin-outbound-auth";

// postKevinAgentTask + dispatchKevinTask + KevinDispatchError
import * as kevinGatewayClient from "../services/kevin-gateway-client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ─── 1. Signing scheme — v1: contract ────────────────────────────────────────

describe("Kevin outbound HMAC — v1: signing scheme", () => {
  test("signing base is v1:{timestampSec}:{rawBody}", () => {
    const ts = "1700000000";
    const body = '{"schemaVersion":"1.0"}';
    const base = buildKevinOutboundSigBase(ts, body);
    assert.equal(base, `v1:${ts}:${body}`);
  });

  test("signature header format is v1={hex}", () => {
    const hex = "a".repeat(64);
    const header = formatKevinOutboundSignatureHeader(hex);
    assert.match(header, /^v1=[0-9a-f]{64}$/);
  });

  test("timestamp is Unix epoch SECONDS (not milliseconds)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const headers = buildKevinOutboundAuthHeaders({
      secret: "test-secret-32bytes-aaaaaaaaaaaa",
      rawBody: "{}",
      timestampSec: nowSec,
      hmacSha256Hex,
    });
    const ts = parseInt(headers["x-kevin-timestamp"], 10);
    // A millisecond timestamp would be ~13 digits; a second timestamp ~10
    assert.ok(ts < 1e12, `Timestamp looks like milliseconds (${ts}); expected seconds`);
    assert.ok(ts > 1e9, `Timestamp too small (${ts})`);
  });

  test("expected header names are x-kevin-timestamp and x-kevin-signature", () => {
    const headers = buildKevinOutboundAuthHeaders({
      secret: "test-secret-32bytes-aaaaaaaaaaaa",
      rawBody: "{}",
      timestampSec: 1700000000,
      hmacSha256Hex,
    });
    assert.ok("x-kevin-timestamp" in headers, "must include x-kevin-timestamp");
    assert.ok("x-kevin-signature" in headers, "must include x-kevin-signature");
    // Old TE scheme headers must NOT be present
    assert.ok(!("X-TE-Signature" in headers), "must NOT include old X-TE-Signature header");
    assert.ok(!("X-TE-Timestamp" in headers), "must NOT include old X-TE-Timestamp header");
  });

  test("golden vector matches Kevin hmac_auth.py", () => {
    const SECRET = "test-vector-secret-32chars-aaaaaa";
    const TS = "1700000000";
    const RAW = '{"schemaVersion":"1.0","event":"task.completed","jobId":"job_fixed","status":"completed"}';
    const EXPECTED_HEX = "568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17";

    const base = buildKevinOutboundSigBase(TS, RAW);
    const hex = hmacSha256Hex(SECRET, base);
    assert.equal(hex, EXPECTED_HEX);

    const result = verifyKevinOutboundRequest({
      secret: SECRET,
      rawBody: RAW,
      timestampHeader: TS,
      signatureHeader: `v1=${EXPECTED_HEX}`,
      nowSec: 1700000000,
      skewSec: 300,
      hmacSha256Hex,
    });
    assert.equal(result.ok, true);
  });

  test("re-serialized pretty body does NOT verify against compact signature", () => {
    const SECRET = "test-vector-secret-32chars-aaaaaa";
    const TS = "1700000000";
    const COMPACT = '{"schemaVersion":"1.0","event":"task.completed","jobId":"job_fixed","status":"completed"}';
    const EXPECTED_HEX = "568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17";
    const PRETTY = JSON.stringify(JSON.parse(COMPACT), null, 2);

    const result = verifyKevinOutboundRequest({
      secret: SECRET,
      rawBody: PRETTY,
      timestampHeader: TS,
      signatureHeader: `v1=${EXPECTED_HEX}`,
      nowSec: 1700000000,
      skewSec: 300,
      hmacSha256Hex,
    });
    assert.equal(result.ok, false, "Pretty-printed body must not verify against compact signature");
  });
});

// ─── 2. Secret resolution chain ───────────────────────────────────────────────

describe("Kevin HMAC secret resolution chain", () => {
  test("resolves KEVIN_CALLBACK_HMAC_SECRET first", () => {
    const secret = resolveKevinOutboundHmacSecret({
      KEVIN_CALLBACK_HMAC_SECRET: "correct-secret",
      KEVIN_OUTBOUND_HMAC_SECRET: "wrong-secret",
      TRAINEFFICIENCY_KEVIN_SIGNING_SECRET: "also-wrong",
    });
    assert.equal(secret, "correct-secret");
  });

  test("falls back to KEVIN_OUTBOUND_HMAC_SECRET if CALLBACK unset", () => {
    const secret = resolveKevinOutboundHmacSecret({
      KEVIN_OUTBOUND_HMAC_SECRET: "outbound-secret",
      TRAINEFFICIENCY_KEVIN_SIGNING_SECRET: "legacy-secret",
    });
    assert.equal(secret, "outbound-secret");
  });

  test("falls back to TRAINEFFICIENCY_KEVIN_SIGNING_SECRET as last resort", () => {
    const secret = resolveKevinOutboundHmacSecret({
      TRAINEFFICIENCY_KEVIN_SIGNING_SECRET: "legacy-only-secret",
    });
    assert.equal(secret, "legacy-only-secret");
  });

  test("returns null when all three env vars are absent", () => {
    const secret = resolveKevinOutboundHmacSecret({});
    assert.equal(secret, null);
  });

  test("empty strings do not count as configured", () => {
    const missing = resolveKevinOutboundHmacSecret({
      KEVIN_CALLBACK_HMAC_SECRET: "",
      KEVIN_OUTBOUND_HMAC_SECRET: "   ",
    });
    assert.equal(missing, null, "whitespace-only values must not resolve as configured");
  });
});

// ─── 3. Production HMAC secret fingerprint ───────────────────────────────────

describe("Production secret fingerprint", () => {
  test("KEVIN_CALLBACK_HMAC_SECRET has correct length and fingerprint", () => {
    const secret = process.env.KEVIN_CALLBACK_HMAC_SECRET;
    assert.ok(secret, "KEVIN_CALLBACK_HMAC_SECRET must be set in production");
    assert.equal(secret!.length, 64, "Secret must be exactly 64 characters");
    const prefix = sha256Hex(secret!).slice(0, 16);
    assert.equal(prefix, "9205e80778da2b21",
      `SHA-256 prefix mismatch. Expected 9205e80778da2b21, got ${prefix}. ` +
      "(Secret value does NOT appear in this error message.)"
    );
  });

  test("TRAINEFFICIENCY_KEVIN_SIGNING_SECRET matches KEVIN_CALLBACK_HMAC_SECRET fingerprint", () => {
    const secret = process.env.TRAINEFFICIENCY_KEVIN_SIGNING_SECRET;
    if (!secret) return; // optional — skip if not set
    const prefix = sha256Hex(secret).slice(0, 16);
    assert.equal(prefix, "9205e80778da2b21",
      `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET fingerprint mismatch: ${prefix}`
    );
  });

  test("KEVIN_OUTBOUND_HMAC_SECRET must equal KEVIN_CALLBACK_HMAC_SECRET (alias contract)", () => {
    const callback = process.env.KEVIN_CALLBACK_HMAC_SECRET;
    const outbound = process.env.KEVIN_OUTBOUND_HMAC_SECRET;
    if (!callback || !outbound) return; // skip if either unset
    // Compare via 32-char fingerprints — secret values never appear in output
    const callbackFp = sha256Hex(callback).slice(0, 32);
    const outboundFp = sha256Hex(outbound).slice(0, 32);
    assert.equal(outboundFp, callbackFp,
      "KEVIN_OUTBOUND_HMAC_SECRET fingerprint does not match KEVIN_CALLBACK_HMAC_SECRET. " +
      "These must be identical values. Secret values do NOT appear in this message. " +
      `KEVIN_OUTBOUND_HMAC_SECRET fingerprint=${outboundFp} KEVIN_CALLBACK_HMAC_SECRET fingerprint=${callbackFp}`
    );
  });

  test("secret value is never logged or included in error messages", () => {
    const result = verifyKevinCallbackHeaders({
      rawBody: "{}",
      timestampHeader: "0",   // deliberately stale
      signatureHeader: "v1=" + "0".repeat(64),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const secret = process.env.KEVIN_CALLBACK_HMAC_SECRET ?? "";
      if (secret) {
        assert.ok(
          !result.message?.includes(secret),
          "Secret value must never appear in error messages"
        );
        assert.ok(
          !result.code?.includes(secret),
          "Secret value must never appear in error codes"
        );
      }
    }
  });
});

// ─── 4. Base URL and integration configuration ────────────────────────────────

describe("Kevin base URL and integration configuration", () => {
  test("KEVIN_HERMES_BASE_URL points to correct production endpoint", () => {
    const url = process.env.KEVIN_HERMES_BASE_URL;
    assert.ok(url, "KEVIN_HERMES_BASE_URL must be set");
    assert.equal(url, "https://kevin-api.trainefficiency.com",
      `Expected https://kevin-api.trainefficiency.com, got ${url}`
    );
  });

  test("KEVIN_GATEWAY_BASE_URL matches KEVIN_HERMES_BASE_URL", () => {
    const hermes = process.env.KEVIN_HERMES_BASE_URL;
    const gateway = process.env.KEVIN_GATEWAY_BASE_URL;
    assert.ok(gateway, "KEVIN_GATEWAY_BASE_URL must be set");
    assert.equal(gateway, hermes,
      "KEVIN_GATEWAY_BASE_URL must equal KEVIN_HERMES_BASE_URL (same Kevin endpoint)"
    );
  });

  test("KEVIN_AGENT_INTEGRATION_ENABLED is true", () => {
    const val = process.env.KEVIN_AGENT_INTEGRATION_ENABLED;
    assert.ok(val === "true" || val === "1",
      `Expected "true" or "1", got "${val}"`
    );
  });

  test("no stale localhost or private-IP URL in KEVIN_HERMES_BASE_URL", () => {
    const url = (process.env.KEVIN_HERMES_BASE_URL ?? "").toLowerCase();
    assert.ok(!url.includes("localhost"), "Must not point at localhost");
    assert.ok(!url.includes("127.0.0.1"), "Must not point at 127.0.0.1");
    assert.ok(!url.includes("192.168."), "Must not point at private 192.168 subnet");
  });

  test("isKevinCallbackHmacConfigured returns true in production", () => {
    assert.equal(isKevinCallbackHmacConfigured(), true,
      "isKevinCallbackHmacConfigured() must return true when KEVIN_CALLBACK_HMAC_SECRET is set"
    );
  });
});

// ─── 5. postKevinAgentTask / dispatchKevinTask export ────────────────────────

describe("postKevinAgentTask canonical export", () => {
  test("postKevinAgentTask is exported from kevin-gateway-client", () => {
    assert.equal(typeof kevinGatewayClient.postKevinAgentTask, "function",
      "postKevinAgentTask must be exported as the canonical dispatch function"
    );
  });

  test("dispatchKevinTask is exported (backward compat)", () => {
    assert.equal(typeof kevinGatewayClient.dispatchKevinTask, "function");
  });

  test("postKevinAgentTask and dispatchKevinTask are the same function reference", () => {
    assert.equal(
      kevinGatewayClient.postKevinAgentTask,
      kevinGatewayClient.dispatchKevinTask,
      "Both names must reference the same function"
    );
  });
});

// ─── 6. Round-trip: sign → verify ─────────────────────────────────────────────

describe("Kevin v1 HMAC round-trip (sign → verify)", () => {
  test("message signed by signKevinOutboundBody verifies with verifyKevinCallbackHeaders", () => {
    const body = JSON.stringify({ schemaVersion: "1.0", taskId: "rt-test", status: "started" });
    const { headers } = signKevinOutboundBody(body);

    assert.ok(headers["x-kevin-timestamp"], "must have x-kevin-timestamp");
    assert.ok(headers["x-kevin-signature"], "must have x-kevin-signature");
    assert.match(headers["x-kevin-signature"], /^v1=[0-9a-f]+$/, "signature must be v1=<hex>");

    const result = verifyKevinCallbackHeaders({
      rawBody: body,
      timestampHeader: headers["x-kevin-timestamp"],
      signatureHeader: headers["x-kevin-signature"],
    });
    assert.equal(result.ok, true, `Round-trip verification failed: ${JSON.stringify(result)}`);
  });

  test("tampered body fails verification", () => {
    const body = JSON.stringify({ schemaVersion: "1.0", taskId: "tamper-test" });
    const { headers } = signKevinOutboundBody(body);

    const result = verifyKevinCallbackHeaders({
      rawBody: body + " ",   // tampered
      timestampHeader: headers["x-kevin-timestamp"],
      signatureHeader: headers["x-kevin-signature"],
    });
    assert.equal(result.ok, false, "Tampered body must fail verification");
  });

  test("missing timestamp returns MISSING_TIMESTAMP error code", () => {
    const result = verifyKevinCallbackHeaders({
      rawBody: "{}",
      timestampHeader: null as any,
      signatureHeader: "v1=" + "a".repeat(64),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "MISSING_TIMESTAMP");
    }
  });

  test("stale timestamp returns STALE_TIMESTAMP error code", () => {
    const result = verifyKevinOutboundRequest({
      secret: "test-secret",
      rawBody: "{}",
      timestampHeader: "1000000000",  // Unix 2001 — definitely stale
      signatureHeader: "v1=" + "a".repeat(64),
      nowSec: Math.floor(Date.now() / 1000),
      skewSec: 300,
      hmacSha256Hex,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "STALE_TIMESTAMP");
    }
  });

  test("wrong secret produces BAD_SIGNATURE", () => {
    const body = JSON.stringify({ taskId: "wrong-secret-test" });
    const correctResult = verifyKevinOutboundRequest({
      secret: "correct-secret",
      rawBody: body,
      timestampHeader: "1700000000",
      signatureHeader: "v1=" + hmacSha256Hex("wrong-secret", `v1:1700000000:${body}`),
      nowSec: 1700000000,
      skewSec: 300,
      hmacSha256Hex,
    });
    assert.equal(correctResult.ok, false);
    if (!correctResult.ok) {
      assert.equal(correctResult.code, "BAD_SIGNATURE");
    }
  });
});
