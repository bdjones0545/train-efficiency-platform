/**
 * Public intake abuse controls + automated-cron send ordering.
 * ─────────────────────────────────────────────────────────────────────────────
 * Three properties, all executed rather than grepped:
 *
 *  1. The two unauthenticated intake endpoints
 *       POST /api/public/lead-capture/:orgSlug/:programSlug/submit
 *       POST /api/attendance/checkin/:slug
 *     are registered behind a rate limiter, and suppress a repeat submission by
 *     (program, normalized email) inside 24 hours — no second row, no second
 *     applicant email, no second sequence.
 *
 *  2. The lead-capture sequence CLAIMS a step before sending it, so a send can
 *     never happen twice and a failure can never advance the sequence.
 *
 *  3. The attendance report cron takes and releases a global job lock, and
 *     skips when the lock is held.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findRouteRegistrations } from "../lib/route-guard-audit.js";
import {
  DEDUP_WINDOW_HOURS,
  findRecentAttendance,
  findRecentSubmission,
  normalizeIntakeEmail,
  resultRows,
} from "../lib/public-intake-dedup.js";

let savedEnv: string | undefined;
beforeEach(() => { savedEnv = process.env.AUTOMATION_SENDS_ENABLED; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.AUTOMATION_SENDS_ENABLED;
  else process.env.AUTOMATION_SENDS_ENABLED = savedEnv;
});

/** Records the SQL fragments a query was built from, so a test can read them. */
function recordingExecutor(rows: any[]) {
  const seen: any[] = [];
  return {
    seen,
    executor: {
      execute: async (query: any) => {
        seen.push(query);
        return { rows };
      },
    },
  };
}

/** A tag that renders the template into inspectable text. */
const textSql = (strings: TemplateStringsArray, ...values: any[]) =>
  strings.reduce((acc, part, i) => acc + part + (i < values.length ? `{${String(values[i])}}` : ""), "");

// ── 1. Rate limiting ─────────────────────────────────────────────────────────

describe("the unauthenticated intake endpoints are rate limited", () => {
  const CASES = [
    { file: "server/routes.ts", path: "/api/public/lead-capture/:orgSlug/:programSlug/submit" },
    { file: "server/attendance-routes.ts", path: "/api/attendance/checkin/:slug" },
  ];

  for (const c of CASES) {
    it(`POST ${c.path} declares publicRateLimiter`, () => {
      const routes = findRouteRegistrations(readFileSync(c.file, "utf-8"), c.file);
      const route = routes.find((r) => r.method === "post" && r.path === c.path);
      assert.ok(route, `${c.path} must still be registered in ${c.file}`);
      assert.ok(
        route!.guardNames.includes("publicRateLimiter()"),
        `${c.path} is unauthenticated and sends email — it must be rate limited (found: ${route!.guardNames.join(", ") || "nothing"})`,
      );
    });
  }

  it("the limiter actually returns 429 past its budget", async () => {
    const { publicRateLimiter } = await import("../middleware/public-rate-limiter.js");
    const limiter = publicRateLimiter(2, 60_000, "test-intake");
    const req = { headers: { "x-forwarded-for": "203.0.113.9" }, socket: {} };
    const statuses: number[] = [];
    const res = {
      set: () => {},
      status: (code: number) => { statuses.push(code); return { json: () => {} }; },
    };
    let allowed = 0;
    for (let i = 0; i < 4; i++) limiter(req, res, () => { allowed++; });
    assert.equal(allowed, 2, "only the budget may pass");
    assert.deepEqual(statuses, [429, 429]);
  });
});

// ── 2. Duplicate suppression ─────────────────────────────────────────────────

