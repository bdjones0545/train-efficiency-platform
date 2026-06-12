/**
 * Department OS v2 — Scaffold Generator
 * Produces ready-to-use boilerplate TypeScript for a new department.
 * All generated files use the correct framework APIs (v2 verified).
 *
 * Usage:
 *   const skeleton = generateDepartmentSkeleton("content-marketing");
 *   // → skeleton.assessmentAgent, skeleton.learningAgent, skeleton.coordinator, etc.
 */

// ─── Scaffold output ───────────────────────────────────────────────────────────

export interface DepartmentSkeleton {
  departmentId:      string;   // kebab-case
  departmentName:    string;   // PascalCase display name
  files:             GeneratedFile[];
}

export interface GeneratedFile {
  filename:    string;
  path:        string;
  content:     string;
  description: string;
}

// ─── Name helpers ──────────────────────────────────────────────────────────────

function toPascal(name: string): string {
  return name.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

function toKebab(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function toDisplay(name: string): string {
  return name.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ─── File generators ───────────────────────────────────────────────────────────

function genAssessmentAgent(id: string, pascal: string, display: string): GeneratedFile {
  return {
    filename:    `${id}-assessment-agent.ts`,
    path:        `server/services/${id}-assessment-agent.ts`,
    description: "Scores and qualifies entities using the Assessment Framework",
    content: `/**
 * ${display} Assessment Agent — Department OS v2
 * Scores entities using the Assessment Framework.
 * Customize KEYWORD_RULES and SCORING_WEIGHTS for your domain.
 */

import { scoreKeywords, compositeScore } from "../frameworks/department-os/assessment-framework";
import type { KeywordRule, ScoringWeight } from "../frameworks/department-os/assessment-framework";

// ─── Scoring rules (customize for your domain) ────────────────────────────────

const KEYWORD_RULES: KeywordRule[] = [
  { keywords: ["example", "keyword"],          points: 10 },
  { keywords: ["another", "keyword"],          points:  8 },
  { keywords: ["negative", "keyword"],         points: -5 },
];

const SCORING_WEIGHTS: ScoringWeight[] = [
  { key: "keyword",  weight: 0.5 },
  { key: "size",     weight: 0.3 },
  { key: "fit",      weight: 0.2 },
];

// ─── Score a single entity ────────────────────────────────────────────────────

export interface ${pascal}Score {
  entityId:       string;
  entityName:     string;
  overallScore:   number;
  qualified:      boolean;
  breakdown:      Record<string, number>;
}

export function score${pascal}Entity(entity: {
  id:          string;
  name:        string;
  description?: string;
  [key: string]: unknown;
}): ${pascal}Score {
  const text          = \`\${entity.name} \${entity.description ?? ""}\`.toLowerCase();
  const keywordScore  = scoreKeywords(text, KEYWORD_RULES);

  // Add domain-specific dimension scores here
  const sizeDimension = 50;
  const fitDimension  = 50;

  const dimensions = {
    keyword: Math.min(100, Math.max(0, keywordScore)),
    size:    sizeDimension,
    fit:     fitDimension,
  };

  const overallScore = compositeScore(dimensions, SCORING_WEIGHTS);
  const qualified    = overallScore >= 60;

  return {
    entityId:     entity.id,
    entityName:   entity.name,
    overallScore,
    qualified,
    breakdown:    dimensions,
  };
}
`,
  };
}

function genLearningAgent(id: string, pascal: string, display: string): GeneratedFile {
  return {
    filename:    `${id}-learning-agent.ts`,
    path:        `server/services/${id}-learning-agent.ts`,
    description: "Maps domain signals → framework Signal → buildLearningReport",
    content: `/**
 * ${display} Learning Agent — Department OS v2
 * Maps domain data to Signal type, then uses the Learning Engine.
 */

import { db }   from "../db";
import { sql }  from "drizzle-orm";
import type { Signal, Insight, LearningReport } from "../frameworks/department-os/learning-engine";
import { buildLearningReport, generateStandardInsights } from "../frameworks/department-os/learning-engine";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Signal mapper — adapt to your domain tables ──────────────────────────────
// Signal fields: orgId, department, source, category, score, contacted, responded,
//                converted, terminal, won, metadata?, recordedAt: Date

function toSignal(row: any, orgId: string): Signal {
  return {
    orgId,
    department: "${id}",
    entityId:   String(row.id ?? ""),
    source:     row.source     ?? "unknown",
    category:   row.category   ?? "general",
    score:      n(row.score),
    contacted:  Boolean(row.contacted),
    responded:  Boolean(row.responded),   // NOT "replied"
    converted:  Boolean(row.converted),
    terminal:   Boolean(row.terminal),
    won:        Boolean(row.won),          // NOT "closed" or "success"
    recordedAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

// ─── Main compute function ────────────────────────────────────────────────────

export async function compute${pascal}LearningMetrics(orgId: string): Promise<{
  report:   LearningReport;
  insights: Insight[];
}> {
  // TODO: replace with your actual signals table query
  const [rawSignals, countRows] = await Promise.all([
    db.execute(sql\`
      SELECT * FROM ${id.replace(/-/g, "_")}_entities
      WHERE org_id = \${orgId}
      ORDER BY created_at DESC
      LIMIT 500
    \`).then(rows),
    db.execute(sql\`
      SELECT COUNT(*) as cnt FROM ${id.replace(/-/g, "_")}_entities WHERE org_id = \${orgId}
    \`).then(rows),
  ]);

  const signals       = rawSignals.map((r: any) => toSignal(r, orgId));
  const totalEntities = n(countRows[0]?.cnt);

  // generateStandardInsights takes a config object — NOT positional args
  const insights = generateStandardInsights({
    department:    "${id}",
    orgId,
    entityLabel:   "${display}",
    signals,
    totalEntities,
    minVolumeTarget: 5,
  });

  // buildLearningReport takes 5 positional args — pass pre-generated insights last
  const report = buildLearningReport("${id}", orgId, signals, totalEntities, insights);

  return { report, insights };
}
`,
  };
}

function genExecutiveAgent(id: string, pascal: string, display: string): GeneratedFile {
  return {
    filename:    `${id}-executive-agent.ts`,
    path:        `server/services/${id}-executive-agent.ts`,
    description: "BestAction, ExecutiveBrief, and DepartmentRecommendations",
    content: `/**
 * ${display} Executive Agent — Department OS v2
 * Generates BestAction ranking, ExecutiveBrief, and DepartmentRecommendations.
 */

import { db }    from "../db";
import { sql }   from "drizzle-orm";
import type { BestAction, ActionPriority, DepartmentRecommendation, ExecutiveBrief } from "../frameworks/department-os/executive-engine";
import {
  rankBestActions,    // rankBestActions(departmentId, candidates) — dept string FIRST
  candidate,          // candidate(condition, action, priorityScore?) — action is Omit<BestAction,'department'>
  composeBrief,
  prioritizeRecommendations,
  buildWinsFromCounts,
  buildRisksFromChecks,
  formatPipelineSummary,
} from "../frameworks/department-os/executive-engine";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Pipeline stats — adapt to your domain ────────────────────────────────────

async function getStats(orgId: string) {
  const rows_ = await db.execute(sql\`
    SELECT status, COUNT(*) as cnt
    FROM ${id.replace(/-/g, "_")}_entities
    WHERE org_id = \${orgId}
    GROUP BY status
  \`).then(rows);

  const byStatus = Object.fromEntries(rows_.map((r: any) => [r.status, n(r.cnt)]));
  const total    = Object.values(byStatus).reduce((s: any, v: any) => s + v, 0) as number;
  return { total, byStatus };
}

// ─── Best action ──────────────────────────────────────────────────────────────

export async function generate${pascal}BestAction(orgId: string): Promise<BestAction | null> {
  const { total, byStatus } = await getStats(orgId);

  const pool = [
    candidate(
      total === 0,
      {
        title:       "Add Your First ${display}",
        description: "Start building the ${display.toLowerCase()} pipeline by adding your first entity.",
        priority:    "high" as ActionPriority,
        route:       "/admin/${id}",
        estimatedImpact: "Enables all ${display.toLowerCase()} intelligence",
      },
      60,
    ),
    // TODO: Add domain-specific candidates here
    // candidate(condition, { title, description, priority, route }, score)
  ];

  return rankBestActions("${id}", pool);  // department string is FIRST arg
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function generate${pascal}Recommendations(orgId: string): Promise<DepartmentRecommendation[]> {
  const now = new Date();
  const recs: DepartmentRecommendation[] = [
    // TODO: Add domain-specific recommendations
    {
      department:      "${id}",
      orgId,
      category:        "discovery",
      recommendation:  "TODO: Add your first recommendation",
      reasoning:       "Based on pipeline analysis",
      confidenceScore: 70,
      supportingData:  {},
      status:          "pending",
      createdAt:       now,
    },
  ];
  return prioritizeRecommendations(recs);
}

// ─── Executive brief ──────────────────────────────────────────────────────────

export async function generate${pascal}Brief(orgId: string): Promise<ExecutiveBrief> {
  const { total } = await getStats(orgId);
  const bestAction = await generate${pascal}BestAction(orgId);

  return composeBrief({
    department:       "${id}",
    orgId,
    summary:          formatPipelineSummary({ entityLabel: "${display}", total }),
    bestActionToday:  bestAction?.title ?? "Review ${display.toLowerCase()} pipeline",  // field is bestActionToday NOT bestAction
    keyWins:          total > 0 ? [\`\${total} ${display.toLowerCase()} entities in pipeline\`] : ["No wins yet — build the pipeline"],
    keyRisks:         ["TODO: Add domain-specific risks"],
    keyOpportunities: ["TODO: Add domain-specific opportunities"],
    metrics:          { total },
  });
}
`,
  };
}

function genCoordinator(id: string, pascal: string, display: string): GeneratedFile {
  return {
    filename:    `${id}-department-coordinator.ts`,
    path:        `server/services/${id}-department-coordinator.ts`,
    description: "DepartmentCoordinator implementation — plugs into CEO Heartbeat and Department Registry",
    content: `/**
 * ${display} Department Coordinator — Department OS v2
 * Implements DepartmentCoordinator. Register with departmentRegistry.register(coordinator, meta).
 *
 * HeartbeatReviewResult fields: departmentId, departmentName, checksRun, checksPassed,
 *   alertsCreated, bestAction, executiveSummary, healthChecks    (NO attentionItems field)
 * DepartmentHealthCheck fields: id, department, severity, passed:boolean,
 *   title, detail, recommendation, checkedAt:Date               (NOT status/name/message)
 */

import { db }     from "../db";
import { sql }    from "drizzle-orm";
import type {
  DepartmentCoordinator,
  HeartbeatReviewResult,
  DepartmentSummaryResult,
} from "../frameworks/department-os/department-coordinator";
import type { BestAction }            from "../frameworks/department-os/department-executive";
import type { DepartmentHealthCheck } from "../frameworks/department-os/department-health";
import { departmentHealthEngine }     from "../frameworks/department-os/health-engine";

import { generate${pascal}BestAction } from "./${id}-executive-agent";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }
function n(v: any): number   { return Number(v ?? 0); }

// ─── Health checks ────────────────────────────────────────────────────────────

async function runHealthChecks(orgId: string): Promise<DepartmentHealthCheck[]> {
  const now = new Date();

  const [noEntities] = await Promise.all([
    db.execute(sql\`
      SELECT COUNT(*) as cnt FROM ${id.replace(/-/g, "_")}_entities WHERE org_id = \${orgId}
    \`).then(rows),
  ]);

  const total = n(noEntities[0]?.cnt);

  return [
    {
      id:         "pipeline_empty",
      department: "${id}",
      severity:   "medium",
      passed:     total > 0,             // passed:boolean NOT status:'failed'/'passed'
      title:      "Empty Pipeline",
      detail:     total === 0
        ? "No ${display.toLowerCase()} entities in the pipeline"
        : \`\${total} ${display.toLowerCase()} entities in pipeline\`,
      recommendation: "Add ${display.toLowerCase()} entities to start generating intelligence",
      checkedAt:  now,                   // Date NOT string
    },
    // TODO: Add 2+ more domain-specific health checks
  ];
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

export function create${pascal}Coordinator(): DepartmentCoordinator {
  return {
    departmentId:   "${id}",
    departmentName: "${display}",

    async runHeartbeatReview(orgId: string): Promise<HeartbeatReviewResult> {
      const healthChecks = await runHealthChecks(orgId);
      const passed       = healthChecks.filter(c => c.passed).length;
      const bestAction   = await generate${pascal}BestAction(orgId).catch((): BestAction | null => null);

      // createAttentionItemsFromFailed takes 4 args: (orgId, agentName, sourceSystem, checks)
      const alertsCreated = await departmentHealthEngine
        .createAttentionItemsFromFailed(orgId, "${id}-coordinator", "${id}", healthChecks)
        .catch(() => 0);

      return {
        departmentId:    "${id}",
        departmentName:  "${display}",
        checksRun:       healthChecks.length,
        checksPassed:    passed,
        alertsCreated,
        bestAction,
        executiveSummary: \`\${healthChecks.length - passed} health issue(s) detected.\`,
        healthChecks,
        // NO attentionItems field — removed in v2
      };
    },

    async generateSummary(orgId: string): Promise<DepartmentSummaryResult> {
      const countRows  = await db.execute(sql\`
        SELECT COUNT(*) as cnt FROM ${id.replace(/-/g, "_")}_entities WHERE org_id = \${orgId}
      \`).then(rows);
      const total      = n(countRows[0]?.cnt);
      const bestAction = await generate${pascal}BestAction(orgId).catch((): BestAction | null => null);

      return {
        departmentId:    "${id}",
        departmentName:  "${display}",
        executiveSummary: \`\${total} entities in pipeline.\`,
        metrics:         { total },   // NO status or highlights fields
        bestAction,
        generatedAt:     new Date().toISOString(),
      };
    },

    async generateBestAction(orgId: string): Promise<BestAction | null> {
      return generate${pascal}BestAction(orgId).catch((): BestAction | null => null);
    },
  };
}
`,
  };
}

function genRoutes(id: string, pascal: string, display: string): GeneratedFile {
  const table = id.replace(/-/g, "_");
  return {
    filename:    `${id}-routes.ts`,
    path:        `server/${id}-routes.ts`,
    description: "REST endpoints + table creation + coordinator registration",
    content: `/**
 * ${display} Routes — Department OS v2
 * IMPORTANT: All routes are registered inside registerRoutes() in server/routes.ts
 * DO NOT register in server/index.ts — those routes are shadowed by Vite SPA catch-all.
 */

import type { Express }         from "express";
import { db }                   from "./db";
import { sql }                  from "drizzle-orm";
import { create${pascal}Coordinator } from "./services/${id}-department-coordinator";
import { departmentRegistry }   from "./services/department-registry";

function rows(r: any): any[] { return Array.isArray(r) ? r : (r?.rows ?? []); }

// ─── Table creation ───────────────────────────────────────────────────────────

async function createTables(): Promise<void> {
  await db.execute(sql\`
    CREATE TABLE IF NOT EXISTS ${table}_entities (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id       TEXT NOT NULL,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new',
      score        INTEGER DEFAULT 0,
      contacted    BOOLEAN DEFAULT false,
      responded    BOOLEAN DEFAULT false,
      converted    BOOLEAN DEFAULT false,
      terminal     BOOLEAN DEFAULT false,
      won          BOOLEAN DEFAULT false,
      source       TEXT,
      notes        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  \`);
  await db.execute(sql\`
    CREATE INDEX IF NOT EXISTS idx_${table}_entities_org ON ${table}_entities(org_id, status)
  \`);
}

// ─── Route registration ───────────────────────────────────────────────────────
// This function is called from registerRoutes() in server/routes.ts

export function register${pascal}Routes(
  app: Express,
  isAuthenticated: (req: any, res: any, next: any) => void,
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void,
): void {
  createTables().catch(err => console.error("[${id}] table creation error:", err));

  // Register coordinator — use static imports, NOT dynamic import().then() chains
  try {
    departmentRegistry.register(create${pascal}Coordinator(), {
      name:              "${display}",
      description:       "${display} department management and intelligence",
      version:           "2.0.0",
      enabled:           true,
      discoveryEnabled:  true,
      outreachEnabled:   true,
      executionEnabled:  true,
      learningEnabled:   true,
      executiveEnabled:  true,
    });
    console.log("[${id}] department registered with Department OS");
  } catch (err) {
    console.error("[${id}] registry registration failed:", err);
  }

  // ── GET /api/${id} ─────────────────────────────────────────────────────────
  app.get("/api/${id}", isAuthenticated, async (req, res) => {
    try {
      const orgId   = getOrgId(req);
      const status  = (req.query.status as string) ?? "";
      const entities = await db.execute(sql\`
        SELECT * FROM ${table}_entities
        WHERE org_id = \${orgId}
        \${status ? sql\`AND status = \${status}\` : sql\`\`}
        ORDER BY created_at DESC
      \`).then(rows);
      res.json(entities);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/${id} ────────────────────────────────────────────────────────
  app.post("/api/${id}", isAuthenticated, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { name, source, notes } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const result = await db.execute(sql\`
        INSERT INTO ${table}_entities (org_id, name, source, notes)
        VALUES (\${orgId}, \${name}, \${source ?? null}, \${notes ?? null})
        RETURNING *
      \`).then(rows);
      res.json(result[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/${id}/:id/status ────────────────────────────────────────────
  app.patch("/api/${id}/:id/status", isAuthenticated, async (req, res) => {
    try {
      const orgId  = getOrgId(req);
      const { status } = req.body;
      const result = await db.execute(sql\`
        UPDATE ${table}_entities
        SET status = \${status}, updated_at = NOW()
        WHERE id = \${req.params.id} AND org_id = \${orgId}
        RETURNING *
      \`).then(rows);
      if (!result[0]) return res.status(404).json({ error: "not found" });
      res.json(result[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // TODO: Add remaining endpoints (executive, learning, health, brief, recommendations)
}
`,
  };
}

function genAdminPage(id: string, pascal: string, display: string): GeneratedFile {
  return {
    filename:    `admin-${id}.tsx`,
    path:        `client/src/pages/admin-${id}.tsx`,
    description: "6-tab admin React page",
    content: `/**
 * ${display} Department — Admin Page
 * Route: /admin/${id}
 * Add to App.tsx: <Route path="/admin/${id}" component={Admin${pascal}Page} />
 * Add to app-sidebar.tsx with appropriate icon and testId
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Admin${pascal}Page() {
  const [activeTab, setActiveTab] = useState("pipeline");

  const { data: entities = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/${id}"],
    staleTime: 30_000,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">${display} Department</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline management and executive intelligence — Department OS v2
          </p>
        </div>
        <Badge variant="outline">L3 Operations</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-${id}">
          <TabsTrigger value="pipeline"    data-testid="tab-pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="outreach"    data-testid="tab-outreach">Outreach</TabsTrigger>
          <TabsTrigger value="assessment"  data-testid="tab-assessment">Assessment</TabsTrigger>
          <TabsTrigger value="learning"    data-testid="tab-learning">Learning</TabsTrigger>
          <TabsTrigger value="executive"   data-testid="tab-executive">Executive</TabsTrigger>
          <TabsTrigger value="health"      data-testid="tab-health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <Card>
            <CardHeader><CardTitle>Pipeline</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : entities.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No entities yet.</p>
                  <Button className="mt-4" data-testid="button-add-entity">
                    Add First ${display}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {entities.map((e: any) => (
                    <div key={e.id} data-testid={\`card-entity-\${e.id}\`}
                      className="flex items-center justify-between p-3 border rounded">
                      <span className="font-medium">{e.name}</span>
                      <Badge data-testid={\`status-\${e.id}\`}>{e.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outreach">
          <Card>
            <CardHeader><CardTitle>Outreach</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">TODO: Implement outreach agent UI</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assessment">
          <Card>
            <CardHeader><CardTitle>Assessment</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">TODO: Implement assessment score UI</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="learning">
          <Card>
            <CardHeader><CardTitle>Learning</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">TODO: Implement learning metrics UI</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="executive">
          <Card>
            <CardHeader><CardTitle>Executive Intelligence</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">TODO: Implement executive brief UI</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <Card>
            <CardHeader><CardTitle>Health Checks</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">TODO: Implement health check UI</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
`,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateDepartmentSkeleton(name: string): DepartmentSkeleton {
  const id      = toKebab(name);
  const pascal  = toPascal(name);
  const display = toDisplay(name);

  return {
    departmentId:   id,
    departmentName: display,
    files: [
      genAssessmentAgent(id, pascal, display),
      genLearningAgent(id, pascal, display),
      genExecutiveAgent(id, pascal, display),
      genCoordinator(id, pascal, display),
      genRoutes(id, pascal, display),
      genAdminPage(id, pascal, display),
    ],
  };
}
