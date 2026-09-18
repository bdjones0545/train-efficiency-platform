/**
 * Signed OAuth `state` parameter shared by every OAuth redirect flow
 * (Gmail, Google Calendar, ...).
 *
 * The public OAuth callback derives the organisation to bind tokens to from
 * this value, so it must be unforgeable: an unsigned `state=<orgId>` would let
 * anyone bind THEIR provider account to ANY organisation (org ids are public).
 *
 * Format (unchanged from the original Gmail implementation, so states issued
 * before this module existed keep verifying):
 *   base64url( JSON({ orgId, nonce, ts, ...extra, sig }) )
 *   sig = HMAC-SHA256( SESSION_SECRET, JSON({ orgId, nonce, ts, ...extra }) )
 *
 * Verification is timing-safe and rejects states older than 15 minutes.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "./secrets";

export const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

/** Clock skew tolerated for a state whose timestamp is in the future. */
const FUTURE_SKEW_MS = 60 * 1000;

export type OAuthStateExtra = Record<string, string | boolean>;

export type VerifiedOAuthState = {
  orgId: string;
  nonce: string;
  ts: number;
  extra: Record<string, unknown>;
};

const RESERVED_KEYS = new Set(["orgId", "nonce", "ts", "sig"]);

function sign(raw: string): string {
  return createHmac("sha256", getSessionSecret()).update(raw).digest("hex");
}

export function buildOAuthState(orgId: string, extra: OAuthStateExtra = {}): string {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error("buildOAuthState requires a non-empty orgId");
  }
  const payload: Record<string, string | boolean> = {
    orgId,
    nonce: randomBytes(16).toString("hex"),
    ts: String(Date.now()),
  };
  for (const [key, value] of Object.entries(extra)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`OAuth state extra field "${key}" is reserved`);
    if (value === undefined || value === null) continue;
    payload[key] = value;
  }
  const sig = sign(JSON.stringify(payload));
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

/**
 * Returns the verified payload, or null when the state is missing, malformed,
 * unsigned, tampered with, or expired. Never throws.
 */
export function verifyOAuthState(state: unknown, now: number = Date.now()): VerifiedOAuthState | null {
  if (typeof state !== "string" || state.length === 0) return null;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const { sig, ...payload } = decoded as Record<string, unknown>;
    if (typeof sig !== "string") return null;

    const expected = Buffer.from(sign(JSON.stringify(payload)), "utf8");
    const provided = Buffer.from(sig, "utf8");
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    const { orgId, nonce, ts, ...extra } = payload;
    if (typeof orgId !== "string" || orgId.length === 0) return null;
    if (typeof nonce !== "string" || nonce.length === 0) return null;
    const issuedAt = typeof ts === "string" || typeof ts === "number" ? Number(ts) : NaN;
    if (!Number.isFinite(issuedAt)) return null;
    const age = now - issuedAt;
    if (age > OAUTH_STATE_MAX_AGE_MS || age < -FUTURE_SKEW_MS) return null;

    return { orgId, nonce, ts: issuedAt, extra };
  } catch {
    return null;
  }
}
