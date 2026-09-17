/**
 * requireInternalServiceToken — internal service-to-service auth.
 *
 * Protects endpoints that must only be called from the Kevin/Hermes runtime,
 * not from browsers or user sessions.
 *
 * Security rules:
 * - Token read from TE_INTERNAL_SERVICE_TOKEN env var (server-only).
 * - TE_INTERNAL_SERVICE_TOKEN_NEW is ALSO accepted while set, so the token can
 *   be rotated with no downtime: set _NEW → switch Kevin to it → move _NEW into
 *   TE_INTERNAL_SERVICE_TOKEN → unset _NEW. (docs/kevin-integration.md §2.)
 *   Every candidate is compared, with no early exit, so acceptance time does not
 *   depend on which token matched.
 * - Compared using timingSafeEqual to prevent timing attacks.
 * - The token is NEVER logged, returned in responses, or included in audit payloads.
 * - Errors are generic — never reveal which part of validation failed.
 * - Browser session authentication is NOT a valid substitute.
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual, createHash } from "crypto";

/** Env vars that may hold a currently-valid token, in precedence order. */
const TOKEN_ENV_VARS = ["TE_INTERNAL_SERVICE_TOKEN", "TE_INTERNAL_SERVICE_TOKEN_NEW"] as const;

/**
 * All configured tokens. During rotation both the current and the _NEW token
 * are valid; outside rotation there is exactly one.
 */
function getExpectedTokens(): Buffer[] {
  const tokens: Buffer[] = [];
  for (const name of TOKEN_ENV_VARS) {
    const raw = (process.env[name] || "").trim();
    if (raw.length >= 24) tokens.push(Buffer.from(raw, "utf8"));
  }
  return tokens;
}

/**
 * Extract bearer token from Authorization header.
 * Returns null for missing or malformed header.
 */
function extractBearer(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Timing-safe token comparison.
 * Pads both buffers to the same length to prevent length-based leakage.
 */
function safeCompare(a: Buffer, b: Buffer): boolean {
  // Hash both to normalize length and prevent timing leakage
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Express middleware. Must be used BEFORE isAuthenticated on internal routes.
 * Rejects any request that does not carry the correct internal service token.
 */
export function requireInternalServiceToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getExpectedTokens();
  if (expected.length === 0) {
    // Token not configured — reject all requests (fail-closed for security)
    res.status(503).json({
      message: "Internal service endpoint unavailable",
      code: "INTERNAL_TOKEN_NOT_CONFIGURED",
    });
    return;
  }

  const raw = extractBearer(req);
  if (!raw) {
    res.status(401).json({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const provided = Buffer.from(raw, "utf8");
  // Compare against every configured token without short-circuiting: a bitwise
  // OR keeps the work constant whether the current or the _NEW token matched.
  let matched = 0;
  for (const candidate of expected) {
    matched |= safeCompare(candidate, provided) ? 1 : 0;
  }
  if (matched !== 1) {
    res.status(401).json({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    return;
  }

  next();
}

/**
 * Returns true if at least one internal service token is properly configured.
 * Safe to call anywhere — does not expose the token value.
 */
export function isInternalServiceTokenConfigured(): boolean {
  return getExpectedTokens().length > 0;
}

/**
 * True while a rotation is in progress (TE_INTERNAL_SERVICE_TOKEN_NEW is set to
 * a usable value). Exposed for operational visibility only — never the value.
 */
export function isInternalServiceTokenRotating(): boolean {
  return (process.env.TE_INTERNAL_SERVICE_TOKEN_NEW || "").trim().length >= 24;
}
