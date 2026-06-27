/**
 * Regression tests: Book Funnel Static Promo Code (TRAINCHAT)
 *
 * Confirms:
 *  1. Every book lead receives TRAINCHAT — never a random code
 *  2. No random promo code is generated
 *  3. Lead attribution (leadId, email, source, fbp/fbc, UTM) is preserved
 *  4. Redemption tracking works by email/lead (not by unique code)
 *  5. The GET /receipt/:id endpoint always returns TRAINCHAT
 *  6. Email template copy references TRAINCHAT
 *  7. Frontend success page always shows TRAINCHAT
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXPECTED_CODE = "TRAINCHAT";

async function readServer(): Promise<string> {
  return readFile("server/book-funnel-routes.ts", "utf8");
}

async function readSuccessPage(): Promise<string> {
  return readFile("client/src/pages/book-redeem-success.tsx", "utf8");
}

// ─── Static code invariants ───────────────────────────────────────────────────

describe("Static promo code invariants", () => {
  it("STATIC_PROMO_CODE constant equals TRAINCHAT", async () => {
    const src = await readServer();
    assert.ok(
      src.includes(`const STATIC_PROMO_CODE = "${EXPECTED_CODE}"`),
      `Expected STATIC_PROMO_CODE = "${EXPECTED_CODE}" in server/book-funnel-routes.ts`,
    );
  });

  it("generatePromoCode function does NOT exist", async () => {
    const src = await readServer();
    assert.ok(
      !src.includes("generatePromoCode"),
      "generatePromoCode should be removed — no per-user code generation",
    );
  });

  it("no rotating TRAIN-XXXX-XXX pattern generator exists", async () => {
    const src = await readServer();
    assert.ok(
      !src.includes("ABCDEFGHJKLMNPQRSTUVWXYZ23456789"),
      "Old character set for random code generation should not be present",
    );
    assert.ok(
      !src.match(/TRAIN-\$\{seg\(4\)\}/),
      "Old TRAIN-XXXX-XXX format string should not be present",
    );
  });

  it("promo_code column is not declared UNIQUE in the migration", async () => {
    const src = await readServer();
    assert.ok(
      !src.includes("ADD COLUMN IF NOT EXISTS promo_code TEXT UNIQUE"),
      "promo_code should not be declared UNIQUE — all leads share the same code",
    );
  });

  it("migration drops the old unique constraint if it existed", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("DROP CONSTRAINT IF EXISTS book_receipt_submissions_promo_code_key"),
      "Must migrate existing DBs by dropping the old unique constraint",
    );
  });

  it("receipt upload handler assigns STATIC_PROMO_CODE, not generatePromoCode()", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("const promoCode: string = STATIC_PROMO_CODE"),
      "Receipt handler must assign STATIC_PROMO_CODE directly",
    );
    assert.ok(
      !src.includes("generatePromoCode()"),
      "generatePromoCode() must not be called anywhere",
    );
  });

  it("GET /receipt/:id handler always returns STATIC_PROMO_CODE", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("promoCode: STATIC_PROMO_CODE"),
      "GET receipt endpoint must return STATIC_PROMO_CODE, not raw DB value",
    );
    assert.ok(
      !src.includes("promoCode: row.promo_code"),
      "GET receipt endpoint must not return row.promo_code (raw DB value)",
    );
  });
});

// ─── Attribution preservation ────────────────────────────────────────────────

describe("Lead attribution fields are preserved", () => {
  it("book_funnel_leads table preserves id, email, source, created_at", async () => {
    const src = await readServer();
    for (const col of ["id", "email", "source", "created_at"]) {
      assert.ok(src.includes(col), `book_funnel_leads must retain column: ${col}`);
    }
  });

  it("POST /leads accepts fbp and fbc attribution params", async () => {
    const src = await readServer();
    assert.ok(src.includes("fbp"), "fbp param must be accepted for attribution");
    assert.ok(src.includes("fbc"), "fbc param must be accepted for attribution");
  });

  it("POST /leads response includes leadId and email", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("return res.json({ success: true, leadId"),
      "Response must include leadId for attribution",
    );
  });
});

// ─── Redemption tracking by email/lead ───────────────────────────────────────

describe("Redemption tracking by email/lead (not unique code)", () => {
  it("book_receipt_submissions retains lead_id, email, promo_code_redeemed_at", async () => {
    const src = await readServer();
    for (const col of ["lead_id", "promo_code_redeemed_at", "trainchat_account_email"]) {
      assert.ok(src.includes(col), `book_receipt_submissions must retain column: ${col}`);
    }
  });

  it("duplicate-submission guard uses email, not promo_code uniqueness", async () => {
    const src = await readServer();
    assert.ok(
      /WHERE email = .+ AND status = 'pending_review'/.test(src),
      "Duplicate guard must query by email, not by promo_code",
    );
    assert.ok(
      !/WHERE promo_code = .+LIMIT/.test(src),
      "Duplicate guard must NOT rely on promo_code uniqueness",
    );
  });

  it("submission INSERT captures lead_id and email for per-user tracking", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("INSERT INTO book_receipt_submissions"),
      "Submissions must still be inserted into book_receipt_submissions",
    );
    const insertBlock = src.slice(src.indexOf("INSERT INTO book_receipt_submissions"));
    assert.ok(
      insertBlock.includes("lead_id") && insertBlock.includes("email"),
      "INSERT must include lead_id and email for attribution",
    );
  });
});

// ─── Email template copy ─────────────────────────────────────────────────────

describe("Email templates include TRAINCHAT", () => {
  it("HTML email template shows the activation code heading", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("Your TrainChat Activation Code"),
      "HTML email must include 'Your TrainChat Activation Code' heading",
    );
  });

  it("HTML email template renders STATIC_PROMO_CODE variable", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("${STATIC_PROMO_CODE}"),
      "HTML email must render STATIC_PROMO_CODE in the code display block",
    );
  });

  it("plain-text email includes activation code line", async () => {
    const src = await readServer();
    assert.ok(
      src.includes("Your TrainChat activation code is: ${STATIC_PROMO_CODE}"),
      "Plain-text email must include activation code line",
    );
  });
});

// ─── Frontend success page ────────────────────────────────────────────────────

describe("Frontend success page always shows TRAINCHAT", () => {
  it("ACTIVATION_CODE constant is set to TRAINCHAT", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes(`const ACTIVATION_CODE = "${EXPECTED_CODE}"`),
      `Success page must set ACTIVATION_CODE = "${EXPECTED_CODE}"`,
    );
  });

  it("displayCode fallback is TRAINCHAT, not a placeholder", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes(`"${EXPECTED_CODE}"`),
      `Success page fallback must be "${EXPECTED_CODE}"`,
    );
    assert.ok(
      !src.includes("TRAIN-????-???"),
      "Old placeholder TRAIN-????-??? must be removed",
    );
  });

  it("no API fetch for promo code from server — code is always static", async () => {
    const src = await readSuccessPage();
    assert.ok(
      !src.includes("/api/book-funnel/receipt/"),
      "Success page must not fetch promo code from the server — it is always TRAINCHAT",
    );
    assert.ok(
      !src.includes("setPromoCode(data.promoCode)"),
      "setPromoCode(data.promoCode) must be removed — code is static",
    );
  });
});

// ─── CTA URL coverage ─────────────────────────────────────────────────────────

describe("TrainChat CTAs pass ?code=TRAINCHAT in the URL", () => {
  it("book-redeem-success.tsx Activate TrainChat link includes ?code=TRAINCHAT", async () => {
    const src = await readSuccessPage();
    assert.ok(
      src.includes("https://www.trainchat.ai?code=TRAINCHAT"),
      "Activate TrainChat CTA must point to https://www.trainchat.ai?code=TRAINCHAT",
    );
    // Must NOT be a bare URL without the code param
    assert.ok(
      !src.includes('href="https://www.trainchat.ai"'),
      "Bare trainchat.ai URL without ?code param must be removed",
    );
  });

  it("book-landing.tsx 'How to Redeem' step 3 mentions the TRAINCHAT code", async () => {
    const src = await import("fs/promises").then((fs) =>
      fs.readFile("client/src/pages/book-landing.tsx", "utf8"),
    );
    assert.ok(
      src.includes("TRAINCHAT"),
      "book-landing.tsx must mention the TRAINCHAT activation code",
    );
    assert.ok(
      !src.includes("activated automatically"),
      "Misleading 'activated automatically' copy must be removed from How to Redeem steps",
    );
  });

  it("book-landing.tsx activation code badge links to trainchat.ai?code=TRAINCHAT", async () => {
    const src = await import("fs/promises").then((fs) =>
      fs.readFile("client/src/pages/book-landing.tsx", "utf8"),
    );
    assert.ok(
      src.includes("https://www.trainchat.ai?code=TRAINCHAT"),
      "Landing page activation badge must link to trainchat.ai?code=TRAINCHAT",
    );
  });

  it("book-landing.tsx FAQ answer mentions the TRAINCHAT code", async () => {
    const src = await import("fs/promises").then((fs) =>
      fs.readFile("client/src/pages/book-landing.tsx", "utf8"),
    );
    const faqIdx = src.indexOf("How does the TrainChat bonus work");
    assert.ok(faqIdx !== -1, "FAQ entry must exist");
    const faqAnswer = src.slice(faqIdx, faqIdx + 500);
    assert.ok(
      faqAnswer.includes("TRAINCHAT"),
      "FAQ answer for 'How does the TrainChat bonus work?' must mention the TRAINCHAT code",
    );
  });
});
