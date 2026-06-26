import type { Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getUncachableSendGridClient } from "./email";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";

// ─── GCS client (same credentials pattern as mediaStorage.ts) ───────────────
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function getBucketName(): string {
  const paths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
  const first = paths.split(",")[0]?.trim();
  if (!first) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set");
  return first.replace(/^\//, "").split("/")[0];
}

async function uploadReceiptToCloud(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<{ storedPath: string }> {
  const bucketName = getBucketName();
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${randomUUID()}${ext}`;
  const objectPath = `.private/receipts/${unique}`;

  const bucket = gcs.bucket(bucketName);
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
  });

  // Return internal path only — never expose this in API responses
  return { storedPath: objectPath };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
const BOOK_RECEIPT_UPLOAD_URL = APP_BASE_URL
  ? `${APP_BASE_URL.replace(/\/$/, "")}${BOOK_RECEIPT_UPLOAD_PATH}`
  : BOOK_RECEIPT_UPLOAD_PATH;

const AMAZON_BOOK_URL = "https://www.amazon.com/dp/B0H6CDZ85W";

// ─── MIME type allow-list (server-side validation, never trust client MIME) ──
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".pdf", ".heic"]);
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
  "image/heic",
  "image/heif",
]);

// Magic-byte signatures for server-side type verification
function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  // HEIC/HEIF: ftyp box (bytes 4-7 are 'ftyp')
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return "image/heic";
  }
  return null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

// ─── Multer: memory storage, 10 MB cap ──────────────────────────────────────
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type. Please upload a JPG, PNG, PDF, or HEIC file.`));
    }
  },
});

// ─── Email helpers ───────────────────────────────────────────────────────────

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

// ─── Event logging ───────────────────────────────────────────────────────────

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

