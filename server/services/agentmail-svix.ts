/**
 * AgentMail / Svix Webhook Signature Verification
 *
 * AgentMail uses Svix to deliver webhooks.  Every delivery includes three
 * required headers that must be verified before processing any event:
 *
 *   svix-id        — Unique delivery ID (same for retries of the same event).
 *   svix-timestamp — Unix timestamp in seconds when the message was sent.
 *   svix-signature — Space-delimited list of "v1,<base64>" HMAC-SHA256 signatures.
 *
 * Signed content:  `${svix-id}.${svix-timestamp}.${rawBodyUtf8}`
 * Signing key:     base64-decode of the part after "whsec_" in the secret.
 *
 * Reference: https://www.agentmail.to/docs/webhook-verification
 *            https://docs.svix.com/receiving/verifying-payloads/how-manual
 *
 * Invariants enforced by this module:
 *   - AGENTMAIL_WEBHOOK_SECRET not set → always reject (503-class: unavailable).
 *   - Missing any svix-* header → reject 401.
 *   - svix-timestamp malformed (trailing junk, decimal, whitespace) → reject 401.
 *   - Timestamp outside ±5 minutes → reject 401 (replay protection).
 *   - No signature match → reject 401.
 *   - Malformed signature bytes → reject 401.
 *   - There is NO unsigned/development bypass mode.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** Tolerance window in seconds (±5 minutes matches Svix default). */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface SvixVerifyResult {
  ok: boolean;
  /** Human-readable reason for rejection. Never leak DB/secret details. */
  error?: string;
  /** HTTP status code the caller should use on rejection. */
  httpStatus?: 401 | 503;
}

/**
 * Verify an AgentMail / Svix webhook delivery.
 *
 * @param rawBody  Exact raw request bytes — MUST be the original network bytes,
 *                 not re-serialized from a parsed object (JSON.stringify is forbidden).
 * @param headers  Express request headers (lowercase keys).
 *
 * @returns { ok: true } on success.
 *          { ok: false, error, httpStatus } on any failure.
 */
export function verifyAgentMailWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): SvixVerifyResult {
  const webhookSecret = process.env.AGENTMAIL_WEBHOOK_SECRET ?? "";

  // ── No secret → webhook unavailable in ALL environments ───────────────────
  // There is no unsigned production mode, and no development bypass.
  // Without a secret we cannot verify authenticity; return 503 so the provider
  // retries rather than silently consuming a potentially spoofed event.
  if (!webhookSecret) {
    return {
      ok: false,
      error: "Webhook verification not configured (AGENTMAIL_WEBHOOK_SECRET missing)",
      httpStatus: 503,
    };
  }

  // ── Extract required Svix headers ─────────────────────────────────────────
  const msgId        = getHeader(headers, "svix-id");
  const msgTimestamp = getHeader(headers, "svix-timestamp");
  const msgSig       = getHeader(headers, "svix-signature");

  if (!msgId || !msgTimestamp || !msgSig) {
    const missing = [
      !msgId        && "svix-id",
      !msgTimestamp && "svix-timestamp",
      !msgSig       && "svix-signature",
    ].filter(Boolean).join(", ");
    return { ok: false, error: `Missing required webhook headers: ${missing}`, httpStatus: 401 };
  }

  // ── Strict timestamp validation ────────────────────────────────────────────
  // parseInt() accepts trailing junk ("1724200000junk" → 1724200000).
  // We require the ENTIRE string to be a valid integer representation:
  //   - Only digits, optionally prefixed by "-"
  //   - No decimals, no trailing characters, no whitespace
  //   - Empty string rejected
  //   - Negative timestamps rejected (no valid Svix timestamp is negative)
  //   - Overflow/unreasonably large values rejected
  if (!/^\d+$/.test(msgTimestamp)) {
    return {
      ok: false,
      error:
        "svix-timestamp must be a non-negative integer with no trailing characters, " +
        `decimals, or whitespace (received: ${JSON.stringify(msgTimestamp)})`,
      httpStatus: 401,
    };
  }

  const tsSeconds = Number(msgTimestamp);

  // Guard overflow (Number() returns Infinity for very large strings) and
  // implausible future timestamps (year ~2286+).
  if (!Number.isFinite(tsSeconds) || tsSeconds > 9_999_999_999 || tsSeconds < 0) {
    return {
      ok: false,
      error: `svix-timestamp value is out of valid range (received: ${msgTimestamp})`,
      httpStatus: 401,
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSec = nowSeconds - tsSeconds;
  if (Math.abs(ageSec) > TIMESTAMP_TOLERANCE_SECONDS) {
    return {
      ok: false,
      error: `Webhook timestamp out of tolerance (age: ${ageSec}s, max: ±${TIMESTAMP_TOLERANCE_SECONDS}s)`,
      httpStatus: 401,
    };
  }

  // ── Decode signing secret ──────────────────────────────────────────────────
  // AgentMail signing secrets: "whsec_<base64>".
  // Strip the prefix if present; otherwise treat the whole value as base64.
  const secretBase64 = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice("whsec_".length)
    : webhookSecret;

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretBase64, "base64");
    if (secretBytes.length === 0) throw new Error("empty");
  } catch {
    return { ok: false, error: "Webhook secret has invalid encoding", httpStatus: 503 };
  }

  // ── Compute expected signature ─────────────────────────────────────────────
  // Signed content: "svix-id . svix-timestamp . raw-body-utf8"
  // The body MUST be the original network bytes — not re-serialized JSON.
  const bodyString     = rawBody.toString("utf8");
  const signedContent  = `${msgId}.${msgTimestamp}.${bodyString}`;
  const expectedDigest = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf    = Buffer.from(expectedDigest, "base64");

  // ── Match against all candidates in svix-signature ────────────────────────
  // Format: "v1,<base64> v1,<base64>" (space-delimited; may contain multiple).
  const candidates = msgSig
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter(Boolean);

  if (candidates.length === 0) {
    return { ok: false, error: "svix-signature contains no valid candidates", httpStatus: 401 };
  }

  const matched = candidates.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "base64");
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });

  if (!matched) {
    return { ok: false, error: "Webhook signature verification failed", httpStatus: 401 };
  }

  return { ok: true };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * Build a test-fixture signature for behavioral tests.
 * Given a secret, msgId, timestamp, and rawBody, returns the svix-signature
 * header value that would pass verifyAgentMailWebhook().
 *
 * Only for test use — never called in production paths.
 */
export function buildTestSvixSignature(
  secret: string,
  msgId: string,
  tsSeconds: number,
  rawBody: string,
): string {
  const secretBase64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const secretBytes  = Buffer.from(secretBase64, "base64");
  const signed       = `${msgId}.${tsSeconds}.${rawBody}`;
  const sig          = createHmac("sha256", secretBytes).update(signed).digest("base64");
  return `v1,${sig}`;
}
