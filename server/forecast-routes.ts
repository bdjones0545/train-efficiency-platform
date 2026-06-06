/**
 * Forecast Routes — Phase 5
 * 13 endpoints under /api/forecast/*
 * Predictive Intelligence & Business Simulation Layer
 */

import type { Express } from "express";
import { isAuthenticated } from "./replit_integrations/auth";
import { createForecastTables } from "./services/forecast-engine";

async function getOrgId(req: any): Promise<string | null> {
  const userId = req.user?.claims?.sub ?? req.user?.id;
  if (!userId) return null;
  const { storage } = await import("./storage");
  const user = await storage.getUser(userId);
  return user?.orgId ?? null;
}

export async function registerForecastRoutes(app: Express) {
  await createForecastTables();

  // GET /api/forecast/dashboard — combined overview + OS score
  app.get("/api/forecast/dashboard", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getForecastDashboard } = await import("./services/forecast-engine");
      res.json(await getForecastDashboard(orgId));
    } catch (e: any) {
      console.error("[forecast] dashboard error:", e);
      res.status(500).json({ message: "Failed to load forecast dashboard" });
    }
  });

  // GET /api/forecast/os-score — Business OS Score breakdown
  app.get("/api/forecast/os-score", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getBusinessOSScore } = await import("./services/forecast-engine");
      res.json(await getBusinessOSScore(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to compute OS score" });
    }
  });

  // GET /api/forecast/digital-twin — current digital twin state
  app.get("/api/forecast/digital-twin", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getDigitalTwin } = await import("./services/forecast-engine");
      res.json(await getDigitalTwin(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load digital twin" });
    }
  });

  // POST /api/forecast/refresh-twin — refresh twin from live data
  app.post("/api/forecast/refresh-twin", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { refreshDigitalTwin } = await import("./services/forecast-engine");
      res.json(await refreshDigitalTwin(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to refresh digital twin" });
    }
  });

  // GET /api/forecast/projections — all forecasts
  app.get("/api/forecast/projections", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getForecasts, generateForecasts } = await import("./services/forecast-engine");
      let rows = await getForecasts(orgId);
      if (!rows.length) rows = await generateForecasts(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load projections" });
    }
  });

  // POST /api/forecast/generate — regenerate all forecasts
  app.post("/api/forecast/generate", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { generateForecasts } = await import("./services/forecast-engine");
      res.json(await generateForecasts(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to generate forecasts" });
    }
  });

  // GET /api/forecast/risks — active risk signals
  app.get("/api/forecast/risks", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getRisks, detectRisks } = await import("./services/forecast-engine");
      let rows = await getRisks(orgId);
      if (!rows.length) rows = await detectRisks(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load risks" });
    }
  });

  // POST /api/forecast/detect-risks — re-run risk detection
  app.post("/api/forecast/detect-risks", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { detectRisks } = await import("./services/forecast-engine");
      res.json(await detectRisks(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to detect risks" });
    }
  });

  // GET /api/forecast/opportunities — active opportunity signals
  app.get("/api/forecast/opportunities", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getOpportunities, detectOpportunities } = await import("./services/forecast-engine");
      let rows = await getOpportunities(orgId);
      if (!rows.length) rows = await detectOpportunities(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load opportunities" });
    }
  });

  // POST /api/forecast/detect-opportunities — re-run detection
  app.post("/api/forecast/detect-opportunities", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { detectOpportunities } = await import("./services/forecast-engine");
      res.json(await detectOpportunities(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to detect opportunities" });
    }
  });

  // POST /api/forecast/simulate — run a scenario simulation
  app.post("/api/forecast/simulate", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { name, scenarioType, parameters } = req.body ?? {};
      if (!scenarioType) return res.status(400).json({ message: "scenarioType required" });
      const { runScenarioSimulation } = await import("./services/forecast-engine");
      const userId = req.user?.claims?.sub ?? req.user?.id;
      res.json(await runScenarioSimulation(orgId, { name: name ?? scenarioType, scenarioType, parameters: parameters ?? {}, createdBy: userId }));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to run simulation" });
    }
  });

  // GET /api/forecast/simulations — past simulations
  app.get("/api/forecast/simulations", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getSimulations } = await import("./services/forecast-engine");
      res.json(await getSimulations(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load simulations" });
    }
  });

  // GET /api/forecast/strategic-plans — list generated plans
  app.get("/api/forecast/strategic-plans", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getStrategicPlans } = await import("./services/forecast-engine");
      res.json(await getStrategicPlans(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load strategic plans" });
    }
  });

  // POST /api/forecast/generate-plan — generate 30/60/90 day plan
  app.post("/api/forecast/generate-plan", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const horizonDays = parseInt(req.body?.horizonDays ?? "30");
      if (![30, 60, 90].includes(horizonDays)) return res.status(400).json({ message: "horizonDays must be 30, 60, or 90" });
      const { generateStrategicPlan } = await import("./services/forecast-engine");
      res.json(await generateStrategicPlan(orgId, horizonDays));
    } catch (e: any) {
      console.error("[forecast] generate-plan error:", e);
      res.status(500).json({ message: "Failed to generate strategic plan" });
    }
  });

  // GET /api/forecast/accuracy — forecast accuracy tracking
  app.get("/api/forecast/accuracy", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { getForecastAccuracy } = await import("./services/forecast-engine");
      res.json(await getForecastAccuracy(orgId));
    } catch (e: any) {
      res.status(500).json({ message: "Failed to load accuracy data" });
    }
  });

  // POST /api/forecast/record-actual — record actual vs predicted
  app.post("/api/forecast/record-actual", isAuthenticated, async (req: any, res) => {
    try {
      const orgId = await getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "Not authorized" });
      const { metric, horizonDays, predictedValue, actualValue } = req.body ?? {};
      if (!metric || !horizonDays || actualValue == null) return res.status(400).json({ message: "metric, horizonDays, actualValue required" });
      const { recordActualOutcome } = await import("./services/forecast-engine");
      await recordActualOutcome(orgId, { metric, horizonDays: parseInt(horizonDays), predictedValue: parseFloat(predictedValue ?? 0), actualValue: parseFloat(actualValue) });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to record actual outcome" });
    }
  });
}
