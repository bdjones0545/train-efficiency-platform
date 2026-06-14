/**
 * Obsidian Organizational Memory Service — Phase 2
 *
 * Obsidian acts as the human-readable institutional memory layer for the
 * AI workforce. TrainEfficiency DB remains the source of truth for all
 * operational data. Obsidian stores agent decisions, reports, learnings,
 * software fixes, and procedural knowledge in structured markdown + frontmatter.
 *
 * Phase 2 additions:
 *   - Memory Classification Layer (YAML frontmatter on every note)
 *   - Agent Context Retrieval (pre-execution vault search → context injection)
 *   - Hermes Learning Engine (Outcome → Observation → Learning → Obsidian)
 *   - Decision Journal (Decision / Reasoning / Outcome / Follow-up)
 *   - Software Improvement Knowledge Base (searchable before new tasks)
 *   - Vault Stats (per-type counts for dashboard)
 *   - Similarity Search (keyword-extracted related notes)
 *
 * Requires env vars:
 *   OBSIDIAN_BASE_URL  — e.g. https://your-ngrok-url.ngrok-free.app
 *   OBSIDIAN_API_KEY   — from Obsidian → Settings → Local REST API
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
  ceoHeartbeat:            "CEO Heartbeat",
  agentDecisions:          "Agent Decisions",
  softwareImprovements:    "Software Improvements",
  hermesLearning:          "Hermes Learning",
  revenueIntelligence:     "Revenue Intelligence",
  growthIntelligence:      "Growth Intelligence",
  schedulingIntelligence:  "Scheduling Intelligence",
  clientSuccess:           "Client Success",
  decisionJournal:         "Decision Journal",
  softwareKB:              "Software KB",
  sops:                    "SOPs",
  dailyReports:            "Daily Reports",
  weeklyReports:           "Weekly Reports",
  ceoReviews:              "CEO Reviews",
  playbooks:               "Playbooks",
} as const;

export type ObsidianNoteType =
  | "ceo_heartbeat"
  | "agent_decision"
  | "software_improvement"
  | "hermes_learning"
  | "revenue_intelligence"
  | "growth_intelligence"
  | "scheduling_intelligence"
  | "client_success"
  | "decision_journal"
  | "software_kb"
  | "sop"
  | "daily_report"
  | "weekly_report"
  | "ceo_review"
  | "playbook"
  | "manual";

export interface NoteMetadata {
  type: ObsidianNoteType;
  agent?: string;
  department?: string;
  organizationId?: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  tags?: string[];
  [key: string]: unknown;
}

// ─── In-Memory Metrics ───────────────────────────────────────────────────────
interface ObsidianMetrics {
  notesCreatedToday: number;
  searchesPerformed: number;
  lastSyncAt: Date | null;
  lastResetDate: string;
  connected: boolean;
  lastConnectionCheck: Date | null;
  totalNotesByType: Record<string, number>;
}

let _metrics: ObsidianMetrics = {
  notesCreatedToday: 0,
  searchesPerformed: 0,
  lastSyncAt: null,
  lastResetDate: "",
  connected: false,
  lastConnectionCheck: null,
  totalNotesByType: {},
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

// ─── Frontmatter Builder ─────────────────────────────────────────────────────
function buildFrontmatter(meta: NoteMetadata): string {
  const lines = ["---"];
  lines.push(`type: ${meta.type}`);
  if (meta.agent)          lines.push(`agent: ${meta.agent}`);
  if (meta.department)     lines.push(`department: ${meta.department}`);
  if (meta.organizationId) lines.push(`organizationId: ${meta.organizationId}`);
  if (meta.severity)       lines.push(`severity: ${meta.severity}`);
  lines.push(`date: ${today()}`);
  if (meta.tags?.length)   lines.push(`tags: [${meta.tags.join(", ")}]`);
  lines.push("---\n");
  return lines.join("\n");
}

// ─── Core HTTP ───────────────────────────────────────────────────────────────
async function obsidianRequest(
  path: string,
  method: "GET" | "PUT" | "POST" | "DELETE" = "GET",
  body?: string,
  contentType = "text/markdown",
): Promise<Response> {
  const { baseUrl, apiKey } = getConfig();
  if (!baseUrl || !apiKey) throw new Error("Obsidian not configured");

  const fetchFn = typeof fetch !== "undefined" ? fetch : undefined;
  if (!fetchFn) throw new Error("fetch not available in this runtime");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    // Bypass ngrok browser-warning interstitial for server-side (non-browser) requests.
    // Without this, ngrok free-tier returns an HTML page instead of forwarding the
    // request, making res.json() throw and falsely reporting "not connected".
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "TrainEfficiency-Agent/1.0",
  };
  // Only attach Content-Type when there is an actual body to send.
  // Sending Content-Type on GET requests can confuse some servers/proxies.
  if (body !== undefined) {
    headers["Content-Type"] = contentType;
  }

  return fetchFn(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body,
  });
}

// ─── Public API — Core ───────────────────────────────────────────────────────

/**
 * Create a new note (overwrites if exists). Automatically injects frontmatter.
 */
