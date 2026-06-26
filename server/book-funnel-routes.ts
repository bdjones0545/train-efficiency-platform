import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getUncachableSendGridClient } from "./email";

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}
function row0(result: unknown): any {
  return rows(result)[0] ?? null;
}

const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  null;

const BOOK_RECEIPT_UPLOAD_PATH = "/book/redeem";
// TODO: swap to a verified absolute domain when APP_BASE_URL / PUBLIC_APP_URL env var is set
const BOOK_RECEIPT_UPLOAD_URL = APP_BASE_URL
  ? `${APP_BASE_URL.replace(/\/$/, "")}${BOOK_RECEIPT_UPLOAD_PATH}`
  : BOOK_RECEIPT_UPLOAD_PATH;

const AMAZON_BOOK_URL = "https://www.amazon.com/dp/B0H6CDZ85W";

function esc(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBonusEmailHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Your TrainChat Bonus Is Waiting</title>
  <style>
    body { margin:0; padding:0; background:#0e0e0e; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; color:#e5e2e1; }
    .wrapper { max-width:600px; margin:0 auto; padding:40px 24px; }
    .logo { font-size:20px; font-weight:800; color:#ffd274; letter-spacing:-0.02em; margin-bottom:40px; }
    .card { background:#1c1b1b; border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:40px 36px; }
    h1 { font-size:28px; font-weight:800; color:#e5e2e1; margin:0 0 12px; line-height:1.2; letter-spacing:-0.02em; }
    .subtitle { font-size:16px; color:#d3c5ae; margin:0 0 32px; line-height:1.6; }
    .steps { margin:0 0 32px; padding:0; list-style:none; }
    .steps li { display:flex; align-items:flex-start; gap:14px; padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.06); }
    .steps li:last-child { border-bottom:none; }
    .step-num { min-width:28px; height:28px; border-radius:50%; background:#ffd274; color:#402d00; font-size:13px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:2px; }
    .step-text { font-size:15px; color:#d3c5ae; line-height:1.5; }
    .step-text strong { color:#e5e2e1; }
    .cta-wrap { text-align:center; margin:32px 0; }
    .cta { display:inline-block; background:#ffd274; color:#402d00; font-size:15px; font-weight:800; text-decoration:none; padding:16px 36px; border-radius:9999px; letter-spacing:0.04em; text-transform:uppercase; }
    .footer-note { font-size:13px; color:#9c8f7a; line-height:1.6; margin-top:32px; padding-top:24px; border-top:1px solid rgba(255,255,255,0.06); }
    .footer { margin-top:40px; font-size:12px; color:#4f4634; text-align:center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="logo">TrainEfficiency</div>
    <div class="card">
      <h1>Your TrainChat Bonus Is Waiting</h1>
      <p class="subtitle">
        Hi ${esc(firstName)}, thanks for claiming your TrainChat bonus with
        <em>The Structure of Training for Strength and Speed for Youth Athletes</em>.
      </p>

      <ul class="steps">
        <li>
          <div class="step-num">1</div>
          <div class="step-text">
            <strong>Complete your book purchase on Amazon.</strong><br/>
            <a href="${esc(AMAZON_BOOK_URL)}" style="color:#ffd274;">${esc(AMAZON_BOOK_URL)}</a>
          </div>
        </li>
        <li>
          <div class="step-num">2</div>
          <div class="step-text">
            <strong>Save or screenshot your Amazon receipt.</strong><br/>
            Keep a copy of your order confirmation email or receipt page.
          </div>
        </li>
        <li>
          <div class="step-num">3</div>
          <div class="step-text">
            <strong>Upload your receipt to redeem your free month of TrainChat.</strong><br/>
            Once verified, your access is activated automatically.
          </div>
        </li>
      </ul>

      <div class="cta-wrap">
        <a href="${esc(BOOK_RECEIPT_UPLOAD_URL)}" class="cta">Upload Receipt</a>
      </div>

      <p class="footer-note">
        If you haven't purchased the book yet, complete your purchase on Amazon first,
        then return to this email to upload your receipt.
      </p>
    </div>
    <div class="footer">
      © 2024 TrainEfficiency. Evidence-Based Performance.<br/>
      Bryan Jones, MS, CSCS, PES, EP-C
    </div>
  </div>
</body>
</html>`;
}

function buildBonusEmailText(firstName: string): string {
  return `Your TrainChat Bonus Is Waiting

Hi ${firstName}, thanks for claiming your TrainChat bonus with The Structure of Training for Strength and Speed for Youth Athletes.

Next steps:

1. Complete your book purchase on Amazon.
   ${AMAZON_BOOK_URL}

2. Save or screenshot your Amazon receipt.
   Keep a copy of your order confirmation email or receipt page.

3. Upload your receipt to redeem your free month of TrainChat.
   ${BOOK_RECEIPT_UPLOAD_URL}

Once verified, your TrainChat access is activated automatically.

---
If you haven't purchased the book yet, complete your purchase on Amazon first, then return to this email to upload your receipt.

© 2024 TrainEfficiency. Evidence-Based Performance.
Bryan Jones, MS, CSCS, PES, EP-C`;
}

async function sendBookBonusEmail(
  toEmail: string,
  firstName: string,
): Promise<void> {
  const { client, fromEmail } = await getUncachableSendGridClient();
  await client.send({
    to: toEmail,
    from: { email: fromEmail, name: "TrainEfficiency" },
    subject: "Your TrainChat Bonus Is Waiting",
    html: buildBonusEmailHtml(firstName),
    text: buildBonusEmailText(firstName),
  });
}

async function logFunnelEvent(
  leadId: string | null,
  email: string | null,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO book_funnel_events (lead_id, email, event_type, metadata)
      VALUES (
        ${leadId},
        ${email},
        ${eventType},
        ${JSON.stringify(metadata)}::jsonb
      )
    `);
  } catch (err) {
    console.error("[BookFunnel] Failed to log event:", eventType, err);
  }
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

  // Safe migration: add bonus_email_sent_at if not present
  await db.execute(sql`
    ALTER TABLE book_funnel_leads
    ADD COLUMN IF NOT EXISTS bonus_email_sent_at TIMESTAMP
  `);

  console.log("[BookFunnel] Tables ready");
}

export async function registerBookFunnelRoutes(app: Express) {
  await ensureBookFunnelTables();

  // POST /api/book-funnel/leads
  // Create or update a book funnel lead by email (upsert), then send bonus email once.
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

      const normalizedFirst  = firstName.trim();
      const normalizedLast   = typeof lastName === "string" ? lastName.trim() : null;
      const normalizedSource = typeof source === "string" ? source.trim() : "book_landing";

      // Upsert: if email exists, update. Otherwise insert.
      const existing = row0(await db.execute(sql`
        SELECT id, bonus_email_sent_at FROM book_funnel_leads WHERE email = ${normalizedEmail}
      `));

      let leadId: string;
      let bonusEmailSentAt: Date | null = null;

      if (existing?.id) {
        leadId = existing.id;
        bonusEmailSentAt = existing.bonus_email_sent_at ?? null;
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

      // ── Bonus email (send once per lead) ──────────────────────────────────
      let emailSent = false;
      let emailAlreadySent = false;

      if (bonusEmailSentAt) {
        emailAlreadySent = true;
        console.log(`[BookFunnel] Bonus email already sent to ${normalizedEmail}, skipping.`);
      } else {
        try {
          await sendBookBonusEmail(normalizedEmail, normalizedFirst);
          emailSent = true;

          // Mark column so we never resend
          await db.execute(sql`
            UPDATE book_funnel_leads
            SET bonus_email_sent_at = NOW()
            WHERE id = ${leadId}
          `);

          await logFunnelEvent(leadId, normalizedEmail, "book_bonus_email_sent", {
            provider: "sendgrid",
            subject: "Your TrainChat Bonus Is Waiting",
          });

          console.log(`[BookFunnel] Bonus email sent to ${normalizedEmail}`);
        } catch (emailErr: any) {
          console.error("[BookFunnel] Failed to send bonus email:", emailErr?.message ?? emailErr);

          await logFunnelEvent(leadId, normalizedEmail, "book_bonus_email_failed", {
            provider: "sendgrid",
            error: emailErr?.message ?? "unknown",
          });
        }
      }

      return res.json({ success: true, leadId, email: normalizedEmail, emailSent, emailAlreadySent });
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

      const normalizedEmail  = typeof email === "string" ? email.trim().toLowerCase() : null;
      const normalizedLeadId = typeof leadId === "string" && leadId.trim() ? leadId.trim() : null;
      const safeMetadata     = metadata && typeof metadata === "object" ? metadata : {};

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
