import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
process.env.KEVIN_SLACK_ENABLED = "true";
process.env.KEVIN_SLACK_DIGESTS_ENABLED = "true";

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { storage } = await import("../storage");
const { requireRole } = await import("../lib/require-role");
const {
  createOrUpdateMappingForOrganization,
  listMappingsForOrg,
  revokeMappingForOrganization,
  verifyMappingForOrganization,
} = await import("../kevin-slack/identity-service");
const { getRecentAuditEvents, getAuditStats } = await import("../kevin-slack/audit-service");
const { getDigestStats, sendDailyDigestForOrganization } = await import("../kevin-slack/digest-service");
const { getKevinSlackTargetForOrganization } = await import("../kevin-slack/target-service");
const routesSource = await readFile(new URL("../kevin-slack-routes.ts", import.meta.url), "utf8");

async function mapping(id: string) {
  const result = await pool.query(
    "SELECT org_id,mapping_status,linked_by FROM kevin_slack_identity_mappings WHERE id=$1",
    [id],
  );
  return result.rows[0];
}

before(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS kevin_slack_notification_log,kevin_slack_digest_runs,kevin_slack_action_audit,
      kevin_slack_identity_mappings,external_integrations,user_profiles,users CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('CLIENT','COACH','ADMIN','STAFF');
    CREATE TABLE users (id varchar PRIMARY KEY,email varchar,first_name varchar,last_name varchar);
    CREATE TABLE user_profiles (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL REFERENCES users(id),
      role user_role NOT NULL DEFAULT 'CLIENT',organization_id varchar
    );
    CREATE TABLE external_integrations (
      id text PRIMARY KEY,org_id text NOT NULL,integration_type text NOT NULL,status text NOT NULL DEFAULT 'disconnected',
      display_name text,auth_type text NOT NULL DEFAULT 'api_key',encrypted_credentials jsonb DEFAULT '{}',scopes jsonb DEFAULT '[]',
      last_health_check_at timestamp,last_successful_action_at timestamp,last_failure_at timestamp,last_failure_reason text,
      rate_limit_state jsonb DEFAULT '{}',usage_stats jsonb DEFAULT '{}',governance_restrictions jsonb DEFAULT '{}',
      enabled_agents jsonb DEFAULT '[]',enabled_tools jsonb DEFAULT '[]',created_by text,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now()
    );
    CREATE TABLE kevin_slack_identity_mappings (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,slack_team_id text NOT NULL,slack_enterprise_id text,
      slack_user_id text NOT NULL,trainefficiency_user_id text NOT NULL,org_id text NOT NULL,
      mapping_status text NOT NULL DEFAULT 'pending',linked_by text,linked_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,last_verified_at timestamptz,UNIQUE(slack_team_id,slack_user_id)
    );
    CREATE TABLE kevin_slack_action_audit (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,slack_team_id text NOT NULL,slack_user_id text NOT NULL,
      trainefficiency_user_id text,org_id text,intent text NOT NULL DEFAULT 'unknown',requested_operation text NOT NULL,
      authorization_result text NOT NULL DEFAULT 'not_resolved',confirmation_result text NOT NULL DEFAULT 'pending',
      execution_result text NOT NULL DEFAULT 'pending',outcome text NOT NULL DEFAULT 'ignored',trace_id text NOT NULL,
      error_message text,created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE kevin_slack_digest_runs (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text NOT NULL,digest_type text NOT NULL,
      period_key text NOT NULL,channel text NOT NULL,sent_at timestamptz,status text NOT NULL DEFAULT 'pending',
      error_msg text,UNIQUE(org_id,digest_type,period_key)
    );
    CREATE TABLE kevin_slack_notification_log (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,org_id text,slack_team_id text NOT NULL,channel text NOT NULL,
      priority text NOT NULL,event_type text NOT NULL,dedup_key text,sent_at timestamptz NOT NULL DEFAULT now(),
      delivery_status text NOT NULL DEFAULT 'sent',error_message text
    );
  `);
});

beforeEach(async () => {
  await pool.query(`TRUNCATE kevin_slack_notification_log,kevin_slack_digest_runs,kevin_slack_action_audit,
    kevin_slack_identity_mappings,external_integrations,user_profiles,users CASCADE`);
  await pool.query(`INSERT INTO users(id,email,first_name) VALUES
    ('admin-a','admin-a@test.invalid','Admin A'),('admin-b','admin-b@test.invalid','Admin B'),
    ('admin-none','admin-none@test.invalid','No Org'),('coach-a','coach-a@test.invalid','Coach A'),
    ('staff-a','staff-a@test.invalid','Staff A'),('client-a','client-a@test.invalid','Client A'),
    ('user-a','user-a@test.invalid','User A'),('user-b','user-b@test.invalid','User B')`);
  await pool.query(`INSERT INTO user_profiles(user_id,role,organization_id) VALUES
    ('admin-a','ADMIN','org-a'),('admin-b','ADMIN','org-b'),('admin-none','ADMIN',NULL),
    ('coach-a','COACH','org-a'),('staff-a','STAFF','org-a'),('client-a','CLIENT','org-a'),
    ('user-a','CLIENT','org-a'),('user-b','CLIENT','org-b')`);
  await pool.query(`INSERT INTO external_integrations(id,org_id,integration_type,status,encrypted_credentials) VALUES
    ('slack-a','org-a','slack','connected','{"botToken":"token-a","teamId":"team-a","defaultChannel":"channel-a"}'),
    ('slack-b','org-b','slack','connected','{"botToken":"token-b","teamId":"team-b","defaultChannel":"channel-b"}')`);
  await pool.query(`INSERT INTO kevin_slack_identity_mappings
    (id,slack_team_id,slack_user_id,trainefficiency_user_id,org_id,mapping_status,linked_by) VALUES
    ('mapping-a','team-a','slack-user-a','user-a','org-a','verified','admin-a'),
    ('mapping-b','team-b','slack-user-b','user-b','org-b','verified','admin-b')`);
});

after(async () => { await pool.end(); });

test("same-organization ADMIN can create a mapping for an owned user", async () => {
  const result = await createOrUpdateMappingForOrganization("org-a", {
    slackTeamId: "team-a", slackUserId: "new-a", trainefficiencyUserId: "user-a", linkedBy: "admin-a", status: "verified",
  });
  assert.equal(result?.orgId, "org-a");
  assert.equal(result?.trainefficiencyUserId, "user-a");
});

test("Org A cannot map an Org B TrainEfficiency user", async () => {
  const result = await createOrUpdateMappingForOrganization("org-a", {
    slackTeamId: "team-a", slackUserId: "cross-user", trainefficiencyUserId: "user-b", linkedBy: "admin-a", status: "verified",
  });
  assert.equal(result, null);
  assert.equal((await pool.query("SELECT count(*)::int n FROM kevin_slack_identity_mappings WHERE slack_user_id='cross-user'")).rows[0].n, 0);
});

test("Org A cannot take over an Org B Slack object identity", async () => {
  const result = await createOrUpdateMappingForOrganization("org-a", {
    slackTeamId: "team-b", slackUserId: "slack-user-b", trainefficiencyUserId: "user-a", linkedBy: "admin-a", status: "verified",
  });
  assert.equal(result, null);
  assert.deepEqual(await mapping("mapping-b"), { org_id: "org-b", mapping_status: "verified", linked_by: "admin-b" });
});

test("direct Org A verify cannot mutate Org B mapping", async () => {
  assert.equal(await verifyMappingForOrganization("org-a", "mapping-b", "admin-a"), false);
  assert.deepEqual(await mapping("mapping-b"), { org_id: "org-b", mapping_status: "verified", linked_by: "admin-b" });
});

test("direct Org A revoke cannot mutate Org B mapping", async () => {
  assert.equal(await revokeMappingForOrganization("org-a", "mapping-b", "admin-a"), false);
  assert.deepEqual(await mapping("mapping-b"), { org_id: "org-b", mapping_status: "verified", linked_by: "admin-b" });
});

test("same-organization verify and revoke lifecycle remains available", async () => {
  await pool.query("UPDATE kevin_slack_identity_mappings SET mapping_status='pending' WHERE id='mapping-a'");
  assert.equal(await verifyMappingForOrganization("org-a", "mapping-a", "admin-a"), true);
  assert.equal((await mapping("mapping-a")).mapping_status, "verified");
  assert.equal(await revokeMappingForOrganization("org-a", "mapping-a", "admin-a"), true);
  assert.equal((await mapping("mapping-a")).mapping_status, "revoked");
});

test("mapping list is tenant isolated", async () => {
  assert.deepEqual((await listMappingsForOrg("org-a")).map((row) => row.id), ["mapping-a"]);
  assert.deepEqual((await listMappingsForOrg("org-b")).map((row) => row.id), ["mapping-b"]);
});

test("audit list and diagnostics stats are tenant isolated", async () => {
  await pool.query(`INSERT INTO kevin_slack_action_audit
    (slack_team_id,slack_user_id,org_id,requested_operation,authorization_result,confirmation_result,execution_result,outcome,trace_id)
    VALUES ('team-a','a','org-a','test','allowed','confirmed','success','executed','trace-a'),
           ('team-b','b','org-b','test','denied','pending','skipped','blocked_cross_org','trace-b')`);
  assert.deepEqual((await getRecentAuditEvents("org-a")).map((row) => row.traceId), ["trace-a"]);
  assert.deepEqual(await getAuditStats("org-a"), { totalInteractions: 1, successRate: 100, blockedCount: 0, last24hCount: 1 });
});

test("digest diagnostics are tenant isolated", async () => {
  await pool.query(`INSERT INTO kevin_slack_digest_runs(org_id,digest_type,period_key,channel,sent_at,status) VALUES
    ('org-a','daily','a','channel-a',now(),'sent'),('org-b','daily','b','channel-b',now(),'failed')`);
  assert.deepEqual(await getDigestStats("org-a"), { totalSent: 1, last7Days: 1, failedCount: 0 });
});

test("provider target comes only from the actor organization's persisted integration", async () => {
  const target = await getKevinSlackTargetForOrganization("org-a");
  assert.deepEqual(target, { integrationId: "slack-a", orgId: "org-a", teamId: "team-a", channel: "channel-a", botToken: "token-a" });
});

test("same-org digest sends only to persisted Org A target", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { json: async () => ({ ok: true, ts: "1" }) } as any;
  };
  try {
    assert.deepEqual(await sendDailyDigestForOrganization("org-a"), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal((calls[0].init.headers as any).Authorization, "Bearer token-a");
    assert.equal(JSON.parse(String(calls[0].init.body)).channel, "channel-a");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown organization produces no provider call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return {} as any; };
  try {
    assert.deepEqual(await sendDailyDigestForOrganization("missing"), { ok: false, error: "Slack integration not configured for organization" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("integration lookup DB failure occurs before provider call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return {} as any; };
  await pool.query("ALTER TABLE external_integrations RENAME TO external_integrations_unavailable");
  try {
    await assert.rejects(sendDailyDigestForOrganization("org-a"));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await pool.query("ALTER TABLE external_integrations_unavailable RENAME TO external_integrations");
  }
});

test("concurrent legitimate and cross-tenant mapping mutations remain isolated", async () => {
  const [owned, denied] = await Promise.all([
    revokeMappingForOrganization("org-b", "mapping-b", "admin-b"),
    revokeMappingForOrganization("org-a", "mapping-b", "admin-a"),
  ]);
  assert.equal(owned, true);
  assert.equal(denied, false);
  assert.deepEqual(await mapping("mapping-b"), { org_id: "org-b", mapping_status: "revoked", linked_by: "admin-b" });
});

test("all Kevin Slack administration surfaces require ADMIN and trusted org middleware", () => {
  const declarations = [...routesSource.matchAll(/app\.(get|post)\(\s*"(\/api\/(?:admin|internal)\/kevin-slack\/[^\"]+)"([\s\S]*?)\n\s*\);/g)];
  assert.equal(declarations.length, 9);
  for (const declaration of declarations) {
    assert.match(declaration[3], /isAuthenticated/);
    assert.match(declaration[3], /requireRole\("ADMIN"\)/);
    assert.match(declaration[3], /requireKevinSlackAdminOrganization/);
  }
});

test("admin routes never derive org or provider targets from body/query", () => {
  const start = routesSource.indexOf('// ── GET /api/admin/kevin-slack/config');
  const adminRoutes = routesSource.slice(start);
  assert.doesNotMatch(adminRoutes, /req\.(body|query)\.(orgId|organizationId|tenantId|teamId|workspaceId|channel|channelId)/);
  assert.doesNotMatch(adminRoutes, /\{[^}]*\b(orgId|organizationId|tenantId|teamId|workspaceId|channel|channelId)\b[^}]*\}\s*=\s*req\.body/);
});

test("actual role middleware allows ADMIN and denies COACH/STAFF/CLIENT/unauthenticated", async () => {
  const original = storage.getUserProfile.bind(storage);
  const invoke = async (role: "ADMIN" | "COACH" | "STAFF" | "CLIENT" | null) => {
    (storage as any).getUserProfile = async () => role ? ({ role } as any) : undefined;
    let status = 200;
    let nextCalls = 0;
    const req = role === null ? {} : { user: { id: `${role.toLowerCase()}-a` } };
    const res = { status(code: number) { status = code; return this; }, json() { return this; } };
    await requireRole("ADMIN")(req, res, () => { nextCalls++; });
    return { status, nextCalls };
  };
  try {
    assert.deepEqual(await invoke("ADMIN"), { status: 200, nextCalls: 1 });
    assert.deepEqual(await invoke("COACH"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke("STAFF"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke("CLIENT"), { status: 403, nextCalls: 0 });
    assert.deepEqual(await invoke(null), { status: 401, nextCalls: 0 });
  } finally {
    (storage as any).getUserProfile = original;
  }
});

test("missing actor org is fail-closed before every admin operation", () => {
  assert.match(routesSource, /req\.kevinSlackOrgId = await resolveOrgIdOrThrow\(req\)/);
  assert.match(routesSource, /handleOrgError\(error, res\)/);
});
