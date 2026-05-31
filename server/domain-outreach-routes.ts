/**
 * Domain Outreach Routes
 * API endpoints for generating AI drafts across all business communication domains.
 * All drafts flow into gmail_agent_actions → AI Comms Center → learning loop.
 */

import type { Express } from "express";
import { db } from "./db";
import { gmailAgentActions, teamTrainingProspects } from "@shared/schema";
import { eq, and, desc, inArray, or, ilike } from "drizzle-orm";

function isAuthenticated(req: any, res: any, next: any) {
  if (!req.isAuthenticated?.() && !req.user) return res.status(401).json({ message: "Unauthorized" });
  next();
}

function requireRole(...roles: string[]) {
  return (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    next();
  };
}

async function getAdminOrgId(req: any): Promise<string | null> {
  try {
    const { storage } = await import("./storage");
    const userId = req.user?.claims?.sub ?? req.user?.id;
    if (!userId) return null;
    const profile = await storage.getUserProfile(userId);
    return profile?.organizationId ?? null;
  } catch {
    return null;
  }
}

// Domain → organizationType patterns for prospect filtering
const DOMAIN_ORG_PATTERNS: Record<string, string[]> = {
  school_partnership: ["school", "high school", "hs ", "k-12", "district", "middle school", "academy"],
  athletic_director: ["school", "high school", "hs ", "district", "athletic", "athletics"],
  coach_outreach: ["coach", "coaching", "trainer", "staff"],
  organization_outreach: ["club", "travel", "league", "recreation", "organization", "youth", "team"],
  business_outreach: ["business", "sponsor", "brand", "local", "retail"],
  corporate_wellness: ["corporate", "wellness", "hr", "company", "employer", "enterprise"],
  facility_partnership: ["facility", "complex", "training center", "sports center", "arena"],
  gym_owner: ["gym", "fitness center", "crossfit", "box", "studio", "health club"],
};

export async function registerDomainOutreachRoutes(app: Express) {
  // ─── Generate a domain-specific AI draft ──────────────────────────────────

  app.post("/api/ai-outreach/generate", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });

      const { domain, messageType, context, recipientEmail, prospectId, dealId } = req.body;
      if (!domain || !messageType) return res.status(400).json({ message: "domain and messageType required" });

      const { generateDomainDraft } = await import("./services/domain-outreach-service");
      const result = await generateDomainDraft({ orgId, domain, messageType, context: context ?? {}, recipientEmail, prospectId, dealId });

      res.json(result);
    } catch (err: any) {
      console.error("[ai-outreach/generate] error:", err.message);
      res.status(500).json({ message: err.message ?? "Draft generation failed" });
    }
  });

  // ─── Bulk generate drafts for a list of prospects ─────────────────────────

  app.post("/api/ai-outreach/bulk-generate", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });

      const { domain, messageType, prospectIds } = req.body;
      if (!domain || !messageType || !Array.isArray(prospectIds) || prospectIds.length === 0) {
        return res.status(400).json({ message: "domain, messageType, and prospectIds required" });
      }
      if (prospectIds.length > 20) return res.status(400).json({ message: "Max 20 prospects per bulk generate" });

      const prospects = await db.select().from(teamTrainingProspects)
        .where(and(eq(teamTrainingProspects.orgId, orgId), inArray(teamTrainingProspects.id, prospectIds)));

      const { generateDomainDraft } = await import("./services/domain-outreach-service");
      const { storage } = await import("./storage");
      const org = await storage.getOrganizationById(orgId);

      const results = await Promise.allSettled(prospects.map(async (p) => {
        const ctx = {
          orgName: org?.name,
          contactName: p.decisionMakerName || p.contactName || undefined,
          contactRole: p.decisionMakerTitle || p.contactRole || undefined,
          organizationName: p.prospectName,
          sport: p.sport !== "unknown" ? p.sport || undefined : undefined,
          city: p.city !== "unknown" ? p.city || undefined : undefined,
          state: p.state !== "unknown" ? p.state || undefined : undefined,
          notes: p.notes || undefined,
          estimatedValue: p.estimatedValue || undefined,
        };
        const email = p.decisionMakerEmail || p.contactEmail || undefined;
        return generateDomainDraft({ orgId, domain, messageType, context: ctx, recipientEmail: email, prospectId: p.id });
      }));

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      res.json({ succeeded, failed, total: prospects.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Bulk generation failed" });
    }
  });

  // ─── Get prospects grouped by domain ──────────────────────────────────────

  app.get("/api/ai-outreach/opportunities", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });

      const { domain } = req.query as Record<string, string>;

      const allProspects = await db.select().from(teamTrainingProspects)
        .where(eq(teamTrainingProspects.orgId, orgId))
        .orderBy(desc(teamTrainingProspects.createdAt));

      const { inferDomainFromOrganizationType } = await import("./services/domain-outreach-service");

      // Tag each prospect with inferred domain
      const tagged = allProspects.map((p) => ({
        ...p,
        inferredDomain: inferDomainFromOrganizationType(p.organizationType ?? ""),
      }));

      if (domain && domain !== "all") {
        return res.json(tagged.filter((p) => p.inferredDomain === domain));
      }

      // Return grouped counts
      const groups: Record<string, { count: number; prospects: typeof tagged }> = {};
      for (const p of tagged) {
        if (!groups[p.inferredDomain]) groups[p.inferredDomain] = { count: 0, prospects: [] };
        groups[p.inferredDomain].count++;
        groups[p.inferredDomain].prospects.push(p);
      }

      res.json(groups);
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to load opportunities" });
    }
  });

  // ─── Get recently generated proposals per domain ──────────────────────────

  app.get("/api/ai-outreach/recent", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getAdminOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });

      const { domain } = req.query as Record<string, string>;

      const where = domain && domain !== "all"
        ? and(eq(gmailAgentActions.orgId, orgId), eq(gmailAgentActions.communicationDomain, domain))
        : eq(gmailAgentActions.orgId, orgId);

      const rows = await db.select().from(gmailAgentActions)
        .where(and(where, eq(gmailAgentActions.status, "proposed")))
        .orderBy(desc(gmailAgentActions.createdAt))
        .limit(50);

      // Only return non-athlete domains
      const OUTREACH_DOMAINS = ["school_partnership","athletic_director","coach_outreach","organization_outreach","business_outreach","employment_opportunity","corporate_wellness","facility_partnership","gym_owner"];
      res.json(rows.filter((r) => OUTREACH_DOMAINS.includes(r.communicationDomain ?? "")));
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to load recent proposals" });
    }
  });

  // ─── Get domain message types config ──────────────────────────────────────

  app.get("/api/ai-outreach/config", isAuthenticated, async (req: any, res) => {
    try {
      const { getDomainMessageTypes, getSupportedDomains } = await import("./services/domain-outreach-service");
      const { domain } = req.query as Record<string, string>;

      if (domain) {
        return res.json({ domain, messageTypes: getDomainMessageTypes(domain) });
      }
      const domains = getSupportedDomains();
      const config = domains.map((d) => ({ ...d, messageTypes: getDomainMessageTypes(d.value) }));
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to load config" });
    }
  });
}
