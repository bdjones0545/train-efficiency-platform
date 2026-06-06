/**
 * Communication Intelligence Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only API endpoints for the Communication Intelligence Dashboard.
 * No sends, approvals, or mutations of any kind.
 */

import type { Express, Request, Response } from "express";
import {
  getCommunicationOverview,
  getChannelPerformance,
  getConversationHealth,
  getApprovalMetrics,
  getResponseMetrics,
  getLeadCommunicationMetrics,
  getHiringCommunicationMetrics,
  getSupportCommunicationMetrics,
  getRevenueCommunicationMetrics,
  getStalledConversationMetrics,
  getCommunicationRisks,
  getFullCommunicationDashboard,
} from "./services/communication-intelligence-service";

function requireAdmin(req: Request, res: Response): boolean {
  if (!(req as any).user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function getOrgId(req: Request): string | null {
  const user = (req as any).user;
  return user?.organizationId ?? user?.orgId ?? null;
}

export function registerCommunicationIntelligenceRoutes(app: Express): void {
  // GET /api/communication-intelligence/overview
  app.get("/api/communication-intelligence/overview", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getCommunicationOverview(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/channels
  app.get("/api/communication-intelligence/channels", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getChannelPerformance(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/health
  app.get("/api/communication-intelligence/health", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getConversationHealth(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/approvals
  app.get("/api/communication-intelligence/approvals", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getApprovalMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/responses
  app.get("/api/communication-intelligence/responses", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getResponseMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/revenue
  app.get("/api/communication-intelligence/revenue", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getRevenueCommunicationMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/hiring
  app.get("/api/communication-intelligence/hiring", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getHiringCommunicationMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/support
  app.get("/api/communication-intelligence/support", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getSupportCommunicationMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/recovery
  app.get("/api/communication-intelligence/recovery", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getStalledConversationMetrics(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/risks
  app.get("/api/communication-intelligence/risks", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getCommunicationRisks(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // GET /api/communication-intelligence/dashboard — full aggregate
  app.get("/api/communication-intelligence/dashboard", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "No organization" }) as any;
    try {
      const data = await getFullCommunicationDashboard(orgId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });
}
