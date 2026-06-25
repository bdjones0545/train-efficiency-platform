import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

async function ensureBookFunnelTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS book_funnel_leads (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
      first_name  TEXT NOT NULL,
      last_name   TEXT,
      email       TEXT NOT NULL UNIQUE,
      source      TEXT DEFAULT 'book_landing',
      amazon_clicked_at TIMESTAMP,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS book_funnel_events (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
      lead_id     VARCHAR REFERENCES book_funnel_leads(id) ON DELETE SET NULL,
      email       TEXT,
      event_type  TEXT NOT NULL,
      metadata    JSONB DEFAULT '{}'::jsonb,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("[BookFunnel] Tables ready");
}

export async function registerBookFunnelRoutes(app: Express) {
  await ensureBookFunnelTables();

  // POST /api/book-funnel/leads
  // Create or update a book funnel lead by email (upsert).
  app.post("/api/book-funnel/leads", async (req, res) => {
    try {
      const { firstName, lastName, email, source, amazonClicked } = req.body ?? {};

      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

      if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
        return res.status(400).json({ error: "firstName is required" });
      }
      if (!normalizedEmail) {
        return res.status(400).json({ error: "email is required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: "email is invalid" });
      }

      const normalizedFirst = firstName.trim();
      const normalizedLast  = typeof lastName === "string" ? lastName.trim() : null;
      const normalizedSource = typeof source === "string" ? source.trim() : "book_landing";

      // Upsert: if email exists, update. Otherwise insert.
      const existing = row0(await db.execute(sql`
        SELECT id FROM book_funnel_leads WHERE email = ${normalizedEmail}
      `));

      let leadId: string;

      if (existing?.id) {
        leadId = existing.id;
        await db.execute(sql`
          UPDATE book_funnel_leads
          SET
            first_name        = ${normalizedFirst},
            last_name         = ${normalizedLast},
            source            = ${normalizedSource},
            amazon_clicked_at = CASE WHEN ${!!amazonClicked} THEN NOW() ELSE amazon_clicked_at END,
            updated_at        = NOW()
          WHERE id = ${leadId}
        `);
      } else {
        const inserted = row0(await db.execute(sql`
          INSERT INTO book_funnel_leads
            (first_name, last_name, email, source, amazon_clicked_at)
          VALUES (
            ${normalizedFirst},
            ${normalizedLast},
            ${normalizedEmail},
            ${normalizedSource},
            ${amazonClicked ? sql`NOW()` : sql`NULL`}
          )
          RETURNING id
        `));
        leadId = inserted?.id;
      }

      return res.json({ success: true, leadId, email: normalizedEmail });
    } catch (err: any) {
      console.error("[BookFunnel] POST /leads error:", err);
      return res.status(500).json({ error: "Failed to save lead. Please try again." });
    }
  });

  // POST /api/book-funnel/events
  // Log a funnel event. leadId and email are optional.
  app.post("/api/book-funnel/events", async (req, res) => {
    try {
      const { leadId, email, eventType, metadata } = req.body ?? {};

      if (!eventType || typeof eventType !== "string" || !eventType.trim()) {
        return res.status(400).json({ error: "eventType is required" });
      }

      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;
      const normalizedLeadId = typeof leadId === "string" && leadId.trim() ? leadId.trim() : null;
      const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};

      await db.execute(sql`
        INSERT INTO book_funnel_events (lead_id, email, event_type, metadata)
        VALUES (
          ${normalizedLeadId},
          ${normalizedEmail},
          ${eventType.trim()},
          ${JSON.stringify(safeMetadata)}::jsonb
        )
      `);

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[BookFunnel] POST /events error:", err);
      return res.status(500).json({ error: "Failed to log event." });
    }
  });

  console.log("[BookFunnel] Routes registered");
}
