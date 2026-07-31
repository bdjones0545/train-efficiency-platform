/**
 * Server-side Kevin → TE callback/outbound auth helpers.
 * Browser must never import this module.
 *
 * Env (server Secrets only) — HMAC names same value, resolve order:
 *   KEVIN_CALLBACK_HMAC_SECRET          preferred TE/Replit (callback receive)
 *   KEVIN_OUTBOUND_HMAC_SECRET          alternate
 *   TRAINEFFICIENCY_KEVIN_SIGNING_SECRET legacy
 *   TE_INTERNAL_SERVICE_TOKEN           optional separate bearer plane
 *   KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS timestamp skew (default 300, clamp 30–3600)
 *   KEVIN_CALLBACK_BASE_URL             TE origin Kevin POSTs callbacks to (not a secret)
 */

import { createHmac, timingSafeEqual } from "crypto";
import {
  buildKevinOutboundAuthHeaders,
  getKevinCallbackAllowedSkewSeconds,
  resolveKevinOutboundHmacSecret,
  verifyKevinOutboundRequest,
  whichKevinOutboundHmacEnv,
  type EnvLike,
} from "../../shared/kevin/outbound-hmac";
import {
  getKevinCallbackBaseUrlStatus,
  type EnvLike as CallbackEnvLike,
} from "../../shared/kevin/callback-base-url";

export {
  KEVIN_CALLBACK_ALLOWED_SKEW_ENV,
  KEVIN_CALLBACK_DEFAULT_SKEW_SEC,
  KEVIN_CALLBACK_HMAC_ENV,
  KEVIN_CALLBACK_HMAC_ENV_CHAIN,
  KEVIN_OUTBOUND_HMAC_ENV_PREFERRED,
  KEVIN_OUTBOUND_HMAC_ENV_LEGACY,
  KEVIN_OUTBOUND_SIG_HEADER,
  KEVIN_OUTBOUND_TS_HEADER,
  getKevinCallbackAllowedSkewSeconds,
  parseKevinSkewSeconds,
} from "../../shared/kevin/outbound-hmac";

export {
  KEVIN_CALLBACK_BASE_URL_DEFAULT,
  KEVIN_CALLBACK_BASE_URL_ENV,
  KEVIN_HERMES_WEBHOOK_PATH,
  buildKevinCallbackUrl,
  getKevinCallbackBaseUrl,
  getKevinCallbackBaseUrlStatus,
  getKevinHermesWebhookUrl,
  isAbsoluteHttpUrl,
  normalizeKevinCallbackBaseUrl,
  whichKevinCallbackBaseUrlEnv,
} from "../../shared/kevin/callback-base-url";

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export function getKevinOutboundHmacSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveKevinOutboundHmacSecret(env as EnvLike);
}

/** Preferred name for TE callback verification — same resolver as outbound. */
export const getKevinCallbackHmacSecret = getKevinOutboundHmacSecret;

export function getKevinOutboundHmacSource(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return whichKevinOutboundHmacEnv(env as EnvLike);
}

export const getKevinCallbackHmacSource = getKevinOutboundHmacSource;

export function isKevinOutboundHmacConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getKevinOutboundHmacSecret(env));
}

export const isKevinCallbackHmacConfigured = isKevinOutboundHmacConfigured;

export function getTeInternalServiceToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const t = (env.TE_INTERNAL_SERVICE_TOKEN || "").trim();
  return t || null;
}

/** Presence-only status for health/debug (never returns secret values). */
export function getKevinOutboundAuthStatus(env: NodeJS.ProcessEnv = process.env): {
  hmacConfigured: boolean;
  hmacEnvName: string | null;
  serviceTokenConfigured: boolean;
  allowedSkewSeconds: number;
  callbackBaseUrl: string;
  callbackBaseUrlSource: string | null;
  callbackBaseUrlUsingDefault: boolean;
  hermesWebhookUrl: string;
} {
  const base = getKevinCallbackBaseUrlStatus(env as CallbackEnvLike);
  return {
    hmacConfigured: isKevinOutboundHmacConfigured(env),
    hmacEnvName: getKevinOutboundHmacSource(env),
    serviceTokenConfigured: Boolean(getTeInternalServiceToken(env)),
    allowedSkewSeconds: getKevinCallbackAllowedSkewSeconds(env as EnvLike),
    callbackBaseUrl: base.baseUrl,
    callbackBaseUrlSource: base.sourceEnv,
    callbackBaseUrlUsingDefault: base.usingDefault,
    hermesWebhookUrl: base.hermesWebhookUrl,
  };
}

export function signKevinOutboundBody(
  rawBody: string,
  opts?: { timestampSec?: number; env?: NodeJS.ProcessEnv },
): { headers: Record<string, string> } {
  const secret = getKevinOutboundHmacSecret(opts?.env ?? process.env);
  if (!secret) {
    throw new Error(
      "KEVIN_CALLBACK_HMAC_SECRET (or KEVIN_OUTBOUND_HMAC_SECRET / TRAINEFFICIENCY_KEVIN_SIGNING_SECRET) not configured",
    );
  }
  return {
    headers: buildKevinOutboundAuthHeaders({
      secret,
      rawBody,
      timestampSec: opts?.timestampSec,
      hmacSha256Hex,
    }),
  };
}

export function verifyKevinOutboundHeaders(opts: {
  rawBody: string;
  timestampHeader?: string | null;
  signatureHeader?: string | null;
  nowSec?: number;
  skewSec?: number;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; code: string; message: string } {
  const env = opts.env ?? process.env;
  const secret = getKevinOutboundHmacSecret(env);
  if (!secret) {
    return {
      ok: false,
      code: "HMAC_UNCONFIGURED",
      message:
        "KEVIN_CALLBACK_HMAC_SECRET (or outbound/legacy alias) not configured on TE",
    };
  }
  const skewSec =
    opts.skewSec ?? getKevinCallbackAllowedSkewSeconds(env as EnvLike);
  return verifyKevinOutboundRequest({
    secret,
    rawBody: opts.rawBody,
    timestampHeader: opts.timestampHeader,
    signatureHeader: opts.signatureHeader,
    nowSec: opts.nowSec,
    skewSec,
    hmacSha256Hex,
  });
}

/** Alias — TE callback route middleware should call this name. */
export const signKevinCallbackBody = signKevinOutboundBody;
export const verifyKevinCallbackHeaders = verifyKevinOutboundHeaders;

/** Optional bearer check for TE_INTERNAL_SERVICE_TOKEN (Authorization: Bearer ***). */
export function verifyTeInternalServiceBearer(
  authorizationHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getTeInternalServiceToken(env);
  if (!expected) return false;
  const raw = (authorizationHeader || "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const got = m[1].trim();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
