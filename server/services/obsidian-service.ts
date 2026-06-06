/**
 * Obsidian Integration Service
 *
 * Obsidian acts as the human-readable organizational memory layer for the
 * AI workforce. TrainEfficiency DB remains the source of truth for all
 * athlete/business data. Obsidian stores agent decisions, reports, learnings,
 * and procedural knowledge in markdown form.
 *
 * Requires env vars:
 *   OBSIDIAN_BASE_URL  — e.g. https://127.0.0.1:27124
 *   OBSIDIAN_API_KEY   — from Obsidian → Settings → Local REST API
 *
 * All calls are non-throwing: failures are logged and ignored so agents
 * are never blocked by Obsidian connectivity issues.
 */

// ─── Config ──────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    baseUrl: process.env.OBSIDIAN_BASE_URL || "",
    apiKey: process.env.OBSIDIAN_API_KEY || "",
  };
}

export function isObsidianConfigured(): boolean {
  const { baseUrl, apiKey } = getConfig();
  return !!(baseUrl && apiKey);
}

// ─── Vault Folders ───────────────────────────────────────────────────────────
export const OBSIDIAN_FOLDERS = {
  ceoHeartbeat: "CEO Heartbeat",
  agentDecisions: "Agent Decisions",
  softwareImprovements: "Software Improvements",
  hermesLearning: "Hermes Learning",
  revenueIntelligence: "Revenue Intelligence",
  growthIntelligence: "Growth Intelligence",
  schedulingIntelligence: "Scheduling Intelligence",
  clientSuccess: "Client Success",
  sops: "SOPs",
  dailyReports: "Daily Reports",
  weeklyReports: "Weekly Reports",
} as const;

// ─── In-Memory Metrics ───────────────────────────────────────────────────────
interface ObsidianMetrics {
  notesCreatedToday: number;
  searchesPerformed: number;
  lastSyncAt: Date | null;
  lastResetDate: string;
  connected: boolean;
  lastConnectionCheck: Date | null;
}

let _metrics: ObsidianMetrics = {
  notesCreatedToday: 0,
  searchesPerformed: 0,
  lastSyncAt: null,
  lastResetDate: "",
  connected: false,
  lastConnectionCheck: null,
};

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function resetDailyIfNeeded() {
  const t = today();
  if (_metrics.lastResetDate !== t) {
    _metrics.notesCreatedToday = 0;
    _metrics.searchesPerformed = 0;
    _metrics.lastResetDate = t;
  }
}