export async function createNote(
  folder: string,
  title: string,
  content: string,
  meta?: NoteMetadata,
): Promise<boolean> {
  if (!isObsidianConfigured()) return false;
  try {
    const fm = meta ? buildFrontmatter(meta) : "";
    const path = `/vault/${folder}/${title}.md`;
    const res = await obsidianRequest(path, "PUT", fm + content);
    if (res.ok || res.status === 204) {
      resetDailyIfNeeded();
      _metrics.notesCreatedToday++;
      _metrics.lastSyncAt = new Date();
      _metrics.connected = true;
      if (meta?.type) {
        _metrics.totalNotesByType[meta.type] = (_metrics.totalNotesByType[meta.type] || 0) + 1;
      }
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

export async function updateNote(folder: string, title: string, content: string, meta?: NoteMetadata): Promise<boolean> {
  return createNote(folder, title, content, meta);
}

/**
 * Append text to a note. Creates the note if it doesn't exist.
 * Frontmatter is only added when creating (PUT), not on append (POST).
 */
export async function appendToNote(
  folder: string,
  title: string,
  content: string,
  meta?: NoteMetadata,
): Promise<boolean> {
  if (!isObsidianConfigured()) return false;
  try {
    // Check if the note exists; if not, create it with frontmatter
    const existing = await readNote(folder, title);
    if (existing === null && meta) {
      return createNote(folder, title, content, meta);
    }

    const path = `/vault/${folder}/${title}.md`;
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

export async function readNote(folder: string, title: string): Promise<string | null> {
  if (!isObsidianConfigured()) return null;
  try {
    const path = `/vault/${folder}/${title}.md`;
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

export async function searchNotes(
  query: string,
  opts?: { typeFilter?: string; limit?: number },
): Promise<ObsidianSearchResult[]> {
  if (!isObsidianConfigured()) return [];
  try {
    const res = await obsidianRequest(
      `/search/simple/?query=${encodeURIComponent(query)}&contextLength=200`,
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
    let results: ObsidianSearchResult[] = Array.isArray(data) ? data : [];

    // Apply type filter if requested (matches against folder name in path)
    if (opts?.typeFilter) {
      const folderHint = opts.typeFilter.replace(/_/g, " ").toLowerCase();
      results = results.filter(r => r.filename.toLowerCase().includes(folderHint));
    }

    return results.slice(0, opts?.limit ?? 50);
  } catch (e: any) {
    console.warn(`[Obsidian] searchNotes error: ${e.message}`);
    _metrics.connected = false;
    return [];
  }
}

export async function listVaultFiles(): Promise<string[]> {
  if (!isObsidianConfigured()) return [];
  try {
    // List root — root contains both .md files and folder/ entries
    const rootRes = await obsidianRequest("/vault/", "GET");
    if (!rootRes.ok) return [];
    const rootData = await rootRes.json();
    const rootEntries: string[] = rootData.files || [];
    _metrics.connected = true;

    const allFiles: string[] = [];

    // Collect root-level .md files
    const rootMd = rootEntries.filter((f: string) => f.endsWith(".md"));
    allFiles.push(...rootMd);

    // Collect subfolders (entries ending with "/"), recurse one level
    const folders = rootEntries.filter((f: string) => f.endsWith("/"));
    await Promise.all(folders.map(async (folderEntry: string) => {
      const folderName = folderEntry.slice(0, -1); // strip trailing "/"
      try {
        // Use raw path (spaces unencoded — Obsidian REST API accepts spaces)
        const folderRes = await obsidianRequest(`/vault/${folderName}/`, "GET");
        if (!folderRes.ok) return;
        const folderData = await folderRes.json();
        const folderFiles: string[] = (folderData.files || []).filter((f: string) => f.endsWith(".md"));
        allFiles.push(...folderFiles.map((f: string) => `${folderName}/${f}`));
      } catch { /* skip inaccessible folders */ }
    }));

    return allFiles.sort();
  } catch (e: any) {
    console.warn(`[Obsidian] listVaultFiles error: ${e.message}`);
    _metrics.connected = false;
    return [];
  }
}

export async function checkConnection(): Promise<{
  connected: boolean;
  vaultName?: string;
  version?: string;
  error?: string;
}> {
  if (!isObsidianConfigured()) return { connected: false, error: "Not configured" };

  const { baseUrl } = getConfig();
  const normalizedBase = baseUrl.replace(/\/$/, "");

  function humanizeNetworkError(raw: string): string {
    if (raw.includes("ECONNREFUSED") || raw.includes("fetch failed") || raw.includes("ENOTFOUND"))
      return "Cannot reach Obsidian — verify OBSIDIAN_BASE_URL and that Obsidian is running";
    if (raw.includes("certificate") || raw.includes("SSL") || raw.includes("self-signed"))
      return "TLS/certificate error — check your OBSIDIAN_BASE_URL";
    if (raw.includes("timeout") || raw.includes("ETIMEDOUT"))
      return "Connection timed out — Obsidian may be sleeping or the URL is slow";
    return raw;
  }

  try {
    // ── Step 1: try GET / (Local REST API root info endpoint) ──────────────
    console.log(`[Obsidian] checkConnection → GET ${normalizedBase}/`);
    const rootRes = await obsidianRequest("/", "GET");
    _metrics.lastConnectionCheck = new Date();

    if (rootRes.status === 401 || rootRes.status === 403) {
      _metrics.connected = false;
      return { connected: false, error: "Authentication failed (GET /) — check OBSIDIAN_API_KEY" };
    }

    if (rootRes.status === 404) {
      // Root endpoint not present in this plugin version or base URL already includes a
      // path prefix — fall back to GET /vault/ which is always present.
      console.log(`[Obsidian] GET ${normalizedBase}/ returned 404 — falling back to GET ${normalizedBase}/vault/`);

      let vaultRes: Response;
      try {
        vaultRes = await obsidianRequest("/vault/", "GET");
      } catch (fallbackErr: any) {
        _metrics.connected = false;
        return { connected: false, error: humanizeNetworkError(fallbackErr?.message ?? "Network error on /vault/ fallback") };
      }

      _metrics.lastConnectionCheck = new Date();

      if (vaultRes.status === 401 || vaultRes.status === 403) {
        _metrics.connected = false;
        return { connected: false, error: "Authentication failed (GET /vault/) — check OBSIDIAN_API_KEY" };
      }
      if (!vaultRes.ok) {
        _metrics.connected = false;
        return {
          connected: false,
          error: `Vault listing endpoint GET /vault/ responded with ${vaultRes.status} ${vaultRes.statusText}`,
        };
      }

      // /vault/ is reachable — we're connected (no root info available)
      _metrics.connected = true;
      return { connected: true };
    }

    if (!rootRes.ok) {
      _metrics.connected = false;
      return {
        connected: false,
        error: `Root endpoint GET / responded with ${rootRes.status} ${rootRes.statusText}`,
      };
    }

    // ── Step 2: 200 OK on / — parse vault metadata (non-JSON 200 is still connected) ──
    let vaultName: string | undefined;
    let version: string | undefined;
    try {
      const data = await rootRes.json();
      vaultName = data.vaultName;
      version = data.versions?.obsidian ?? data.versions?.self;
    } catch { /* non-JSON 200 is still a live connection */ }

    _metrics.connected = true;
    return { connected: true, vaultName, version };

  } catch (e: any) {
    _metrics.connected = false;
    _metrics.lastConnectionCheck = new Date();
    return { connected: false, error: humanizeNetworkError(e?.message ?? "Network error") };
  }
}

// ─── Vault Stats ─────────────────────────────────────────────────────────────
export interface VaultStats {
  totalNotes: number;
  byFolder: Record<string, number>;
  byType: Record<string, number>;
}

export async function getVaultStats(): Promise<VaultStats> {
  const files = await listVaultFiles();
  const byFolder: Record<string, number> = {};

  for (const f of files) {
    const parts = f.split("/");
    const folder = parts.length > 1 ? parts[0] : "Root";
    byFolder[folder] = (byFolder[folder] || 0) + 1;
  }

  // Map folders → type names for display
  const byType: Record<string, number> = {
    ceo_heartbeat:           byFolder["CEO Heartbeat"] || 0,
    agent_decision:          byFolder["Agent Decisions"] || 0,
    software_improvement:    byFolder["Software Improvements"] || 0,
    hermes_learning:         byFolder["Hermes Learning"] || 0,
    decision_journal:        byFolder["Decision Journal"] || 0,
    software_kb:             byFolder["Software KB"] || 0,
    revenue_intelligence:    byFolder["Revenue Intelligence"] || 0,
    growth_intelligence:     byFolder["Growth Intelligence"] || 0,
    scheduling_intelligence: byFolder["Scheduling Intelligence"] || 0,
    client_success:          byFolder["Client Success"] || 0,
    sop:                     byFolder["SOPs"] || 0,
    daily_report:            byFolder["Daily Reports"] || 0,
    weekly_report:           byFolder["Weekly Reports"] || 0,
  };

  // Also blend in session-tracked write counts
  for (const [type, count] of Object.entries(_metrics.totalNotesByType)) {
    byType[type] = Math.max(byType[type] || 0, count);
  }

  return { totalNotes: files.length, byFolder, byType };
}

// ─── Similarity Search ───────────────────────────────────────────────────────
export interface SimilarNote {
  filename: string;
  score: number;
  context: string;
  folder: string;
  title: string;
}

/**
 * Find notes similar to the given content by extracting key terms and searching.
 * Returns up to `limit` deduplicated results excluding the source note.
 */
export async function findSimilarNotes(
  content: string,
  sourceFilename?: string,
  limit = 8,
): Promise<SimilarNote[]> {
  if (!isObsidianConfigured()) return [];

  // Extract key terms: strip frontmatter, markdown syntax, common stop words
  const stripped = content
    .replace(/^---[\s\S]*?---\n?/m, "")
    .replace(/[#*_`[\]()>|]/g, " ")
    .toLowerCase();

  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
    "has", "have", "had", "this", "that", "it", "its", "as", "not", "no",
    "we", "our", "their", "they", "will", "would", "could", "should",
    "agent", "org", "date", "type", "run", "id", "via",
  ]);

  const words = stripped.split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ""))
    .filter(w => w.length > 4 && !stopWords.has(w));

  // Frequency map → pick top 5 unique terms
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const topTerms = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  if (!topTerms.length) return [];

  // Run parallel searches for each term
  const queryStr = topTerms.join(" ");
  const results = await searchNotes(queryStr, { limit: 30 });

  const seen = new Set<string>();
  const similar: SimilarNote[] = [];

  for (const r of results) {
    if (r.filename === sourceFilename) continue;
    if (seen.has(r.filename)) continue;
    seen.add(r.filename);

    const parts = r.filename.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Vault Root";
    const title = parts[parts.length - 1].replace(".md", "");
    const context = r.matches?.[0]?.context || "";

    similar.push({ filename: r.filename, score: r.score, context, folder, title });
    if (similar.length >= limit) break;
  }

  return similar;
}

// ─── Agent Context Retrieval ─────────────────────────────────────────────────
export interface AgentContext {
  recentDecisions: ObsidianSearchResult[];
  relatedFixes: ObsidianSearchResult[];
  ceoRecommendations: ObsidianSearchResult[];
  hermesLearnings: ObsidianSearchResult[];
  contextString: string;
  retrieved: number;
}

/**
 * Retrieve institutional memory relevant to an agent's upcoming task.
 * Inject contextString into the agent's system prompt for stateful behavior.
 */
export async function retrieveAgentContext(
  query: string,
  opts?: { orgId?: string; limit?: number },
): Promise<AgentContext> {
  if (!isObsidianConfigured()) {
    return { recentDecisions: [], relatedFixes: [], ceoRecommendations: [], hermesLearnings: [], contextString: "", retrieved: 0 };
  }

  const lim = opts?.limit ?? 10;

  const [decisions, fixes, ceoRecs, learnings] = await Promise.all([
    searchNotes(query, { typeFilter: "agent_decision", limit: lim }),
    searchNotes(query, { typeFilter: "software_kb", limit: Math.ceil(lim / 2) }),
    searchNotes(query, { typeFilter: "ceo_heartbeat", limit: Math.ceil(lim / 2) }),
    searchNotes(query, { typeFilter: "hermes_learning", limit: lim }),
  ]);

  const retrieved = decisions.length + fixes.length + ceoRecs.length + learnings.length;

  const formatSection = (label: string, items: ObsidianSearchResult[]) => {
    if (!items.length) return "";
    const lines = items.slice(0, 5).map(r => {
      const title = r.filename.split("/").pop()?.replace(".md", "") || r.filename;
      const snippet = r.matches?.[0]?.context?.trim() || "";
      return `- **${title}**: ${snippet}`;
    }).join("\n");
    return `\n### ${label}\n${lines}`;
  };

  const contextString = retrieved === 0
    ? ""
    : `## Institutional Memory Context\n\nRelevant prior knowledge retrieved from organizational memory (${retrieved} items):\n` +
      formatSection("Prior Agent Decisions", decisions) +
      formatSection("Software Fix History", fixes) +
      formatSection("CEO Recommendations", ceoRecs) +
      formatSection("Hermes Learnings", learnings) +
      "\n\n---\nUse the above context to inform your response, avoid repeating known mistakes, and build on prior decisions.\n";

  return { recentDecisions: decisions, relatedFixes: fixes, ceoRecommendations: ceoRecs, hermesLearnings: learnings, contextString, retrieved };
}

// ─── Status ───────────────────────────────────────────────────────────────────
export interface ObsidianStatus {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  notesCreatedToday: number;
  searchesPerformed: number;
  lastConnectionCheck: string | null;
  vaultName?: string;
  version?: string;
  /** Specific reason why connected=false, only present when configured but not connected */
  connectionError?: string;
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

// ─── Agent Writers — Phase 1 (upgraded with frontmatter) ─────────────────────

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

  const meta: NoteMetadata = {
    type: "ceo_heartbeat",
    agent: "CEO Heartbeat Agent",
    department: "executive",
    organizationId: orgId,
    severity: errors.length > 0 ? "high" : "info",
    tags: ["heartbeat", "priorities", "executive"],
  };

  await createNote(OBSIDIAN_FOLDERS.ceoHeartbeat, `${dateStr} Heartbeat`, content, meta);
  await appendToNote(
    OBSIDIAN_FOLDERS.dailyReports,
    dateStr,
    `\n## ${timeStr} — CEO Heartbeat\n\n${topList || "_No priorities_"}\n`,
    { type: "daily_report", agent: "CEO Heartbeat Agent", organizationId: orgId, tags: ["daily", "heartbeat"] },
  );
}

export async function writeAgentDecision(opts: {
  orgId: string;
  actionType: string;
  title: string;
  reasoning: string;
  confidence?: number;
  executedAt?: Date;
  outcome?: string;
}): Promise<void> {
  const { orgId, actionType, title, reasoning, confidence, executedAt, outcome } = opts;
  const dateStr = today();
  const timeStr = (executedAt ?? new Date()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const entry = `\n## ${timeStr} — ${title}

**Action Type:** ${actionType}  
**Org:** ${orgId}  
**Confidence:** ${confidence != null ? `${confidence}%` : "—"}  
**Reasoning:** ${reasoning}  
${outcome ? `**Outcome:** ${outcome}` : ""}

---
`;

  const meta: NoteMetadata = {
    type: "agent_decision",
    agent: "Auto-Execution Engine",
    department: "operations",
    organizationId: orgId,
    severity: "info",
    tags: ["decision", actionType.toLowerCase().replace(/\s+/g, "_")],
  };

  await appendToNote(OBSIDIAN_FOLDERS.agentDecisions, `${dateStr} Decisions`, entry, meta);
}

export async function writeSoftwareImprovement(opts: {
  title: string;
  finding: string;
  fix?: string;
  severity?: string;
  orgId?: string;
}): Promise<void> {
  const { title, finding, fix, severity, orgId } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const entry = `\n## ${timeStr} — ${title}

**Severity:** ${severity || "—"}  
**Finding:** ${finding}  
${fix ? `**Fix Applied:** ${fix}` : ""}

---
`;

  const meta: NoteMetadata = {
    type: "software_improvement",
    agent: "Software Improvement Agent",
    department: "engineering",
    organizationId: orgId,
    severity: (severity as any) || "info",
    tags: ["software", "improvement", severity || "info"],
  };

  await appendToNote(OBSIDIAN_FOLDERS.softwareImprovements, `${dateStr} Improvements`, entry, meta);
}

export async function writeHermesLearning(opts: {
  topic: string;
  content: string;
  source?: string;
  orgId?: string;
  tags?: string[];
}): Promise<void> {
  const { topic, content, source, orgId, tags } = opts;
  const dateStr = today();

  const entry = `\n## ${topic}\n\n${content}\n\n${source ? `_Source: ${source}_` : ""}\n\n---\n`;

  const meta: NoteMetadata = {
    type: "hermes_learning",
    agent: "Hermes Learning Engine",
    department: "intelligence",
    organizationId: orgId,
    severity: "info",
    tags: ["learning", "hermes", ...(tags || [])],
  };

  await appendToNote(OBSIDIAN_FOLDERS.hermesLearning, `${dateStr} Hermes Learning`, entry, meta);
}

// ─── Agent Writers — Phase 2: New Pipelines ───────────────────────────────────

/**
 * Hermes Learning Engine: Outcome → Observation → Learning → Obsidian
 * Converts a raw outcome into a structured reusable learning.
 */
export async function recordOutcomeLearning(opts: {
  outcome: string;
  observation: string;
  learning: string;
  domain: string;
  metric?: string;
  metricValue?: string | number;
  orgId?: string;
  tags?: string[];
}): Promise<boolean> {
  const { outcome, observation, learning, domain, metric, metricValue, orgId, tags } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const content = `## ${timeStr} — ${domain}

**Outcome:** ${outcome}  
**Observation:** ${observation}  
**Learning:** ${learning}  
${metric ? `**Metric:** ${metric}: ${metricValue}` : ""}

---
`;

  const meta: NoteMetadata = {
    type: "hermes_learning",
    agent: "Hermes Learning Engine",
    department: "intelligence",
    organizationId: orgId,
    severity: "info",
    tags: ["learning", "outcome", domain.toLowerCase(), ...(tags || [])],
  };

  const title = `${dateStr} Hermes Learning`;
  return appendToNote(OBSIDIAN_FOLDERS.hermesLearning, title, "\n" + content, meta);
}

/**
 * Decision Journal: Full structured entry with Decision / Reasoning / Outcome / Follow-up.
 */
export async function writeDecisionJournal(opts: {
  decision: string;
  reasoning: string;
  outcome?: string;
  followUp?: string;
  agent: string;
  orgId?: string;
  confidence?: number;
  tags?: string[];
}): Promise<boolean> {
  const { decision, reasoning, outcome, followUp, agent, orgId, confidence, tags } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const title = `${dateStr} Decisions`;

  const entry = `
## ${timeStr} — ${decision.slice(0, 80)}${decision.length > 80 ? "…" : ""}

| Field | Value |
|-------|-------|
| **Agent** | ${agent} |
| **Org** | ${orgId || "—"} |
| **Confidence** | ${confidence != null ? `${confidence}%` : "—"} |
| **Date** | ${new Date().toISOString()} |

**Decision:** ${decision}

**Reasoning:** ${reasoning}

${outcome ? `**Outcome:** ${outcome}\n\n` : ""}${followUp ? `**Follow-Up:** ${followUp}\n\n` : ""}---
`;

  const meta: NoteMetadata = {
    type: "decision_journal",
    agent,
    department: "executive",
    organizationId: orgId,
    severity: "info",
    tags: ["decision", "journal", ...(tags || [])],
  };

  return appendToNote(OBSIDIAN_FOLDERS.decisionJournal, title, entry, meta);
}

/**
 * Update a decision journal entry with its outcome and follow-up result.
 */
export async function updateDecisionOutcome(opts: {
  decisionTitle: string;
  outcome: string;
  followUp?: string;
  orgId?: string;
}): Promise<boolean> {
  const { decisionTitle, outcome, followUp, orgId } = opts;
  const updateEntry = `\n> **Outcome Update (${new Date().toLocaleString()}):** ${outcome}${followUp ? `\n> **Follow-Up:** ${followUp}` : ""}\n`;
  return appendToNote(OBSIDIAN_FOLDERS.decisionJournal, decisionTitle, updateEntry);
}

/**
 * Software Knowledge Base: Write a structured issue/fix entry for future agent reference.
 * Agents should call searchSoftwareKB() before creating new improvement tasks.
 */
export async function writeSoftwareKB(opts: {
  issue: string;
  rootCause: string;
  fix: string;
  filesModified?: string[];
  outcome: string;
  severity?: "critical" | "high" | "medium" | "low";
  tags?: string[];
  orgId?: string;
}): Promise<boolean> {
  const { issue, rootCause, fix, filesModified, outcome, severity, tags, orgId } = opts;
  const dateStr = today();
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const title = `${dateStr} Software KB`;

  const filesSection = filesModified?.length
    ? `**Files Modified:**\n${filesModified.map(f => `- \`${f}\``).join("\n")}\n\n`
    : "";

  const entry = `
## ${timeStr} — ${issue.slice(0, 80)}${issue.length > 80 ? "…" : ""}

**Severity:** ${severity || "medium"}

**Issue:** ${issue}

**Root Cause:** ${rootCause}

**Fix:** ${fix}

${filesSection}**Outcome:** ${outcome}

---
`;

  const meta: NoteMetadata = {
    type: "software_kb",
    agent: "Software Improvement Agent",
    department: "engineering",
    organizationId: orgId,
    severity: severity || "medium",
    tags: ["software", "kb", "fix", ...(tags || [])],
  };

  return appendToNote(OBSIDIAN_FOLDERS.softwareKB, title, entry, meta);
}

/**
 * Search the Software KB before creating a new improvement task.
 * Returns relevant prior fixes sorted by relevance.
 */
export async function searchSoftwareKB(
  query: string,
  limit = 5,
): Promise<Array<{ filename: string; context: string; score: number }>> {
  const results = await searchNotes(query, { typeFilter: "software_kb", limit });
  return results.map(r => ({
    filename: r.filename,
    context: r.matches?.[0]?.context || "",
    score: r.score,
  }));
}

/**
 * CEO Daily Review: Writes what-worked / what-failed / what-repeat / what-stop
 * to the CEO Reviews folder for human-readable retrospectives.
 */
export async function writeCEOReview(opts: {
  whatWorked: string;
  whatFailed: string;
  whatRepeat: string;
  whatStop: string;
  outcomesAnalyzed: number;
  orgId?: string;
}): Promise<boolean> {
  const { whatWorked, whatFailed, whatRepeat, whatStop, outcomesAnalyzed, orgId } = opts;
  const dateStr = today();
  const title = `${dateStr} CEO Review`;

  const entry = `
## Daily Outcome Review — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

> Based on ${outcomesAnalyzed} agent decisions analyzed

### ✅ What Worked
${whatWorked}

### ❌ What Failed
${whatFailed}

### 🔁 What To Repeat
${whatRepeat}

### 🛑 What To Stop
${whatStop}

---
`;

  const meta: NoteMetadata = {
    type: "ceo_review",
    agent: "CEO Review Engine",
    department: "executive",
    organizationId: orgId,
    severity: "info",
    tags: ["ceo", "review", "outcomes", "daily"],
  };

  return appendToNote(OBSIDIAN_FOLDERS.ceoReviews, title, entry, meta);
}

/**
 * Organizational Playbook: Writes a promoted high-performing pattern as a
 * structured SOP to the Playbooks folder.
 */
export async function writePlaybook(opts: {
  title: string;
  description?: string;
  sourceLearning: string;
  patternType?: string;
  successRate: number;
  evidenceCount: number;
  triggerCondition?: string;
  actions?: string;
  expectedOutcome?: string;
  orgId?: string;
}): Promise<boolean> {
  const { title, description, sourceLearning, patternType, successRate, evidenceCount, triggerCondition, actions, expectedOutcome, orgId } = opts;
  const dateStr = today();
  const noteTitle = `${dateStr} ${title}`;

  const entry = `
## ${title}

> **Promoted:** ${new Date().toLocaleDateString()} | **Type:** ${patternType ?? "General"} | **Success Rate:** ${successRate}% | **Evidence:** ${evidenceCount} cases

### Description
${description ?? sourceLearning}

### Source Pattern
${sourceLearning}

### Trigger Condition
${triggerCondition ?? "Identified automatically from recurring high-success recommendations."}

### Actions
${actions ?? "Follow the pattern as described above."}

### Expected Outcome
${expectedOutcome ?? `Based on ${evidenceCount} historical cases with ${successRate}% average success score.`}

---
`;

  const meta: NoteMetadata = {
    type: "playbook",
    agent: "Playbook Generator",
    department: "operations",
    organizationId: orgId,
    severity: "info",
    tags: ["playbook", "sop", "promoted", patternType ?? "general"],
  };

  return appendToNote(OBSIDIAN_FOLDERS.playbooks, noteTitle, entry, meta);
}
