/**
 * Kevin → TE callback destination base URL (where Kevin POSTs async webhooks).
 *
 * Env resolve order (first absolute http(s) URL wins):
 *   1. KEVIN_CALLBACK_BASE_URL   — preferred TE/Replit + Kevin name
 *   2. TE_APP_BASE_URL           — existing TE public app base
 *   3. APP_BASE_URL / PUBLIC_APP_URL
 *   4. https://{REPLIT_DEV_DOMAIN} when present
 *   5. default https://app.trainefficiency.com
 *
 * Not a secret. Distinct from KEVIN_HERMES_BASE_URL (TE→Kevin Hermes API).
 * Paths are joined with single slashes; no trailing slash on base.
 */

export const KEVIN_CALLBACK_BASE_URL_ENV = "KEVIN_CALLBACK_BASE_URL" as const;

export const KEVIN_CALLBACK_BASE_URL_FALLBACK_CHAIN = [
  KEVIN_CALLBACK_BASE_URL_ENV,
  "TE_APP_BASE_URL",
  "APP_BASE_URL",
  "PUBLIC_APP_URL",
] as const;

/** Production TE app origin (no trailing slash).
 * Prefer apex until app.trainefficiency.com DNS exists (NXDOMAIN as of 2026-07-31).
 */
export const KEVIN_CALLBACK_BASE_URL_DEFAULT = "https://trainefficiency.com";

/** Known Hermes webhook path on TE (architecture). */
export const KEVIN_HERMES_WEBHOOK_PATH = "/api/kevin/webhooks/hermes";

export type EnvLike = Record<string, string | undefined>;

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/** True if absolute http(s) URL with host. */
export function isAbsoluteHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.host);
  } catch {
    return false;
  }
}

/**
 * Normalize a candidate base URL: trim, strip trailing slash, require absolute http(s).
 * Returns null if unusable.
 */
export function normalizeKevinCallbackBaseUrl(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const base = stripTrailingSlashes(t);
  if (!isAbsoluteHttpUrl(base)) return null;
  return base;
}

/** Which env key supplied the resolved base (for status/debug). */
export function whichKevinCallbackBaseUrlEnv(env: EnvLike = {}): string | null {
  for (const key of KEVIN_CALLBACK_BASE_URL_FALLBACK_CHAIN) {
    if (normalizeKevinCallbackBaseUrl(env[key])) return key;
  }
  if (env.REPLIT_DEV_DOMAIN && String(env.REPLIT_DEV_DOMAIN).trim()) {
    const cand = normalizeKevinCallbackBaseUrl(`https://${String(env.REPLIT_DEV_DOMAIN).trim()}`);
    if (cand) return "REPLIT_DEV_DOMAIN";
  }
  return null;
}

/**
 * Resolve Kevin→TE callback base URL (no trailing slash).
 * Always returns a usable absolute URL (falls back to production default).
 */
export function getKevinCallbackBaseUrl(env: EnvLike = {}): string {
  for (const key of KEVIN_CALLBACK_BASE_URL_FALLBACK_CHAIN) {
    const n = normalizeKevinCallbackBaseUrl(env[key]);
    if (n) return n;
  }
  const repl = (env.REPLIT_DEV_DOMAIN || "").trim();
  if (repl) {
    const n = normalizeKevinCallbackBaseUrl(`https://${repl}`);
    if (n) return n;
  }
  return KEVIN_CALLBACK_BASE_URL_DEFAULT;
}

/** Join base + path safely (path may be absolute — then returned as-is if http(s)). */
export function buildKevinCallbackUrl(
  pathOrAbsolute: string,
  env: EnvLike = {},
): string {
  const raw = (pathOrAbsolute || "").trim();
  if (isAbsoluteHttpUrl(raw)) return stripTrailingSlashes(raw);
  const base = getKevinCallbackBaseUrl(env);
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${path}`;
}

/** Convenience: full URL for Hermes→TE webhook receiver. */
export function getKevinHermesWebhookUrl(env: EnvLike = {}): string {
  return buildKevinCallbackUrl(KEVIN_HERMES_WEBHOOK_PATH, env);
}

/** Presence-only status (never secrets). */
export function getKevinCallbackBaseUrlStatus(env: EnvLike = {}): {
  configured: boolean;
  sourceEnv: string | null;
  baseUrl: string;
  usingDefault: boolean;
  hermesWebhookUrl: string;
} {
  const sourceEnv = whichKevinCallbackBaseUrlEnv(env);
  const baseUrl = getKevinCallbackBaseUrl(env);
  return {
    configured: Boolean(sourceEnv),
    sourceEnv,
    baseUrl,
    usingDefault: sourceEnv === null,
    hermesWebhookUrl: getKevinHermesWebhookUrl(env),
  };
}
