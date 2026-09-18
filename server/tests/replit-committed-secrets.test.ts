/**
 * Committed-secrets guard for `.replit`.
 *
 * `.replit` is committed to a PUBLIC repository and its `[userenv.*]` sections
 * are loaded into the workspace and deployment environment. On 2026-07-29 three
 * live HMAC secrets (KEVIN_OUTBOUND_HMAC_SECRET, KEVIN_CALLBACK_HMAC_SECRET,
 * KEVIN_INBOUND_HMAC_SECRET) were committed there — the very values the Kevin
 * webhook routes use to verify inbound callbacks. Anyone with the repository
 * could sign a callback. Secrets belong in Replit Secrets / the deployment
 * environment only, exactly as the ADMIN_REPAIR_KEY comment in the file says.
 *
 * This test fails if any environment key whose name marks it as a credential
 * carries a non-empty value in `.replit`.
 *
 * Run with:
 *   node --import tsx --test server/tests/replit-committed-secrets.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const replitSrc = readFileSync(path.join(repoRoot, ".replit"), "utf8");

// Names that denote credentials. `_KEY_ID`, `_ENABLED`, `_URL`, `_ID`, `_MS`
// are identifiers/flags, not secrets, and are excluded by construction.
const CREDENTIAL_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|AUTH_KEY|SIGNING_KEY|ENCRYPTION_KEY|REPAIR_KEY|WEBHOOK_KEY)$/;

function envAssignments(): Array<{ line: number; key: string; value: string }> {
  const out: Array<{ line: number; key: string; value: string }> = [];
  replitSrc.split("\n").forEach((raw, i) => {
    const m = raw.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"(.*)"\s*$/);
    if (m) out.push({ line: i + 1, key: m[1], value: m[2] });
  });
  return out;
}

test(".replit assigns at least one environment variable (parser sanity)", () => {
  assert.ok(envAssignments().length > 0, "expected [userenv] assignments in .replit");
});

test("no credential-named variable in .replit carries a value", () => {
  const offenders = envAssignments().filter(
    (a) => CREDENTIAL_NAME.test(a.key) && a.value.trim().length > 0,
  );
  assert.deepEqual(
    offenders.map((o) => `${o.key} (line ${o.line}, ${o.value.length} chars)`),
    [],
    "credential values must live in Replit Secrets, never in the committed .replit",
  );
});

test("the three Kevin HMAC secrets are not assigned in .replit at all", () => {
  for (const key of [
    "KEVIN_OUTBOUND_HMAC_SECRET",
    "KEVIN_CALLBACK_HMAC_SECRET",
    "KEVIN_INBOUND_HMAC_SECRET",
  ]) {
    assert.ok(
      !envAssignments().some((a) => a.key === key),
      `${key} must not be assigned in .replit (rotate it and set it in Replit Secrets)`,
    );
  }
});
