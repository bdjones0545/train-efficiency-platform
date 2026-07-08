import { Express } from "express";
import {
  ensureOnboardingStatesTable,
  getAthleteOnboardingSummary,
  getGuardianOnboardingSummary,
  getOnboardingType,
  markOnboardingViewed,
  confirmAthleteProfile,
  confirmGuardianProfile,
} from "./services/client-onboarding-service";

function getCurrentUserId(req: any): string | null {
  return req.user?.claims?.sub ?? req.user?.id ?? null;
}

export function registerClientOnboardingRoutes(app: Express) {
  ensureOnboardingStatesTable().catch(console.error);

  // GET /api/client/onboarding/check — lightweight first-login check (no full data load)
  app.get("/api/client/onboarding/check", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await getOnboardingType(userId);
      res.json(result);
    } catch (e: any) {
      console.error("[client-onboarding] check:", e);
      res.status(500).json({ error: "Check failed" });
    }
  });

  // GET /api/client/onboarding — athlete onboarding summary
  app.get("/api/client/onboarding", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const summary = await getAthleteOnboardingSummary(userId);
      if (!summary) return res.status(404).json({ error: "User not found" });
      res.json(summary);
    } catch (e: any) {
      console.error("[client-onboarding] GET /api/client/onboarding:", e);
      res.status(500).json({ error: "Failed to load onboarding summary" });
    }
  });

  // GET /api/guardian/onboarding — guardian onboarding summary
  app.get("/api/guardian/onboarding", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const summary = await getGuardianOnboardingSummary(userId);
      if (!summary) return res.status(404).json({ error: "User not found" });
      res.json(summary);
    } catch (e: any) {
      console.error("[client-onboarding] GET /api/guardian/onboarding:", e);
      res.status(500).json({ error: "Failed to load guardian onboarding summary" });
    }
  });

  // POST /api/client/onboarding/mark-viewed
  app.post("/api/client/onboarding/mark-viewed", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await markOnboardingViewed(userId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[client-onboarding] mark-viewed:", e);
      res.status(500).json({ error: "Failed to mark onboarding viewed" });
    }
  });

  // POST /api/guardian/onboarding/mark-viewed
  app.post("/api/guardian/onboarding/mark-viewed", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await markOnboardingViewed(userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "Failed to mark viewed" });
    }
  });

  // POST /api/client/onboarding/confirm-profile
  app.post("/api/client/onboarding/confirm-profile", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { phone, smsOptIn, notificationPreferences } = req.body ?? {};
      await confirmAthleteProfile(userId, { phone, smsOptIn, notificationPreferences });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[client-onboarding] confirm-profile:", e);
      res.status(500).json({ error: "Failed to confirm profile" });
    }
  });

  // POST /api/guardian/onboarding/confirm-profile
  app.post("/api/guardian/onboarding/confirm-profile", async (req: any, res) => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { phone, smsOptIn, notificationPreferences } = req.body ?? {};
      await confirmGuardianProfile(userId, { phone, smsOptIn, notificationPreferences });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[client-onboarding] guardian confirm-profile:", e);
      res.status(500).json({ error: "Failed to confirm profile" });
    }
  });
}
