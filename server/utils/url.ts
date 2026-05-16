/**
 * Auth URL Guard
 *
 * buildPublicAppUrl(path?) — the single source of truth for generating
 * URLs that will appear in transactional / auth emails or Stripe redirects.
 *
 * Priority order (highest to lowest):
 *   1. PUBLIC_APP_URL   — required in production
 *   2. BASE_URL         — optional secondary override
 *   3. REPLIT_DEV_DOMAIN — dev/preview only
 *   4. localhost:5000   — last-resort dev fallback
 *
 * In production (NODE_ENV === "production"), the resolved base is validated
 * against a denylist of unsafe domains. Any match throws immediately —
 * no Replit, localhost, or preview domain can ever appear in a production
 * auth email link.
 */

const BANNED_IN_PRODUCTION: string[] = [
  "replit.dev",
  "janeway.replit.dev",
  "localhost",
  "127.0.0.1",
];

export function buildPublicAppUrl(path = ""): string {
  const isProduction = process.env.NODE_ENV === "production";

  const base =
    process.env.PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    process.env.BASE_URL?.replace(/\/+$/, "") ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : null);

  if (!base) {
    if (isProduction) {
      throw new Error(
        "[auth-url] PUBLIC_APP_URL is required in production but is not set. " +
          "Set PUBLIC_APP_URL=https://trainefficiency.com in your production environment."
      );
    }
    const devUrl = `http://localhost:5000${path}`;
    console.warn(
      "[auth-url] No PUBLIC_APP_URL set — falling back to localhost for development:",
      devUrl
    );
    return devUrl;
  }

  if (isProduction) {
    const lower = base.toLowerCase();
    for (const banned of BANNED_IN_PRODUCTION) {
      if (lower.includes(banned)) {
        throw new Error(
          `[auth-url] SECURITY: Refusing to generate link — base URL "${base}" ` +
            `contains banned domain "${banned}". ` +
            `Set PUBLIC_APP_URL=https://trainefficiency.com in your production environment ` +
            `and remove any REPLIT_DEV_DOMAIN overrides.`
        );
      }
    }
  }

  const url = `${base}${path}`;

  try {
    console.log("[auth-url] Generated link domain:", new URL(url).origin);
  } catch {
    console.log("[auth-url] Generated link base:", base);
  }

  return url;
}
