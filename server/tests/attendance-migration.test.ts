import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "attendance-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|0010)_.*\.sql$/.test(name)))
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
const migrations = await import("../application-migrations");

async function poolFor(): Promise<pg.Pool> {
  const schema = `attendance_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema); await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}
async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations WHERE migration_id='0011_attendance_schema.sql'`)).rows[0].n;
}
after(async () => { for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); await rm(legacyDirectory,{recursive:true,force:true}); });

test("fresh, repeated, and three concurrent migrators formally own Attendance", async () => {
  const pool=await poolFor(); await Promise.all([1,2,3].map(()=>migrations.runApplicationMigrations(pool,{migrationsDirectory})));
  await migrations.runApplicationMigrations(pool,{migrationsDirectory});
  for (const table of ["attendance_programs","attendance_program_fields","attendance_reward_tiers","attendance_qr_codes","attendance_records","attendance_rewards_earned","attendance_email_history","attendance_report_recipients","attendance_report_email_history","session_attendance"])
    assert.equal((await pool.query("SELECT to_regclass($1) relation",[table])).rows[0].relation,table);
  assert.equal(await ledgerCount(pool),1); await pool.end();
});

test("compatible legacy report data is preserved", async () => {
  const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory:legacyDirectory});
  await pool.query(`CREATE TABLE attendance_report_recipients(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),org_id varchar NOT NULL,attendance_program_id varchar NOT NULL,coach_id varchar,email varchar NOT NULL,name varchar NOT NULL,receive_daily boolean NOT NULL DEFAULT true,receive_weekly boolean NOT NULL DEFAULT true,active boolean NOT NULL DEFAULT true,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now(),UNIQUE(attendance_program_id,email))`);
  await pool.query(`CREATE TABLE attendance_report_email_history(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),org_id varchar NOT NULL,attendance_program_id varchar NOT NULL,recipient_email varchar NOT NULL,report_type varchar NOT NULL,period_start date,period_end date,sent_at timestamp,status varchar NOT NULL DEFAULT 'sent',sendgrid_message_id varchar,error_message text,created_at timestamp DEFAULT now())`);
  await pool.query(`INSERT INTO attendance_report_recipients(org_id,attendance_program_id,email,name) VALUES('org-a','program-a','a@example.test','A')`);
  await pool.query(`INSERT INTO attendance_report_email_history(org_id,attendance_program_id,recipient_email,report_type) VALUES('org-a','program-a','a@example.test','daily')`);
  await migrations.runApplicationMigrations(pool,{migrationsDirectory});
  assert.equal((await pool.query(`SELECT count(*)::int n FROM attendance_report_recipients`)).rows[0].n,1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM attendance_report_email_history WHERE sendgrid_status_code IS NULL`)).rows[0].n,1); await pool.end();
});

test("partial, missing-column, type, and nullability drift fail transactionally; repair retries", async (t) => {
  const cases=[
    ["partial",`CREATE TABLE session_attendance(id varchar PRIMARY KEY)`],
    ["tenant type",`ALTER TABLE attendance_programs ALTER COLUMN organization_id TYPE text`],
    ["non-tenant type",`ALTER TABLE attendance_records ALTER COLUMN visit_number TYPE bigint`],
    ["required nullable",`ALTER TABLE attendance_records ALTER COLUMN athlete_email DROP NOT NULL`],
    ["optional required",`ALTER TABLE attendance_records ALTER COLUMN phone SET NOT NULL`],
  ] as const;
  for (const [name,mutation] of cases) await t.test(name,async()=>{ const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory:legacyDirectory}); await pool.query(mutation); await assert.rejects(migrations.runApplicationMigrations(pool,{migrationsDirectory}),/missing column|does not exist|contract mismatch/); assert.equal(await ledgerCount(pool),0); await pool.end(); });
  const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory:legacyDirectory}); await pool.query(`CREATE TABLE session_attendance(id varchar PRIMARY KEY)`); await assert.rejects(migrations.runApplicationMigrations(pool,{migrationsDirectory})); await pool.query(`DROP TABLE session_attendance`); await migrations.runApplicationMigrations(pool,{migrationsDirectory}); assert.equal(await ledgerCount(pool),1); await pool.end();
});

test("PK drift is rejected transactionally", async () => {
  const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory});
  await pool.query(`DELETE FROM train_efficiency_migrations WHERE migration_id='0011_attendance_schema.sql'`);
  await pool.query(`ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_pkey; ALTER TABLE session_attendance ADD PRIMARY KEY(booking_id,id)`);
  await assert.rejects(migrations.runApplicationMigrations(pool,{migrationsDirectory}),/PRIMARY KEY/);
  assert.equal(await ledgerCount(pool),0); await pool.end();
});

test("runtime validator contract declares PK, uniqueness, ordered partial indexes, and foreign keys", async () => {
  const source=await readFile(new URL("../attendance-schema-validation.ts",import.meta.url),"utf8");
  assert.match(source,/UNIQUE_KEYS/); assert.match(source,/booking_id,user_id/); assert.match(source,/user_id IS NOT NULL/);
  assert.match(source,/booking_id,participant_name/); assert.match(source,/FOREIGN_KEYS/); assert.match(source,/update_action/);
  assert.match(source,/indisprimary/); assert.match(source,/indisunique/); assert.match(source,/pg_get_expr/);
});

test("adversarial uniqueness/index/FK drift is rejected by runtime validation", async (t) => {
  const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory});
  const validation=await import("../attendance-schema-validation");
  const executor=drizzle(pool);
  await validation.validateAttendanceSchema(executor);
  const mutations=[
    `DROP TABLE attendance_report_email_history`,
    `ALTER TABLE attendance_report_recipients DROP COLUMN name`,
    `ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_pkey; ALTER TABLE session_attendance ADD PRIMARY KEY(booking_id,id)`,
    `ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_pkey; CREATE UNIQUE INDEX session_attendance_id_unique ON session_attendance(id)`,
    `DROP INDEX session_attendance_booking_user; CREATE UNIQUE INDEX session_attendance_booking_user ON session_attendance(user_id,booking_id) WHERE user_id IS NOT NULL`,
    `ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_booking_id_fkey`,
    `ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_booking_id_fkey; ALTER TABLE session_attendance ADD FOREIGN KEY(booking_id) REFERENCES users(id)`,
    `ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_booking_id_fkey; ALTER TABLE session_attendance ADD FOREIGN KEY(booking_id) REFERENCES bookings(id)`,
    `ALTER TABLE attendance_report_recipients DROP CONSTRAINT attendance_report_recipients_attendance_program_id_email_key; ALTER TABLE attendance_report_recipients ADD UNIQUE(email)`,
    `ALTER TABLE session_attendance ALTER COLUMN status SET DEFAULT 'absent'`,
  ];
  for (const mutation of mutations) await t.test(mutation.slice(0,30),async()=>{ await pool.query("BEGIN"); await pool.query(mutation); await assert.rejects(validation.validateAttendanceSchema(executor),validation.AttendanceSchemaUnavailableError); await pool.query("ROLLBACK"); });
  await pool.end();
});

test("session attendance identity is tenant-preserving and duplicate-safe", async () => {
  const pool=await poolFor(); await migrations.runApplicationMigrations(pool,{migrationsDirectory});
  await pool.query(`INSERT INTO organizations(id,name,slug) VALUES('org-a','A','a'),('org-b','B','b'); INSERT INTO users(id,email) VALUES('user-a','a@example.test'); INSERT INTO coach_profiles(id,user_id) VALUES('coach-a','user-a'); INSERT INTO services(id,name) VALUES('service','Attendance'); INSERT INTO bookings(id,client_id,coach_id,service_id,start_at,end_at,organization_id) VALUES('booking-a','user-a','coach-a','service',now(),now(),'org-a'),('booking-b','user-a','coach-a','service',now(),now(),'org-b')`);
  await pool.query(`INSERT INTO session_attendance(booking_id,user_id,organization_id) VALUES('booking-a','user-a','org-a'),('booking-b','user-a','org-b')`);
  await assert.rejects(pool.query(`INSERT INTO session_attendance(booking_id,user_id,organization_id) VALUES('booking-a','user-a','org-a')`),/duplicate key/);
  await pool.end();
});

test("runtime paths validate, never repair, and preserve public/auth middleware order", async () => {
  const attendance=await readFile(new URL("../attendance-routes.ts",import.meta.url),"utf8");
  const phase2=await readFile(new URL("../scheduling-phase2-routes.ts",import.meta.url),"utf8");
  const cron=await readFile(new URL("../attendance-report-cron.ts",import.meta.url),"utf8");
  for (const source of [attendance,phase2,cron]) assert.doesNotMatch(source,/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i);
  assert.match(attendance,/"\/api\/attendance\/checkin\/:slug", requireAttendanceSchema, async/);
  assert.match(attendance,/isAuthenticated, requireRole\("COACH", "ADMIN"\), requireAttendanceSchema, async/);
  assert.match(phase2,/"\/api\/scheduling\/attendance\/:bookingId", isAuthenticated, requireAttendanceSchema, async/);
  const { AttendanceSchemaUnavailableError,sendAttendanceSchemaUnavailable }=await import("../attendance-schema-validation");
  let code=0; let body:any; const response={status(n:number){code=n;return this;},json(v:any){body=v;return this;}};
  assert.equal(sendAttendanceSchemaUnavailable(new AttendanceSchemaUnavailableError(["secret.detail"]),response as any),true);
  assert.equal(code,503); assert.deepEqual(body,{message:"Attendance schema unavailable"}); assert.equal(JSON.stringify(body).includes("secret"),false);
});
