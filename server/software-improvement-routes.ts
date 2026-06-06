/**
 * Software Improvement Routes
 *
 * All routes enforce organization/session isolation.
 * SAFETY: These routes manage task records only — no code execution,
 * no deployment, no PR merges, no emails, no Stripe actions.
 *
 * Phase 2A additions:
 *   POST /api/software-improvement/tasks/:id/request-github-issue
 *   POST /api/software-improvement/tasks/:id/approve-github-issue
 *   GET  /api/software-improvement/tasks/:id/github-issue-draft
 */

import { Express } from "express";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { softwareImprovementTasks, agentOperatingTimeline } from "@shared/schema";
import {
  runSoftwareImprovementAgent,
  ensureSoftwareImprovementTable,
  canRunSoftwareImprovementAgent,
} from "./services/software-improvement-agent";
import { requestComposioAction } from "./composio-action-adapter";
import { executeComposioAction } from "./services/composio-service";
import { emitComposioHermesEvent } from "./composio-hermes-emitter";

function getOrgId(req: any): string | null {
  return req.user?.orgId ?? req.query.orgId ?? null;
}

// ─── GitHub Issue column bootstrap ───────────────────────────────────────────

async function ensureGitHubIssueColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE software_improvement_tasks ADD COLUMN IF NOT EXISTS github_issue_url VARCHAR(512)`);
    await db.execute(sql`ALTER TABLE software_improvement_tasks ADD COLUMN IF NOT EXISTS github_approval_queue_id VARCHAR(256)`);
    await db.execute(sql`ALTER TABLE software_improvement_tasks ADD COLUMN IF NOT EXISTS github_issue_draft JSONB`);
  } catch {
    // Columns may already exist
  }
}

// ─── GitHub issue draft builder ───────────────────────────────────────────────

function buildGitHubIssueDraft(task: any): {
  title: string;
  body: string;
  labels: string[];
  severity: string;
  affectedFiles: string;
  codexPromptSummary: string;
} {
  const labels: string[] = [
    `severity:${task.severity}`,
    "ai-detected",
    "needs-review",
    "software-improvement-agent",
  ];
  if (task.affectedArea) {
    labels.push(`area:${task.affectedArea.toLowerCase().replace(/[\s/]+/g, "-").replace(/[^a-z0-9:-]/g, "")}`);
  }

  const body = [
    `## Problem Summary`,
    task.problemSummary,
    ``,
    `## Business Context`,
    task.businessContext ?? "_Not specified_",
    ``,
    `## Affected Area`,
    task.affectedArea ?? "_Not specified_",
    ``,
    `## Suspected Files / Routes`,
    "```",
    task.suspectedFiles ?? "Not specified",
    "```",
    ``,
    `## Reproduction Steps`,
    task.reproductionSteps ?? "_Not specified_",
    ``,
    `## Expected Behavior`,
    task.expectedBehavior ?? "_Not specified_",
    ``,
    `---`,
    `**Severity:** \`${task.severity.toUpperCase()}\``,
    `**Priority:** ${task.priority}`,
    `**Source Agent:** ${task.sourceAgent}`,
    `**Detected At:** ${new Date(task.createdAt).toISOString()}`,
    ``,
    `> This issue was drafted by the TrainEfficiency Software Improvement Agent.`,
    `> Human review and approval is required before any code changes are made.`,
  ].join("\n");

  const codexPromptSummary = task.codexPrompt
    ? task.codexPrompt.slice(0, 600) + (task.codexPrompt.length > 600 ? "\n…(truncated)" : "")
    : "No Codex prompt generated yet — run Prepare Codex Prompt first.";

  return {
    title: `[${task.severity.toUpperCase()}] ${task.title}`,
    body,
    labels,
    severity: task.severity,
    affectedFiles: task.suspectedFiles ?? "",
    codexPromptSummary,
  };
}

