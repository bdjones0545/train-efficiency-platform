/**
 * Software KB Service
 * Automatically captures every platform fix, audit resolution, crash, build error,
 * and deployment issue into a persistent, searchable `software_kb_entries` table.
 *
 * Table is created lazily on first use — survives deploys and restarts.
 * Seeded once with real historical fixes documented across the project.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Table bootstrap ───────────────────────────────────────────────────────────

let _tableReady = false;

export async function ensureSoftwareKbTable(): Promise<void> {
  if (_tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS software_kb_entries (
      id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      org_id               TEXT        NOT NULL,
      severity             TEXT        NOT NULL DEFAULT 'medium',
      issue                TEXT        NOT NULL,
      root_cause           TEXT        NOT NULL DEFAULT '',
      fix_applied          TEXT        NOT NULL DEFAULT '',
      files_modified       TEXT        NOT NULL DEFAULT '',
      outcome              TEXT        NOT NULL DEFAULT '',
      source               TEXT        NOT NULL DEFAULT 'Manual Entry',
      source_type          TEXT        NOT NULL DEFAULT 'human_admin',
      related_entity_type  TEXT        DEFAULT NULL,
      related_entity_id    TEXT        DEFAULT NULL,
      metadata             JSONB       DEFAULT '{}',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_software_kb_org_id      ON software_kb_entries(org_id);
    CREATE INDEX IF NOT EXISTS idx_software_kb_severity    ON software_kb_entries(severity);
    CREATE INDEX IF NOT EXISTS idx_software_kb_source_type ON software_kb_entries(source_type);
    CREATE INDEX IF NOT EXISTS idx_software_kb_created_at  ON software_kb_entries(created_at DESC);
  `).catch(() => {});
  _tableReady = true;
}

// ─── Seed control ─────────────────────────────────────────────────────────────

let _seeded = false;

const HISTORICAL_FIXES: Omit<SoftwareKbInput, "orgId">[] = [
  {
    severity: "high",
    issue: "Express route registration order — routes added after registerRoutes() were shadowed by Vite's SPA catch-all",
    rootCause: "setupVite() adds app.use('/{*path}', ...) catch-all AFTER registerRoutes() returns; any route registered to server/index.ts after that is unreachable",
    fixApplied: "All API routes must be registered inside registerRoutes() in server/routes.ts, never after it in server/index.ts",
    filesModified: "server/routes.ts, server/index.ts",
    outcome: "All API routes now reachable; SPA routing unaffected",
    source: "Architecture Audit",
    sourceType: "architecture_audit",
  },
  {
    severity: "critical",
    issue: "CEO Heartbeat lock bug — releaseJobLock UPDATE to 'released' blocked all future manual runs within 28-min window",
    rootCause: "Lock release used UPDATE status='released' instead of DELETE; job_execution_locks still had a row for the same key, blocking re-acquisition",
    fixApplied: "releaseJobLock now DELETEs the row; startup cleanup deletes any lingering 'released' rows on boot",
    filesModified: "server/services/ceo-heartbeat-service.ts",
    outcome: "Manual heartbeat runs no longer blocked; lock re-acquisition works correctly",
    source: "CEO Heartbeat Audit",
    sourceType: "service_fix",
  },
  {
    severity: "high",
    issue: "Dashboard card data shape mismatches — revenue/utilization/recommendations cards returned wrong shapes causing blank cards",
    rootCause: "periodRevenueCents was missing from top-level response; utilization was unwrapped instead of wrapped in summary object; /api/recommendations used wrong orgId lookup",
    fixApplied: "Added periodRevenueCents top-level, wrapped utilization in summary object, fixed /api/recommendations to use profile lookup for orgId",
    filesModified: "server/routes.ts",
    outcome: "All home page dashboard cards populate correctly",
    source: "Dashboard Data Audit",
    sourceType: "api_fix",
  },
  {
    severity: "high",
    issue: "Integration status dual-system false negative — always showed 'No communication integrations connected'",
    rootCause: "Two separate status-check systems were in conflict; Hermes/AgentMail/Obsidian were wrongly classified as external integrations rather than infrastructure",
    fixApplied: "Unified via server/services/integration-status-service.ts — DB first, env-var fallback; reclassified infrastructure agents",
    filesModified: "server/services/integration-status-service.ts, server/routes.ts",
    outcome: "Integration status widget shows correct connected state",
    source: "Integration Status Audit",
    sourceType: "service_fix",
  },
  {
    severity: "medium",
    issue: "Drizzle db.execute() response shape inconsistency — some queries returned array, others QueryResult object",
    rootCause: "db.execute(sql`...`) return type varies by query; silent catch{} blocks hid ReferenceErrors mid-object-literal",
    fixApplied: "Always use Array.isArray() guard on db.execute() results before accessing rows",
    filesModified: "Multiple service files",
    outcome: "No more silent failures from unexpected response shapes",
    source: "Database Layer Audit",
    sourceType: "db_fix",
  },
  {
    severity: "high",
    issue: "Scheduling agent — booking_status enum case mismatch and getCoachName missing join",
    rootCause: "booking_status enum values are uppercase (CANCELLED not cancelled); getCoachName used db.execute instead of Drizzle join on users table; programGoals could be string or array without guard",
    fixApplied: "Uppercase enum values throughout; getCoachName uses Drizzle join; programGoals guarded before .toLowerCase()",
    filesModified: "server/services/internal-scheduling-agent-service.ts",
    outcome: "Scheduling agent no longer crashes on booking status or coach lookup",
    source: "Scheduling Agent Audit",
    sourceType: "service_fix",
  },
  {
    severity: "medium",
    issue: "ReactNode mid-file import caused TS error — import must be at top with 'type' modifier",
    rootCause: "Platform Engineering page imported ReactNode in mid-file; TypeScript strict mode requires type-only imports at the top of the file",
    fixApplied: "Moved ReactNode import to top of file with 'import type' syntax",
    filesModified: "client/src/pages/admin-platform-engineering.tsx",
    outcome: "TypeScript build passes cleanly",
    source: "TypeScript Build Audit",
    sourceType: "typescript_fix",
  },
  {
    severity: "medium",
    issue: "Obsidian REST API folder path encoding — spaces must be raw, not %20",
    rootCause: "Obsidian REST API does not decode %20 in folder paths; OBSIDIAN_BASE_URL also must have trailing slash stripped",
    fixApplied: "Use raw spaces in folder path strings; strip trailing slash from OBSIDIAN_BASE_URL on initialization",
    filesModified: "server/services/obsidian-service.ts",
    outcome: "Obsidian vault folder listing and note access works correctly",
    source: "Obsidian Integration Audit",
    sourceType: "integration_fix",
  },
  {
    severity: "high",
    issue: "Agent State Persistence — CEO Heartbeat queryFn URL bug caused 8 queries to fail silently on page load",
    rootCause: "queryFn URL was malformed; lastHeartbeatAt had no DB fallback; _globalPaused sentinel not in job_execution_locks; _nextRunAt not seeded from latest ceo_heartbeat_runs on startup",
    fixApplied: "Fixed queryFn URLs (8 queries); added lastHeartbeatAt DB fallback; _globalPaused sentinel in job_execution_locks; _nextRunAt seeded from latest heartbeat run on startup",
    filesModified: "client/src/pages/admin-ceo-heartbeat.tsx, server/services/ceo-heartbeat-service.ts",
    outcome: "CEO Heartbeat page loads with correct state; pause/resume persists across restarts",
    source: "Agent State Persistence Audit",
    sourceType: "persistence_fix",
  },
  {
    severity: "medium",
    issue: "Wallet/Stripe creditWallet non-idempotent — duplicate transactions possible under concurrent requests",
    rootCause: "No unique constraint on wallet_transactions; concurrent webhook delivery could insert duplicate credit rows",
    fixApplied: "Added DB unique indexes + onConflictDoNothing; added livemode column on wallet_transactions; dead-letter now stores userId",
    filesModified: "server/routes.ts, server/db/schema.ts",
    outcome: "Wallet credits are idempotent; no duplicate transactions",
    source: "Wallet Safety Audit",
    sourceType: "security_fix",
  },
  {
    severity: "high",
    issue: "Communication safety — Gmail agent could send live emails without human approval in certain code paths",
    rootCause: "Multiple send paths (cron, auto-execution, bulk) bypassed the central send guard; no atomic row claim to prevent duplicate sends in race conditions",
    fixApplied: "Centralized gate at server/services/agentmail-send-guard.ts; atomic row claim for duplicate-send race; all cron paths gated; blocked sends written to outbound_email_audit_log",
    filesModified: "server/services/agentmail-send-guard.ts, server/email-agent/follow-up-cron.ts, server/email-agent/auto-execution-engine.ts",
    outcome: "All outbound sends go through the single guard; emergency pause works on all paths",
    source: "Communication Safety Audit",
    sourceType: "security_fix",
  },
  {
    severity: "medium",
    issue: "Department OS v2 — import() chain caused module resolution failures at runtime",
    rootCause: "Dynamic import() chains with variable paths failed; static imports required for reliability; pctOf helper was named differently in subdirectory modules",
    fixApplied: "Static imports instead of dynamic import() chains; direct subdirectory path imports; renamed pct to pctOf",
    filesModified: "server/frameworks/department-os/builder/*.ts",
    outcome: "Department OS v2 modules load reliably; no runtime import errors",
    source: "Department OS v2 Audit",
    sourceType: "module_fix",
  },
  {
    severity: "high",
    issue: "Decision Journal auto-capture — Decisions tab was empty; only showed seed data, no real decisions",
    rootCause: "Decisions endpoint only filtered Hermes learnings by memoryType='decision'; no real decisions were being captured from approval/rejection paths",
    fixApplied: "Created software_kb_entries table and service; wired recordDecision() into 5 capture points (workflow, gmail, heartbeat, recommendations, reply classification); new /decisions/stats and /decisions/search endpoints",
    filesModified: "server/services/decision-journal-service.ts, server/routes.ts, client/src/pages/admin-organizational-memory.tsx",
    outcome: "Every approval/rejection auto-captured; Decisions tab shows live data with KPI row and source filters",
    source: "Decision Journal Implementation",
    sourceType: "feature_implementation",
  },
];

export async function seedHistoricalFixes(orgId: string): Promise<void> {
  if (_seeded) return;
  _seeded = true;
  await ensureSoftwareKbTable();
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM software_kb_entries WHERE source_type NOT IN ('human_admin') LIMIT 1`);
    const rows = Array.isArray(result) ? result : (result as any).rows ?? [];
    const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
    if (cnt > 0) return;
    for (const fix of HISTORICAL_FIXES) {
      await recordSoftwareKbEntry({ ...fix, orgId }).catch(() => {});
    }
  } catch { _seeded = false; }
}

// ─── Core types ────────────────────────────────────────────────────────────────

export interface SoftwareKbEntry {
  id: string;
  orgId: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  issue: string;
  rootCause: string;
  fixApplied: string;
  filesModified: string;
  outcome: string;
  source: string;
  sourceType: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareKbInput {
  orgId: string;
  severity?: "low" | "medium" | "high" | "critical" | string;
  issue: string;
  rootCause?: string;
  fixApplied?: string;
  filesModified?: string;
  outcome?: string;
  source?: string;
  sourceType?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, any>;
}

// ─── Core write ────────────────────────────────────────────────────────────────

export async function recordSoftwareKbEntry(input: SoftwareKbInput): Promise<string | null> {
  try {
    await ensureSoftwareKbTable();
    const id = `skb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.execute(sql`
      INSERT INTO software_kb_entries (
        id, org_id, severity, issue, root_cause, fix_applied,
        files_modified, outcome, source, source_type,
        related_entity_type, related_entity_id, metadata
      ) VALUES (
        ${id},
        ${input.orgId},
        ${input.severity ?? "medium"},
        ${input.issue},
        ${input.rootCause ?? ""},
        ${input.fixApplied ?? ""},
        ${input.filesModified ?? ""},
        ${input.outcome ?? ""},
        ${input.source ?? "Manual Entry"},
        ${input.sourceType ?? "human_admin"},
        ${input.relatedEntityType ?? null},
        ${input.relatedEntityId ?? null},
        ${JSON.stringify(input.metadata ?? {})}
      )
    `);
    return id;
  } catch (e) {
    console.error("[SoftwareKB] recordSoftwareKbEntry failed:", e);
    return null;
  }
}

// ─── Queries ───────────────────────────────────────────────────────────────────

export async function getSoftwareKbEntries(opts: {
  orgId?: string;
  severity?: string;
  sourceType?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<SoftwareKbEntry[]> {
  await ensureSoftwareKbTable();
  const { orgId, limit = 100, offset = 0 } = opts;
  const severity  = opts.severity  && opts.severity  !== "all" ? opts.severity  : undefined;
  const sourceType = opts.sourceType && opts.sourceType !== "all" ? opts.sourceType : undefined;
  try {
    const rows = await db.execute(sql`
      SELECT * FROM software_kb_entries
      WHERE 1=1
        ${orgId      ? sql`AND org_id      = ${orgId}`      : sql``}
        ${severity   ? sql`AND severity    = ${severity}`   : sql``}
        ${sourceType ? sql`AND source_type = ${sourceType}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[SoftwareKB] getSoftwareKbEntries failed:", e);
    return [];
  }
}

export async function searchSoftwareKbEntries(q: string, orgId?: string, limit = 30): Promise<SoftwareKbEntry[]> {
  await ensureSoftwareKbTable();
  if (!q.trim()) return [];
  try {
    const term = `%${q.toLowerCase()}%`;
    const rows = await db.execute(sql`
      SELECT * FROM software_kb_entries
      WHERE (
        lower(issue)          LIKE ${term} OR
        lower(root_cause)     LIKE ${term} OR
        lower(fix_applied)    LIKE ${term} OR
        lower(files_modified) LIKE ${term} OR
        lower(outcome)        LIKE ${term} OR
        lower(source)         LIKE ${term}
      )
      ${orgId ? sql`AND org_id = ${orgId}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const data = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[SoftwareKB] searchSoftwareKbEntries failed:", e);
    return [];
  }
}

export async function getSoftwareKbStats(orgId?: string): Promise<{
  total: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  last7DaysCount: number;
  bySourceType: Record<string, number>;
  bySeverity: Record<string, number>;
  topFilesModified: string[];
}> {
  await ensureSoftwareKbTable();
  try {
    const totalRes = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM software_kb_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
    `);
    const totalRows = Array.isArray(totalRes) ? totalRes : (totalRes as any).rows ?? [];
    const total = parseInt(totalRows[0]?.cnt ?? "0", 10);

    const sevRes = await db.execute(sql`
      SELECT severity, COUNT(*) AS cnt FROM software_kb_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
      GROUP BY severity
    `);
    const sevRows = Array.isArray(sevRes) ? sevRes : (sevRes as any).rows ?? [];
    const bySeverity: Record<string, number> = {};
    for (const r of sevRows) bySeverity[String(r.severity)] = parseInt(String(r.cnt), 10);

    const srcRes = await db.execute(sql`
      SELECT source_type, COUNT(*) AS cnt FROM software_kb_entries
      ${orgId ? sql`WHERE org_id = ${orgId}` : sql``}
      GROUP BY source_type
    `);
    const srcRows = Array.isArray(srcRes) ? srcRes : (srcRes as any).rows ?? [];
    const bySourceType: Record<string, number> = {};
    for (const r of srcRows) bySourceType[String(r.source_type)] = parseInt(String(r.cnt), 10);

    const weekRes = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM software_kb_entries
      WHERE created_at > now() - interval '7 days'
      ${orgId ? sql`AND org_id = ${orgId}` : sql``}
    `);
    const weekRows = Array.isArray(weekRes) ? weekRes : (weekRes as any).rows ?? [];
    const last7DaysCount = parseInt(String(weekRows[0]?.cnt ?? "0"), 10);

    return {
      total,
      criticalCount: bySeverity["critical"] ?? 0,
      highCount:     bySeverity["high"]     ?? 0,
      mediumCount:   bySeverity["medium"]   ?? 0,
      lowCount:      bySeverity["low"]      ?? 0,
      last7DaysCount,
      bySourceType,
      bySeverity,
      topFilesModified: [],
    };
  } catch (e) {
    console.error("[SoftwareKB] getSoftwareKbStats failed:", e);
    return { total: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, last7DaysCount: 0, bySourceType: {}, bySeverity: {}, topFilesModified: [] };
  }
}

// ─── Convenience wrappers ──────────────────────────────────────────────────────

export async function recordSoftwareImprovementFix(opts: {
  orgId: string;
  taskId: string;
  problemSummary: string;
  affectedArea?: string;
  suspectedFiles?: string;
  severity?: string;
}): Promise<void> {
  await recordSoftwareKbEntry({
    orgId: opts.orgId,
    severity: opts.severity ?? "medium",
    issue: opts.problemSummary,
    rootCause: `Software Improvement Agent detected issue in ${opts.affectedArea ?? "unknown area"}`,
    fixApplied: "Software Improvement Agent task created — awaiting engineering review",
    filesModified: opts.suspectedFiles ?? "",
    outcome: "Improvement task queued for resolution",
    source: "Software Improvement Agent",
    sourceType: "software_improvement_agent",
    relatedEntityType: "software_improvement_task",
    relatedEntityId: opts.taskId,
  });
}

export async function recordErrorBoundaryEvent(opts: {
  orgId: string;
  component: string;
  error: string;
  url?: string;
}): Promise<void> {
  await recordSoftwareKbEntry({
    orgId: opts.orgId,
    severity: "high",
    issue: `UI Error Boundary triggered: ${opts.component} — ${opts.error.slice(0, 200)}`,
    rootCause: `React error boundary caught unhandled error in component: ${opts.component}`,
    fixApplied: "Error boundary prevented full page crash; root cause pending engineering review",
    filesModified: opts.component,
    outcome: "Error isolated; user shown fallback UI",
    source: "Error Boundary Monitor",
    sourceType: "error_boundary",
    metadata: { url: opts.url ?? "", error: opts.error.slice(0, 500) },
  });
}

export async function recordTypeScriptFix(opts: {
  orgId: string;
  description: string;
  filesModified: string;
  errorCode?: string;
}): Promise<void> {
  await recordSoftwareKbEntry({
    orgId: opts.orgId,
    severity: "medium",
    issue: `TypeScript error resolved: ${opts.description}`,
    rootCause: opts.errorCode ? `TS error code: ${opts.errorCode}` : "TypeScript compilation error",
    fixApplied: opts.description,
    filesModified: opts.filesModified,
    outcome: "TypeScript build passes cleanly",
    source: "TypeScript Build",
    sourceType: "typescript_fix",
  });
}

export async function recordDeploymentFix(opts: {
  orgId: string;
  issue: string;
  fixApplied: string;
  filesModified?: string;
}): Promise<void> {
  await recordSoftwareKbEntry({
    orgId: opts.orgId,
    severity: "high",
    issue: opts.issue,
    rootCause: "Deployment or startup failure",
    fixApplied: opts.fixApplied,
    filesModified: opts.filesModified ?? "",
    outcome: "Server starts cleanly and all health checks pass",
    source: "Deployment Monitor",
    sourceType: "deployment_fix",
  });
}

// ─── Row mapper ────────────────────────────────────────────────────────────────

function mapRow(r: any): SoftwareKbEntry {
  return {
    id:                 r.id,
    orgId:              r.org_id,
    severity:           r.severity,
    issue:              r.issue,
    rootCause:          r.root_cause,
    fixApplied:         r.fix_applied,
    filesModified:      r.files_modified,
    outcome:            r.outcome,
    source:             r.source,
    sourceType:         r.source_type,
    relatedEntityType:  r.related_entity_type ?? null,
    relatedEntityId:    r.related_entity_id ?? null,
    metadata:           typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}),
    createdAt:          r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt:          r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}
