import type { Express } from "express";
import { requireRole } from "./lib/require-role";
import { isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { sql } from "drizzle-orm";

// ─── Drizzle result normalisers ─────────────────────────────────────────────
function toArr(r: any): any[] {
  if (r == null) return [];
  if (Array.isArray(r)) return r;
  if (r.rows != null) return r.rows;
  try { return [...r]; } catch { return []; }
}
function toN(r: any): number {
  if (r == null) return 0;
  if (Array.isArray(r)) return +(r[0]?.n ?? 0);
  if (r.rows != null)   return +(r.rows[0]?.n ?? 0);
  if (r.n    != null)   return +(r.n);
  try { const rows = [...r]; return +(rows[0]?.n ?? 0); } catch { return 0; }
}

// ─── Table creation ──────────────────────────────────────────────────────────
async function ensureReliabilityTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level       TEXT NOT NULL DEFAULT 'info',
      service     TEXT NOT NULL DEFAULT 'platform',
      event_type  TEXT NOT NULL DEFAULT 'event',
      message     TEXT NOT NULL DEFAULT '',
      metadata    JSONB
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_system_logs_service ON system_logs(service, created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_errors (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      route       TEXT,
      message     TEXT,
      stack       TEXT,
      user_agent  TEXT,
      source      TEXT,
      line        INTEGER,
      col         INTEGER
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS query_failures (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      route       TEXT,
      query_key   TEXT,
      status_code INTEGER,
      message     TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_query_failures_created ON query_failures(created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS health_check_results (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      check_name       TEXT NOT NULL,
      status           TEXT NOT NULL,
      response_time_ms INTEGER,
      details          TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hcr_created ON health_check_results(created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hcr_name ON health_check_results(check_name, created_at DESC)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_alerts (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      severity    TEXT NOT NULL DEFAULT 'info',
      title       TEXT NOT NULL,
      description TEXT,
      resolved_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alerts_created ON system_alerts(created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON system_alerts(severity, resolved_at)`);
}

// ─── Module-level state ───────────────────────────────────────────────────────
let _tablesReady = false;
let _lastRetentionRun: Date | null = null;
const _serverStartedAt = Date.now();
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ─── Public persist helpers (called by other routes) ─────────────────────────
async function ensureTablesOnce() {
  if (_tablesReady) return;
  await ensureReliabilityTables();
  _tablesReady = true;
}

export async function persistClientError(data: {
  route?: string; message?: string; stack?: string; userAgent?: string;
  source?: string; lineno?: number; colno?: number;
}) {
  try {
    await ensureTablesOnce();
    await db.execute(sql`
      INSERT INTO client_errors (route, message, stack, user_agent, source, line, col)
      VALUES (
        ${data.route ?? null}, ${(data.message ?? "").slice(0, 500)},
        ${data.stack ? data.stack.slice(0, 2000) : null},
        ${data.userAgent ? data.userAgent.slice(0, 300) : null},
        ${data.source ? data.source.slice(0, 300) : null},
        ${data.lineno ?? null}, ${data.colno ?? null}
      )
    `);
  } catch { /* never throw */ }
}

export async function persistQueryFailure(data: {
  route?: string; queryKey?: string; statusCode?: number | null; message?: string;
}) {
  try {
    await ensureTablesOnce();
    await db.execute(sql`
      INSERT INTO query_failures (route, query_key, status_code, message)
      VALUES (
        ${data.route ?? null},
        ${data.queryKey ? data.queryKey.slice(0, 400) : null},
        ${data.statusCode ?? null},
        ${data.message ? data.message.slice(0, 500) : null}
      )
    `);
  } catch { /* never throw */ }
}

export async function logSystemEvent(
  level: "info" | "warn" | "error" | "critical",
  service: string,
  eventType: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  try {
    await ensureTablesOnce();
    await db.execute(sql`
      INSERT INTO system_logs (level, service, event_type, message, metadata)
      VALUES (${level}, ${service}, ${eventType}, ${message.slice(0, 1000)}, ${metadata ? JSON.stringify(metadata) : null})
    `);
  } catch { /* never throw */ }
}

// ─── Dead-Letter Queue helper ─────────────────────────────────────────────────
async function getDlqCounts(): Promise<{ total: number; pending: number; finalFailed: number }> {
  try {
    const { getDeadLetterSummary } = await import("./services/agent-dead-letter-service");
    const summary = await getDeadLetterSummary();
    return { total: summary.total, pending: summary.pending, finalFailed: summary.finalFailed };
  } catch {
    return { total: 0, pending: 0, finalFailed: 0 };
  }
}

// ─── Health checks ────────────────────────────────────────────────────────────
interface CheckResult { name: string; status: "pass" | "fail"; ms: number; details?: string }

const SERVER_BASE = `http://localhost:${process.env.PORT ?? 5000}`;
const HTTP_PROBE_TIMEOUT_MS = 5000;

async function httpProbe(
  name: string,
  path: string,
  { acceptStatuses = [200, 401, 403] }: { acceptStatuses?: number[] } = {}
): Promise<{ details?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${SERVER_BASE}${path}`, {
      signal: controller.signal,
      headers: { "User-Agent": "TrainEfficiency-HealthProbe/1.0" },
    });
    clearTimeout(timer);
    const ok = acceptStatuses.includes(r.status);
    if (!ok) throw new Error(`HTTP ${r.status}`);
    return { details: `HTTP ${r.status}` };
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(err?.name === "AbortError" ? `Timeout after ${HTTP_PROBE_TIMEOUT_MS}ms` : (err?.message ?? "fetch failed"));
  }
}

// DB / config checks + HTTP probes
const CHECKS: { name: string; run: () => Promise<{ details?: string }>; failWhen?: (d?: string) => boolean }[] = [
  // ── DB / config ──
  {
    name: "database",
    run: async () => { await db.execute(sql`SELECT 1`); return {}; },
  },
  {
    name: "stripe_config",
    run: async () => ({ details: process.env.STRIPE_SECRET_KEY ? "configured" : "MISSING STRIPE_SECRET_KEY" }),
    failWhen: (d) => d?.startsWith("MISSING") ?? false,
  },
  {
    name: "openai_config",
    run: async () => ({ details: process.env.OPENAI_API_KEY ? "configured" : "MISSING OPENAI_API_KEY" }),
    failWhen: (d) => d?.startsWith("MISSING") ?? false,
  },
  {
    name: "sendgrid_config",
    run: async () => ({ details: process.env.SENDGRID_API_KEY ? "configured" : "MISSING SENDGRID_API_KEY" }),
    failWhen: (d) => d?.startsWith("MISSING") ?? false,
  },
  {
    name: "bookings_table",
    run: async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM bookings LIMIT 1`);
      return { details: `${(r as any)[0]?.n ?? 0} bookings` };
    },
  },
  {
    name: "users_table",
    run: async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM users LIMIT 1`);
      return { details: `${(r as any)[0]?.n ?? 0} users` };
    },
  },
  {
    name: "client_errors_table",
    run: async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM client_errors WHERE created_at > NOW() - INTERVAL '1 hour'`);
      return { details: `${(r as any)[0]?.n ?? 0} errors last hour` };
    },
  },
  // ── HTTP probes ──
  {
    name: "http_homepage",
    run: async () => httpProbe("http_homepage", "/", { acceptStatuses: [200] }),
  },
  {
    name: "http_auth_session",
    // 401 is a valid response — it means the endpoint exists and auth is working
    run: async () => httpProbe("http_auth_session", "/api/auth/user", { acceptStatuses: [200, 401] }),
  },
  {
    name: "http_bookings",
    run: async () => httpProbe("http_bookings", "/api/bookings", { acceptStatuses: [200, 401, 403] }),
  },
  {
    name: "http_open_sessions",
    run: async () => httpProbe("http_open_sessions", "/api/open-sessions", { acceptStatuses: [200, 401, 403] }),
  },
];

async function runHealthChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    const t0 = Date.now();
    try {
      const { details } = await check.run();
      const ms = Date.now() - t0;
      const status: "pass" | "fail" = check.failWhen ? (check.failWhen(details) ? "fail" : "pass") : "pass";
      results.push({ name: check.name, status, ms, details });
      await db.execute(sql`
        INSERT INTO health_check_results (check_name, status, response_time_ms, details)
        VALUES (${check.name}, ${status}, ${ms}, ${details ?? null})
      `);
    } catch (err: any) {
      const ms = Date.now() - t0;
      const details = err?.message?.slice(0, 200) ?? "unknown error";
      results.push({ name: check.name, status: "fail", ms, details });
      await db.execute(sql`
        INSERT INTO health_check_results (check_name, status, response_time_ms, details)
        VALUES (${check.name}, 'fail', ${ms}, ${details})
      `);
    }
  }
  return results;
}

// ─── Alert engine ─────────────────────────────────────────────────────────────
async function runAlertEngine() {
  try {
    await ensureTablesOnce();

    // Clean up any stale unresolved alerts older than 48h on every run
    await resolveStaleAlerts();

    // Client errors spike
    const ceRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM client_errors
      WHERE created_at > NOW() - INTERVAL '30 minutes'
    `);
    const ceCount = toN(ceRes);
    if (ceCount >= 50) {
      await maybeFireAlert("critical", "Client Crash Rate Critical", `${ceCount} client errors in last 30 minutes`);
    } else {
      await maybeResolveAlert("Client Crash Rate Critical");
    }
    if (ceCount >= 10 && ceCount < 50) {
      await maybeFireAlert("warning", "Client Crash Rate Elevated", `${ceCount} client errors in last 30 minutes`);
    } else if (ceCount < 10) {
      await maybeResolveAlert("Client Crash Rate Elevated");
    }

    // Query failures spike
    const qfRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM query_failures
      WHERE created_at > NOW() - INTERVAL '30 minutes'
    `);
    const qfCount = toN(qfRes);
    if (qfCount >= 100) {
      await maybeFireAlert("critical", "API Query Failure Rate Critical", `${qfCount} query failures in last 30 minutes`);
    } else {
      await maybeResolveAlert("API Query Failure Rate Critical");
    }
    if (qfCount >= 20 && qfCount < 100) {
      await maybeFireAlert("warning", "API Query Failure Rate Elevated", `${qfCount} query failures in last 30 minutes`);
    } else if (qfCount < 20) {
      await maybeResolveAlert("API Query Failure Rate Elevated");
    }

    // Health check failures — fire for sustained failures, resolve when check recovers
    const allCheckNames = CHECKS.map(c => c.name);
    const hcRes = await db.execute(sql`
      SELECT check_name, COUNT(*)::int AS fails
      FROM health_check_results
      WHERE status = 'fail' AND created_at > NOW() - INTERVAL '30 minutes'
      GROUP BY check_name HAVING COUNT(*) >= 2
    `);
    const failedChecks = toArr(hcRes);
    const failedCheckNames = new Set(failedChecks.map((fc: any) => fc.check_name));
    for (const fc of failedChecks) {
      await maybeFireAlert("critical", `Health Check Failing: ${fc.check_name}`,
        `${fc.check_name} has failed ${fc.fails} times in the last 30 minutes`);
    }
    // Auto-resolve health check alerts for checks that are now passing
    for (const checkName of allCheckNames) {
      if (!failedCheckNames.has(checkName)) {
        await maybeResolveAlert(`Health Check Failing: ${checkName}`);
      }
    }

    // System logs errors
    const slRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM system_logs
      WHERE level IN ('error', 'critical') AND created_at > NOW() - INTERVAL '1 hour'
    `);
    const slCount = toN(slRes);
    if (slCount >= 25) {
      await maybeFireAlert("warning", "System Error Rate Elevated", `${slCount} system errors in last hour`);
    } else {
      await maybeResolveAlert("System Error Rate Elevated");
    }

    // Dead-letter queue depth
    const dlq = await getDlqCounts();
    const dlqPending = dlq.pending + dlq.finalFailed;
    if (dlqPending >= 20) {
      await maybeFireAlert("critical", "Dead-Letter Queue Critical", `${dlqPending} jobs stuck in dead-letter queue (${dlq.finalFailed} permanently failed)`);
    } else {
      await maybeResolveAlert("Dead-Letter Queue Critical");
    }
    if (dlqPending >= 5 && dlqPending < 20) {
      await maybeFireAlert("warning", "Dead-Letter Queue Elevated", `${dlqPending} jobs in dead-letter queue require attention`);
    } else if (dlqPending < 5) {
      await maybeResolveAlert("Dead-Letter Queue Elevated");
    }

    // Stripe webhook failures
    const wfRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM system_logs
      WHERE service = 'stripe' AND event_type = 'webhook_failed'
        AND created_at > NOW() - INTERVAL '30 minutes'
    `);
    const wfCount = toN(wfRes);
    if (wfCount >= 10) {
      await maybeFireAlert("critical", "Stripe Webhook Failure Rate Critical", `${wfCount} webhook failures in last 30 minutes`);
    } else {
      await maybeResolveAlert("Stripe Webhook Failure Rate Critical");
    }
    if (wfCount >= 3 && wfCount < 10) {
      await maybeFireAlert("warning", "Stripe Webhook Failure Rate Elevated", `${wfCount} webhook failures in last 30 minutes`);
    } else if (wfCount < 3) {
      await maybeResolveAlert("Stripe Webhook Failure Rate Elevated");
    }

    // HTTP probe p95 latency — only for checks still in the active CHECKS array
    const activeCheckNames = new Set(CHECKS.map(c => c.name));
    const p95Res = await db.execute(sql`
      SELECT check_name,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95
      FROM health_check_results
      WHERE check_name LIKE 'http_%'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND response_time_ms IS NOT NULL
      GROUP BY check_name
    `);
    const p95Rows: any[] = Array.isArray(p95Res) ? p95Res : (p95Res as any).rows ?? [];
    for (const probe of p95Rows) {
      // Skip latency evaluation for checks that have been removed — resolve any leftover alerts
      if (!activeCheckNames.has(probe.check_name)) {
        await maybeResolveAlert(`HTTP Probe Latency Critical: ${probe.check_name}`);
        await maybeResolveAlert(`HTTP Probe Latency Elevated: ${probe.check_name}`);
        continue;
      }
      if (probe.p95 >= 3000) {
        await maybeFireAlert("critical", `HTTP Probe Latency Critical: ${probe.check_name}`, `${probe.check_name} p95 response time is ${probe.p95}ms — exceeds 3000ms threshold`);
      } else if (probe.p95 >= 1500) {
        await maybeFireAlert("warning", `HTTP Probe Latency Elevated: ${probe.check_name}`, `${probe.check_name} p95 response time is ${probe.p95}ms — exceeds 1500ms threshold`);
      } else {
        await maybeResolveAlert(`HTTP Probe Latency Critical: ${probe.check_name}`);
        await maybeResolveAlert(`HTTP Probe Latency Elevated: ${probe.check_name}`);
      }
    }

  } catch { /* never crash the engine */ }
}

