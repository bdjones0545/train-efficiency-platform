/**
 * Software Improvement Routes
 *
 * All routes enforce organization/session isolation.
 * SAFETY: These routes manage task records only — no code execution,
 * no deployment, no PR merges, no emails, no Stripe actions.
 */

import { Express } from "express";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { softwareImprovementTasks } from "@shared/schema";
import {
  runSoftwareImprovementAgent,
  ensureSoftwareImprovementTable,
  canRunSoftwareImprovementAgent,
} from "./services/software-improvement-agent";

function getOrgId(req: any): string | null {
  return req.user?.orgId ?? req.query.orgId ?? null;
}

export async function registerSoftwareImprovementRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  // Bootstrap table on startup
  await ensureSoftwareImprovementTable();

  // ─── GET /api/software-improvement/tasks ────────────────────────────────────
  app.get("/api/software-improvement/tasks", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { severity, status, sourceAgent, limit = "50", offset = "0" } = req.query as Record<string, string>;

      const tasks = await db
        .select()
        .from(softwareImprovementTasks)
        .where(eq(softwareImprovementTasks.organizationId, orgId))
        .orderBy(desc(softwareImprovementTasks.priority), desc(softwareImprovementTasks.createdAt))
        .limit(parseInt(limit, 10))
        .offset(parseInt(offset, 10))
        .catch(() => []);

      let filtered = tasks;
      if (severity) filtered = filtered.filter((t) => t.severity === severity);
      if (status) filtered = filtered.filter((t) => t.status === status);
      if (sourceAgent) filtered = filtered.filter((t) => t.sourceAgent === sourceAgent);

      const byStatus = tasks.reduce((acc: Record<string, number>, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {});

      const bySeverity = tasks.reduce((acc: Record<string, number>, t) => {
        acc[t.severity] = (acc[t.severity] ?? 0) + 1;
        return acc;
      }, {});

      res.json({
        tasks: filtered,
        total: filtered.length,
        byStatus,
        bySeverity,
        canRunAgent: canRunSoftwareImprovementAgent(orgId),
        generatedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch tasks", error: e.message });
    }
  });

  // ─── GET /api/software-improvement/tasks/:id ────────────────────────────────
  app.get("/api/software-improvement/tasks/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const [task] = await db
        .select()
        .from(softwareImprovementTasks)
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .limit(1)
        .catch(() => []);

      if (!task) return res.status(404).json({ message: "Task not found" });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch task", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/tasks ───────────────────────────────────
  app.post("/api/software-improvement/tasks", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const {
        title, problemSummary, businessContext, affectedArea,
        suspectedFiles, reproductionSteps, expectedBehavior,
        severity = "medium", sourceAgent = "manual", sourceType = "manual_report",
      } = req.body;

      if (!title || !problemSummary) {
        return res.status(400).json({ message: "title and problemSummary are required" });
      }

      const codexPrompt = buildCodexPromptLocal({
        title, problemSummary, businessContext, affectedArea,
        suspectedFiles, reproductionSteps, expectedBehavior,
      });

      const [task] = await db.insert(softwareImprovementTasks).values({
        organizationId: orgId,
        sourceAgent,
        sourceType,
        title,
        problemSummary,
        businessContext: businessContext ?? null,
        affectedArea: affectedArea ?? null,
        suspectedFiles: suspectedFiles ?? null,
        reproductionSteps: reproductionSteps ?? null,
        expectedBehavior: expectedBehavior ?? null,
        constraints: "- Preserve multi-tenant isolation\n- No production data modification\n- No emails or Stripe actions\n- Keep mobile responsive",
        acceptanceChecks: "- npm run check passes\n- Endpoint works correctly\n- No cross-org data leakage\n- UI works on mobile",
        severity,
        priority: severity === "critical" ? 95 : severity === "high" ? 75 : severity === "medium" ? 50 : 25,
        status: "detected",
        codexPrompt,
      }).returning();

      res.status(201).json(task);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to create task", error: e.message });
    }
  });

  // ─── PATCH /api/software-improvement/tasks/:id ──────────────────────────────
  app.patch("/api/software-improvement/tasks/:id", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const allowed = [
        "title", "problemSummary", "businessContext", "affectedArea",
        "suspectedFiles", "reproductionSteps", "expectedBehavior",
        "severity", "priority", "status", "codexStatus", "codexBranch", "codexPrUrl",
      ];
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (req.body.status === "merged" || req.body.status === "rejected") {
        updates.completedAt = new Date();
      }

      const [task] = await db
        .update(softwareImprovementTasks)
        .set(updates)
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .returning();

      if (!task) return res.status(404).json({ message: "Task not found" });
      res.json(task);
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update task", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/tasks/:id/prepare-codex ────────────────
  app.post("/api/software-improvement/tasks/:id/prepare-codex", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const [existing] = await db
        .select()
        .from(softwareImprovementTasks)
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .limit(1)
        .catch(() => []);

      if (!existing) return res.status(404).json({ message: "Task not found" });

      const codexPrompt = buildCodexPromptLocal({
        title: existing.title,
        problemSummary: existing.problemSummary,
        businessContext: existing.businessContext ?? "",
        affectedArea: existing.affectedArea ?? "",
        suspectedFiles: existing.suspectedFiles ?? "",
        reproductionSteps: existing.reproductionSteps ?? "",
        expectedBehavior: existing.expectedBehavior ?? "",
      });

      const [updated] = await db
        .update(softwareImprovementTasks)
        .set({ codexPrompt, status: "ready_for_codex", updatedAt: new Date() })
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .returning();

      res.json({ success: true, task: updated });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to prepare Codex prompt", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/tasks/:id/mark-sent ─────────────────────
  app.post("/api/software-improvement/tasks/:id/mark-sent", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { codexBranch } = req.body;
      const [updated] = await db
        .update(softwareImprovementTasks)
        .set({
          status: "sent_to_codex",
          codexStatus: "pending",
          codexBranch: codexBranch ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .returning();

      if (!updated) return res.status(404).json({ message: "Task not found" });
      res.json({ success: true, task: updated });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to mark as sent", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/tasks/:id/mark-review ───────────────────
  app.post("/api/software-improvement/tasks/:id/mark-review", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const { codexPrUrl } = req.body;
      const [updated] = await db
        .update(softwareImprovementTasks)
        .set({
          status: "needs_review",
          codexStatus: "pr_open",
          codexPrUrl: codexPrUrl ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .returning();

      if (!updated) return res.status(404).json({ message: "Task not found" });
      res.json({ success: true, task: updated });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to mark for review", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/tasks/:id/archive ───────────────────────
  app.post("/api/software-improvement/tasks/:id/archive", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      const [updated] = await db
        .update(softwareImprovementTasks)
        .set({ status: "archived", updatedAt: new Date(), completedAt: new Date() })
        .where(
          and(
            eq(softwareImprovementTasks.id, req.params.id),
            eq(softwareImprovementTasks.organizationId, orgId),
          ),
        )
        .returning();

      if (!updated) return res.status(404).json({ message: "Task not found" });
      res.json({ success: true, task: updated });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to archive task", error: e.message });
    }
  });

  // ─── POST /api/software-improvement/run ─────────────────────────────────────
  app.post("/api/software-improvement/run", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ message: "orgId required" });

      if (!canRunSoftwareImprovementAgent(orgId)) {
        return res.status(429).json({
          message: "Agent is on cooldown. It runs at most once per hour to avoid flooding the task queue.",
          canRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      }

      const result = await runSoftwareImprovementAgent(orgId);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to run agent", error: e.message });
    }
  });
}

// ─── Local prompt builder (duplicate-free, no circular dep) ──────────────────

function buildCodexPromptLocal(task: {
  title: string;
  problemSummary: string;
  businessContext?: string | null;
  affectedArea?: string | null;
  suspectedFiles?: string | null;
  reproductionSteps?: string | null;
  expectedBehavior?: string | null;
}): string {
  return `You are working on TrainEfficiency, a multi-tenant SaaS scheduling platform for strength and conditioning businesses.

## Problem
${task.problemSummary}

## Business context
${task.businessContext ?? "Not specified"}

## Affected area
${task.affectedArea ?? "Not specified"}

## Suspected files / routes
${task.suspectedFiles ?? "Not specified"}

## Reproduction steps
${task.reproductionSteps ?? "Not specified"}

## Expected behavior
${task.expectedBehavior ?? "Not specified"}

## Constraints
- Preserve multi-tenant isolation (every query must be scoped to organization_id)
- Do not break organization authentication
- Do not expose global data across organizations
- Do NOT modify production data
- Do NOT send emails, trigger Stripe actions, or execute any business actions
- Keep all UI mobile responsive
- Add useful logging for debugging
- Add or update tests where possible

## Acceptance checks
- \`npm run check\` passes with zero TypeScript errors
- The affected endpoint works correctly
- No cross-org data leakage (test with a second organization)
- UI renders correctly on mobile if frontend is affected
- No regression in existing functionality`;
}
