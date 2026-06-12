/**
 * resolve-org-id.ts — Single authoritative org resolution for every route.
 *
 * Rules (enforced platform-wide):
 *  1. Every org-scoped route MUST call resolveOrgIdOrThrow(req).
 *  2. Throws OrgResolutionError on failure — middleware converts to 403.
 *  3. Never returns null, undefined, or "".
 *  4. Every violation attempt is logged as ORG_ACCESS_DENIED.
 *
 * Forbidden patterns (DO NOT use anywhere in route files):
 *   req.user?.organizationId || ""
 *   req.session?.organizationId || ""
 *   req.query.organizationId || ""
 *   req.body.organizationId || ""
 *   (req.session as any)?.organizationId ?? (req.user as any)?.organizationId ?? ""
 */

import { resolveOrgSession } from "../org-auth";
import { db } from "../db";
import { userProfiles, coachProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Error class ─────────────────────────────────────────────────────────────

export class OrgResolutionError extends Error {
  public readonly statusCode = 403;
  constructor(
    public readonly userId: string | null,
    public readonly route: string,
  ) {
    super("ORG_RESOLUTION_FAILED");
    this.name = "OrgResolutionError";
  }
}

export function isOrgResolutionError(err: any): err is OrgResolutionError {
  return err instanceof OrgResolutionError || err?.message === "ORG_RESOLUTION_FAILED";
}

// ─── Structured violation logging ────────────────────────────────────────────

export function logOrgAccessDenied(
  userId: string | null,
  orgId: string | null,
  route: string,
): void {
  console.warn(
    JSON.stringify({
      event: "ORG_ACCESS_DENIED",
      userId: userId ?? "unknown",
      organizationId: orgId ?? "unknown",
      route,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Core resolver ────────────────────────────────────────────────────────────

function extractUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

/**
 * Resolves the organization for the current request.
 *
 * Resolution order:
 *   1. resolveOrgSession() — X-Org-Auth-Token, OIDC session, Bearer token
 *      (with membership + role verification)
 *   2. Direct DB profile lookup — for OIDC admin/coach sessions that pre-date
 *      explicit membership rows, using userProfiles then coachProfiles.
 *
 * Throws OrgResolutionError (status 403) if no org can be determined.
 * NEVER returns "", null, or undefined.
 */
export async function resolveOrgIdOrThrow(req: any): Promise<string> {
  const route = req.path ?? req.url ?? "unknown";
  const userId = extractUserId(req);

  // ── Path 1: Full org-session resolution ──────────────────────────────────
  try {
    const auth = await resolveOrgSession(req);
    if (auth?.orgId) return auth.orgId;
  } catch {
    // fall through to path 2
  }

  // ── Path 2: Direct profile lookup for admin/OIDC sessions ────────────────
  if (userId) {
    try {
      const [profile] = await db
        .select({ organizationId: userProfiles.organizationId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      if (profile?.organizationId) return profile.organizationId;

      const [coach] = await db
        .select({ organizationId: coachProfiles.organizationId })
        .from(coachProfiles)
        .where(eq(coachProfiles.userId, userId))
        .limit(1);
      if (coach?.organizationId) return coach.organizationId;
    } catch {
      // fall through to failure
    }
  }

  // ── Failed ───────────────────────────────────────────────────────────────
  logOrgAccessDenied(userId, null, route);
  throw new OrgResolutionError(userId, route);
}

// ─── Express error middleware ─────────────────────────────────────────────────

/**
 * Register AFTER all routes: app.use(orgErrorMiddleware)
 * Catches OrgResolutionError and returns 403 JSON.
 */
export function orgErrorMiddleware(
  err: any,
  req: any,
  res: any,
  next: any,
): void {
  if (isOrgResolutionError(err)) {
    logOrgAccessDenied(
      extractUserId(req),
      null,
      req.path ?? req.url ?? "unknown",
    );
    res.status(403).json({
      error: "ORG_RESOLUTION_FAILED",
      message: "Forbidden: organization could not be determined for this session.",
    });
    return;
  }
  next(err);
}

// ─── Inline helper for catch blocks ──────────────────────────────────────────

/**
 * Use inside existing catch blocks that previously returned 500 for all errors.
 * Re-sends a proper 403 for org failures; re-throws everything else.
 *
 * Usage:
 *   } catch (err: any) {
 *     if (handleOrgError(err, res)) return;
 *     res.status(500).json({ error: err.message });
 *   }
 */
export function handleOrgError(err: any, res: any): boolean {
  if (isOrgResolutionError(err)) {
    res.status(403).json({
      error: "ORG_RESOLUTION_FAILED",
      message: "Forbidden: organization access denied.",
    });
    return true;
  }
  return false;
}
