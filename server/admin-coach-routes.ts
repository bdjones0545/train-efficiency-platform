/**
 * admin-coach-routes.ts — org-scoped coach administration.
 *
 * Every route here resolves the caller's organization through the trusted
 * resolver and passes it into the SQL predicate. `requireRole("ADMIN")` is a
 * per-organization role (any registrant gets it), so a coach id from another
 * tenant must match zero rows — never a write, never a 200.
 *
 * Extracted from routes.ts so the handlers can be executed in tests with a
 * fake app, stubbed storage, and an injected org resolver.
 */
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { isAuthenticated } from "./replit_integrations/auth";
import { requireRole, getUserRole } from "./lib/require-role";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";
import { storage } from "./storage";
import { sendCoachWelcomeEmail, type OrgBranding } from "./email";

export type AdminCoachRouteDeps = {
  getOrgBranding: (orgId: string | null | undefined) => Promise<OrgBranding | undefined>;
  /** Trusted org resolver; production uses resolveOrgIdOrThrow. Tests inject a stub. */
  resolveOrgId?: (req: any) => Promise<string>;
};

export function registerAdminCoachRoutes(app: Express, deps: AdminCoachRouteDeps): void {
  const resolveOrgId = deps.resolveOrgId ?? resolveOrgIdOrThrow;
  const { getOrgBranding } = deps;

  app.post("/api/admin/coaches", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const { firstName, lastName, email, password, bio, specialties } = req.body;
      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ message: "First name, last name, email, and password are required" });
      }
      if (typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ message: "Please provide a valid email address" });
      }
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const adminOrgId = await resolveOrgId(req);

      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        const existingCoach = await storage.getCoachProfileByUserId(existingUser.id);
        if (existingCoach) {
          return res.status(400).json({ message: "A coach with this email already exists" });
        }
        const existingProfile = await storage.getUserProfile(existingUser.id);
        if (existingProfile?.role === "ADMIN") {
          return res.status(400).json({ message: "This user is an admin and cannot be added as a coach" });
        }
        // A profile that already belongs to another organization must not be re-homed
        // into the caller's org by "adding" that email as a coach.
        if (existingProfile?.organizationId && existingProfile.organizationId !== adminOrgId) {
          return res.status(400).json({ message: "A user with this email already belongs to another organization" });
        }
      }

      const { db: dbRef } = await import("./db");
      const { users: usersTable } = await import("@shared/models/auth");

      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const [newUser] = await dbRef.insert(usersTable).values({
          email: normalizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          profileImageUrl: null,
          lastSignInAt: new Date(),
        }).returning();
        userId = newUser.id;
      }

      await storage.upsertUserProfile({ userId, role: "COACH", organizationId: adminOrgId });

      const passwordHash = await bcrypt.hash(password, 10);
      const parsedSpecialties = Array.isArray(specialties)
        ? specialties.filter((s: any) => typeof s === "string" && s.trim())
        : [];
      const coachProfile = await storage.createCoachProfile({
        userId,
        email: normalizedEmail,
        passwordHash,
        bio: typeof bio === "string" ? bio.trim() : "",
        specialties: parsedSpecialties,
        timezone: "America/New_York",
        isActive: true,
        organizationId: adminOrgId,
      });

      getOrgBranding(adminOrgId).then(async orgB => {
        try {
          await sendCoachWelcomeEmail(normalizedEmail, firstName.trim(), password, orgB);
          storage.createCommunicationLog({
            orgId: adminOrgId,
            userId,
            type: "welcome",
            channel: "email",
            recipientEmail: normalizedEmail,
            subject: "Welcome to your coaching platform",
            status: "sent",
            provider: "sendgrid",
          } as any).catch(() => {});
        } catch (err: any) {
          console.error("Failed to send coach welcome email:", err);
          storage.createCommunicationLog({
            orgId: adminOrgId,
            userId,
            type: "welcome",
            channel: "email",
            recipientEmail: normalizedEmail,
            subject: "Welcome to your coaching platform",
            status: "failed",
            provider: "sendgrid",
            errorMessage: err?.message ?? String(err),
          } as any).catch(() => {});
        }
      }).catch(() => {});

      res.json({ success: true, coachProfile });
    } catch (error: any) {
      if (handleOrgError(error, res)) return;
      console.error("Error creating coach:", error);
      if (error?.message?.includes("unique") || error?.code === "23505") {
        return res.status(400).json({ message: "A coach with this email already exists" });
      }
      res.status(500).json({ message: "Failed to create coach" });
    }
  });

  app.patch("/api/admin/coaches/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { bio, specialties, isActive, payoutPercentage } = req.body;
      const updateData: Record<string, any> = {};
      if (bio !== undefined) updateData.bio = bio;
      if (specialties !== undefined) updateData.specialties = Array.isArray(specialties) ? specialties : [];
      if (isActive !== undefined) updateData.isActive = isActive;
      if (payoutPercentage !== undefined) {
        const pct = parseInt(payoutPercentage);
        if (isNaN(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ message: "Percentage must be between 0 and 100" });
        }
        updateData.payoutPercentage = pct;
      }
      const orgId = await resolveOrgId(req);
      const updated = await storage.updateCoachProfileForOrganization(id, orgId, updateData);
      if (!updated) return res.status(404).json({ message: "Coach not found" });
      res.json(updated);
    } catch (error) {
      if (handleOrgError(error, res)) return;
      console.error("Error updating coach:", error);
      res.status(500).json({ message: "Failed to update coach" });
    }
  });

  app.delete("/api/admin/coaches/:id", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const orgId = await resolveOrgId(req);
      const deleted = await storage.deleteCoachProfileForOrganization(id, orgId);
      if (!deleted) return res.status(404).json({ message: "Coach not found" });
      res.json({ success: true });
    } catch (error) {
      if (handleOrgError(error, res)) return;
      console.error("Error deleting coach:", error);
      res.status(500).json({ message: "Failed to delete coach" });
    }
  });

  app.patch("/api/admin/coaches/:id/payout", isAuthenticated, requireRole("ADMIN"), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { payoutPercentage } = req.body;
      if (payoutPercentage === undefined || payoutPercentage === null) {
        return res.status(400).json({ message: "payoutPercentage required" });
      }
      const pct = parseInt(payoutPercentage);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ message: "Percentage must be between 0 and 100" });
      }
      const orgId = await resolveOrgId(req);
      const updated = await storage.updateCoachProfileForOrganization(id, orgId, { payoutPercentage: pct });
      if (!updated) return res.status(404).json({ message: "Coach not found" });
      res.json(updated);
    } catch (error) {
      if (handleOrgError(error, res)) return;
      console.error("Error updating coach payout:", error);
      res.status(500).json({ message: "Failed to update coach payout" });
    }
  });

  // A COACH sees only their own coach profile's redemptions; an ADMIN sees the
  // whole organization. Nobody sees another organization.
  app.get("/api/coach/payout-redemptions", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const orgId = await resolveOrgId(req);
      const role = await getUserRole(userId);

      const orgCoaches = await storage.getCoachProfilesByOrganization(orgId);
      const coachMap = new Map(orgCoaches.map(c => [c.id, c]));
      let visibleCoachIds = new Set(orgCoaches.map(c => c.id));

      if (role !== "ADMIN") {
        const ownCoach = await storage.getCoachProfileByUserId(userId);
        if (!ownCoach || !coachMap.has(ownCoach.id)) {
          return res.status(403).json({ message: "Coach profile not found for session" });
        }
        visibleCoachIds = new Set([ownCoach.id]);
      }

      const allRedemptions = await storage.getRedemptionsByOrganization(orgId);

      const result = allRedemptions
        .filter((r: any) => visibleCoachIds.has(r.coachId))
        .map((r: any) => {
          const coach = coachMap.get(r.coachId);
          return {
            id: r.id,
            coachId: r.coachId,
            coachEmail: coach?.user?.email || null,
            amountCents: r.amountCents,
            redeemedAt: r.redeemedAt,
            payoutStatus: r.payoutStatus,
          };
        });
      res.json(result);
    } catch (error) {
      if (handleOrgError(error, res)) return;
      console.error("Error fetching payout redemptions:", error);
      res.status(500).json({ message: "Failed to fetch payout redemptions" });
    }
  });
}
