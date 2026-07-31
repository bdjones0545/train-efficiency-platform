/**
 * Kevin ↔ TrainEfficiency callback HMAC plane (Kevin → TE callbacks / webhooks).
 *
 * Env resolve order (same value on all names when present):
 *   1. KEVIN_CALLBACK_HMAC_SECRET     — preferred TE/Replit name (callback receive)
 *   2. KEVIN_OUTBOUND_HMAC_SECRET     — alternate TE name (Kevin sign side)
 *   3. TRAINEFFICIENCY_KEVIN_SIGNING_SECRET — legacy alias
 *
 * Pure helpers — no Node crypto binding required for unit tests with injectables.
 * Scheme v1 (Slack-like):
 *   base = `v1:${timestampSec}:${rawBody}`
 *   signature header = `v1=<hex(hmac_sha256(secret, base))`
 *   header names: x-kevin-timestamp, x-kevin-signature
 *
 * TE_INTERNAL_SERVICE_TOKEN is a separate bearer plane — do not overload this secret.
 */

/** Preferred TE/Replit name for Kevin→TE callback HMAC. */
export const KEVIN_CALLBACK_HMAC_ENV = "KEVIN_CALLBACK_HMAC_SECRET" as const;
/** Alternate name (same value) — Kevin outbound / historical preferred. */
export const KEVIN_OUTBOUND_HMAC_ENV_PREFERRED = "KEVIN_OUTBOUND_HMAC_SECRET" as const;
export const KEVIN_OUTBOUND_HMAC_ENV_LEGACY = "TRAINEFFICIENCY_KEVIN_SIGNING_SECRET" as const;

/** Ordered list used by resolver (first hit wins). */
export const KEVIN_CALLBACK_HMAC_ENV_CHAIN = [
  KEVIN_CALLBACK_HMAC_ENV,
  KEVIN_OUTBOUND_HMAC_ENV_PREFERRED,
  KEVIN_OUTBOUND_HMAC_ENV_LEGACY,
] as const;

export const KEVIN_OUTBOUND_SIG_HEADER = "x-kevin-signature";
export const KEVIN_OUTBOUND_TS_HEADER = "x-kevin-timestamp";
export const KEVIN_OUTBOUND_SIG_VERSION = "v1";

/** Env: max |now - x-kevin-timestamp| accepted on TE callback verify (seconds). */
export const KEVIN_CALLBACK_ALLOWED_SKEW_ENV = "KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS" as const;
export const KEVIN_CALLBACK_DEFAULT_SKEW_SEC = 300;

export type EnvLike = Record<string, string | undefined>;

/** Parse non-negative int seconds with clamp. Invalid/empty → fallback. */
export function parseKevinSkewSeconds(
  raw: string | undefined | null,
  fallback: number = KEVIN_CALLBACK_DEFAULT_SKEW_SEC,
  minSec = 30,
  maxSec = 3_600,
): number {
  const fb = Math.min(maxSec, Math.max(minSec, Math.floor(fallback)));
  if (raw == null || !String(raw).trim()) return fb;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return fb;
  return Math.min(maxSec, Math.max(minSec, Math.floor(n)));
}

/** TE callback timestamp skew from env KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS (default 300). */
export function getKevinCallbackAllowedSkewSeconds(env: EnvLike = {}): number {
  return parseKevinSkewSeconds(env[KEVIN_CALLBACK_ALLOWED_SKEW_ENV], KEVIN_CALLBACK_DEFAULT_SKEW_SEC);
}

/** Resolve HMAC secret: callback → outbound → legacy. */
export function resolveKevinOutboundHmacSecret(env: EnvLike = {}): string | null {
  for (const key of KEVIN_CALLBACK_HMAC_ENV_CHAIN) {
    const v = (env[key] || "").trim();
    if (v) return v;
  }
  return null;
}

/** @deprecated alias — same as resolveKevinOutboundHmacSecret */
export const resolveKevinCallbackHmacSecret = resolveKevinOutboundHmacSecret;

