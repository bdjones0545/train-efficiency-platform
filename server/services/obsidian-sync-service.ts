/**
 * Obsidian Sync Service — DB-first, Obsidian-optional
 *
 * All learning / memory writes go to Postgres FIRST.
 * Obsidian is a best-effort secondary mirror:
 *   - If online: sync succeeds → logged.
 *   - If offline: item queued in `obsidian_sync_queue` → retried by cron.
 *   - Retries run every 5 minutes until success or max attempts.
 *   - Idempotency keys prevent duplicate notes on retry.
 *
 * Logging contract (each state emits exactly one line):
 *   ✅ [ObsidianSync] DB write success — <context>
 *   ✅ [ObsidianSync] Obsidian sync success — <folder>/<title>
 *   ⏭️  [ObsidianSync] Obsidian skipped/offline — queued for retry: <idempotency_key>
 *   ✅ [ObsidianSync] Obsidian retry success — <idempotency_key>
 *   ❌ [ObsidianSync] Obsidian retry failed (attempt N) — <idempotency_key>: <error>
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Table bootstrap ──────────────────────────────────────────────────────────

let _tableReady = false;

async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS obsidian_sync_queue (
        id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        idempotency_key  TEXT        NOT NULL,
        note_action      TEXT        NOT NULL DEFAULT 'create',
        folder           TEXT        NOT NULL,
        title            TEXT        NOT NULL,
        content          TEXT        NOT NULL DEFAULT '',
        metadata_json    JSONB       DEFAULT '{}',
        status           TEXT        NOT NULL DEFAULT 'pending',
        attempts         INTEGER     NOT NULL DEFAULT 0,
        max_attempts     INTEGER     NOT NULL DEFAULT 10,
        last_attempt_at  TIMESTAMPTZ,
        synced_at        TIMESTAMPTZ,
        error_message    TEXT,
        context_label    TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_osq_idempotency ON obsidian_sync_queue (idempotency_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_osq_status ON obsidian_sync_queue (status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_osq_created ON obsidian_sync_queue (created_at DESC)
    `);
    _tableReady = true;
  } catch (e: any) {
    console.warn("[ObsidianSync] Table setup warning:", e?.message);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObsidianSyncItem {
  /** Unique key — retries reuse the same key; duplicates are ignored */
  idempotencyKey: string;
  /** "create" = PUT (overwrite/create); "append" = POST (add to existing) */
  noteAction: "create" | "append";
  folder: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  /** Human-readable label for log lines, e.g. "CEO Heartbeat report" */
  contextLabel?: string;
}

// ─── Queue item insertion (DB-side, always succeeds) ─────────────────────────

async function enqueue(item: ObsidianSyncItem): Promise<void> {
  await ensureTable();
  try {
    await db.execute(sql`
      INSERT INTO obsidian_sync_queue
        (idempotency_key, note_action, folder, title, content, metadata_json, context_label)
      VALUES
        (${item.idempotencyKey}, ${item.noteAction}, ${item.folder}, ${item.title},
         ${item.content}, ${JSON.stringify(item.metadata ?? {})}::jsonb,
         ${item.contextLabel ?? null})
      ON CONFLICT (idempotency_key) DO NOTHING
    `);
  } catch (e: any) {
    console.warn("[ObsidianSync] enqueue warning:", e?.message);
  }
}

// ─── Single sync attempt ──────────────────────────────────────────────────────

async function attemptObsidianWrite(item: ObsidianSyncItem): Promise<boolean> {
  try {
    const { isObsidianConfigured, createNote, appendToNote } = await import("./obsidian-service");
    if (!isObsidianConfigured()) return false;

    const meta = item.metadata as any;
    if (item.noteAction === "append") {
      return await appendToNote(item.folder, item.title, item.content, meta);
    } else {
      return await createNote(item.folder, item.title, item.content, meta);
    }
  } catch {
    return false;
  }
}

// ─── Primary entry point ──────────────────────────────────────────────────────

/**
 * Try to sync a note to Obsidian immediately.
 * Always logs "DB write success" first (caller is responsible for the DB write
 * having happened before calling this).
 * If Obsidian is offline or the write fails, the item is queued for retry.
 */
export async function trySyncNow(item: ObsidianSyncItem): Promise<void> {
  console.log(`✅ [ObsidianSync] DB write success — ${item.contextLabel ?? `${item.folder}/${item.title}`}`);

  const ok = await attemptObsidianWrite(item);

  if (ok) {
    console.log(`✅ [ObsidianSync] Obsidian sync success — ${item.folder}/${item.title}`);
    // Mark as synced in the queue if it was previously pending
    await ensureTable();
    await db.execute(sql`
      UPDATE obsidian_sync_queue
      SET status = 'synced', synced_at = NOW(), updated_at = NOW()
      WHERE idempotency_key = ${item.idempotencyKey}
    `).catch(() => {});
  } else {
    console.log(`⏭️  [ObsidianSync] Obsidian skipped/offline — queued for retry: ${item.idempotencyKey}`);
    await enqueue(item);
  }
}

/**
 * Queue an item without trying immediately.
 * Use this when the caller already knows Obsidian is likely offline.
 */
export async function queueObsidianSync(item: ObsidianSyncItem): Promise<void> {
  console.log(`✅ [ObsidianSync] DB write success — ${item.contextLabel ?? `${item.folder}/${item.title}`}`);
  console.log(`⏭️  [ObsidianSync] Obsidian sync deferred — queued: ${item.idempotencyKey}`);
  await enqueue(item);
}

