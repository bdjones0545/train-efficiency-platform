/**
 * platform-admin-auth.ts — guards for PLATFORM-level (cross-tenant) admin surfaces.
 *
 * `requireRole("ADMIN")` is a per-organization role: POST /api/organizations/register
 * hands it to any registrant. It must never, on its own, unlock anything that reads
 * or mutates data across organizations. Routes that do (Stripe wallet-sync audits,
 * balance-integrity repair, webhook event logs, customer-success) additionally require
 * the caller's session to belong to the platform administrator organization.
 */
import { storage } from "../storage";
import { isAuthenticated } from "../replit_integrations/auth";
import { getUserRole } from "./require-role";

/** The single organization whose ADMIN users are platform super-admins. */
export const PLATFORM_ADMIN_ORG_ID = "org-est";

export function isPlatformAdminOrgId(orgId: string | null | undefined): boolean {
  return typeof orgId === "string" && orgId === PLATFORM_ADMIN_ORG_ID;
}

async function getSessionOrgId(req: any): Promise<string | null> {
  try {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return null;
    const profile = await storage.getUserProfile(userId);
    return profile?.organizationId ?? null;
  } catch {
    return null;
  }
}

/** True only when the session's profile belongs to the platform admin org. */
export async function isPlatformAdminSession(req: any): Promise<boolean> {
  return isPlatformAdminOrgId(await getSessionOrgId(req));
}

const PLATFORM_ONLY_MESSAGE = "Access restricted to platform administrators.";

/**
 * Express middleware — 403 unless the session belongs to the platform admin org.
 * Pair with `isAuthenticated` (or use after it) so req.user is populated.
 */
export async function requirePlatformAdminOrg(req: any, res: any, next: any) {
  try {
    if (!(await isPlatformAdminSession(req))) {
      return res.status(403).json({ message: PLATFORM_ONLY_MESSAGE });
    }
    next();
  } catch {
    res.status(403).json({ message: PLATFORM_ONLY_MESSAGE });
  }
}

/** Shared-secret branch: `x-admin-key` must equal ADMIN_REPAIR_KEY (when configured). */
export function isAdminRepairAuthorized(req: any): boolean {
  const headerKey = req.headers?.["x-admin-key"];
  const envKey = process.env.ADMIN_REPAIR_KEY;
  if (envKey && headerKey === envKey) return true;
  return false;
}

/**
 * Guard for platform-wide billing repair/audit endpoints.
 *
 *   - shared ADMIN_REPAIR_KEY header            → allowed
 *   - authenticated ADMIN in the platform org   → allowed
 *   - authenticated ADMIN in any other org      → 403
 *   - authenticated non-ADMIN                   → 403
 *   - unauthenticated                           → 401
 */
export async function adminRepairAuth(req: any, res: any, next: any) {
  if (isAdminRepairAuthorized(req)) return next();
  return isAuthenticated(req, res, async () => {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const role = await getUserRole(userId);
    if (role !== "ADMIN") return res.status(403).json({ message: "Forbidden" });
    if (!(await isPlatformAdminSession(req))) {
      return res.status(403).json({ message: PLATFORM_ONLY_MESSAGE });
    }
    next();
  });
}
