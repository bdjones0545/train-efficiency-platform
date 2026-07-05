import { db } from "./db";
import crypto from "crypto";
import {
  orgSessions,
  orgMemberships,
  userProfiles,
  coachProfiles,
} from "@shared/schema";
import { eq, and, gt, sql as drizzleSql } from "drizzle-orm";
import { hashAuthToken } from "./lib/auth-token";

export interface OrgAuthContext {
  userId: string;
  orgId: string;
  role: string;
}

/**
 * Resolves who is making a request to an org-scoped route.
 *
 * Tries three auth paths in order (first match wins):
 *   A. X-Org-Auth-Token header  — org-specific localStorage token (athletes / org-login flow)
 *   B. OIDC session             — Replit OIDC / passport req.user
 *   C. Bearer token             — email-password main-app login stored in auth_tokens
 *
 * For paths B & C the user's platform org membership is looked up, so org
 * admins and coaches who authenticated through the main platform login can
 * access org-scoped routes without doing a separate org login.
 */
export async function resolveOrgSession(req: any): Promise<OrgAuthContext | null> {
  // ── Path A: X-Org-Auth-Token ─────────────────────────────────────────────────
  const orgAuthToken = req.headers["x-org-auth-token"] as string | undefined;
  if (orgAuthToken) {
    try {
      const tokenHash = crypto.createHash("sha256").update(orgAuthToken).digest("hex");
      const now = new Date();
      const [session] = await db
        .select()
        .from(orgSessions)
        .where(and(eq(orgSessions.tokenHash, tokenHash), gt(orgSessions.expiresAt, now)))
        .limit(1);
      if (session) {
        const [membership] = await db
          .select()
          .from(orgMemberships)
          .where(and(eq(orgMemberships.userId, session.userId), eq(orgMemberships.orgId, session.orgId)))
          .limit(1);
        if (membership) {
          return { userId: session.userId, orgId: session.orgId, role: membership.role };
        }
      }
    } catch { /* fall through */ }
  }

  // ── Path B: OIDC session (passport sets req.user) ────────────────────────────
  if (req.user) {
    try {
      const mainUserId: string = req.user?.claims?.sub ?? req.user?.id;
      const [profileRow] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainUserId)).limit(1);
      const [coachRow] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, mainUserId)).limit(1);
      const userOrgId = profileRow?.organizationId ?? coachRow?.organizationId;
      if (userOrgId) {
        const [membership] = await db.select().from(orgMemberships)
          .where(and(eq(orgMemberships.userId, mainUserId), eq(orgMemberships.orgId, userOrgId)))
          .limit(1);
        if (membership && ["admin", "coach", "staff", "owner"].includes(membership.role)) {
          return { userId: mainUserId, orgId: userOrgId, role: membership.role };
        }
        // Derive from platform role when no explicit membership row exists yet
        const profileRole = profileRow?.role ?? null;
        if (profileRole === "ADMIN") return { userId: mainUserId, orgId: userOrgId, role: "admin" };
        if (profileRole === "COACH") return { userId: mainUserId, orgId: userOrgId, role: "coach" };
        if (profileRole === "STAFF") return { userId: mainUserId, orgId: userOrgId, role: "staff" };
      }
    } catch { /* fall through */ }
  }

  // ── Path C: Bearer token (email-password login) ───────────────────────────────
  const authHeader = req.headers.authorization as string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const bearerToken = authHeader.slice(7);
      const tokenResult = await db.execute(
        drizzleSql`SELECT user_id FROM auth_tokens WHERE token = ${hashAuthToken(bearerToken)} AND expires_at > NOW() LIMIT 1`
      );
      const rows = (tokenResult as any).rows ?? [];
      if (rows.length) {
        const mainUserId = rows[0].user_id as string;
        const [profileRow] = await db.select().from(userProfiles).where(eq(userProfiles.userId, mainUserId)).limit(1);
        const [coachRow] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, mainUserId)).limit(1);
        const userOrgId = profileRow?.organizationId ?? coachRow?.organizationId;
        if (userOrgId) {
          const [membership] = await db.select().from(orgMemberships)
            .where(and(eq(orgMemberships.userId, mainUserId), eq(orgMemberships.orgId, userOrgId)))
            .limit(1);
          if (membership && ["admin", "coach", "staff", "owner"].includes(membership.role)) {
            return { userId: mainUserId, orgId: userOrgId, role: membership.role };
          }
          const profileRole = profileRow?.role ?? null;
          if (profileRole === "ADMIN") return { userId: mainUserId, orgId: userOrgId, role: "admin" };
          if (profileRole === "COACH") return { userId: mainUserId, orgId: userOrgId, role: "coach" };
          if (profileRole === "STAFF") return { userId: mainUserId, orgId: userOrgId, role: "staff" };
        }
      }
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Express middleware — requires coach/admin/staff/owner role.
 * Sets req._orgAuth on success.
 */
export function requireCoach(req: any, res: any, next: any) {
  resolveOrgSession(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ message: "Not authenticated" });
      if (!["admin", "coach", "staff", "owner"].includes(auth.role)) {
        return res.status(403).json({ message: "Coach access required" });
      }
      req._orgAuth = auth;
      next();
    })
    .catch(() => res.status(500).json({ message: "Auth error" }));
}

/**
 * Express middleware — any authenticated org member.
 * Sets req._orgAuth on success.
 */
export function requireOrgUser(req: any, res: any, next: any) {
  resolveOrgSession(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ message: "Not authenticated" });
      req._orgAuth = auth;
      next();
    })
    .catch(() => res.status(500).json({ message: "Auth error" }));
}