export async function registerSoftwareImprovementRoutes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): Promise<void> {
  // Bootstrap tables on startup
  await ensureSoftwareImprovementTable();
  await ensureGitHubIssueColumns();

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

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 2A — Composio GitHub Issue Drafting
  // ════════════════════════════════════════════════════════════════════════════

  // ─── GET /api/software-improvement/tasks/:id/github-issue-draft ─────────────
  // Returns the stored GitHub issue draft for a task.
  app.get(
    "/api/software-improvement/tasks/:id/github-issue-draft",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const [task] = await db
          .select()
          .from(softwareImprovementTasks)
          .where(and(eq(softwareImprovementTasks.id, req.params.id), eq(softwareImprovementTasks.organizationId, orgId)))
          .limit(1)
          .catch(() => []);

        if (!task) return res.status(404).json({ message: "Task not found" });

        const draft = (task as any).githubIssueDraft ?? buildGitHubIssueDraft(task);
        res.json({ draft, taskStatus: task.status, taskId: task.id });
      } catch (e: any) {
        res.status(500).json({ message: "Failed to fetch draft", error: e.message });
      }
    },
  );

  // ─── POST /api/software-improvement/tasks/:id/request-github-issue ──────────
  // Step 1: Build the GitHub issue draft and queue it for human approval.
  // Status transition: any eligible → github_issue_draft_requested
  app.post(
    "/api/software-improvement/tasks/:id/request-github-issue",
    isAuthenticated,
    requireRole("COACH", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const [task] = await db
          .select()
          .from(softwareImprovementTasks)
          .where(and(eq(softwareImprovementTasks.id, req.params.id), eq(softwareImprovementTasks.organizationId, orgId)))
          .limit(1)
          .catch(() => []);

        if (!task) return res.status(404).json({ message: "Task not found" });

        // Only allow high or critical severity
        if (!["high", "critical"].includes(task.severity)) {
          return res.status(400).json({
            message: `GitHub issue drafting is only available for high or critical severity tasks. This task is "${task.severity}".`,
          });
        }

        // Guard: already requested or created
        if ((task.status as string) === "github_issue_draft_requested") {
          return res.status(409).json({ message: "GitHub issue draft already requested for this task." });
        }
        if ((task.status as string) === "github_issue_created") {
          return res.status(409).json({
            message: "GitHub issue already created for this task.",
            githubIssueUrl: (task as any).githubIssueUrl,
          });
        }

        // Build the draft
        const draft = buildGitHubIssueDraft(task);

        // Route through Composio action adapter
        // GITHUB is read-only + approval-required → this will always queue for approval
        const adapterResult = await requestComposioAction({
          orgId,
          agentId: "software_improvement_agent",
          tool: "GITHUB",
          action: "GITHUB_CREATE_AN_ISSUE",
          inputParams: {
            title: draft.title,
            body: draft.body,
            labels: draft.labels,
          },
          confidence: 0.85,
          riskLevel: "high",
          notes: `GitHub issue draft for task: ${task.title} (${task.severity})`,
        });

        // Update task: store draft + approval queue ID + new status
        await db.execute(sql`
          UPDATE software_improvement_tasks
          SET
            status = 'github_issue_draft_requested',
            github_issue_draft = ${JSON.stringify(draft)}::jsonb,
            github_approval_queue_id = ${adapterResult.approvalQueueId ?? null},
            updated_at = NOW()
          WHERE id = ${task.id} AND organization_id = ${orgId}
        `);

        // Log to agent_operating_timeline
        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: "software_improvement_agent",
          systemName: "composio_github",
          actionType: "approval_required",
          actionStatus: "requires_approval",
          communicationDomain: "github",
          summary: `GitHub issue draft requested for: ${task.title}`,
          requiresApproval: true,
          approvalStatus: "pending",
          relatedEntityType: "software_improvement_task",
          relatedEntityId: task.id,
          metadata: {
            draft,
            approvalQueueId: adapterResult.approvalQueueId,
            taskSeverity: task.severity,
          },
        }).catch(() => {});

        // Emit Hermes event
        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: "software_improvement_agent",
          tool: "GITHUB",
          action: "GITHUB_CREATE_AN_ISSUE",
          result: "queued_for_approval",
          outcome: "pending_approval",
          metadata: {
            taskId: task.id,
            taskTitle: task.title,
            taskSeverity: task.severity,
            approvalQueueId: adapterResult.approvalQueueId,
            draft,
          },
        });

        res.status(202).json({
          success: true,
          message: "GitHub issue draft queued for human approval.",
          approvalQueueId: adapterResult.approvalQueueId,
          draft,
          taskStatus: "github_issue_draft_requested",
        });
      } catch (e: any) {
        console.error("[SoftwareImprovement] request-github-issue failed:", e.message);
        res.status(500).json({ message: "Failed to request GitHub issue", error: e.message });
      }
    },
  );

  // ─── POST /api/software-improvement/tasks/:id/approve-github-issue ──────────
  // Step 2: Human has reviewed the draft and approves execution.
  // Executes the Composio GitHub create-issue action and records the URL.
  // Status transition: github_issue_draft_requested → github_issue_created
  app.post(
    "/api/software-improvement/tasks/:id/approve-github-issue",
    isAuthenticated,
    requireRole("ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = getOrgId(req);
        if (!orgId) return res.status(400).json({ message: "orgId required" });

        const [task] = await db
          .select()
          .from(softwareImprovementTasks)
          .where(and(eq(softwareImprovementTasks.id, req.params.id), eq(softwareImprovementTasks.organizationId, orgId)))
          .limit(1)
          .catch(() => []);

        if (!task) return res.status(404).json({ message: "Task not found" });

        if ((task.status as string) !== "github_issue_draft_requested") {
          return res.status(400).json({
            message: `Expected status "github_issue_draft_requested", got "${task.status}". Request a draft first.`,
          });
        }

        const draft: any = (task as any).githubIssueDraft ?? buildGitHubIssueDraft(task);

        // Execute via Composio service directly (admin has explicitly approved)
        const execResult = await executeComposioAction({
          orgId,
          agentId: "software_improvement_agent",
          tool: "GITHUB",
          action: "GITHUB_CREATE_AN_ISSUE",
          inputParams: {
            title: draft.title,
            body: draft.body,
            labels: draft.labels,
          },
        });

        // Try to extract the GitHub issue URL from the result
        let githubIssueUrl: string | null = null;
        if (execResult.success && execResult.data) {
          const data: any = execResult.data;
          githubIssueUrl =
            data?.html_url ??
            data?.url ??
            data?.issue?.html_url ??
            data?.data?.html_url ??
            null;
        }

        // Update task status
        await db.execute(sql`
          UPDATE software_improvement_tasks
          SET
            status = 'github_issue_created',
            github_issue_url = ${githubIssueUrl},
            updated_at = NOW()
          WHERE id = ${task.id} AND organization_id = ${orgId}
        `);

        // Log to agent_operating_timeline
        await db.insert(agentOperatingTimeline).values({
          orgId,
          agentName: "software_improvement_agent",
          systemName: "composio_github",
          actionType: execResult.success ? "workflow_executed" : "error",
          actionStatus: execResult.success ? "completed" : "failed",
          communicationDomain: "github",
          summary: execResult.success
            ? `GitHub issue created for: ${task.title}${githubIssueUrl ? ` → ${githubIssueUrl}` : ""}`
            : `GitHub issue creation failed: ${execResult.error}`,
          requiresApproval: false,
          approvalStatus: "approved",
          relatedEntityType: "software_improvement_task",
          relatedEntityId: task.id,
          executedAt: new Date(),
          outcomeStatus: execResult.success ? "success" : "failure",
          errorMessage: execResult.error,
          metadata: {
            draft,
            githubIssueUrl,
            durationMs: execResult.durationMs,
          },
        }).catch(() => {});

        // Emit Hermes event
        await emitComposioHermesEvent({
          source: "composio",
          orgId,
          agent: "software_improvement_agent",
          tool: "GITHUB",
          action: "GITHUB_CREATE_AN_ISSUE",
          result: execResult.success ? "success" : "failure",
          outcome: execResult.success ? "github_issue_created" : "failed",
          metadata: {
            taskId: task.id,
            taskTitle: task.title,
            githubIssueUrl,
            durationMs: execResult.durationMs,
            error: execResult.error,
          },
        });

        res.json({
          success: execResult.success,
          message: execResult.success
            ? `GitHub issue created successfully${githubIssueUrl ? `. View at: ${githubIssueUrl}` : " (URL not returned by Composio — check GitHub directly)."}`
            : `Composio execution failed: ${execResult.error}`,
          githubIssueUrl,
          taskStatus: "github_issue_created",
          composioResult: execResult.success ? { durationMs: execResult.durationMs } : { error: execResult.error },
        });
      } catch (e: any) {
        console.error("[SoftwareImprovement] approve-github-issue failed:", e.message);
        res.status(500).json({ message: "Failed to execute GitHub issue creation", error: e.message });
      }
    },
  );
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
