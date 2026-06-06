import type { Express } from "express";
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
} from "./services/obsidian-service";

export function registerObsidianRoutes(app: Express) {
  // ─── GET /api/obsidian/status ─────────────────────────────────────────────
  app.get("/api/obsidian/status", async (req: any, res) => {
    try {
      const status = getObsidianStatus();
      // Run a live connectivity check if configured
      if (status.configured) {
        const conn = await checkConnection();
        res.json({ ...status, connected: conn.connected, vaultName: conn.vaultName, version: conn.version });
      } else {
        res.json(status);
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/folders ────────────────────────────────────────────
  app.get("/api/obsidian/folders", async (req: any, res) => {
    res.json({ folders: Object.values(OBSIDIAN_FOLDERS) });
  });

  // ─── POST /api/obsidian/search ────────────────────────────────────────────
  app.post("/api/obsidian/search", async (req: any, res) => {
    const { query } = req.body || {};
    if (!query) return res.status(400).json({ message: "query required" });
    try {
      const results = await searchNotes(query);
      res.json({ results });
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
  app.get("/api/obsidian/vault", async (req: any, res) => {
    try {
      const files = await listVaultFiles();
      res.json({ files });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── POST /api/obsidian/write ─────────────────────────────────────────────
  app.post("/api/obsidian/write", async (req: any, res) => {
    const { folder, title, content, mode } = req.body || {};
    if (!folder || !title || !content) return res.status(400).json({ message: "folder, title, and content required" });
    try {
      const ok = mode === "append"
        ? await appendToNote(folder, title, content)
        : await createNote(folder, title, content);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── GET /api/obsidian/connect ────────────────────────────────────────────
  app.get("/api/obsidian/connect", async (req: any, res) => {
    try {
      const result = await checkConnection();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
