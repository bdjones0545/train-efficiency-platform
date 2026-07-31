/**
 * Deterministic Kevin↔TE HMAC test vector.
 * Python agent-gateway and TE Node must produce identical signatures.
 *
 * Fixed inputs (never rotate — golden vector for CI):
 *   secret    = test-vector-secret-32chars-aaaaaa
 *   timestamp = 1700000000
 *   rawBody   = {"schemaVersion":"1.0","event":"task.completed","jobId":"job_fixed","status":"completed"}
 *   base      = v1:1700000000:{rawBody}
 *   signature = v1=568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17
 */
import { createHmac } from "crypto";
import assert from "node:assert/strict";
import {
  buildKevinOutboundSigBase,
  formatKevinOutboundSignatureHeader,
  verifyKevinOutboundRequest,
} from "../../shared/kevin/outbound-hmac";

const SECRET = "test-vector-secret-32chars-aaaaaa";
const TS = "1700000000";
const RAW =
  '{"schemaVersion":"1.0","event":"task.completed","jobId":"job_fixed","status":"completed"}';
const EXPECTED_HEX =
  "568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17";

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function main() {
  const base = buildKevinOutboundSigBase(TS, RAW);
  assert.equal(base, `v1:${TS}:${RAW}`);
  const hex = hmacSha256Hex(SECRET, base);
  assert.equal(hex, EXPECTED_HEX);
  const header = formatKevinOutboundSignatureHeader(hex);
  assert.equal(header, `v1=${EXPECTED_HEX}`);

  const ok = verifyKevinOutboundRequest({
    secret: SECRET,
    rawBody: RAW,
    timestampHeader: TS,
    signatureHeader: header,
    nowSec: 1700000000,
    skewSec: 300,
    hmacSha256Hex,
  });
  assert.equal(ok.ok, true);

  const bad = verifyKevinOutboundRequest({
    secret: SECRET,
    rawBody: RAW,
    timestampHeader: TS,
    signatureHeader: "v1=" + "0".repeat(64),
    nowSec: 1700000000,
    skewSec: 300,
    hmacSha256Hex,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, "BAD_SIGNATURE");

  // Re-serialized pretty body must NOT verify against compact signature
  const pretty = JSON.stringify(JSON.parse(RAW), null, 2);
  const prettyVerify = verifyKevinOutboundRequest({
    secret: SECRET,
    rawBody: pretty,
    timestampHeader: TS,
    signatureHeader: header,
    nowSec: 1700000000,
    skewSec: 300,
    hmacSha256Hex,
  });
  assert.equal(prettyVerify.ok, false);

  console.log(
    JSON.stringify({
      ok: true,
      expectedHex: EXPECTED_HEX,
      header,
      note: "Matches Kevin services/agent_gateway hmac_auth.py golden vector",
    }),
  );
}

main();