// ─── Retry queue processor (called by cron) ───────────────────────────────────

const MAX_BATCH = 20;

export async function processObsidianSyncQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  await ensureTable();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const { isObsidianConfigured } = await import("./obsidian-service");
    if (!isObsidianConfigured()) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    // Fetch pending items that haven't exceeded max_attempts
    const result = await db.execute(sql`
      SELECT id, idempotency_key, note_action, folder, title, content,
             metadata_json, context_label, attempts, max_attempts
      FROM obsidian_sync_queue
      WHERE status = 'pending'
        AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT ${MAX_BATCH}
    `);
    const rows: any[] = Array.isArray(result) ? result : (result as any)?.rows ?? [];

    for (const row of rows) {
      processed++;
      const key = row.idempotency_key;
      const item: ObsidianSyncItem = {
        idempotencyKey: key,
        noteAction: row.note_action as "create" | "append",
        folder: row.folder,
        title: row.title,
        content: row.content,
        metadata: typeof row.metadata_json === "string"
          ? JSON.parse(row.metadata_json)
          : (row.metadata_json ?? {}),
        contextLabel: row.context_label ?? undefined,
      };

      const attempts = Number(row.attempts) + 1;
      const ok = await attemptObsidianWrite(item);

      if (ok) {
        succeeded++;
        console.log(`✅ [ObsidianSync] Obsidian retry success — ${key}`);
        await db.execute(sql`
          UPDATE obsidian_sync_queue
          SET status = 'synced', attempts = ${attempts},
              last_attempt_at = NOW(), synced_at = NOW(), updated_at = NOW()
          WHERE idempotency_key = ${key}
        `).catch(() => {});
      } else {
        failed++;
        const maxAttempts = Number(row.max_attempts);
        const newStatus = attempts >= maxAttempts ? "failed" : "pending";
        console.log(
          `❌ [ObsidianSync] Obsidian retry failed (attempt ${attempts}/${maxAttempts}) — ${key}` +
          (newStatus === "failed" ? " [EXHAUSTED — giving up]" : ""),
        );
        await db.execute(sql`
          UPDATE obsidian_sync_queue
          SET status = ${newStatus}, attempts = ${attempts},
              last_attempt_at = NOW(), error_message = 'Obsidian write returned false',
              updated_at = NOW()
          WHERE idempotency_key = ${key}
        `).catch(() => {});
      }
    }
  } catch (e: any) {
    console.warn("[ObsidianSync] processObsidianSyncQueue error:", e?.message);
  }

  return { processed, succeeded, failed };
}

// ─── Cron startup ─────────────────────────────────────────────────────────────

let _cronStarted = false;
const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startObsidianSyncCron(): void {
  if (_cronStarted) return;
  _cronStarted = true;

  // Run once after 30s on startup (give other services time to initialize)
  setTimeout(async () => {
    const r = await processObsidianSyncQueue();
    if (r.processed > 0) {
      console.log(`[ObsidianSync] Startup retry: ${r.processed} processed, ${r.succeeded} synced, ${r.failed} failed`);
    }
  }, 30_000);

  setInterval(async () => {
    const r = await processObsidianSyncQueue();
    if (r.processed > 0) {
      console.log(`[ObsidianSync] Cron retry: ${r.processed} processed, ${r.succeeded} synced, ${r.failed} failed`);
    }
  }, RETRY_INTERVAL_MS);

  console.log("[ObsidianSync] Retry cron started — interval: 5 min");
}

// ─── Queue admin helpers ──────────────────────────────────────────────────────

export async function getQueueStats(): Promise<{
  pending: number;
  synced: number;
  failed: number;
  total: number;
}> {
  await ensureTable();
  try {
    const result = await db.execute(sql`
      SELECT status, COUNT(*) AS cnt
      FROM obsidian_sync_queue
      GROUP BY status
    `);
    const rows: any[] = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.status] = Number(r.cnt);
    return {
      pending: stats["pending"] ?? 0,
      synced:  stats["synced"]  ?? 0,
      failed:  stats["failed"]  ?? 0,
      total:   Object.values(stats).reduce((a, b) => a + b, 0),
    };
  } catch {
    return { pending: 0, synced: 0, failed: 0, total: 0 };
  }
}

export async function getQueueItems(opts: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<any[]> {
  await ensureTable();
  const { status, limit = 50, offset = 0 } = opts;
  try {
    const result = await db.execute(sql`
      SELECT id, idempotency_key, note_action, folder, title, context_label,
             status, attempts, max_attempts, last_attempt_at, synced_at,
             error_message, created_at
      FROM obsidian_sync_queue
      WHERE 1=1
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return Array.isArray(result) ? result : (result as any)?.rows ?? [];
  } catch {
    return [];
  }
}

/** Reset failed items back to pending so the cron retries them */
export async function requeueFailed(): Promise<number> {
  await ensureTable();
  try {
    const result = await db.execute(sql`
      UPDATE obsidian_sync_queue
      SET status = 'pending', attempts = 0, error_message = NULL, updated_at = NOW()
      WHERE status = 'failed'
      RETURNING id
    `);
    const rows: any[] = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    return rows.length;
  } catch {
    return 0;
  }
}
