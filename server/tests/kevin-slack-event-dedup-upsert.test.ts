import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

/**
 * Slack replay protection.
 *
 * server/kevin-slack/conversation-state.ts wrote
 *
 *   INSERT INTO kevin_slack_event_dedup (event_id, team_id)
 *   VALUES (...) ON CONFLICT (event_id) DO NOTHING
 *
 * but the table's key is the COMPOSITE primary key (event_id, team_id) —
 * deliberately so, per migrations/0002_kevin_slack_tables.sql, because a
 * single-column key would let one workspace's event id suppress another's.
 * `ON CONFLICT (event_id)` therefore matched no unique index and Postgres
 * raised 42P10 on every call. markEventSeen catches and logs, so the insert
 * failed silently: nothing was ever recorded and isEventDuplicate always
 * returned false, meaning Slack retries were re-processed every time.
 */

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { runApplicationMigrations } = await import("../application-migrations");
const { isEventDuplicate, markEventSeen } = await import("../kevin-slack/conversation-state");
const { pool: appPool } = await import("../db");

const teamA = `T-${randomUUID().slice(0, 8)}`;
const teamB = `T-${randomUUID().slice(0, 8)}`;
const captured: string[] = [];
const originalError = console.error;

async function dedupRows(eventId: string) {
  const result = await pool.query(
    `SELECT event_id, team_id FROM kevin_slack_event_dedup WHERE event_id = $1 ORDER BY team_id`,
    [eventId],
  );
  return result.rows;
}

before(async () => {
  // kevin_slack_event_dedup lives only in migrations/*.sql, not shared/schema.ts.
  await runApplicationMigrations(appPool as any);
  await pool.query(`DELETE FROM kevin_slack_event_dedup WHERE team_id = ANY($1)`, [[teamA, teamB]]);
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
    originalError(...args);
  };
});

after(async () => {
  console.error = originalError;
  await pool.query(`DELETE FROM kevin_slack_event_dedup WHERE team_id = ANY($1)`, [[teamA, teamB]]);
  await pool.end();
  await appPool.end();
});

test("the dedup key is the composite primary key (event_id, team_id)", async () => {
  const index = await pool.query(
    `SELECT pg_get_indexdef(ix.indexrelid) AS def
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'kevin_slack_event_dedup' AND ix.indisprimary`,
  );
  assert.equal(index.rows.length, 1);
  assert.match(index.rows[0].def, /\(event_id, team_id\)/);
});

test("markEventSeen records the event, so the retry is recognised as a duplicate", async () => {
  const eventId = `Ev-${randomUUID()}`;
  assert.equal(await isEventDuplicate(eventId, teamA), false, "unseen event must not be a duplicate");

  await markEventSeen(eventId, teamA);

  assert.deepEqual(await dedupRows(eventId), [{ event_id: eventId, team_id: teamA }]);
  assert.equal(await isEventDuplicate(eventId, teamA), true, "Slack's retry must be deduped");
  assert.deepEqual(captured.filter((line) => line.includes("[Kevin Slack]")), []);
});

test("the same delivery twice leaves one row and raises nothing", async () => {
  const eventId = `Ev-${randomUUID()}`;
  await markEventSeen(eventId, teamA);
  await markEventSeen(eventId, teamA);

  assert.deepEqual(await dedupRows(eventId), [{ event_id: eventId, team_id: teamA }]);
  assert.deepEqual(captured.filter((line) => line.includes("[Kevin Slack]")), []);
});

test("one workspace's event id never suppresses another workspace's", async () => {
  const eventId = `Ev-${randomUUID()}`;
  await markEventSeen(eventId, teamA);

  assert.equal(await isEventDuplicate(eventId, teamB), false, "team B has not seen this event");
  await markEventSeen(eventId, teamB);

  assert.deepEqual(
    (await dedupRows(eventId)).map((row) => row.team_id).sort(),
    [teamA, teamB].sort(),
    "both workspaces must hold their own dedup record",
  );
  assert.deepEqual(captured.filter((line) => line.includes("[Kevin Slack]")), []);
});