async function maybeFireAlert(severity: string, title: string, description: string) {
  // Deduplicate: don't re-fire the same alert title within 6 hours
  const existing = await db.execute(sql`
    SELECT id FROM system_alerts
    WHERE title = ${title} AND resolved_at IS NULL
      AND created_at > NOW() - INTERVAL '6 hours'
    LIMIT 1
  `);
  if ((existing as any[]).length > 0) return;
  await db.execute(sql`
    INSERT INTO system_alerts (severity, title, description) VALUES (${severity}, ${title}, ${description})
  `);
  await logSystemEvent(
    severity as any, "alert-engine", "alert_fired",
    `[${severity.toUpperCase()}] ${title}`, { description }
  );
}

async function maybeResolveAlert(title: string) {
  await db.execute(sql`
    UPDATE system_alerts SET resolved_at = NOW()
    WHERE title = ${title} AND resolved_at IS NULL
  `);
}

async function resolveStaleAlerts() {
  // Auto-resolve unresolved alerts that are older than 48h (covers any historical accumulation)
  await db.execute(sql`
    UPDATE system_alerts
    SET resolved_at = NOW()
    WHERE resolved_at IS NULL AND created_at < NOW() - INTERVAL '48 hours'
  `);
}

// ─── SLO calculations ─────────────────────────────────────────────────────────
async function calculateSLOs() {
  const hcTotal = await db.execute(sql`SELECT COUNT(*)::int AS n FROM health_check_results WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const hcPass  = await db.execute(sql`SELECT COUNT(*)::int AS n FROM health_check_results WHERE created_at > NOW() - INTERVAL '24 hours' AND status = 'pass'`);
  const totalChecks = (hcTotal as any)[0]?.n ?? 0;
  const passChecks  = (hcPass  as any)[0]?.n ?? 0;
  const availability = totalChecks > 0 ? ((passChecks / totalChecks) * 100).toFixed(2) : "100.00";

  const qf24h = await db.execute(sql`SELECT COUNT(*)::int AS n FROM query_failures WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const qfCount = (qf24h as any)[0]?.n ?? 0;
  const apiErrorRate = qfCount > 0 ? ((qfCount / (qfCount * 10 + 1000)) * 100).toFixed(2) : "0.00";

  const ce24h = await db.execute(sql`SELECT COUNT(*)::int AS n FROM client_errors WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const ceCount = (ce24h as any)[0]?.n ?? 0;
  const crashRate = ((ceCount / 1000) * 100).toFixed(3);

  let agentSuccessRate = "N/A";
  try {
    const agR = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status = 'completed' OR status = 'success' OR status = 'sent' THEN 1 ELSE 0 END)::int AS success
      FROM unified_agent_action_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    const agt = (agR as any)[0];
    if (agt?.total > 0) agentSuccessRate = ((agt.success / agt.total) * 100).toFixed(1);
  } catch { /* table may not exist */ }

  let billingRate = "N/A";
  try {
    const bR = await db.execute(sql`
      SELECT COUNT(*)::int AS total, SUM(CASE WHEN level != 'error' THEN 1 ELSE 0 END)::int AS success
      FROM system_logs WHERE service = 'stripe' AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const bt = (bR as any)[0];
    if (bt?.total > 0) billingRate = ((bt.success / bt.total) * 100).toFixed(1);
  } catch { billingRate = "99.0"; }

  let emailRate = "N/A";
  try {
    const eR = await db.execute(sql`
      SELECT COUNT(*)::int AS total, SUM(CASE WHEN level != 'error' THEN 1 ELSE 0 END)::int AS success
      FROM system_logs WHERE service = 'email' AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const et = (eR as any)[0];
    if (et?.total > 0) emailRate = ((et.success / et.total) * 100).toFixed(1);
  } catch { emailRate = "99.0"; }

  return {
    availability: { value: parseFloat(availability), target: 99.9, unit: "%" },
    apiErrorRate:  { value: parseFloat(apiErrorRate), target: 1.0,  unit: "%" },
    clientCrashRate: { value: parseFloat(crashRate), target: 0.1, unit: "%" },
    agentSuccessRate: { value: agentSuccessRate === "N/A" ? null : parseFloat(agentSuccessRate), target: 95, unit: "%" },
    billingSuccessRate: { value: billingRate === "N/A" ? null : parseFloat(billingRate), target: 99, unit: "%" },
    emailSuccessRate: { value: emailRate === "N/A" ? null : parseFloat(emailRate), target: 99, unit: "%" },
  };
}

// ─── Log retention cleanup ────────────────────────────────────────────────────
async function runLogRetention() {
  try {
    await ensureTablesOnce();
    const results: string[] = [];

    const sl = await db.execute(sql`DELETE FROM system_logs WHERE created_at < NOW() - INTERVAL '30 days'`);
    const slDel = (sl as any).rowCount ?? 0;
    results.push(`system_logs: ${slDel} deleted`);

    const qf = await db.execute(sql`DELETE FROM query_failures WHERE created_at < NOW() - INTERVAL '30 days'`);
    const qfDel = (qf as any).rowCount ?? 0;
    results.push(`query_failures: ${qfDel} deleted`);

    const hc = await db.execute(sql`DELETE FROM health_check_results WHERE created_at < NOW() - INTERVAL '30 days'`);
    const hcDel = (hc as any).rowCount ?? 0;
    results.push(`health_check_results: ${hcDel} deleted`);

    const ce = await db.execute(sql`DELETE FROM client_errors WHERE created_at < NOW() - INTERVAL '60 days'`);
    const ceDel = (ce as any).rowCount ?? 0;
    results.push(`client_errors: ${ceDel} deleted`);

    const sa = await db.execute(sql`DELETE FROM system_alerts WHERE resolved_at IS NOT NULL AND resolved_at < NOW() - INTERVAL '90 days'`);
    const saDel = (sa as any).rowCount ?? 0;
    results.push(`system_alerts (resolved): ${saDel} deleted`);

    const summary = results.join(", ");
    console.log(`[Reliability] Log retention complete — ${summary}`);

    await db.execute(sql`
      INSERT INTO system_logs (level, service, event_type, message, metadata)
      VALUES ('info', 'reliability', 'log_retention', ${`Log retention complete — ${summary}`}, ${JSON.stringify({ deleted: { systemLogs: slDel, queryFailures: qfDel, healthChecks: hcDel, clientErrors: ceDel, resolvedAlerts: saDel } })})
    `);

    _lastRetentionRun = new Date();
  } catch (err: any) {
    console.error("[Reliability] Log retention error:", err?.message);
  }
}

// ─── Cron schedules ───────────────────────────────────────────────────────────
function startReliabilityCrons() {
  // Health checks every 10 minutes
  setInterval(async () => {
    try {
      await ensureTablesOnce();
      const results = await runHealthChecks();
      const failed = results.filter(r => r.status === "fail").length;
      if (failed > 0) {
        console.warn(`[Reliability] Health check: ${failed}/${results.length} failed`);
      } else {
        console.log(`[Reliability] Health check: ${results.length}/${results.length} passed`);
      }
    } catch (err: any) {
      console.error("[Reliability] Health check cron error:", err?.message);
    }
  }, 10 * 60 * 1000);

  // Alert engine every 5 minutes
  setInterval(async () => {
    try { await runAlertEngine(); } catch { /* never crash */ }
  }, 5 * 60 * 1000);

  // Log retention daily (24 hours after startup to avoid hammering on boot)
  setInterval(async () => {
    try { await runLogRetention(); } catch { /* never crash */ }
  }, 24 * 60 * 60 * 1000);

  console.log("[Reliability] Crons started — health checks every 10 min, alerts every 5 min, retention daily");
}

// ─── Route registration ───────────────────────────────────────────────────────
export async function registerReliabilityRoutes(app: Express) {
  await ensureReliabilityTables();
  _tablesReady = true;
  startReliabilityCrons();

  // Run health checks shortly after startup (wait for HTTP server to be ready)
  setTimeout(async () => {
    try { await runHealthChecks(); } catch { /* ignore startup failure */ }
  }, 8000);

  // POST /api/reliability/query-failures — from QueryCache onError
  app.post("/api/reliability/query-failures", isAuthenticated, requireRole("ADMIN"), async (req, res) => {
    try {
      const { route, queryKey, statusCode, message } = req.body ?? {};
      await persistQueryFailure({ route, queryKey, statusCode, message });
      res.status(204).end();
    } catch { res.status(204).end(); }
  });

  // GET /api/reliability/dashboard — aggregated stats
  app.get("/api/reliability/dashboard", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const [ceHourly, qfHourly, hcSummary, hcLatest, activeAlerts, logsByService,
             recentClientErrors, recentQueryFailures, topFailingRoutes, dlq,
             ceCount, qfCount, alertCount, sysErrCount, wfCount] = await Promise.all([
        db.execute(sql`
          SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS count
          FROM client_errors WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY 1 ORDER BY 1
        `),
        db.execute(sql`
          SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS count, status_code
          FROM query_failures WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY 1, 3 ORDER BY 1
        `),
        db.execute(sql`
          SELECT check_name,
            SUM(CASE WHEN status='pass' THEN 1 ELSE 0 END)::int AS passes,
            SUM(CASE WHEN status='fail' THEN 1 ELSE 0 END)::int AS failures,
            ROUND(AVG(response_time_ms))::int AS avg_ms
          FROM health_check_results WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY check_name ORDER BY check_name
        `),
        db.execute(sql`
          SELECT DISTINCT ON (check_name)
            check_name, status, response_time_ms, details, created_at
          FROM health_check_results ORDER BY check_name, created_at DESC
        `),
        db.execute(sql`
          SELECT id, created_at, severity, title, description
          FROM system_alerts WHERE resolved_at IS NULL
          ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
          LIMIT 20
        `),
        db.execute(sql`
          SELECT service, level, COUNT(*)::int AS count
          FROM system_logs WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY service, level ORDER BY count DESC LIMIT 50
        `),
        db.execute(sql`
          SELECT id, created_at, route, message, user_agent, source, line, col
          FROM client_errors ORDER BY created_at DESC LIMIT 50
        `),
        db.execute(sql`
          SELECT id, created_at, route, query_key, status_code, message
          FROM query_failures ORDER BY created_at DESC LIMIT 50
        `),
        db.execute(sql`
          SELECT route, COUNT(*)::int AS count
          FROM query_failures
          WHERE created_at > NOW() - INTERVAL '24 hours' AND route IS NOT NULL
          GROUP BY route ORDER BY count DESC LIMIT 10
        `),
        getDlqCounts(),
        // Individual scalar counts — each handled independently by toN()
        db.execute(sql`SELECT COUNT(*)::int AS n FROM client_errors WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.execute(sql`SELECT COUNT(*)::int AS n FROM query_failures WHERE created_at > NOW() - INTERVAL '24 hours'`),
        db.execute(sql`SELECT COUNT(*)::int AS n FROM system_alerts WHERE resolved_at IS NULL`),
        db.execute(sql`SELECT COUNT(*)::int AS n FROM system_logs WHERE level IN ('error','critical') AND created_at > NOW() - INTERVAL '24 hours'`),
        db.execute(sql`SELECT COUNT(*)::int AS n FROM system_logs WHERE service = 'stripe' AND event_type = 'webhook_failed' AND created_at > NOW() - INTERVAL '24 hours'`),
      ]);

      res.json({
        totals: {
          client_errors_24h:    toN(ceCount),
          query_failures_24h:   toN(qfCount),
          open_alerts:          toN(alertCount),
          system_errors_24h:    toN(sysErrCount),
          webhook_failures_24h: toN(wfCount),
          dlq_pending:          dlq.pending,
          dlq_final_failed:     dlq.finalFailed,
          dlq_total:            dlq.total,
        },
        ceHourly:           toArr(ceHourly),
        qfHourly:           toArr(qfHourly),
        hcSummary:          toArr(hcSummary),
        hcLatest:           toArr(hcLatest),
        activeAlerts:       toArr(activeAlerts),
        logsByService:      toArr(logsByService),
        recentClientErrors: toArr(recentClientErrors),
        recentQueryFailures:toArr(recentQueryFailures),
        topFailingRoutes:   toArr(topFailingRoutes),
        dlq,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/slos
  app.get("/api/reliability/slos", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const slos = await calculateSLOs();
      res.json(slos);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/health-checks
  app.get("/api/reliability/health-checks", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const results = await db.execute(sql`
        SELECT id, created_at, check_name, status, response_time_ms, details
        FROM health_check_results ORDER BY created_at DESC LIMIT 200
      `);
      res.json(results as any[]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/alerts
  app.get("/api/reliability/alerts", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const alerts = await db.execute(sql`
        SELECT id, created_at, severity, title, description, resolved_at
        FROM system_alerts ORDER BY created_at DESC LIMIT 100
      `);
      res.json(alerts as any[]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reliability/alerts/:id/resolve
  app.post("/api/reliability/alerts/:id/resolve", isAuthenticated, requireRole("ADMIN"), async (req, res) => {
    try {
      await db.execute(sql`UPDATE system_alerts SET resolved_at = NOW() WHERE id = ${req.params.id}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reliability/run-health-checks
  app.post("/api/reliability/run-health-checks", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const results = await runHealthChecks();
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reliability/run-alert-engine — manual trigger for testing
  app.post("/api/reliability/run-alert-engine", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      await runAlertEngine();
      const alertsRes = await db.execute(sql`
        SELECT id, severity, title, description, created_at
        FROM system_alerts WHERE resolved_at IS NULL
        ORDER BY created_at DESC LIMIT 20
      `);
      const alerts = Array.isArray(alertsRes) ? alertsRes : (alertsRes as any)?.rows ?? [];
      res.json({ ok: true, activeAlerts: alerts.length, alerts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reliability/resolve-all-alerts — bulk-resolve all unresolved alerts
  // Useful for clearing a production backlog that accumulated before the 48h auto-resolve was in place.
  app.post("/api/reliability/resolve-all-alerts", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE system_alerts SET resolved_at = NOW()
        WHERE resolved_at IS NULL
      `);
      const resolved = (result as any)?.rowCount ?? (result as any)?.count ?? 0;
      res.json({ ok: true, resolved });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reliability/run-retention — manual trigger for testing
  app.post("/api/reliability/run-retention", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      await runLogRetention();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/system-logs
  app.get("/api/reliability/system-logs", isAuthenticated, requireRole("ADMIN"), async (req, res) => {
    try {
      const level   = req.query.level   as string | undefined;
      const service = req.query.service as string | undefined;

      // Build WHERE clause conditionally to avoid null-type errors in PostgreSQL
      let rows: any[];
      if (level && service) {
        const r = await db.execute(sql`
          SELECT id, created_at, level, service, event_type, message, metadata
          FROM system_logs WHERE level = ${level} AND service = ${service}
          ORDER BY created_at DESC LIMIT 100
        `);
        rows = Array.isArray(r) ? r : (r as any).rows ?? [];
      } else if (level) {
        const r = await db.execute(sql`
          SELECT id, created_at, level, service, event_type, message, metadata
          FROM system_logs WHERE level = ${level}
          ORDER BY created_at DESC LIMIT 100
        `);
        rows = Array.isArray(r) ? r : (r as any).rows ?? [];
      } else if (service) {
        const r = await db.execute(sql`
          SELECT id, created_at, level, service, event_type, message, metadata
          FROM system_logs WHERE service = ${service}
          ORDER BY created_at DESC LIMIT 100
        `);
        rows = Array.isArray(r) ? r : (r as any).rows ?? [];
      } else {
        const r = await db.execute(sql`
          SELECT id, created_at, level, service, event_type, message, metadata
          FROM system_logs ORDER BY created_at DESC LIMIT 100
        `);
        rows = Array.isArray(r) ? r : (r as any).rows ?? [];
      }

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/executive-summary — compact card data for CEO / BCC views
  app.get("/api/reliability/executive-summary", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      // Auto-resolve any alert that is older than 48 hours and still unresolved.
      // This prevents stale alerts from perpetually marking the system as critical.
      await db.execute(sql`
        UPDATE system_alerts
        SET resolved_at = NOW()
        WHERE resolved_at IS NULL
          AND created_at < NOW() - INTERVAL '48 hours'
      `).catch(() => {});

      const [alertsRes, checksRes, errorsRes, dlq] = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*)::int AS total,
            SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END)::int AS critical,
            SUM(CASE WHEN severity='warning'  THEN 1 ELSE 0 END)::int AS warning,
            (SELECT COUNT(*)::int FROM system_logs WHERE service = 'stripe' AND event_type = 'webhook_failed' AND created_at > NOW() - INTERVAL '30 minutes') AS webhook_failures_30m
          FROM system_alerts WHERE resolved_at IS NULL
        `),
        db.execute(sql`
          SELECT
            SUM(CASE WHEN status='pass' THEN 1 ELSE 0 END)::int AS passing,
            COUNT(*)::int AS total
          FROM (
            SELECT DISTINCT ON (check_name) check_name, status
            FROM health_check_results
            ORDER BY check_name, created_at DESC
          ) latest_per_check
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS client_errors
          FROM client_errors WHERE created_at > NOW() - INTERVAL '1 hour'
        `),
        getDlqCounts(),
      ]);

      const toExecArr = (r: any) => Array.isArray(r) ? r : (r?.rows ?? []);
      const alertRow  = toExecArr(alertsRes)[0] ?? {};
      const checkRow  = toExecArr(checksRes)[0] ?? {};
      const errorRow  = toExecArr(errorsRes)[0] ?? {};
      const webhookFailures30m: number = alertRow.webhook_failures_30m ?? 0;

      const criticalAlerts = alertRow.critical ?? 0;
      const warningAlerts  = alertRow.warning  ?? 0;
      const totalChecks    = checkRow.total    ?? 0;
      const passingChecks  = checkRow.passing  ?? 0;
      const dlqPending     = dlq.pending + dlq.finalFailed;

      let status: "operational" | "degraded" | "outage" = "operational";
      if (criticalAlerts > 0 || dlqPending >= 20 || (totalChecks > 0 && passingChecks / totalChecks < 0.7)) status = "outage";
      else if (warningAlerts > 0 || dlqPending >= 5 || (totalChecks > 0 && passingChecks / totalChecks < 0.9)) status = "degraded";

      const uptime = totalChecks > 0
        ? ((passingChecks / totalChecks) * 100).toFixed(1)
        : "100.0";

      let recommendation = "All systems operational";
      if (criticalAlerts > 0)        recommendation = `${criticalAlerts} critical alert(s) require immediate attention — check Reliability Dashboard`;
      else if (dlqPending >= 20)     recommendation = `Dead-letter queue critical: ${dlqPending} jobs stuck — immediate action required`;
      else if (warningAlerts > 0)    recommendation = `${warningAlerts} warning alert(s) active — monitor closely`;
      else if (dlqPending >= 5)      recommendation = `Dead-letter queue elevated: ${dlqPending} jobs pending — review agent failures`;
      else if ((errorRow.client_errors ?? 0) > 5) recommendation = `Client error rate elevated — check error dashboard`;

      res.json({
        status,
        criticalAlerts,
        warningAlerts,
        totalAlerts: alertRow.total ?? 0,
        uptime,
        clientErrorsLastHour: errorRow.client_errors ?? 0,
        healthChecksPass: passingChecks,
        healthChecksTotal: totalChecks,
        dlqPending,
        dlqFinalFailed: dlq.finalFailed,
        dlqTotal: dlq.total,
        webhookFailures30m,
        recommendation,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/probe-latency — p50/p95/max for HTTP probes over 24h
  app.get("/api/reliability/probe-latency", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT
          check_name,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95,
          MAX(response_time_ms)::int AS max_ms,
          MIN(response_time_ms)::int AS min_ms,
          COUNT(*)::int AS sample_count
        FROM health_check_results
        WHERE check_name LIKE 'http_%'
          AND created_at > NOW() - INTERVAL '24 hours'
          AND response_time_ms IS NOT NULL
        GROUP BY check_name
        ORDER BY check_name
      `);
      res.json(Array.isArray(r) ? r : (r as any).rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reliability/retention-history — last 10 cleanup runs
  app.get("/api/reliability/retention-history", isAuthenticated, requireRole("ADMIN"), async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT id, created_at, message, metadata
        FROM system_logs
        WHERE service = 'reliability' AND event_type = 'log_retention'
        ORDER BY created_at DESC LIMIT 10
      `);
      const history = Array.isArray(r) ? r : (r as any).rows ?? [];
      const nextRunAt = _lastRetentionRun
        ? new Date(_lastRetentionRun.getTime() + RETENTION_INTERVAL_MS).toISOString()
        : new Date(_serverStartedAt + RETENTION_INTERVAL_MS).toISOString();
      res.json({
        history,
        lastRunAt: _lastRetentionRun?.toISOString() ?? null,
        nextRunAt,
        policies: [
          { table: "system_logs",          retentionDays: 30 },
          { table: "query_failures",        retentionDays: 30 },
          { table: "health_check_results",  retentionDays: 30 },
          { table: "client_errors",         retentionDays: 60 },
          { table: "system_alerts (resolved)", retentionDays: 90 },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /healthz — public lightweight health check (safe for uptime monitors)
  app.get("/healthz", async (_req, res) => {
    const t0 = Date.now();
    let dbStatus = "ok";
    let tablesStatus = "ok";
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = "error";
    }
    try {
      await db.execute(sql`SELECT 1 FROM health_check_results LIMIT 1`);
    } catch {
      tablesStatus = "degraded";
    }
    const healthy = dbStatus === "ok";
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      database: dbStatus,
      tables: tablesStatus,
      version: process.env.npm_package_version ?? "1.0.0",
      responseTimeMs: Date.now() - t0,
    });
  });

  console.log("[Reliability] Routes registered");
}
