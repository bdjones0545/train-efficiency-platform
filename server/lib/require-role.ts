import { storage } from "../storage";

/**
 * Resolve a user's platform role from their profile.
 * Defaults to "CLIENT" when no profile/role is present (least privilege).
 */
export async function getUserRole(userId: string): Promise<string> {
  const profile = await storage.getUserProfile(userId);
  return profile?.role || "CLIENT";
}

/**
 * Express middleware — requires the authenticated user to hold one of `roles`.
 *
 * 401 when unauthenticated (no resolvable user id), 403 when the role is not
 * permitted. Pair with `isAuthenticated` so req.user is populated first.
 *
 * Extracted verbatim from routes.ts so it can be shared by route modules
 * (e.g. reliability-routes, phase10-routes) without duplicating the logic.
 */
export function requireRole(...roles: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const role = await getUserRole(userId);
    if (!roles.includes(role)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}
