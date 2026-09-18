/**
 * Twilio inbound SMS webhook (STOP / START keywords).
 *
 * Security model:
 *  - Every request must carry a valid X-Twilio-Signature computed with
 *    TWILIO_AUTH_TOKEN over the exact URL Twilio was configured with plus the
 *    urlencoded form params. Fails CLOSED: no auth token or a bad/missing
 *    signature → 403 and nothing is written. Without this, anyone who could
 *    reach the endpoint could opt any phone number in or out.
 *  - STOP is authoritative: users.smsOptIn=false AND every user_org_preferences
 *    row of the user gets smsOptIn=false, because sendSms reads org
 *    preferences first and only falls back to users.smsOptIn.
 *  - START only re-enables users.smsOptIn. It never fabricates org-level
 *    consent; the subscriber re-consents in the app for opt-in-only messages.
 */

import type { Request, RequestHandler, Response } from "express";
import twilio from "twilio";
import { storage } from "./storage";
import { normalizePhone } from "./sms";

export const TWILIO_SIGNATURE_HEADER = "x-twilio-signature";
export const TWIML_EMPTY_RESPONSE = "<?xml version='1.0'?><Response/>";

export const SMS_STOP_KEYWORDS: ReadonlySet<string> = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
export const SMS_START_KEYWORDS: ReadonlySet<string> = new Set(["START", "YES", "UNSTOP"]);

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value.split(",")[0].trim();
  return undefined;
}

/**
 * Reconstructs the absolute URL Twilio signed. Follows the repo convention for
 * externally-visible URLs (routes.ts Gmail callback): PUBLIC_APP_URL wins,
 * otherwise the proxy-forwarded protocol + Host header. The app does not set
 * `trust proxy`, so req.protocol alone would report http behind TLS termination.
 */
export function resolveTwilioWebhookUrl(req: Pick<Request, "headers" | "originalUrl" | "protocol">): string {
  const configured = process.env.PUBLIC_APP_URL?.replace(/\/+$/, "");
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) || req.protocol || "https";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host || "";
  const base = configured || `${proto}://${host}`;
  return `${base}${req.originalUrl ?? ""}`;
}

export type TwilioSignatureRejection = "missing_auth_token" | "missing_signature" | "invalid_signature";

/**
 * Pure check used by the middleware: returns the rejection reason or null when
 * the request is authentic. Exported so the decision can be unit-tested with a
 * signature produced by twilio's own getExpectedTwilioSignature.
 */
export function checkTwilioSignature(
  req: Pick<Request, "headers" | "originalUrl" | "protocol" | "body">,
  authToken: string | undefined = process.env.TWILIO_AUTH_TOKEN,
): TwilioSignatureRejection | null {
  if (!authToken) return "missing_auth_token";
  const signature = firstHeaderValue(req.headers[TWILIO_SIGNATURE_HEADER]);
  if (!signature) return "missing_signature";
  const params = req.body && typeof req.body === "object" ? req.body : {};
  const url = resolveTwilioWebhookUrl(req);
  return twilio.validateRequest(authToken, signature, url, params) ? null : "invalid_signature";
}

/** Express middleware: 403 unless X-Twilio-Signature verifies. Fails closed. */
export const requireTwilioSignature: RequestHandler = (req, res, next) => {
  const rejection = checkTwilioSignature(req);
  if (rejection) {
    if (rejection === "missing_auth_token") {
      console.error("[Twilio webhook] TWILIO_AUTH_TOKEN is not set — rejecting inbound SMS webhook (fail closed)");
    } else {
      console.warn(`[Twilio webhook] Rejected inbound SMS webhook: ${rejection}`);
    }
    res.status(403).type("text/plain").send("Forbidden");
    return;
  }
  next();
};

/**
 * Applies a STOP/START keyword to every user with the sending phone number.
 * Any other body is acknowledged and ignored.
 */
export async function applyInboundSmsKeyword(from: string, rawBody: string): Promise<{ action: "stop" | "start" | "ignored"; userIds: string[] }> {
  const normalized = normalizePhone(from);
  if (!normalized) return { action: "ignored", userIds: [] };
  const body = (rawBody || "").trim().toUpperCase();

  if (SMS_STOP_KEYWORDS.has(body)) {
    const matches = await storage.getUsersByPhone(normalized);
    for (const u of matches) {
      await storage.updateUserSmsOptIn(u.id, false, "twilio_stop");
      const { orgPreferenceRowsUpdated } = await storage.optOutUserSmsInAllOrgs(u.id);
      console.log(`[SMS STOP] Opted out user ${u.id} (${normalized}); org preference rows updated: ${orgPreferenceRowsUpdated}`);
    }
    return { action: "stop", userIds: matches.map((u) => u.id) };
  }

  if (SMS_START_KEYWORDS.has(body)) {
    const matches = await storage.getUsersByPhone(normalized);
    for (const u of matches) {
      // User-level only: org-level consent is re-granted by the user in the app.
      await storage.updateUserSmsOptIn(u.id, true, "twilio_start");
      console.log(`[SMS START] Re-enabled user-level SMS for user ${u.id} (${normalized})`);
    }
    return { action: "start", userIds: matches.map((u) => u.id) };
  }

  return { action: "ignored", userIds: [] };
}

/** Route handler. Mount behind express.urlencoded() and requireTwilioSignature. */
export async function handleTwilioInboundSms(req: Request, res: Response): Promise<void> {
  try {
    const from = String(req.body?.From ?? "").trim();
    if (from) await applyInboundSmsKeyword(from, String(req.body?.Body ?? ""));
  } catch (err) {
    console.error("[Twilio webhook] Error:", err);
  }
  res.status(200).type("text/xml").send(TWIML_EMPTY_RESPONSE);
}
