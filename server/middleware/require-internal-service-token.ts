/**
 * requireInternalServiceToken — internal service-to-service auth.
 *
 * Protects endpoints that must only be called from the Kevin/Hermes runtime,
 * not from browsers or user sessions.
 *
 * Security rules:
 * - Token read from TE_INTERNAL_SERVICE_TOKEN env var (server-only).
 * - Compared using timingSafeEqual to prevent timing attacks.
 * - The token is NEVER logged, returned in responses, or included in audit payloads.
 * - Errors are generic — never reveal which part of validation failed.
 * - Browser session authentication is NOT a valid substitute.
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual, createHash } from "crypto";

function getExpectedToken(): Buffer | null {
  const raw = (process.env.TE_INTERNAL_SERVICE_TOKEN || "").trim();
  if (!raw || raw.length < 24) return null;
  return Buffer.from(raw, "utf8");
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
  const expected = getExpectedToken();
  if (!expected) {
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
  if (!safeCompare(expected, provided)) {
    res.status(401).json({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    return;
  }

  next();
}

/**
 * Returns true if the internal service token is properly configured.
 * Safe to call anywhere — does not expose the token value.
 */
export function isInternalServiceTokenConfigured(): boolean {
  return getExpectedToken() !== null;
}
