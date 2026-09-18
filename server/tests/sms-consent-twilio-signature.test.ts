/**
 * SMS consent + Twilio webhook authenticity.
 *
 * Three defects, each proven by executing code rather than grepping it:
 *  1. A carrier STOP was ignored for any user with a user_org_preferences row,
 *     because sendSms reads org preferences first and only falls back to
 *     users.smsOptIn (the only flag the STOP webhook used to write).
 *  2. `agent_outreach` (the AI agent's send_sms tool) counted as operational
 *     and bypassed the opt-in gate entirely.
 *  3. POST /api/twilio/sms/incoming accepted any request: no X-Twilio-Signature
 *     check, so anyone could opt any phone number in or out.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";
import twilio from "twilio";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/no_database_access";
// Never let a developer's real Twilio credentials leak into a consent test.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_PHONE_NUMBER;
delete process.env.TWILIO_AUTH_TOKEN;

const { storage } = await import("../storage");
const { sendSms } = await import("../sms");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── storage stubbing ─────────────────────────────────────────────────────────

type Stub = Partial<Record<keyof typeof storage, (...args: any[]) => any>>;
const stubbed: string[] = [];

function stubStorage(overrides: Stub) {
  for (const [name, fn] of Object.entries(overrides)) {
    (storage as any)[name] = fn;
    stubbed.push(name);
  }
}

afterEach(() => {
  // Own properties shadow the prototype methods; deleting restores the real ones.
  for (const name of stubbed.splice(0)) delete (storage as any)[name];
});

const PHONE = "+15551234567";

const stoppedUser = {
  id: "user-stopped",
  phone: PHONE,
  smsOptIn: false,
  smsConsentSource: "twilio_stop",
  notificationPreferences: null,
};

// The org-preference row says yes to everything: this is the row that used to win.
const consentingOrgPrefs = {
  userId: stoppedUser.id,
  orgId: "org-1",
  smsOptIn: true,
  notificationPreferences: { sms: { marketing: true, reminders: true, bookingConfirmations: true, outreach: true } },
};

function consentStubs(user = stoppedUser, orgPrefs: any = consentingOrgPrefs) {
  const calls = { orgPrefsLookups: 0, logs: [] as any[] };
  stubStorage({
    getUser: async (id: string) => (id === user.id ? user : undefined),
    getUsersByPhone: async (phone: string) => (phone === user.phone ? [user] : []),
    getUserOrgPreferences: async () => {
      calls.orgPrefsLookups += 1;
      return orgPrefs;
    },
    createCommunicationLog: async (log: any) => {
      calls.logs.push(log);
      return log;
    },
  });
  return calls;
}

// ── Defect 1: carrier STOP must win over org-level preferences ───────────────

test("carrier STOP blocks a marketing SMS even when the org-preference row says opted in", async () => {
  const calls = consentStubs();
  const result = await sendSms({ to: PHONE, body: "sale!", ctx: { orgId: "org-1", type: "marketing", recipientUserId: stoppedUser.id } });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, "sms_carrier_stop");
  assert.equal(calls.orgPrefsLookups, 0, "the STOP decision is made before org preferences are consulted");
  assert.equal(calls.logs.at(-1)?.status, "skipped");
  assert.equal(calls.logs.at(-1)?.errorMessage, "sms_carrier_stop");
});

test("carrier STOP blocks an operational reminder (no messagePurpose) too", async () => {
  consentStubs();
  const result = await sendSms({ to: PHONE, body: "see you at 6", ctx: { orgId: "org-1", type: "reminder", recipientUserId: stoppedUser.id } });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, "sms_carrier_stop");
});

test("carrier STOP blocks an explicitly operational booking confirmation", async () => {
  consentStubs();
  const result = await sendSms({
    to: PHONE,
    body: "booked",
    ctx: { orgId: "org-1", type: "booking_confirmation", messagePurpose: "operational", recipientUserId: stoppedUser.id },
  });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, "sms_carrier_stop");
});

test("carrier STOP is phone-level: a send with no recipientUserId is blocked by phone lookup", async () => {
  consentStubs();
  const result = await sendSms({ to: "(555) 123-4567", body: "hi", ctx: { orgId: "org-1", type: "outreach" } });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, "sms_carrier_stop");
});

test("an in-app opt-out (not a carrier STOP) still lets operational messages through the consent gates", async () => {
  // smsOptIn=false but the source is the app, not Twilio: org preferences remain the source of truth.
  consentStubs({ ...stoppedUser, smsConsentSource: "web" });
  const result = await sendSms({ to: PHONE, body: "see you at 6", ctx: { orgId: "org-1", type: "reminder", recipientUserId: stoppedUser.id } });
  // Twilio is deliberately unconfigured in this test, so passing every gate ends here — never at a consent skip.
  assert.equal(result.skipped, "twilio_not_configured");
});

// ── Defect 2: agent_outreach requires opt-in ─────────────────────────────────

test("agent_outreach is not operational: it is skipped when the recipient has not opted in", async () => {
  const notOptedIn = { ...stoppedUser, id: "user-quiet", smsConsentSource: null };
  consentStubs(notOptedIn, { ...consentingOrgPrefs, userId: notOptedIn.id, smsOptIn: false });
  const result = await sendSms({ to: PHONE, body: "hey there", ctx: { orgId: "org-1", type: "agent_outreach", recipientUserId: notOptedIn.id } });
  assert.equal(result.sent, false);
  assert.equal(result.skipped, "sms_not_opted_in");
});

// ── Defect 1 (write side): STOP updates both tables ──────────────────────────

function fakeRes() {
  const res: any = {
    statusCode: 200,
    contentType: undefined as string | undefined,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    type(t: string) { res.contentType = t; return res; },
    send(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

function fakeReq(opts: { headers?: Record<string, string>; body?: any; originalUrl?: string; protocol?: string }) {
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers,
    body: opts.body ?? {},
    originalUrl: opts.originalUrl ?? "/api/twilio/sms/incoming",
    protocol: opts.protocol ?? "http",
    get: (name: string) => headers[name.toLowerCase()],
  } as any;
}

test("STOP opts the user out at the user level AND on every org-preference row", async () => {
  const { handleTwilioInboundSms } = await import("../twilio-inbound-sms");
  const userCalls: any[] = [];
  const orgCalls: string[] = [];
  stubStorage({
    getUsersByPhone: async (phone: string) => (phone === PHONE ? [{ id: "u-1", phone: PHONE }, { id: "u-2", phone: PHONE }] : []),
    updateUserSmsOptIn: async (...args: any[]) => { userCalls.push(args); return {}; },
    optOutUserSmsInAllOrgs: async (userId: string) => { orgCalls.push(userId); return { orgPreferenceRowsUpdated: 2 }; },
  });

  const res = fakeRes();
  await handleTwilioInboundSms(fakeReq({ body: { From: "(555) 123-4567", Body: " stop " } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "<?xml version='1.0'?><Response/>");
  assert.deepEqual(userCalls, [["u-1", false, "twilio_stop"], ["u-2", false, "twilio_stop"]]);
  assert.deepEqual(orgCalls, ["u-1", "u-2"]);
});

test("START re-enables the user level only and never grants org-level consent", async () => {
  const { handleTwilioInboundSms } = await import("../twilio-inbound-sms");
  const userCalls: any[] = [];
  let orgWrites = 0;
  stubStorage({
    getUsersByPhone: async () => [{ id: "u-1", phone: PHONE }],
    updateUserSmsOptIn: async (...args: any[]) => { userCalls.push(args); return {}; },
    optOutUserSmsInAllOrgs: async () => { orgWrites += 1; return { orgPreferenceRowsUpdated: 0 }; },
    upsertUserOrgPreferences: async () => { orgWrites += 1; return {}; },
  });

  const res = fakeRes();
  await handleTwilioInboundSms(fakeReq({ body: { From: PHONE, Body: "START" } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(userCalls, [["u-1", true, "twilio_start"]]);
  assert.equal(orgWrites, 0);
});

test("the real storage implementation writes the STOP to user_org_preferences", () => {
  // The unit suite has no database; pin the write target of the method the handler calls.
  const source = readFileSync(path.join(repoRoot, "server", "storage.ts"), "utf8");
  const impl = source.slice(source.indexOf("async optOutUserSmsInAllOrgs("));
  const body = impl.slice(0, impl.indexOf("\n  }\n"));
  assert.match(body, /\.update\(userOrgPreferences\)/);
  assert.match(body, /smsOptIn:\s*false/);
  assert.match(body, /eq\(userOrgPreferences\.userId,\s*userId\)/);
});

// ── Defect 3: X-Twilio-Signature validation, fail closed ─────────────────────

const AUTH_TOKEN = "twilio-test-auth-token";
const WEBHOOK_URL = "https://app.example.test/api/twilio/sms/incoming";
const STOP_PARAMS = { From: PHONE, Body: "STOP", MessageSid: "SM123" };

function storageMustNotBeTouched() {
  const touched: string[] = [];
  stubStorage({
    getUsersByPhone: async () => { touched.push("getUsersByPhone"); return []; },
    updateUserSmsOptIn: async () => { touched.push("updateUserSmsOptIn"); return {}; },
    optOutUserSmsInAllOrgs: async () => { touched.push("optOutUserSmsInAllOrgs"); return { orgPreferenceRowsUpdated: 0 }; },
  });
  return touched;
}

async function runGuard(req: any) {
  const { requireTwilioSignature } = await import("../twilio-inbound-sms");
  const res = fakeRes();
  let reached = false;
  await requireTwilioSignature(req, res, () => { reached = true; });
  return { res, reached };
}

test("a request with no X-Twilio-Signature is rejected with 403 and touches no storage", async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  const touched = storageMustNotBeTouched();
  const { res, reached } = await runGuard(fakeReq({ body: STOP_PARAMS }));
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(touched, []);
});

test("a forged X-Twilio-Signature is rejected with 403 and touches no storage", async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  const touched = storageMustNotBeTouched();
  const forged = twilio.getExpectedTwilioSignature("attacker-guess", WEBHOOK_URL, STOP_PARAMS);
  const { res, reached } = await runGuard(fakeReq({ headers: { "X-Twilio-Signature": forged }, body: STOP_PARAMS }));
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(touched, []);
});

test("a signature over different params (tampered body) is rejected", async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  storageMustNotBeTouched();
  const signedForStop = twilio.getExpectedTwilioSignature(AUTH_TOKEN, WEBHOOK_URL, STOP_PARAMS);
  const { res, reached } = await runGuard(fakeReq({ headers: { "X-Twilio-Signature": signedForStop }, body: { ...STOP_PARAMS, Body: "START" } }));
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);
});

test("without TWILIO_AUTH_TOKEN the webhook fails closed even for a correctly signed request", async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  const touched = storageMustNotBeTouched();
  const valid = twilio.getExpectedTwilioSignature(AUTH_TOKEN, WEBHOOK_URL, STOP_PARAMS);
  const { res, reached } = await runGuard(fakeReq({ headers: { "X-Twilio-Signature": valid }, body: STOP_PARAMS }));
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(touched, []);
});

test("a request signed by Twilio's own algorithm over PUBLIC_APP_URL is accepted and processed", async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.PUBLIC_APP_URL = "https://app.example.test/";
  const { handleTwilioInboundSms } = await import("../twilio-inbound-sms");
  const userCalls: any[] = [];
  stubStorage({
    getUsersByPhone: async () => [{ id: "u-1", phone: PHONE }],
    updateUserSmsOptIn: async (...args: any[]) => { userCalls.push(args); return {}; },
    optOutUserSmsInAllOrgs: async () => ({ orgPreferenceRowsUpdated: 1 }),
  });
  const valid = twilio.getExpectedTwilioSignature(AUTH_TOKEN, WEBHOOK_URL, STOP_PARAMS);
  const req = fakeReq({ headers: { "X-Twilio-Signature": valid, host: "internal-proxy:5000" }, body: STOP_PARAMS });

  const { res: guardRes, reached } = await runGuard(req);
  assert.equal(reached, true, "valid signature must reach the handler");
  assert.equal(guardRes.statusCode, 200);

  const res = fakeRes();
  await handleTwilioInboundSms(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(userCalls, [["u-1", false, "twilio_stop"]]);
});

test("without PUBLIC_APP_URL the signed URL is rebuilt from X-Forwarded-Proto and Host", async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  delete process.env.PUBLIC_APP_URL;
  const valid = twilio.getExpectedTwilioSignature(AUTH_TOKEN, "https://app.example.test/api/twilio/sms/incoming?v=1", STOP_PARAMS);
  const req = fakeReq({
    headers: { "X-Twilio-Signature": valid, "X-Forwarded-Proto": "https", host: "app.example.test" },
    body: STOP_PARAMS,
    originalUrl: "/api/twilio/sms/incoming?v=1",
    protocol: "http", // what Express reports behind TLS termination without trust proxy
  });
  const { reached } = await runGuard(req);
  assert.equal(reached, true);
});

// ── Wiring: the route in routes.ts must actually mount the guard ─────────────

test("POST /api/twilio/sms/incoming is registered behind requireTwilioSignature", async () => {
  const { findRouteRegistrations } = await import("../lib/route-guard-audit");
  const source = readFileSync(path.join(repoRoot, "server", "routes.ts"), "utf8");
  const route = findRouteRegistrations(source, "server/routes.ts").find(
    (r) => r.method === "post" && r.path === "/api/twilio/sms/incoming",
  );
  assert.ok(route, "the Twilio inbound SMS route must exist");
  assert.ok(
    route.guardNames.includes("requireTwilioSignature"),
    `expected requireTwilioSignature among middleware, got: ${route.guardNames.join(", ") || "(none)"}`,
  );
});
