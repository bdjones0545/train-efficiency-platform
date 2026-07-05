/**
 * Phase 0 security hardening — unit tests.
 *
 * Covers:
 *   - hashAuthToken: deterministic, non-reversible, distinct per input
 *   - getSessionSecret / getCredentialEncryptionKey: dev fallbacks + separation
 *   - assertRequiredSecrets: fails closed in production
 *   - credentials vault: encrypt/decrypt round-trip still works
 *
 * No server or database required.
 *
 * Run with:
 *   npx tsx server/tests/secrets-and-token-hash.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { hashAuthToken } from "../lib/auth-token";
import {
  getSessionSecret,
  getCredentialEncryptionKey,
  assertRequiredSecrets,
} from "../lib/secrets";
import { encryptCredentials, decryptCredentials } from "../credentials-vault";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const keys = Object.keys(overrides);
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── hashAuthToken ───────────────────────────────────────────────────────────
test("hashAuthToken is deterministic and returns a 64-char hex digest", () => {
  const raw = "abc123";
  const h1 = hashAuthToken(raw);
  const h2 = hashAuthToken(raw);
  assert.equal(h1, h2, "same input must hash identically");
  assert.match(h1, /^[0-9a-f]{64}$/, "must be sha256 hex");
});

test("hashAuthToken never returns the raw token and differs per input", () => {
  const raw = "super-secret-token";
  assert.notEqual(hashAuthToken(raw), raw, "hash must not equal raw token");
  assert.notEqual(hashAuthToken("a"), hashAuthToken("b"), "distinct inputs differ");
});

// ─── getSessionSecret ────────────────────────────────────────────────────────
test("getSessionSecret returns env value when set", () => {
  withEnv({ NODE_ENV: "development", SESSION_SECRET: "my-session-secret" }, () => {
    assert.equal(getSessionSecret(), "my-session-secret");
  });
});

test("getSessionSecret uses a dev fallback in development when unset", () => {
  withEnv({ NODE_ENV: "development", SESSION_SECRET: undefined }, () => {
    assert.equal(typeof getSessionSecret(), "string");
    assert.ok(getSessionSecret().length > 0);
  });
});

// ─── getCredentialEncryptionKey ──────────────────────────────────────────────
test("credential key is a 32-byte buffer and is NOT derived from SESSION_SECRET", () => {
  withEnv(
    {
      NODE_ENV: "development",
      SESSION_SECRET: "the-session-secret",
      CREDENTIAL_ENCRYPTION_KEY: "the-credential-key-which-is-32chrs!",
    },
    () => {
      const key = getCredentialEncryptionKey();
      assert.equal(key.length, 32, "AES-256 key must be 32 bytes");

      // Key derived from SESSION_SECRET would collide; it must not.
      const fromSession = crypto.createHash("sha256").update("the-session-secret").digest();
      assert.notDeepEqual(key, fromSession, "credential key must not derive from SESSION_SECRET");
    },
  );
});

// ─── assertRequiredSecrets (fail closed in prod) ─────────────────────────────
test("assertRequiredSecrets is a no-op in development", () => {
  withEnv(
    { NODE_ENV: "development", SESSION_SECRET: undefined, CREDENTIAL_ENCRYPTION_KEY: undefined },
    () => {
      assert.doesNotThrow(() => assertRequiredSecrets());
    },
  );
});

test("assertRequiredSecrets throws in production when a secret is missing", () => {
  withEnv(
    { NODE_ENV: "production", SESSION_SECRET: "x".repeat(40), CREDENTIAL_ENCRYPTION_KEY: undefined },
    () => {
      assert.throws(() => assertRequiredSecrets(), /CREDENTIAL_ENCRYPTION_KEY/);
    },
  );
});

test("assertRequiredSecrets throws in production when secrets collide", () => {
  const same = "y".repeat(40);
  withEnv(
    { NODE_ENV: "production", SESSION_SECRET: same, CREDENTIAL_ENCRYPTION_KEY: same },
    () => {
      assert.throws(() => assertRequiredSecrets(), /must be different/);
    },
  );
});

test("assertRequiredSecrets passes in production when both are set and distinct", () => {
  withEnv(
    {
      NODE_ENV: "production",
      SESSION_SECRET: "s".repeat(40),
      CREDENTIAL_ENCRYPTION_KEY: "c".repeat(40),
    },
    () => {
      assert.doesNotThrow(() => assertRequiredSecrets());
    },
  );
});

// ─── credentials vault round-trip ────────────────────────────────────────────
test("credentials vault encrypt/decrypt round-trips with a dedicated key", () => {
  withEnv(
    { NODE_ENV: "development", CREDENTIAL_ENCRYPTION_KEY: "vault-key-vault-key-vault-key-32!" },
    () => {
      const secret = { apiKey: "sk-live-1234", refreshToken: "rt-abcd" };
      const envelope = encryptCredentials(secret);
      assert.notEqual((envelope as any)._enc, undefined, "envelope must be encrypted");
      const round = decryptCredentials(envelope);
      assert.deepEqual(round, secret, "decrypt must recover original credentials");
    },
  );
});
