/**
 * Regression tests: Book Funnel Receipt Upload Flow
 *
 * Coverage:
 *  1.  Successful upload invariants (source code)
 *  2.  Validation failures — email, file, type, size
 *  3.  Duplicate upload detection (email-based, not code-based)
 *  4.  Storage failure handling
 *  5.  Confirmation email sent on upload (separate from lead email)
 *  6.  Email failure is non-fatal
 *  7.  Activation code always equals TRAINCHAT
 *  8.  Attribution fields (UTM, fbp, fbc) stored on submission
 *  9.  Response status is pending_review (not "redeemed")
 * 10.  Rate limiter exists for the receipt endpoint
 * 11.  Filename sanitization prevents path traversal
 * 12.  Magic-byte MIME verification present
 * 13.  Logging: upload received, validation, storage, DB write, email, response time
 * 14.  No sensitive user data logged
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXPECTED_CODE = "TRAINCHAT";

async function readRoutes(): Promise<string> {
  return readFile("server/book-funnel-routes.ts", "utf8");
}

async function readFrontend(): Promise<string> {
  return readFile("client/src/pages/book-redeem.tsx", "utf8");
}

async function readSuccessPage(): Promise<string> {
  return readFile("client/src/pages/book-redeem-success.tsx", "utf8");
}

// ─── 1. Successful upload invariants ─────────────────────────────────────────

describe("Successful upload invariants", () => {
  it("STATIC_PROMO_CODE constant equals TRAINCHAT", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`const STATIC_PROMO_CODE = "${EXPECTED_CODE}"`),
      `STATIC_PROMO_CODE must equal "${EXPECTED_CODE}"`,
    );
  });

  it("receipt handler assigns STATIC_PROMO_CODE, not a generated code", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("const promoCode: string = STATIC_PROMO_CODE"),
      "Receipt handler must assign STATIC_PROMO_CODE directly",
    );
    assert.ok(
      !src.includes("generatePromoCode"),
      "generatePromoCode must not exist — no per-user code generation",
    );
  });

  it("response status is pending_review, not redeemed", async () => {
    const src = await readRoutes();
    // Find the POST /receipt response object
    const receiptSection = src.slice(src.lastIndexOf("POST /api/book-funnel/receipt"));
    assert.ok(
      receiptSection.includes(`status: "pending_review"`),
      'POST /receipt response must return status: "pending_review"',
    );
    assert.ok(
      !receiptSection.includes(`status: "redeemed"`),
      'POST /receipt response must not return status: "redeemed" (misleading — DB is pending_review)',
    );
  });

  it("GET /receipt/:id always returns STATIC_PROMO_CODE, not raw DB value", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("promoCode: STATIC_PROMO_CODE"),
      "GET receipt endpoint must return STATIC_PROMO_CODE",
    );
    assert.ok(
      !src.includes("promoCode: row.promo_code"),
      "GET receipt endpoint must not return raw DB promo_code value",
    );
  });

  it("submission INSERT includes lead_id and email for attribution", async () => {
    const src = await readRoutes();
    assert.ok(src.includes("INSERT INTO book_receipt_submissions"), "Must insert into book_receipt_submissions");
    const insertBlock = src.slice(src.indexOf("INSERT INTO book_receipt_submissions"));
    assert.ok(
      insertBlock.includes("lead_id") && insertBlock.includes("email"),
      "INSERT must include lead_id and email",
    );
  });

  it("response includes submissionId for the success page", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("submissionId: submission?.id"),
      "Response must include submissionId",
    );
  });

  it("response message confirms email delivery", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("activation code has been emailed to you"),
      "Response message must confirm that activation code was emailed",
    );
  });
});

// ─── 2. Validation failures ───────────────────────────────────────────────────

describe("Validation failures return 4xx", () => {
  it("missing email returns 400", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`return res.status(400).json({ error: "Email address is required." })`),
      "Missing email must return 400",
    );
  });

  it("invalid email format returns 400", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`return res.status(400).json({ error: "Please enter a valid email address." })`),
      "Invalid email must return 400",
    );
  });

  it("missing file returns 400", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`return res.status(400).json({ error: "Please select a file to upload." })`),
      "Missing file must return 400",
    );
  });

  it("unsupported extension returns 400", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`return res.status(400).json({ error: "Unsupported file type. Please upload a JPG, PNG, PDF, or HEIC file." })`),
      "Bad extension must return 400",
    );
  });

  it("MIME type magic-byte mismatch returns 400", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("File content does not match a supported type"),
      "Magic-byte mismatch must return 400",
    );
  });

  it("oversized file returns 400 via multer", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`return res.status(400).json({ error: "File is too large. Maximum size is 10 MB." })`),
      "Oversized file must return 400",
    );
  });

  it("multer file size limit is set to 10 MB", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("10 * 1024 * 1024"),
      "Multer must enforce 10 MB limit",
    );
  });
});

// ─── 3. Duplicate upload detection ───────────────────────────────────────────

describe("Duplicate upload detection", () => {
  it("duplicate guard queries by email, not by promo_code", async () => {
    const src = await readRoutes();
    assert.ok(
      /WHERE email = .+ AND status = 'pending_review'/.test(src),
      "Duplicate guard must query by email",
    );
    assert.ok(
      !/WHERE promo_code = .+LIMIT/.test(src),
      "Duplicate guard must NOT rely on promo_code uniqueness",
    );
  });

  it("duplicate receipt returns 409 conflict", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("return res.status(409).json({"),
      "Duplicate receipt must return 409",
    );
    assert.ok(
      src.includes("already pending review"),
      "409 message must indicate pending review status",
    );
  });

  it("promo_code column is not declared UNIQUE", async () => {
    const src = await readRoutes();
    assert.ok(
      !src.includes("ADD COLUMN IF NOT EXISTS promo_code TEXT UNIQUE"),
      "promo_code must not be UNIQUE — all leads share the same code",
    );
  });

  it("migration drops old unique constraint if it existed", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("DROP CONSTRAINT IF EXISTS book_receipt_submissions_promo_code_key"),
      "Must drop old unique constraint for migration safety",
    );
  });
});

// ─── 4. Storage failure handling ─────────────────────────────────────────────

describe("Storage failure handling", () => {
  it("storage failure returns 500 without crashing", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("return res.status(500).json({ error: \"Failed to store your receipt. Please try again.\" })"),
      "Storage failure must return 500",
    );
  });

  it("storage failure is logged before responding", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`console.error("[BookFunnel] Receipt upload to storage failed:`),
      "Storage failure must be logged with console.error before the 500 response",
    );
  });

  it("storage failure logs a funnel event", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`"book_receipt_upload_failed"`),
      "Storage failure must log a book_receipt_upload_failed event",
    );
  });

  it("UUID-based filename prevents overwriting another user's receipt", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("randomUUID"),
      "Must use randomUUID() to ensure unique storage paths",
    );
    assert.ok(
      src.includes(".private/receipts/"),
      "Receipts must be stored in private directory",
    );
  });
});

// ─── 5. Confirmation email sent on upload ─────────────────────────────────────

describe("Receipt confirmation email", () => {
  it("sendReceiptConfirmationEmail function exists", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("async function sendReceiptConfirmationEmail("),
      "sendReceiptConfirmationEmail must exist as a separate function from the lead bonus email",
    );
  });

  it("confirmation email is called within the receipt upload handler", async () => {
    const src = await readRoutes();
    // Must be called inside the POST /receipt handler, after successful DB insert
    const afterInsert = src.slice(src.lastIndexOf("INSERT INTO book_receipt_submissions"));
    assert.ok(
      afterInsert.includes("sendReceiptConfirmationEmail("),
      "sendReceiptConfirmationEmail must be called after successful DB insert",
    );
  });

  it("confirmation email HTML contains the TRAINCHAT code", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("buildReceiptConfirmationEmailHtml"),
      "Must have buildReceiptConfirmationEmailHtml function",
    );
    // Verify the constant that controls the CTA URL is set correctly
    assert.ok(
      src.includes(`const TRAINCHAT_ACTIVATE_URL = "https://www.trainchat.ai?code=TRAINCHAT"`),
      "TRAINCHAT_ACTIVATE_URL constant must point to trainchat.ai?code=TRAINCHAT",
    );
    const htmlFn = src.slice(
      src.indexOf("function buildReceiptConfirmationEmailHtml"),
      src.indexOf("function buildReceiptConfirmationEmailText"),
    );
    assert.ok(
      htmlFn.includes("${STATIC_PROMO_CODE}"),
      "HTML confirmation email must include STATIC_PROMO_CODE",
    );
    assert.ok(
      htmlFn.includes("Activate TrainChat"),
      "HTML confirmation email must have Activate TrainChat CTA",
    );
    assert.ok(
      htmlFn.includes("TRAINCHAT_ACTIVATE_URL"),
      "HTML CTA link must reference TRAINCHAT_ACTIVATE_URL (resolves to trainchat.ai?code=TRAINCHAT)",
    );
  });

  it("confirmation email plain text contains the TRAINCHAT code", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("buildReceiptConfirmationEmailText"),
      "Must have buildReceiptConfirmationEmailText function",
    );
    const textFnStart = src.indexOf("function buildReceiptConfirmationEmailText");
    const textFn = src.slice(textFnStart, textFnStart + 1500);
    assert.ok(
      textFn.includes("${STATIC_PROMO_CODE}"),
      "Plain-text confirmation email must include STATIC_PROMO_CODE",
    );
    assert.ok(
      textFn.includes("TRAINCHAT_ACTIVATE_URL"),
      "Plain-text confirmation email must reference TRAINCHAT_ACTIVATE_URL (resolves to trainchat.ai?code=TRAINCHAT)",
    );
  });

  it("confirmation email subject references the activation code", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Receipt Received") && src.includes("Activate TrainChat with code"),
      "Confirmation email subject must reference the activation code",
    );
  });

  it("confirmation_email_sent_at column is added via migration", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMP"),
      "Must migrate confirmation_email_sent_at column",
    );
  });

  it("DB is updated with confirmation_email_sent_at on success", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("SET confirmation_email_sent_at = NOW()"),
      "Must update confirmation_email_sent_at in DB on email success",
    );
  });
});

// ─── 6. Email failure is non-fatal ───────────────────────────────────────────

describe("Email failure handling", () => {
  it("email failure is caught and logged", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Failed to send receipt confirmation email"),
      "Email failure must be caught and logged",
    );
  });

  it("email failure does NOT abort the HTTP response", async () => {
    const src = await readRoutes();
    // After the email catch block, must still reach the success response
    const afterEmailCatch = src.slice(
      src.indexOf("Email failure is non-fatal"),
    );
    assert.ok(
      afterEmailCatch.includes("return res.json({"),
      "Response must still succeed even when email fails",
    );
  });

  it("email failure logs a funnel event", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(`"book_receipt_confirmation_email_failed"`),
      "Email failure must log book_receipt_confirmation_email_failed event",
    );
  });

  it("confirmationEmailSent flag is returned in the response", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("confirmationEmailSent,"),
      "Response must include confirmationEmailSent boolean",
    );
  });
});

// ─── 7. Activation code is always TRAINCHAT ───────────────────────────────────

describe("Activation code invariants — TRAINCHAT everywhere", () => {
  it("success page ACTIVATION_CODE constant is TRAINCHAT", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes(`const ACTIVATION_CODE = "${EXPECTED_CODE}"`),
      `Success page must set ACTIVATION_CODE = "${EXPECTED_CODE}"`,
    );
  });

  it("success page fallback is TRAINCHAT", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes(`"${EXPECTED_CODE}"`),
      `Success page fallback must be "${EXPECTED_CODE}"`,
    );
  });

  it("success page does not fetch promo code from server", async () => {
    const src = await readSuccessPage();
    assert.ok(
      !src.includes("/api/book-funnel/receipt/"),
      "Success page must not fetch promo code — it is always TRAINCHAT",
    );
  });

  it("Activate TrainChat CTA on success page uses ?code=TRAINCHAT", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes("https://www.trainchat.ai?code=TRAINCHAT"),
      "Activate TrainChat link must include ?code=TRAINCHAT",
    );
    assert.ok(
      !src.includes('href="https://www.trainchat.ai"'),
      "Bare trainchat.ai URL without ?code param must not exist",
    );
  });

  it("lead-capture bonus email contains the TRAINCHAT code display block", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Your TrainChat Activation Code"),
      "Lead bonus email must include activation code heading",
    );
    assert.ok(
      src.includes("${STATIC_PROMO_CODE}"),
      "Lead bonus email must render STATIC_PROMO_CODE",
    );
  });

  it("plain-text lead bonus email contains activation code line", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Your TrainChat activation code is: ${STATIC_PROMO_CODE}"),
      "Plain-text bonus email must include activation code line",
    );
  });
});

// ─── 8. Attribution fields stored on submission ───────────────────────────────

describe("Attribution fields — UTM + fbp/fbc", () => {
  it("book_receipt_submissions has utm_source column via migration", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("ADD COLUMN IF NOT EXISTS utm_source TEXT"),
      "Must add utm_source column",
    );
  });

  it("book_receipt_submissions has utm_medium column via migration", async () => {
    const src = await readRoutes();
    assert.ok(src.includes("ADD COLUMN IF NOT EXISTS utm_medium TEXT"));
  });

  it("book_receipt_submissions has utm_campaign column via migration", async () => {
    const src = await readRoutes();
    assert.ok(src.includes("ADD COLUMN IF NOT EXISTS utm_campaign TEXT"));
  });

  it("book_receipt_submissions has fbp column via migration", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("ADD COLUMN IF NOT EXISTS fbp TEXT"),
      "Must add fbp column for Meta pixel attribution",
    );
  });

  it("book_receipt_submissions has fbc column via migration", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("ADD COLUMN IF NOT EXISTS fbc TEXT"),
      "Must add fbc column for Meta click id attribution",
    );
  });

  it("POST /receipt accepts utm_source from multipart body", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("req.body?.utm_source"),
      "Must read utm_source from multipart form body",
    );
  });

  it("POST /receipt accepts fbp from multipart body", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("req.body?.fbp"),
      "Must read fbp from multipart form body",
    );
  });

  it("INSERT stores utm and attribution values into DB", async () => {
    const src = await readRoutes();
    const insertBlock = src.slice(src.indexOf("INSERT INTO book_receipt_submissions"));
    assert.ok(
      insertBlock.includes("utm_source") &&
      insertBlock.includes("utm_medium") &&
      insertBlock.includes("utm_campaign") &&
      insertBlock.includes("fbp") &&
      insertBlock.includes("fbc"),
      "INSERT must include all attribution columns",
    );
  });

  it("frontend reads UTM params from URL and appends to FormData", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("readAttributionFromUrl"),
      "Frontend must have readAttributionFromUrl helper",
    );
    assert.ok(
      src.includes("utm_source") && src.includes("utm_campaign"),
      "Frontend must read utm_source and utm_campaign from URL",
    );
    assert.ok(
      src.includes("formData.append(key, val)") || src.includes("formData.append"),
      "Frontend must append attribution data to FormData",
    );
  });

  it("frontend reads _fbp cookie when not in URL", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("_fbp"),
      "Frontend must attempt to read _fbp cookie for Meta attribution",
    );
  });

  it("lead-capture POST /leads accepts fbp and fbc params", async () => {
    const src = await readRoutes();
    assert.ok(src.includes("fbp") && src.includes("fbc"), "Lead capture must accept fbp and fbc");
  });

  it("lead-capture response includes leadId for attribution chaining", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("return res.json({ success: true, leadId"),
      "Lead response must include leadId",
    );
  });
});

// ─── 9. Security hardening ────────────────────────────────────────────────────

describe("Security hardening", () => {
  it("filename is sanitized before storage", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("function sanitizeFilename"),
      "sanitizeFilename function must exist",
    );
    assert.ok(
      src.includes("sanitizeFilename(originalname)"),
      "Must call sanitizeFilename on originalname before storage",
    );
  });

  it("sanitizeFilename strips path traversal characters", async () => {
    const src = await readRoutes();
    const fnBody = src.slice(
      src.indexOf("function sanitizeFilename"),
      src.indexOf("function sanitizeFilename") + 200,
    );
    // Must allow only safe characters — block ../  slashes etc.
    assert.ok(
      fnBody.includes("[^a-zA-Z0-9._-]"),
      "sanitizeFilename must strip characters outside [a-zA-Z0-9._-]",
    );
  });

  it("storage path uses UUID, not original filename", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("randomUUID()"),
      "Must use randomUUID() in storage path to prevent collisions and traversal",
    );
  });

  it("file stored in .private/ directory (not public-readable)", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes(".private/receipts/"),
      "Receipts must be in .private/ directory — not publicly accessible",
    );
  });

  it("internal storage path is never returned in API responses", async () => {
    const src = await readRoutes();
    // Response objects must not include storedPath / receipt_file_url
    const responseBlocks = src.match(/return res\.json\(\{[^}]+\}\)/gs) ?? [];
    for (const block of responseBlocks) {
      assert.ok(
        !block.includes("storedPath") && !block.includes("receipt_file_url"),
        "API responses must never expose internal file storage paths",
      );
    }
  });

  it("MIME allow-list only contains safe types", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("const ALLOWED_MIMES = new Set"),
      "ALLOWED_MIMES set must exist",
    );
    // Must NOT allow generic application/octet-stream server-side
    const allowedMimesBlock = src.slice(
      src.indexOf("const ALLOWED_MIMES = new Set"),
      src.indexOf("const ALLOWED_MIMES = new Set") + 300,
    );
    assert.ok(
      !allowedMimesBlock.includes("application/octet-stream"),
      "Server-side ALLOWED_MIMES must not include application/octet-stream",
    );
  });

  it("extension allow-list blocks unexpected types", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("const ALLOWED_EXTENSIONS = new Set"),
      "ALLOWED_EXTENSIONS set must exist",
    );
    const extBlock = src.slice(
      src.indexOf("const ALLOWED_EXTENSIONS = new Set"),
      src.indexOf("const ALLOWED_EXTENSIONS = new Set") + 200,
    );
    // Must NOT include .exe, .js, .html, .sh
    for (const dangerous of [".exe", ".js", ".sh", ".html", ".php"]) {
      assert.ok(
        !extBlock.includes(dangerous),
        `ALLOWED_EXTENSIONS must not include ${dangerous}`,
      );
    }
  });
});

// ─── 10. Rate limiting ────────────────────────────────────────────────────────

describe("Rate limiting", () => {
  it("in-memory rate limiter function exists", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("function checkRateLimit("),
      "checkRateLimit function must exist",
    );
  });

  it("receipt endpoint applies rate limiting before multer", async () => {
    const src = await readRoutes();
    // checkRateLimit must be called before the multer middleware in the receipt handler
    const receiptSection = src.slice(
      src.indexOf("POST /api/book-funnel/receipt"),
    );
    const rateLimitIdx = receiptSection.indexOf("checkRateLimit(`receipt:");
    const multerIdx = receiptSection.indexOf("receiptUpload.single");
    assert.ok(
      rateLimitIdx !== -1 && rateLimitIdx < multerIdx,
      "Rate limit check must occur before multer in the receipt handler",
    );
  });

  it("rate limit exceeded returns 429", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("return res.status(429).json("),
      "Rate limit exceeded must return 429",
    );
  });

  it("leads endpoint also applies rate limiting", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("checkRateLimit(`leads:"),
      "POST /leads must also apply rate limiting",
    );
  });

  it("rate limiter cleans up stale entries to prevent memory leaks", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("setInterval"),
      "Rate limiter must clean up stale entries with setInterval",
    );
    assert.ok(
      src.includes(".unref()"),
      "Cleanup interval must use .unref() so it does not block process exit",
    );
  });
});

// ─── 11. Logging completeness ─────────────────────────────────────────────────

describe("Logging completeness", () => {
  it("logs upload received (email logged at intake)", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Receipt upload received for"),
      "Must log when an upload is received",
    );
  });

  it("logs validation rejections", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Receipt rejected: missing email") ||
      src.includes("Receipt rejected:"),
      "Must log validation rejection reasons",
    );
  });

  it("logs storage success with path", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Receipt stored at"),
      "Must log successful storage with path",
    );
  });

  it("logs DB write with submission id", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Submission record created:"),
      "Must log DB write with submission id",
    );
  });

  it("logs email sent with recipient", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("Confirmation email sent to"),
      "Must log confirmation email sent",
    );
  });

  it("final success log includes response time", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("responseTimeMs"),
      "Final log line must include response time for latency monitoring",
    );
  });

  it("does not log raw buffer contents", async () => {
    const src = await readRoutes();
    assert.ok(
      !src.includes("console.log(buffer") && !src.includes("console.log(req.file.buffer"),
      "Must not log raw file buffer contents",
    );
  });

  it("book_receipt_uploaded funnel event includes response time", async () => {
    const src = await readRoutes();
    const eventBlock = src.slice(
      src.indexOf('"book_receipt_uploaded"'),
      src.indexOf('"book_receipt_uploaded"') + 400,
    );
    assert.ok(
      eventBlock.includes("responseTimeMs"),
      "book_receipt_uploaded event must capture responseTimeMs",
    );
  });
});

// ─── 12. Frontend validation ──────────────────────────────────────────────────

describe("Frontend upload validation", () => {
  it("client enforces 10 MB max size", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("MAX_SIZE_BYTES = 10 * 1024 * 1024"),
      "Frontend must enforce 10 MB limit",
    );
  });

  it("client accepts jpg, jpeg, png, pdf, heic extensions", async () => {
    const src = await readFrontend();
    for (const ext of [".jpg", ".jpeg", ".png", ".pdf", ".heic"]) {
      assert.ok(src.includes(ext), `Frontend ACCEPTED_EXTENSIONS must include ${ext}`);
    }
  });

  it("submit button is disabled while uploading (prevents duplicate submissions)", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("disabled={isUploading || uploadState"),
      "Submit button must be disabled during upload",
    );
  });

  it("drag-and-drop zone exists", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("onDrop={handleDrop}") && src.includes("onDragOver"),
      "Drop zone must handle drag-and-drop events",
    );
  });

  it("file input has correct accept attribute", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes('accept=".jpg,.jpeg,.png,.pdf,.heic"'),
      "File input must declare accepted extensions",
    );
  });

  it("upload progress bar is shown while uploading", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("uploadProgress") && src.includes("Uploading"),
      "Must show upload progress bar",
    );
  });

  it("server error is displayed to the user", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("serverError") && src.includes("data-testid=\"error-server\""),
      "Server errors must be displayed with a testid",
    );
  });

  it("network error is caught and shown to the user", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes("Network error. Please check your connection"),
      "Network errors must be shown to the user",
    );
  });

  it("email input has data-testid for testing", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes('data-testid="input-email"'),
      "Email input must have data-testid",
    );
  });

  it("file drop zone has data-testid for testing", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes('data-testid="drop-zone-receipt"'),
      "Drop zone must have data-testid",
    );
  });

  it("submit button has data-testid for testing", async () => {
    const src = await readFrontend();
    assert.ok(
      src.includes('data-testid="button-submit-receipt"'),
      "Submit button must have data-testid",
    );
  });
});

// ─── 13. Table schema integrity ────────────────────────────────────────────────

describe("Table schema integrity", () => {
  it("book_funnel_leads table has id, email, source, created_at", async () => {
    const src = await readRoutes();
    for (const col of ["id", "email", "source", "created_at"]) {
      assert.ok(src.includes(col), `book_funnel_leads must have column: ${col}`);
    }
  });

  it("book_receipt_submissions has all required columns", async () => {
    const src = await readRoutes();
    for (const col of [
      "lead_id", "email", "receipt_file_url", "original_filename",
      "mime_type", "file_size", "status", "promo_code", "uploaded_at",
      "utm_source", "utm_medium", "utm_campaign", "fbp", "fbc",
      "confirmation_email_sent_at",
    ]) {
      assert.ok(src.includes(col), `book_receipt_submissions must reference column: ${col}`);
    }
  });

  it("book_funnel_events table exists for audit trail", async () => {
    const src = await readRoutes();
    assert.ok(
      src.includes("CREATE TABLE IF NOT EXISTS book_funnel_events"),
      "book_funnel_events table must exist",
    );
  });
});
