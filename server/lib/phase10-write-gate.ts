/**
 * phase10-write-gate — broad write-authorization middleware for the Phase 4-9
 * marketplace / developer / beta routes that previously relied solely on
 * internal orgId checks without explicit session enforcement.
 *
 * Two tiers:
 *
 *  * PHASE10_ADMIN_WRITE_PATHS — platform-operations writes whose handlers
 *    carry no role guard of their own, so this middleware is the ONLY
 *    authority check in front of them (agent verification/publication,
 *    submission approval, telemetry runtime creation, unbounded recomputes,
 *    beta program administration). A session alone is not enough: ADMIN.
 *
 *  * PHASE10_AUTHENTICATED_WRITE_PATHS — writes whose own handlers already
 *    call isAuthenticated + requireRole("COACH", "ADMIN") and resolve the org
 *    from the session. Here the gate stays an authentication floor so that
 *    coach-facing and developer self-service flows keep working.
 *
 * ADMIN paths are matched FIRST: "/api/developer/submissions" is a prefix
 * extension of "/api/developer/submit" and must not inherit the weaker tier.
 */

import { getUserRole } from "./require-role";

export const PHASE10_WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

export const PHASE10_ADMIN_WRITE_PATHS = [
  "/api/marketplace/runtimes/bootstrap",
  "/api/marketplace/telemetry",
  "/api/marketplace/trials/start",
  "/api/marketplace/ecosystem/refresh",
  "/api/marketplace/benchmarks/refresh",
  "/api/marketplace/reputation/refresh",
  "/api/marketplace/verification/",
  "/api/developer/submissions",
  "/api/developer/validate",
  "/api/beta/",
];

export const PHASE10_AUTHENTICATED_WRITE_PATHS = [
  "/api/workforce/",
  "/api/marketplace/case-studies",
  "/api/developer/register",
  "/api/developer/submit",
  "/api/feedback",
];

export type Phase10Tier = "none" | "authenticated" | "admin";

/** Which tier a request falls into. Exported so the gate is directly testable. */
export function phase10Tier(method: string, path: string): Phase10Tier {
  if (!PHASE10_WRITE_METHODS.includes(method)) return "none";
  if (PHASE10_ADMIN_WRITE_PATHS.some((p) => path.startsWith(p))) return "admin";
  if (PHASE10_AUTHENTICATED_WRITE_PATHS.some((p) => path.startsWith(p))) return "authenticated";
  return "none";
}

export function phase10WriteGate() {
  return async (req: any, res: any, next: any) => {
    const tier = phase10Tier(req.method, req.path);
    if (tier === "none") return next();

    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!req.user || !userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (tier === "admin") {
      const role = await getUserRole(userId);
      if (role !== "ADMIN") {
        return res.status(403).json({ message: "Forbidden" });
      }
    }
    return next();
  };
}
