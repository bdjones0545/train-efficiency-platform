import type { Express, RequestHandler } from "express";
import {
  checkConnection,
  createNote,
  appendToNote,
  readNote,
  searchNotes,
  listVaultFiles,
  getObsidianStatus,
  isObsidianConfigured,
  OBSIDIAN_FOLDERS,
  getVaultStats,
  findSimilarNotes,
  retrieveAgentContext,
  recordOutcomeLearning,
  writeDecisionJournal,
  updateDecisionOutcome,
  writeSoftwareKB,
  searchSoftwareKB,
} from "./services/obsidian-service";

export function registerObsidianRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  requireRole: (...roles: string[]) => RequestHandler,
) {

  // ─── GET /api/obsidian/status ─────────────────────────────────────────────
  app.get("/api/obsidian/status", async (_req: any, res) => {
    try {
      const status = getObsidianStatus();
      if (status.configured) {
        const conn = await checkConnection();
        res.json({
          ...status,
          connected: conn.connected,
          vaultName: conn.vaultName,
          version: conn.version,
          // Pass specific error message so the frontend can display why it failed
          connectionError: conn.connected ? undefined : conn.error,
        });
      } else {
        res.json(status);
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/stats ──────────────────────────────────────────────
  app.get("/api/obsidian/stats", async (_req: any, res) => {
    try {
      const stats = await getVaultStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/folders ────────────────────────────────────────────
  app.get("/api/obsidian/folders", async (_req: any, res) => {
    res.json({ folders: Object.values(OBSIDIAN_FOLDERS) });
  });

  // ─── POST /api/obsidian/search ────────────────────────────────────────────
  // Supports optional typeFilter and dateFilter in body
  app.post("/api/obsidian/search", async (req: any, res) => {
    const { query, typeFilter, agentFilter, limit } = req.body || {};
    if (!query) return res.status(400).json({ message: "query required" });
    try {
      let results = await searchNotes(query, { typeFilter, limit: limit ?? 50 });

      // Agent filter: match against filename or context
      if (agentFilter) {
        const af = agentFilter.toLowerCase();
        results = results.filter(r =>
          r.filename.toLowerCase().includes(af) ||
          r.matches?.some(m => m.context.toLowerCase().includes(af))
        );
      }

      // Enrich with folder / title metadata
      const enriched = results.map(r => {
        const parts = r.filename.split("/");
        const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Vault Root";
        const title = parts[parts.length - 1].replace(".md", "");
        return { ...r, folder, title };
      });

      res.json({ results: enriched, total: enriched.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/read ───────────────────────────────────────────────
  app.get("/api/obsidian/read", async (req: any, res) => {
    const { folder, title } = req.query as { folder: string; title: string };
    if (!folder || !title) return res.status(400).json({ message: "folder and title required" });
    try {
      const content = await readNote(folder, title);
      if (content === null) return res.status(404).json({ message: "Note not found" });
      res.json({ content });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/vault ──────────────────────────────────────────────
  app.get("/api/obsidian/vault", async (_req: any, res) => {
    try {
      const files = await listVaultFiles();
      res.json({ files });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/write ─────────────────────────────────────────────
  app.post("/api/obsidian/write", async (req: any, res) => {
    const { folder, title, content, mode, meta } = req.body || {};
    if (!folder || !title || !content) return res.status(400).json({ message: "folder, title, and content required" });
    try {
      const noteMeta = meta || { type: "manual" as const };
      const ok = mode === "append"
        ? await appendToNote(folder, title, content, noteMeta)
        : await createNote(folder, title, content, noteMeta);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/connect ────────────────────────────────────────────
  app.get("/api/obsidian/connect", async (_req: any, res) => {
    try {
      const result = await checkConnection();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/similar ───────────────────────────────────────────
  // Find notes similar to the provided content or filename
  app.post("/api/obsidian/similar", async (req: any, res) => {
    const { content, sourceFilename, limit } = req.body || {};
    if (!content) return res.status(400).json({ message: "content required" });
    try {
      const results = await findSimilarNotes(content, sourceFilename, limit ?? 8);
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/context ───────────────────────────────────────────
  // Retrieve agent context before execution
  app.post("/api/obsidian/context", async (req: any, res) => {
    const { query, orgId, limit } = req.body || {};
    if (!query) return res.status(400).json({ message: "query required" });
    try {
      const ctx = await retrieveAgentContext(query, { orgId, limit });
      res.json(ctx);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/learn ─────────────────────────────────────────────
  // Hermes Learning Engine: record an outcome → observation → learning
  // Requires authentication and COACH/ADMIN role — not publicly callable.
  app.post("/api/obsidian/learn", isAuthenticated, requireRole("COACH", "ADMIN"), async (req: any, res) => {
    const { outcome, observation, learning, domain, metric, metricValue, orgId, tags } = req.body || {};
    if (!outcome || !observation || !learning || !domain)
      return res.status(400).json({ message: "outcome, observation, learning, domain required" });
    try {
      const ok = await recordOutcomeLearning({ outcome, observation, learning, domain, metric, metricValue, orgId, tags });
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/decision ──────────────────────────────────────────
  // Write to Decision Journal
  app.post("/api/obsidian/decision", async (req: any, res) => {
    const { decision, reasoning, outcome, followUp, agent, orgId, confidence, tags } = req.body || {};
    if (!decision || !reasoning || !agent)
      return res.status(400).json({ message: "decision, reasoning, agent required" });
    try {
      const ok = await writeDecisionJournal({ decision, reasoning, outcome, followUp, agent, orgId, confidence, tags });
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── PATCH /api/obsidian/decision/outcome ─────────────────────────────────
  // Update decision outcome after follow-up
  app.patch("/api/obsidian/decision/outcome", async (req: any, res) => {
    const { decisionTitle, outcome, followUp, orgId } = req.body || {};
    if (!decisionTitle || !outcome) return res.status(400).json({ message: "decisionTitle and outcome required" });
    try {
      const ok = await updateDecisionOutcome({ decisionTitle, outcome, followUp, orgId });
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/software-kb ──────────────────────────────────────
  // Write to Software Knowledge Base
  app.post("/api/obsidian/software-kb", async (req: any, res) => {
    const { issue, rootCause, fix, filesModified, outcome, severity, tags, orgId } = req.body || {};
    if (!issue || !rootCause || !fix || !outcome)
      return res.status(400).json({ message: "issue, rootCause, fix, outcome required" });
    try {
      const ok = await writeSoftwareKB({ issue, rootCause, fix, filesModified, outcome, severity, tags, orgId });
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/software-kb/search ────────────────────────────────
  // Search Software KB before creating new improvement tasks
  app.get("/api/obsidian/software-kb/search", async (req: any, res) => {
    const { q, limit } = req.query as { q: string; limit: string };
    if (!q) return res.status(400).json({ message: "q required" });
    try {
      const results = await searchSoftwareKB(q, limit ? parseInt(limit, 10) : 5);
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
