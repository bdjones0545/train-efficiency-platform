/**
 * Department Factory Routes — Department OS v2
 * Powers the /admin/department-factory dashboard.
 * Exposes framework metadata, scaffold generation, and registry stats.
 */

import type { Express }   from "express";
import { departmentRegistry } from "./services/department-registry";
import {
  MATURITY_LEVELS,
  DEPARTMENT_COMPONENTS,
  computeMaturityLevel,
  getMaturityDefinition,
} from "./frameworks/department-os/builder/department-template";
import {
  CHECKLIST_ITEMS,
  evaluateChecklist,
} from "./frameworks/department-os/builder/department-checklist";
import { BUILDER_GUIDE }        from "./frameworks/department-os/builder/department-builder-guide";
import { generateDepartmentSkeleton } from "./frameworks/department-os/builder/department-scaffold";

// ─── Framework constants ──────────────────────────────────────────────────────
// Approximate framework lines (shared infrastructure that every department reuses)
const FRAMEWORK_LINES = 1_850;
// Approximate custom lines per department
const CUSTOM_LINES_PER_DEPT = 420;

function computeFactoryStats(deptCount: number) {
  const totalCustom   = CUSTOM_LINES_PER_DEPT * deptCount;
  const savedLines    = FRAMEWORK_LINES * deptCount - FRAMEWORK_LINES;   // savings vs writing infra fresh per dept
  const totalCode     = FRAMEWORK_LINES + totalCustom;
  const reusePercent  = Math.round((FRAMEWORK_LINES / (FRAMEWORK_LINES + CUSTOM_LINES_PER_DEPT)) * 100);
  return {
    registeredDepts:       deptCount,
    frameworkLines:        FRAMEWORK_LINES,
    avgDeptLines:          CUSTOM_LINES_PER_DEPT,
    totalCustomLines:      totalCustom,
    estimatedSavedLines:   Math.max(0, savedLines),
    reusePercent,
    builderFiles:          4,  // template, checklist, guide, scaffold
    maturityLevels:        5,
    apiGotchasDocumented:  BUILDER_GUIDE.apiGotchas.length,
    checklistItems:        CHECKLIST_ITEMS.length,
  };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerDepartmentFactoryRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
): void {

  // ── GET /api/department-factory/overview ──────────────────────────────────
  app.get("/api/department-factory/overview", isAuthenticated, async (req, res) => {
    try {
      const depts = departmentRegistry.getAll();

      const departments = depts.map(dept => {
        const maturityLevel = computeMaturityLevel(dept);
        const maturityDef   = getMaturityDefinition(maturityLevel);
        const checklist     = evaluateChecklist(dept);
        return {
          id:              dept.id,
          name:            dept.name,
          description:     dept.description,
          version:         dept.version,
          enabled:         dept.enabled,
          registeredAt:    dept.registeredAt,
          maturityLevel,
          maturityBadge:   maturityDef.badge,
          maturityName:    maturityDef.name,
          capabilities: {
            discovery:     dept.discoveryEnabled,
            qualification: dept.qualificationEnabled,
            outreach:      dept.outreachEnabled,
            execution:     dept.executionEnabled,
            learning:      dept.learningEnabled,
            executive:     dept.executiveEnabled,
          },
          checklistPercent: checklist.percentComplete,
          allRequiredDone:  checklist.allRequiredDone,
        };
      });

      const stats = computeFactoryStats(depts.length);

      res.json({ departments, stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/department-factory/maturity ──────────────────────────────────
  app.get("/api/department-factory/maturity", isAuthenticated, async (_req, res) => {
    try {
      res.json({
        levels:    MATURITY_LEVELS,
        components: DEPARTMENT_COMPONENTS,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/department-factory/guide ─────────────────────────────────────
  app.get("/api/department-factory/guide", isAuthenticated, async (_req, res) => {
    try {
      res.json(BUILDER_GUIDE);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/department-factory/checklist/:departmentId ───────────────────
  app.get("/api/department-factory/checklist/:departmentId", isAuthenticated, async (req, res) => {
    try {
      const dept = departmentRegistry.get(req.params.departmentId);
      if (!dept) return res.status(404).json({ error: "Department not found" });
      res.json(evaluateChecklist(dept));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/department-factory/scaffold ─────────────────────────────────
  app.post("/api/department-factory/scaffold", isAuthenticated, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ error: "name must be at least 2 characters" });
      }
      const skeleton = generateDepartmentSkeleton(name.trim());
      res.json(skeleton);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/department-factory/gotchas ───────────────────────────────────
  app.get("/api/department-factory/gotchas", isAuthenticated, async (_req, res) => {
    try {
      res.json({ gotchas: BUILDER_GUIDE.apiGotchas });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("[DepartmentFactory] Routes registered");
}
