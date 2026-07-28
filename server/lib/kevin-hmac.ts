/**
 * kevin-hmac.ts — HMAC signing and verification for Kevin gateway integration.
 *
 * Outbound: TrainEfficiency signs requests to Kevin with KEVIN_OUTBOUND_HMAC_SECRET.
 * Inbound:  TrainEfficiency verifies callbacks from Kevin with KEVIN_CALLBACK_HMAC_SECRET.
 *
 * Security properties:
 *  - SHA-256 HMAC
 *  - Constant-time comparison for verification
 *  - Timestamp validation with configurable skew window
 *  - Deterministic canonical serialization (sorted JSON keys)
 *  - Secrets never logged
 */

import crypto from "node:crypto";

// ─── Canonical serialization ──────────────────────────────────────────────────

/**
 * Produces a deterministic JSON string regardless of key insertion order.
 * Prevents accidental signature differences caused by object key ordering.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return value;
  });
}

// ─── Body hash ───────────────────────────────────────────────────────────────

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ─── Canonical request string ────────────────────────────────────────────────

/**
 * Produces the canonical request string that is HMAC-signed.
 * Format:
 *   {METHOD}\n{PATH}\n{TIMESTAMP}\n{REQUEST-ID}\n{BODY-SHA256}
 *
 * All components are controlled by the signing party; none are user-supplied
 * from query params or headers that the browser could forge.
 */
export function buildCanonicalRequest(
  method: string,
  path: string,
  timestamp: string,
  requestId: string,
  bodySha256: string,
): string {
  return [
    method.toUpperCase(),
    path,
    timestamp,
    requestId,
    bodySha256,
  ].join("\n");
}

// ─── Outbound signing ─────────────────────────────────────────────────────────

export interface OutboundSigningResult {
  /** ISO-8601 UTC timestamp used in the signature */
  timestamp: string;
  /** Unique request identifier */
  requestId: string;
  /** SHA-256 hex of the raw body bytes */
  bodySha256: string;
  /** Full HMAC-SHA256 hex signature (do not log) */
  signature: string;
}

/**
 * Signs an outbound request to Kevin.
 * Returns header values — caller attaches them to the HTTP request.
 */
export function signOutboundRequest(
  method: string,
  path: string,
  body: string,
  secret: string,
): OutboundSigningResult {
  const timestamp = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const bodySha256 = sha256Hex(body);
  const canonical = buildCanonicalRequest(method, path, timestamp, requestId, bodySha256);
  const signature = crypto.createHmac("sha256", secret).update(canonical).digest("hex");

  return { timestamp, requestId, bodySha256, signature };
}

/**
 * Builds the full set of outbound headers for a signed request to Kevin.
 */
export function buildSignedHeaders(
  method: string,
  path: string,
  body: string,
  secret: string,
  correlationId: string,
  idempotencyKey: string,
): Record<string, string> {
  const { timestamp, requestId, bodySha256, signature } = signOutboundRequest(
    method,
    path,
    body,
    secret,
  );

  return {
    "Content-Type": "application/json",
    "X-TE-Timestamp": timestamp,
    "X-TE-Request-ID": requestId,
    "X-TE-Correlation-ID": correlationId,
    "X-TE-Idempotency-Key": idempotencyKey,
    "X-TE-Body-SHA256": bodySha256,
    // Prefix with "sha256=" to match common HMAC header conventions
    "X-TE-Signature": `sha256=${signature}`,
  };
}

// ─── Inbound callback verification ───────────────────────────────────────────

export type CallbackVerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies an inbound signed callback from Kevin.
 *
 * Expected callback headers:
 *   X-Kevin-Timestamp   — ISO-8601
 *   X-Kevin-Request-ID  — UUID
 *   X-Kevin-Signature   — sha256={hex}
 *
 * Signature covers:
 *   POST\n/api/agent-callbacks/kevin\n{timestamp}\n{requestId}\n{bodySha256}
 */
export function verifyCallbackSignature(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  allowedSkewSeconds: number,
): CallbackVerificationResult {
  const timestamp = extractHeader(headers, "x-kevin-timestamp");
  const requestId = extractHeader(headers, "x-kevin-request-id");
  const sigHeader = extractHeader(headers, "x-kevin-signature");

  if (!timestamp || !requestId || !sigHeader) {
    return {
      ok: false,
      reason: "missing_signature_headers",
    };
  }

  // Validate timestamp format and skew
  const ts = Date.parse(timestamp);
  if (isNaN(ts)) {
    return { ok: false, reason: "invalid_timestamp_format" };
  }
  const skewMs = Math.abs(Date.now() - ts);
  if (skewMs > allowedSkewSeconds * 1000) {
    return {
      ok: false,
      reason: `timestamp_out_of_window (skew=${Math.round(skewMs / 1000)}s, allowed=${allowedSkewSeconds}s)`,
    };
  }

  // Extract expected signature value
  const expectedPrefix = "sha256=";
  if (!sigHeader.startsWith(expectedPrefix)) {
    return { ok: false, reason: "invalid_signature_format" };
  }
  const providedSigHex = sigHeader.slice(expectedPrefix.length);

  // Compute expected signature
  const bodySha256 = sha256Hex(rawBody);
  const canonical = buildCanonicalRequest(
    "POST",
    "/api/agent-callbacks/kevin",
    timestamp,
    requestId,
    bodySha256,
  );
  const expectedSig = crypto.createHmac("sha256", secret).update(canonical).digest("hex");

  // Constant-time comparison
  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(providedSigHex, "hex");
    expected = Buffer.from(expectedSig, "hex");
  } catch {
    return { ok: false, reason: "signature_decode_failed" };
  }

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
