/**
 * Kevin Slack EOH — Request Signature Verification
 *
 * Implements Slack's signing-secret verification algorithm:
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Rules enforced:
 * - Reject requests with stale timestamps (>5 minutes)
 * - Use timing-safe comparison via crypto.timingSafeEqual
 * - Never log the signing secret
 * - Preserve raw body for HMAC (must be set before body parsing)
 * - Return 401 on any failure; never reveal which check failed
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getSlackSigningSecret } from "./config";

const MAX_TIMESTAMP_DELTA_SECONDS = 300; // 5 minutes

export interface SlackVerificationResult {
  ok: boolean;
  error?: "missing_secret" | "missing_headers" | "stale_timestamp" | "invalid_signature";
}

/**
 * Verify a Slack request using HMAC-SHA256.
 *
 * @param timestamp - X-Slack-Request-Timestamp header value
 * @param signature - X-Slack-Signature header value
 * @param rawBody   - raw (unparsed) request body bytes
 */
export function verifySlackRequest(
  timestamp: string,
  signature: string,
  rawBody: Buffer | string,
): SlackVerificationResult {
  const secret = getSlackSigningSecret();
  if (!secret) {
    return { ok: false, error: "missing_secret" };
  }

  if (!timestamp || !signature) {
    return { ok: false, error: "missing_headers" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_DELTA_SECONDS) {
    return { ok: false, error: "stale_timestamp" };
  }

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const sigBase = `v0:${timestamp}:${body}`;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(sigBase);
  const computed = `v0=${hmac.digest("hex")}`;

  const expectedBuf = Buffer.from(signature, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");

  // Timing-safe comparison requires equal-length buffers
  if (expectedBuf.length !== computedBuf.length) {
    return { ok: false, error: "invalid_signature" };
  }

  const safe = crypto.timingSafeEqual(expectedBuf, computedBuf);
  if (!safe) {
    return { ok: false, error: "invalid_signature" };
  }

  return { ok: true };
}

/**
 * Express middleware that verifies Slack signatures on incoming requests.
 *
 * Requires that the raw body has been captured as req.rawBody before
 * the JSON body parser runs. See rawBodyCapture middleware below.
 */
export function verifySlackSignatureMiddleware(req: any, res: Response, next: NextFunction): void {
  const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;
  const signature = req.headers["x-slack-signature"] as string | undefined;

  if (!timestamp || !signature) {
    res.status(401).json({ error: "Missing Slack verification headers" });
    return;
  }

  const rawBody: Buffer | string = req.rawBody ?? "";
  const result = verifySlackRequest(timestamp, signature, rawBody);

  if (!result.ok) {
    // Never reveal which specific check failed to the caller
    res.status(401).json({ error: "Request verification failed" });
    return;
  }

  next();
}

/**
 * Express middleware to capture the raw request body before JSON parsing.
 *
 * Must be used BEFORE express.json() on Slack routes to preserve the raw
 * body bytes required for HMAC verification.
 */
export function rawBodyCapture(req: any, res: Response, next: NextFunction): void {
  const chunks: Buffer[] = [];

  req.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    // Also parse as JSON if Content-Type is application/json
    if (req.headers["content-type"]?.includes("application/json")) {
      try {
        req.body = JSON.parse(req.rawBody.toString("utf8"));
      } catch {
        req.body = {};
      }
    } else if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
      // Parse URL-encoded body (used by Slack slash commands and actions)
      const parsed: Record<string, string> = {};
      const bodyStr = req.rawBody.toString("utf8");
      for (const pair of bodyStr.split("&")) {
        const [k, v] = pair.split("=").map(decodeURIComponent);
        if (k) parsed[k] = v ?? "";
      }
      req.body = parsed;
    }
    next();
  });

  req.on("error", (err: Error) => {
    console.error("[Kevin Slack] Raw body capture error:", err.message);
    next(err);
  });
}
