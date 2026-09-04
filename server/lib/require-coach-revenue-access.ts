import { storage } from "../storage";
import { getUserRole } from "./require-role";
import { resolveOrgIdOrThrow, handleOrgError } from "./resolve-org-id";

/**
 * Express middleware — enforces the organization's `coachTransactionsVisible`
 * setting on org-wide revenue reads.
 *
 * The setting was previously honoured only by the sidebar, which hid the
 * Transactions link. The route stayed registered and the APIs stayed open, so
 * a COACH could still read full organization revenue by visiting the URL.
 *
 * ADMIN is unaffected — the setting exists to hide revenue from coaches, not
 * from the org's own administrators. Endpoints that return a coach's *own*
 * earnings (redemptions, payouts, cashouts) are deliberately not gated by it.
 *
 * Must run after `isAuthenticated` and `requireRole("COACH", "ADMIN")`.
 */
export async function requireCoachRevenueAccess(req: any, res: any, next: any) {
  try {
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const role = await getUserRole(userId);
    if (role !== "COACH") return next();

    const orgId = await resolveOrgIdOrThrow(req);
    const org = await storage.getOrganizationById(orgId);
    if (org?.coachTransactionsVisible === false) {
      return res.status(403).json({
        message: "Transaction visibility is disabled for coaches in this organization",
        code: "COACH_TRANSACTIONS_HIDDEN",
      });
    }
    next();
  } catch (error) {
    if (handleOrgError(error, res)) return;
    console.error("Error checking coach revenue access:", error);
    res.status(500).json({ message: "Failed to verify revenue access" });
  }
}
