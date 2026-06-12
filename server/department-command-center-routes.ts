/**
 * Department Command Center Routes
 * 4 endpoints powering the Executive Department OS.
 * All data discovered dynamically from departmentRegistry — no hardcoded departments.
 */

import type { Express } from "express";
import { generateDepartmentCommandCenter } from "./services/department-command-center";
import { resolveOrgIdOrThrow, handleOrgError } from "./lib/resolve-org-id";

export function registerDepartmentCommandCenterRoutes(
  app: Express,
  isAuthenticated: any,
): void {

  // ── GET /api/departments/overview ──────────────────────────────────────────
  app.get("/api/departments/overview", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const center = await generateDepartmentCommandCenter(orgId);
      res.json({
        departments:            center.departments,
        organizationHealth:     center.organizationHealth,
        organizationBestAction: center.organizationBestAction,
        generatedAt:            center.generatedAt,
      });
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/departments/health ────────────────────────────────────────────
  app.get("/api/departments/health", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const center = await generateDepartmentCommandCenter(orgId);
      res.json(
        center.departments.map(d => ({
          departmentId:   d.departmentId,
          departmentName: d.departmentName,
          healthScore:    d.healthScore,
          status:         d.status,
          checksRun:      d.checksRun,
          checksPassed:   d.checksPassed,
          checksFailed:   d.checksFailed,
          alertsCreated:  d.alertsCreated,
          openAlerts:     d.openAlerts,
          criticalAlerts: d.healthChecks.filter((c: any) => !c.passed && c.severity === "high").length,
          highAlerts:     d.healthChecks.filter((c: any) => !c.passed && c.severity === "medium").length,
          lowAlerts:      d.healthChecks.filter((c: any) => !c.passed && c.severity === "low").length,
          lastReview:     center.generatedAt,
        }))
      );
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/departments/actions ───────────────────────────────────────────
  app.get("/api/departments/actions", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const center = await generateDepartmentCommandCenter(orgId);
      res.json(center.allBestActions);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/departments/alerts ────────────────────────────────────────────
  app.get("/api/departments/alerts", isAuthenticated, async (req, res) => {
    try {
      const orgId = await resolveOrgIdOrThrow(req);
      const center = await generateDepartmentCommandCenter(orgId);
      res.json(center.allAlerts);
    } catch (err: any) {
      if (handleOrgError(err, res)) return;
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[DepartmentCommandCenter] Routes registered");
}