// ─── Core HTTP ───────────────────────────────────────────────────────────────
async function obsidianRequest(
  path: string,
  method: "GET" | "PUT" | "POST" | "DELETE" = "GET",
  body?: string,
  contentType = "text/markdown",
): Promise<Response> {
  const { baseUrl, apiKey } = getConfig();
  if (!baseUrl || !apiKey) throw new Error("Obsidian not configured (missing OBSIDIAN_BASE_URL or OBSIDIAN_API_KEY)");

  // Node 18+ has native fetch; fall back gracefully
  const fetchFn = typeof fetch !== "undefined" ? fetch : undefined;
  if (!fetchFn) throw new Error("fetch not available in this runtime");

  return fetchFn(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": contentType,
    },
    body,
    // Allow self-signed certs via env flag in Node
    ...(process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? {} : {}),
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a new note (overwrites if exists).
 * @param folder  Vault folder (use OBSIDIAN_FOLDERS constants)
 * @param title   Note title without .md extension
 * @param content Markdown content
 */
export async function createNote(folder: string, title: string, content: string): Promise<boolean> {
  if (!isObsidianConfigured()) return false;
  try {
    const path = `/vault/${encodeURIComponent(folder)}/${encodeURIComponent(title)}.md`;
    const res = await obsidianRequest(path, "PUT", content);
    if (res.ok || res.status === 204) {
      resetDailyIfNeeded();
      _metrics.notesCreatedToday++;
      _metrics.lastSyncAt = new Date();
      _metrics.connected = true;
      return true;
    }
    console.warn(`[Obsidian] createNote failed: ${res.status} ${res.statusText}`);
    return false;
  } catch (e: any) {
    console.warn(`[Obsidian] createNote error: ${e.message}`);
    _metrics.connected = false;
    return false;
  }
}

/**
 * Update an existing note (alias for createNote with PUT — creates if missing).
 */
export async function updateNote(folder: string, title: string, content: string): Promise<boolean> {
  return createNote(folder, title, content);
}

/**
 * Append text to an existing note. Creates the note if it doesn't exist.
 */
export async function appendToNote(folder: string, title: string, content: string): Promise<boolean> {
  if (!isObsidianConfigured()) return false;
  try {
    const path = `/vault/${encodeURIComponent(folder)}/${encodeURIComponent(title)}.md`;
    const res = await obsidianRequest(path, "POST", content);
    if (res.ok || res.status === 204) {
      resetDailyIfNeeded();
      _metrics.notesCreatedToday++;
      _metrics.lastSyncAt = new Date();
      _metrics.connected = true;
      return true;
    }
    console.warn(`[Obsidian] appendToNote failed: ${res.status} ${res.statusText}`);
    return false;
  } catch (e: any) {
    console.warn(`[Obsidian] appendToNote error: ${e.message}`);
    _metrics.connected = false;
    return false;
  }
}

/**
 * Read a note. Returns null on any failure.
 */
export async function readNote(folder: string, title: string): Promise<string | null> {
  if (!isObsidianConfigured()) return null;
  try {
    const path = `/vault/${encodeURIComponent(folder)}/${encodeURIComponent(title)}.md`;
    const res = await obsidianRequest(path, "GET");
    if (!res.ok) return null;
    const text = await res.text();
    _metrics.connected = true;
    _metrics.lastSyncAt = new Date();
    return text;
  } catch (e: any) {
    console.warn(`[Obsidian] readNote error: ${e.message}`);
    _metrics.connected = false;
    return null;
  }
}

export interface ObsidianSearchResult {
  filename: string;
  score: number;
  matches: Array<{ match: { start: number; end: number }; context: string }>;
}

/**
 * Search the entire vault. Returns [] on any failure.
 */
export async function searchNotes(query: string): Promise<ObsidianSearchResult[]> {
  if (!isObsidianConfigured()) return [];
  try {
    const res = await obsidianRequest(
      `/search/simple/?query=${encodeURIComponent(query)}&contextLength=150`,
      "POST",
      undefined,
      "application/json",
    );
    if (!res.ok) return [];
    resetDailyIfNeeded();
    _metrics.searchesPerformed++;
    _metrics.connected = true;
    _metrics.lastSyncAt = new Date();
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e: any) {
    console.warn(`[Obsidian] searchNotes error: ${e.message}`);
    _metrics.connected = false;
    return [];
  }
}

/**
 * List all .md files in the vault root.
 */
export async function listVaultFiles(): Promise<string[]> {
  if (!isObsidianConfigured()) return [];
  try {
    const res = await obsidianRequest("/vault/", "GET");
    if (!res.ok) return [];
    const data = await res.json();
    const files: string[] = data.files || [];
    _metrics.connected = true;
    return files.filter((f: string) => f.endsWith(".md")).sort();
  } catch (e: any) {
    console.warn(`[Obsidian] listVaultFiles error: ${e.message}`);
    _metrics.connected = false;
    return [];
  }
}

/**
 * Test connectivity to Obsidian and return vault info.
 */
export async function checkConnection(): Promise<{ connected: boolean; vaultName?: string; version?: string }> {
  if (!isObsidianConfigured()) return { connected: false };
  try {
    const res = await obsidianRequest("/", "GET");
    if (!res.ok) { _metrics.connected = false; return { connected: false }; }
    const data = await res.json();
    _metrics.connected = true;
    _metrics.lastConnectionCheck = new Date();
    return { connected: true, vaultName: data.vaultName, version: data.versions?.obsidian };
  } catch {
    _metrics.connected = false;
    return { connected: false };
  }
}

export interface ObsidianStatus {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  notesCreatedToday: number;
  searchesPerformed: number;
  lastConnectionCheck: string | null;
}

export function getObsidianStatus(): ObsidianStatus {
  resetDailyIfNeeded();
  return {
    configured: isObsidianConfigured(),
    connected: _metrics.connected,
    lastSyncAt: _metrics.lastSyncAt?.toISOString() ?? null,
    notesCreatedToday: _metrics.notesCreatedToday,
    searchesPerformed: _metrics.searchesPerformed,
    lastConnectionCheck: _metrics.lastConnectionCheck?.toISOString() ?? null,
  };
}

// ─── Agent-Specific Writers ───────────────────────────────────────────────────

/**
 * Write a CEO Heartbeat report to Obsidian.
 * Called fire-and-forget after runHeartbeatCycle() completes.
 */
export async function writeHeartbeatReport(opts: {
  orgId: string;
  runId: string;
  priorities: Array<{ action?: string; title?: string; priorityScore?: number; priority?: string }>;
  agentsCoordinated: number;
  prioritiesGenerated: number;
  errors: string[];
  durationMs?: number;
}): Promise<void> {
  const { orgId, runId, priorities, agentsCoordinated, prioritiesGenerated, errors, durationMs } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const topList = priorities.slice(0, 5).map((p, i) =>
    `${i + 1}. **${p.title || p.action || "—"}** ${p.priority ? `[${p.priority}]` : ""} ${p.priorityScore != null ? `(score: ${p.priorityScore})` : ""}`.trim()
  ).join("\n");

  const errorSection = errors.length > 0
    ? `\n## Errors\n\n${errors.map(e => `- ${e}`).join("\n")}\n`
    : "";

  const content = `# CEO Heartbeat — ${dateStr} ${timeStr}

**Run ID:** ${runId}  
**Org:** ${orgId}  
**Timestamp:** ${new Date().toISOString()}  
**Duration:** ${durationMs != null ? `${durationMs}ms` : "—"}

---

## Summary

| Metric | Value |
|--------|-------|
| Agents Coordinated | ${agentsCoordinated} |
| Priorities Generated | ${prioritiesGenerated} |
| Errors | ${errors.length} |

## Top Priorities

${topList || "_No priorities generated_"}
${errorSection}
---
_Written automatically by CEO Heartbeat Agent_
`;

  await createNote(OBSIDIAN_FOLDERS.ceoHeartbeat, `${dateStr} Heartbeat`, content);
  // Also append to daily report
  await appendToNote(OBSIDIAN_FOLDERS.dailyReports, dateStr, `\n## ${timeStr} — CEO Heartbeat\n\n${topList || "_No priorities_"}\n`);
}

/**
 * Write an auto-execution decision to Obsidian.
 * Called fire-and-forget after the auto-execution engine fires.
 */
export async function writeAgentDecision(opts: {
  orgId: string;
  actionType: string;
  title: string;
  reasoning: string;
  confidence?: number;
  executedAt?: Date;
}): Promise<void> {
  const { orgId, actionType, title, reasoning, confidence, executedAt } = opts;
  const dateStr = today();
  const timeStr = (executedAt ?? new Date()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const entry = `\n## ${timeStr} — ${title}

**Action Type:** ${actionType}  
**Org:** ${orgId}  
**Confidence:** ${confidence != null ? `${confidence}%` : "—"}  
**Reasoning:** ${reasoning}

---
`;

  await appendToNote(OBSIDIAN_FOLDERS.agentDecisions, `${dateStr} Decisions`, entry);
}

/**
 * Write a software improvement finding to Obsidian.
 */
export async function writeSoftwareImprovement(opts: {
  title: string;
  finding: string;
  fix?: string;
  severity?: string;
}): Promise<void> {
  const { title, finding, fix, severity } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const entry = `\n## ${timeStr} — ${title}

**Severity:** ${severity || "—"}  
**Finding:** ${finding}  
${fix ? `**Fix Applied:** ${fix}` : ""}

---
`;

  await appendToNote(OBSIDIAN_FOLDERS.softwareImprovements, `${dateStr} Improvements`, entry);
}

/**
 * Write a Hermes learning/procedural knowledge note.
 */
export async function writeHermesLearning(opts: {
  topic: string;
  content: string;
  source?: string;
}): Promise<void> {
  const { topic, content, source } = opts;
  const dateStr = today();

  const entry = `\n## ${topic}\n\n${content}\n\n${source ? `_Source: ${source}_` : ""}\n\n---\n`;
  await appendToNote(OBSIDIAN_FOLDERS.hermesLearning, `${dateStr} Hermes Learning`, entry);
}