export function whichKevinOutboundHmacEnv(env: EnvLike = {}): string | null {
  for (const key of KEVIN_CALLBACK_HMAC_ENV_CHAIN) {
    if ((env[key] || "").trim()) return key;
  }
  return null;
}

export const whichKevinCallbackHmacEnv = whichKevinOutboundHmacEnv;

export function buildKevinOutboundSigBase(timestampSec: string | number, rawBody: string): string {
  return `${KEVIN_OUTBOUND_SIG_VERSION}:${timestampSec}:${rawBody}`;
}

export function formatKevinOutboundSignatureHeader(hexDigest: string): string {
  const h = hexDigest.trim().toLowerCase();
  return `${KEVIN_OUTBOUND_SIG_VERSION}=${h}`;
}

export function parseKevinOutboundSignatureHeader(header: string | null | undefined): {
  version: string;
  hex: string;
} | null {
  if (!header) return null;
  const s = header.trim();
  const m = /^(v\d+)=([0-9a-fA-F]+)$/.exec(s);
  if (!m) return null;
  return { version: m[1], hex: m[2].toLowerCase() };
}

export function isKevinOutboundTimestampFresh(
  timestampSec: number,
  nowSec: number,
  skewSec = 60 * 5,
): boolean {
  if (!Number.isFinite(timestampSec) || !Number.isFinite(nowSec)) return false;
  return Math.abs(nowSec - timestampSec) <= skewSec;
}

/** Constant-time hex compare (length must match). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export type HmacSha256Hex = (secret: string, message: string) => string;

/**
 * Verify inbound Kevin→TE request signature.
 * `hmacSha256Hex` must be provided by the server (Node crypto) or test double.
 */
export function verifyKevinOutboundRequest(opts: {
  secret: string;
  rawBody: string;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  nowSec?: number;
  skewSec?: number;
  hmacSha256Hex: HmacSha256Hex;
}): { ok: true } | { ok: false; code: string; message: string } {
  const tsRaw = (opts.timestampHeader || "").trim();
  if (!tsRaw || !/^\d+$/.test(tsRaw)) {
    return { ok: false, code: "MISSING_TIMESTAMP", message: "Missing or invalid x-kevin-timestamp" };
  }
  const ts = Number(tsRaw);
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (!isKevinOutboundTimestampFresh(ts, now, opts.skewSec ?? KEVIN_CALLBACK_DEFAULT_SKEW_SEC)) {
    return { ok: false, code: "STALE_TIMESTAMP", message: "x-kevin-timestamp outside allowed skew" };
  }
  const parsed = parseKevinOutboundSignatureHeader(opts.signatureHeader);
  if (!parsed) {
    return { ok: false, code: "MISSING_SIGNATURE", message: "Missing or invalid x-kevin-signature" };
  }
  if (parsed.version !== KEVIN_OUTBOUND_SIG_VERSION) {
    return { ok: false, code: "BAD_VERSION", message: `Unsupported signature version ${parsed.version}` };
  }
  const base = buildKevinOutboundSigBase(tsRaw, opts.rawBody);
  const expectedHex = opts.hmacSha256Hex(opts.secret, base).toLowerCase();
  if (!timingSafeEqualHex(expectedHex, parsed.hex)) {
    return { ok: false, code: "BAD_SIGNATURE", message: "Invalid Kevin outbound HMAC signature" };
  }
  return { ok: true };
}

/** Build headers for a Kevin→TE signed request (caller supplies hmac). */
export function buildKevinOutboundAuthHeaders(opts: {
  secret: string;
  rawBody: string;
  timestampSec?: number;
  hmacSha256Hex: HmacSha256Hex;
}): Record<string, string> {
  const ts = String(opts.timestampSec ?? Math.floor(Date.now() / 1000));
  const base = buildKevinOutboundSigBase(ts, opts.rawBody);
  const hex = opts.hmacSha256Hex(opts.secret, base).toLowerCase();
  return {
    [KEVIN_OUTBOUND_TS_HEADER]: ts,
    [KEVIN_OUTBOUND_SIG_HEADER]: formatKevinOutboundSignatureHeader(hex),
  };
}
