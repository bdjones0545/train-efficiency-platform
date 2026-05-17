import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { orgAiIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptApiKey, decryptApiKey, maskApiKey, testConnection } from "./services/trainchat-client";
import { z } from "zod";

function requireRole(...roles: string[]) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id ?? req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { db: dbRef } = await import("./db");
    const { userProfiles } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [profile] = await dbRef.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    if (!profile || !roles.includes(profile.role ?? "")) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

async function getOrgId(req: any): Promise<string | null> {
  const userId = req.user?.id ?? req.user?.claims?.sub;
  if (!userId) return null;
  const { userProfiles } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return profile?.organizationId ?? null;
}

export function registerIntegrationsRoutes(app: Express) {
  // GET /api/org/integrations/trainchat
  app.get(
    "/api/org/integrations/trainchat",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await getOrgId(req);
        if (!orgId) return res.status(403).json({ message: "No organization found" });

        const [row] = await db
          .select()
          .from(orgAiIntegrations)
          .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat")))
          .limit(1);

        if (!row) {
          return res.json({ connected: false, maskedKey: null, apiBaseUrl: null, lastTestedAt: null, lastSuccessAt: null, lastError: null });
        }

        let maskedKey: string | null = null;
        if (row.apiKeyEncrypted) {
          try {
            const plain = decryptApiKey(row.apiKeyEncrypted);
            maskedKey = maskApiKey(plain);
          } catch {
            maskedKey = "tc_••••••••";
          }
        }

        return res.json({
          connected: row.isActive,
          maskedKey,
          apiBaseUrl: row.apiBaseUrl,
          lastTestedAt: row.lastTestedAt,
          lastSuccessAt: row.lastSuccessAt,
          lastError: row.lastError,
        });
      } catch (err: any) {
        console.error("[integrations] GET trainchat error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // POST /api/org/integrations/trainchat
  app.post(
    "/api/org/integrations/trainchat",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await getOrgId(req);
        if (!orgId) return res.status(403).json({ message: "No organization found" });

        const bodySchema = z.object({
          apiKey: z.string().min(1),
          apiBaseUrl: z.string().url(),
        });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

        const { apiKey, apiBaseUrl } = parsed.data;
        const apiKeyEncrypted = encryptApiKey(apiKey);
        const now = new Date();

        const [existing] = await db
          .select()
          .from(orgAiIntegrations)
          .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat")))
          .limit(1);

        if (existing) {
          await db
            .update(orgAiIntegrations)
            .set({ apiKeyEncrypted, apiBaseUrl, isActive: true, lastError: null, updatedAt: now })
            .where(eq(orgAiIntegrations.id, existing.id));
        } else {
          await db.insert(orgAiIntegrations).values({
            orgId,
            provider: "trainchat",
            apiKeyEncrypted,
            apiBaseUrl,
            isActive: true,
          });
        }

        return res.json({ success: true });
      } catch (err: any) {
        console.error("[integrations] POST trainchat error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // POST /api/org/integrations/trainchat/test
  app.post(
    "/api/org/integrations/trainchat/test",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await getOrgId(req);
        if (!orgId) return res.status(403).json({ message: "No organization found" });

        const bodySchema = z.object({
          apiKey: z.string().optional(),
          apiBaseUrl: z.string().url().optional(),
        });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

        let { apiKey, apiBaseUrl } = parsed.data;

        if (!apiKey || !apiBaseUrl) {
          const [row] = await db
            .select()
            .from(orgAiIntegrations)
            .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat")))
            .limit(1);

          if (!row) return res.status(400).json({ message: "No integration saved. Provide apiKey and apiBaseUrl." });
          if (!row.apiKeyEncrypted) return res.status(400).json({ message: "No API key stored." });
          apiBaseUrl = apiBaseUrl ?? row.apiBaseUrl ?? "";
          try {
            apiKey = decryptApiKey(row.apiKeyEncrypted);
          } catch {
            return res.status(500).json({ message: "Failed to decrypt stored API key" });
          }
        }

        const result = await testConnection(apiBaseUrl, apiKey!);
        const now = new Date();

        await db
          .update(orgAiIntegrations)
          .set({
            lastTestedAt: now,
            lastSuccessAt: result.success ? now : undefined,
            lastError: result.success ? null : result.message,
            updatedAt: now,
          })
          .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat")));

        return res.json(result);
      } catch (err: any) {
        console.error("[integrations] TEST trainchat error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // DELETE /api/org/integrations/trainchat
  app.delete(
    "/api/org/integrations/trainchat",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = await getOrgId(req);
        if (!orgId) return res.status(403).json({ message: "No organization found" });

        await db
          .delete(orgAiIntegrations)
          .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, "trainchat")));

        return res.json({ success: true });
      } catch (err: any) {
        console.error("[integrations] DELETE trainchat error:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    }
  );
}