// ─── Table setup ─────────────────────────────────────────────────────────────

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

  // ── Receipt submissions table ──────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS book_receipt_submissions (
      id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
      lead_id            VARCHAR REFERENCES book_funnel_leads(id) ON DELETE SET NULL,
      email              TEXT NOT NULL,
      receipt_file_url   TEXT NOT NULL,
      original_filename  TEXT NOT NULL,
      mime_type          TEXT NOT NULL,
      file_size          INTEGER NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending_review',
      uploaded_at        TIMESTAMP DEFAULT NOW(),
      created_at         TIMESTAMP DEFAULT NOW(),
      updated_at         TIMESTAMP DEFAULT NOW()
    )
  `);

  // TODO: Add reviewed_at, reviewed_by, reviewer_notes columns when admin approval is built
  // TODO: Add promo_code column when promo code delivery is built
  // TODO: Add ai_verification_result JSONB column when AI receipt verification is built
  // TODO: Add trainchat_activated_at when automatic TrainChat activation is built

  console.log("[BookFunnel] Tables ready");
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerBookFunnelRoutes(app: Express) {
  await ensureBookFunnelTables();

  // ── POST /api/book-funnel/leads ───────────────────────────────────────────
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

      let emailSent = false;
      let emailAlreadySent = false;

      if (bonusEmailSentAt) {
        emailAlreadySent = true;
        console.log(`[BookFunnel] Bonus email already sent to ${normalizedEmail}, skipping.`);
      } else {
        try {
          await sendBookBonusEmail(normalizedEmail, normalizedFirst);
          emailSent = true;
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

  // ── POST /api/book-funnel/events ──────────────────────────────────────────
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

  // ── POST /api/book-funnel/receipt ─────────────────────────────────────────
  // Accepts multipart/form-data: { email: string, receipt: File }
  app.post(
    "/api/book-funnel/receipt",
    (req, res, next) => {
      receiptUpload.single("receipt")(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Maximum size is 10 MB." });
        }
        if (err) {
          return res.status(400).json({ error: err.message ?? "File upload error." });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        // ── 1. Validate email ──────────────────────────────────────────────
        const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        if (!rawEmail) {
          return res.status(400).json({ error: "Email address is required." });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
          return res.status(400).json({ error: "Please enter a valid email address." });
        }

        // ── 2. Validate file present ───────────────────────────────────────
        if (!req.file) {
          return res.status(400).json({ error: "Please select a file to upload." });
        }

        const { buffer, originalname, mimetype, size } = req.file;
        const ext = path.extname(originalname).toLowerCase();

        // ── 3. Server-side extension check ────────────────────────────────
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return res.status(400).json({ error: "Unsupported file type. Please upload a JPG, PNG, PDF, or HEIC file." });
        }

        // ── 4. Magic-byte verification (never trust client MIME) ───────────
        const detectedMime = detectMimeFromBuffer(buffer);
        // Allow if: detected type is in allow-list, OR file is HEIC/HEIF (magic byte is ftyp box),
        // OR if detection inconclusive but extension and reported mime both pass.
        const mimeOk =
          (detectedMime !== null && ALLOWED_MIMES.has(detectedMime)) ||
          (detectedMime === null && ALLOWED_MIMES.has(mimetype) && ALLOWED_EXTENSIONS.has(ext));

        if (!mimeOk) {
          return res.status(400).json({ error: "File content does not match a supported type (JPG, PNG, PDF, HEIC)." });
        }

        const resolvedMime = detectedMime ?? mimetype;

        // ── 5. File size (already enforced by multer, but double-check) ───
        if (size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: "File is too large. Maximum size is 10 MB." });
        }

        // ── 6. Sanitize filename ──────────────────────────────────────────
        const safeFilename = sanitizeFilename(originalname);

        // ── 7. Check for existing pending submission (duplicate guard) ────
        const existingSubmission = row0(await db.execute(sql`
          SELECT id FROM book_receipt_submissions
          WHERE email = ${rawEmail} AND status = 'pending_review'
          LIMIT 1
        `));

        if (existingSubmission?.id) {
          return res.status(409).json({
            error: "A receipt from this email is already pending review. We'll be in touch soon!",
          });
        }

        // ── 8. Look up existing lead by email ────────────────────────────
        const lead = row0(await db.execute(sql`
          SELECT id FROM book_funnel_leads WHERE email = ${rawEmail}
        `));
        const leadId: string | null = lead?.id ?? null;

        // ── 9. Upload file to private cloud storage ───────────────────────
        let storedPath: string;
        try {
          const upload = await uploadReceiptToCloud(buffer, safeFilename, resolvedMime);
          storedPath = upload.storedPath;
        } catch (uploadErr: any) {
          console.error("[BookFunnel] Receipt upload to storage failed:", uploadErr?.message);
          await logFunnelEvent(leadId, rawEmail, "book_receipt_upload_failed", {
            error: uploadErr?.message ?? "storage_error",
            filename: safeFilename,
          });
          return res.status(500).json({ error: "Failed to store your receipt. Please try again." });
        }

        // ── 10. Create submission record ──────────────────────────────────
        const submission = row0(await db.execute(sql`
          INSERT INTO book_receipt_submissions
            (lead_id, email, receipt_file_url, original_filename, mime_type, file_size, status)
          VALUES (
            ${leadId},
            ${rawEmail},
            ${storedPath},
            ${safeFilename},
            ${resolvedMime},
            ${size},
            'pending_review'
          )
          RETURNING id
        `));

        // ── 11. Log event ─────────────────────────────────────────────────
        await logFunnelEvent(leadId, rawEmail, "book_receipt_uploaded", {
          submissionId: submission?.id ?? null,
          filename: safeFilename,
          mimeType: resolvedMime,
          fileSizeBytes: size,
          hasExistingLead: !!leadId,
          // TODO: trigger manual admin review notification here
          // TODO: trigger AI receipt verification here
        });

        console.log(`[BookFunnel] Receipt submitted for ${rawEmail}, submission ${submission?.id}`);

        return res.json({
          success: true,
          submissionId: submission?.id ?? null,
          status: "pending_review",
          message: "Your receipt has been received and is pending verification.",
        });
      } catch (err: any) {
        console.error("[BookFunnel] POST /receipt error:", err);
        return res.status(500).json({ error: "An unexpected error occurred. Please try again." });
      }
    },
  );

  console.log("[BookFunnel] Routes registered");
}
