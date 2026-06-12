/**
 * public-rate-limiter.ts — Simple in-memory rate limiter for unauthenticated
 * public endpoints (e.g. /api/coaches, /api/availability, /api/services).
 *
 * Prevents UUID enumeration and org data scraping via repeated public queries.
 * Uses a sliding-window counter keyed by IP address.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

function getClientIp(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

function pruneExpired(windowMs: number): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart >= windowMs) {
      store.delete(key);
    }
  }
}

/**
 * Creates an Express middleware that rate-limits by IP.
 *
 * @param maxRequests - max allowed requests per window (default 30)
 * @param windowMs    - window duration in ms (default 60 000)
 * @param routeLabel  - label for structured log output
 */
export function publicRateLimiter(
  maxRequests: number = DEFAULT_MAX_REQUESTS,
  windowMs: number = DEFAULT_WINDOW_MS,
  routeLabel: string = "public",
) {
  return (req: any, res: any, next: any) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const key = `${routeLabel}:${ip}`;

    // Prune expired entries periodically (every ~100 requests)
    if (Math.random() < 0.01) pruneExpired(windowMs);

    const entry = store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return next();
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      console.warn(
        JSON.stringify({
          event: "RATE_LIMIT_EXCEEDED",
          ip,
          route: routeLabel,
          count: entry.count,
          windowMs,
          timestamp: new Date().toISOString(),
        }),
      );
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({
        error: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    }

    next();
  };
}