describe("duplicate submissions inside the window are suppressed", () => {
  it("normalizes the email before comparing", () => {
    assert.equal(normalizeIntakeEmail("  Athlete@Example.COM "), "athlete@example.com");
    assert.equal(normalizeIntakeEmail(undefined), "");
    assert.equal(normalizeIntakeEmail(42), "");
  });

  it("a repeat lead-capture submit finds the existing row (one submission, one applicant email)", async () => {
    const { executor, seen } = recordingExecutor([{ id: "existing-submission" }]);
    const found = await findRecentSubmission(
      executor,
      { orgId: "org-1", programId: "prog-1", email: "  Athlete@Example.com " },
      textSql as any,
    );
    assert.equal(found?.id, "existing-submission", "a duplicate must resolve to the existing submission id");
    const query = String(seen[0]);
    assert.match(query, /LOWER\(email\) = \{athlete@example\.com\}/, "comparison must be case-insensitive on both sides");
    assert.match(query, /\{24\} \* INTERVAL '1 hour'/, "the window must be 24 hours");
    assert.equal(DEDUP_WINDOW_HOURS, 24);
  });

  it("a first-time submit finds nothing and proceeds", async () => {
    const { executor } = recordingExecutor([]);
    const found = await findRecentSubmission(
      executor,
      { orgId: "org-1", programId: "prog-1", email: "new@example.com" },
      textSql as any,
    );
    assert.equal(found, null);
  });

  it("an empty email never matches an existing row", async () => {
    const { executor, seen } = recordingExecutor([{ id: "should-not-be-reached" }]);
    assert.equal(await findRecentSubmission(executor, { orgId: "o", programId: "p", email: "" }, textSql as any), null);
    assert.equal(seen.length, 0, "no query should be issued for an empty email");
  });

  it("a repeat attendance check-in finds the existing visit", async () => {
    const { executor, seen } = recordingExecutor([{ id: "visit-1", visit_number: 7 }]);
    const found = await findRecentAttendance(
      executor,
      { programId: "prog-1", email: "ATHLETE@example.com" },
      textSql as any,
    );
    assert.equal(found?.visit_number, 7, "a double-tap returns the visit that already exists");
    assert.match(String(seen[0]), /LOWER\(athlete_email\) = \{athlete@example\.com\}/);
  });

  it("resultRows reads both array and { rows } shapes", () => {
    assert.deepEqual(resultRows([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(resultRows({ rows: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(resultRows(null), []);
  });

  it("both routes consult the duplicate window before doing any work", () => {
    const routesSrc = readFileSync("server/routes.ts", "utf-8");
    assert.ok(routesSrc.includes("findRecentSubmission("), "lead-capture submit must dedupe");
    const attendanceSrc = readFileSync("server/attendance-routes.ts", "utf-8");
    assert.ok(attendanceSrc.includes("findRecentAttendance("), "attendance check-in must dedupe");
  });
});

// ── 3. Claim-before-send ─────────────────────────────────────────────────────

describe("the lead-capture sequence claims a step before sending it", () => {
  /** Minimal drizzle-shaped fake that records the order of operations. */
  function fakeDb(order: string[], claimResult: any[]) {
    const table = { id: "id", sequenceStatus: "sequence_status", followUpCount: "follow_up_count" };
    let updates = 0;
    return {
      table,
      updates: () => updates,
      db: {
        select: () => ({
          from: () => ({
            where: async () => [
              {
                id: "sub-1", orgId: "org-1", programId: "prog-1",
                athleteName: "Test Athlete", email: "athlete@example.com", sport: null,
                sequenceStatus: "pending", aiQualificationScore: 90,
                followUpCount: 0, contactedAt: null,
                createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
              },
            ],
          }),
        }),
        update: () => ({
          set: (values: any) => ({
            where: () => {
              updates++;
              const isClaim = values.sequenceStatus?.toString().includes("_sending");
              order.push(isClaim ? "claim" : `settle:${values.sequenceStatus}`);
              return {
                returning: async () => claimResult,
              };
            },
          }),
        }),
      },
    };
  }

  const fakeStorage = {
    getOrganizationById: async () => ({ id: "org-1", name: "Org", slug: "org", ownerUserId: null, ownerEmail: "coach@example.com" }),
    getAthleticProgramById: async () => ({ id: "prog-1", name: "Program", slug: "prog" }),
    getUser: async () => null,
  } as any;

  it("claims first, then sends, then records the result", async () => {
    delete process.env.AUTOMATION_SENDS_ENABLED;
    const order: string[] = [];
    const fake = fakeDb(order, [{ id: "sub-1" }]);
    const { runLeadCaptureSequenceCron } = await import("../lead-capture-sequences.js");

    await runLeadCaptureSequenceCron({
      loadDb: async () => fake.db,
      storage: fakeStorage,
      isOptedOut: async () => false,
      log: async () => {},
      mail: { send: async () => { order.push("send"); return [{ statusCode: 202 }]; } },
    });

    const trimmed = order.filter((step) => step !== "noop");
    assert.equal(trimmed[0], "claim", "the step must be claimed BEFORE the send — otherwise a status write that fails after a successful send re-sends next tick");
    assert.equal(trimmed[1], "send");
    assert.equal(trimmed[2], "settle:high_intent_sent", "a successful send advances the sequence");
  });

  it("a step already claimed by another worker is not sent again", async () => {
    delete process.env.AUTOMATION_SENDS_ENABLED;
    const order: string[] = [];
    const fake = fakeDb(order, []); // claim returns no row → somebody else owns it
    const { runLeadCaptureSequenceCron } = await import("../lead-capture-sequences.js");

    await runLeadCaptureSequenceCron({
      loadDb: async () => fake.db,
      storage: fakeStorage,
      isOptedOut: async () => false,
      log: async () => {},
      mail: { send: async () => { order.push("send"); return [{ statusCode: 202 }]; } },
    });

    assert.deepEqual(order, ["claim"], "a lost claim must not send");
  });

  it("a failed send does NOT advance the sequence and is recorded, not swallowed", async () => {
    delete process.env.AUTOMATION_SENDS_ENABLED;
    const order: string[] = [];
    const fake = fakeDb(order, [{ id: "sub-1" }]);
    const logged: string[] = [];
    const { runLeadCaptureSequenceCron } = await import("../lead-capture-sequences.js");

    await runLeadCaptureSequenceCron({
      loadDb: async () => fake.db,
      storage: fakeStorage,
      isOptedOut: async () => false,
      log: async (entry: any) => { logged.push(entry.status); },
      mail: { send: async () => { order.push("send"); throw new Error("sendgrid 502"); } },
    });

    assert.equal(order[0], "claim");
    assert.equal(order[1], "send");
    assert.equal(order[2], "settle:high_intent_1hr_failed", "a failure must not advance to the next step");
    assert.ok(logged.includes("failed"), "the failure must be recorded, not swallowed by catch (_) {}");
  });

  it("no empty catch swallows a per-row failure any more", () => {
    const src = readFileSync("server/lead-capture-sequences.ts", "utf-8");
    const cron = src.slice(src.indexOf("export async function runLeadCaptureSequenceCron"));
    assert.ok(!cron.includes("} catch (_) {}"), "the cron must not swallow a per-row failure");
    assert.ok(cron.includes("console.error(`[LeadCapture Sequences] submission"), "a per-row failure must be logged");
  });
});

// ── 4. Attendance report cron job lock ───────────────────────────────────────

describe("the attendance report cron runs under a global job lock", () => {
  const AT_5PM_WEDNESDAY = { hour: 17, minute: 0, day: 3, dateStr: "2026-09-16" };

  it("acquires attendance_report_cron globally and releases it", async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "false"; // keeps the run itself inert
    const acquired: any[] = [];
    const released: string[] = [];
    const { runAttendanceReportTick } = await import("../attendance-report-cron.js");

    const result = await runAttendanceReportTick({
      now: AT_5PM_WEDNESDAY as any,
      lock: {
        acquire: async (orgId, jobName, ttl) => { acquired.push([orgId, jobName, ttl]); return { acquired: true, lockKey: "lk-1" }; },
        release: async (lockKey) => { released.push(lockKey); },
      },
    });

    assert.equal(result, "ran");
    assert.deepEqual(acquired, [["__global__", "attendance_report_cron", 5]]);
    assert.deepEqual(released, ["lk-1"], "the lock must be released in a finally block");
  });

  it("skips when another instance holds the lock", async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "false";
    let sendGridResolved = 0;
    const { runAttendanceReportTick } = await import("../attendance-report-cron.js");

    const result = await runAttendanceReportTick({
      now: AT_5PM_WEDNESDAY as any,
      lock: { acquire: async () => ({ acquired: false, lockKey: "" }), release: async () => {} },
      deps: { getSendGrid: async () => { sendGridResolved++; return null; } },
    });

    assert.equal(result, "skipped_lock_held");
    assert.equal(sendGridResolved, 0);
  });

  it("fails closed when the lock service errors", async () => {
    process.env.AUTOMATION_SENDS_ENABLED = "false";
    const { runAttendanceReportTick } = await import("../attendance-report-cron.js");
    const result = await runAttendanceReportTick({
      now: AT_5PM_WEDNESDAY as any,
      lock: { acquire: async () => { throw new Error("lock service down"); }, release: async () => {} },
    });
    assert.equal(result, "skipped_lock_held", "an unreachable lock service is not permission to send");
  });

  it("does nothing outside the 17:00 ET window", async () => {
    const { runAttendanceReportTick } = await import("../attendance-report-cron.js");
    let acquireCalls = 0;
    const result = await runAttendanceReportTick({
      now: { hour: 9, minute: 30, day: 3, dateStr: "2026-09-16" } as any,
      lock: { acquire: async () => { acquireCalls++; return { acquired: true, lockKey: "x" }; }, release: async () => {} },
    });
    assert.equal(result, "skipped_not_due");
    assert.equal(acquireCalls, 0);
  });

  it("the report history row is reserved BEFORE the send, with a uniqueness guard", () => {
    const src = readFileSync("server/attendance-report-cron.ts", "utf-8");
    const reserve = src.indexOf("reserveReportSend(orgId");
    const send = src.indexOf("await sg.sgMail.send(");
    assert.ok(reserve > 0 && send > 0 && reserve < send, "the history row must be written before the send");
    assert.ok(src.includes("ON CONFLICT DO NOTHING"), "the reservation must be conditional on the uniqueness guard");
    assert.ok(!src.includes("async function alreadySent("), "the check-then-write dedup must be gone");

    const migration = readFileSync("migrations/0023_attendance_report_send_uniqueness.sql", "utf-8");
    assert.ok(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS"), "the guard must be a real unique index");
    assert.match(migration, /WHERE status IN \('sending', 'sent'\)/, "the index must be partial so failures can be retried");
    assert.ok(migration.includes("DELETE FROM attendance_report_email_history"), "existing exact duplicates must be collapsed before the index is created");
  });
});
