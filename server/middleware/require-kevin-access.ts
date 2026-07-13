/**
 * requireKevinAccess — ADMIN (or platform superadmin) only.
 * Policy lock 2026-07-13: COACH has no Kevin Console / /api/kevin/* access.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { userProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

function getUserId(req: any): string | null {
  return (
    req.user?.claims?.sub ??
    req.user?.id ??
    req.user?.userId ??
    null
  );
}

/**
 * Express middleware. Must run after isAuthenticated.
 * Allows: user_profiles.role === "ADMIN"
 * Platform superadmin: role ADMIN with isPlatformAdmin / platformAdmin flags if present.
 */
export async function requireKevinAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    // Platform flag on user object (if ever set by auth layer)
    if (
      (req as any).user?.isPlatformAdmin === true ||
      (req as any).user?.platformAdmin === true
    ) {
      next();
      return;
    }

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const role = profile?.role ?? "CLIENT";
    if (role !== "ADMIN") {
      res.status(403).json({
        message: "Forbidden: Kevin Console requires ADMIN",
        code: "KEVIN_ADMIN_ONLY",
      });
      return;
    }
    next();
  } catch {
    res.status(403).json({ message: "Forbidden" });
  }
}
