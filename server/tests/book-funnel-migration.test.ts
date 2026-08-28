import assert from "node:assert/strict";
import test, { after } from "node:test";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;
const { Pool } = pg;
const admin = new Pool({ connectionString });
const schemas: string[] = [];
const migrationsDirectory = new URL("../../migrations", import.meta.url).pathname;
const legacyDirectory = await mkdtemp(join(tmpdir(), "book-funnel-legacy-migrations-"));
for (const file of (await readdir(migrationsDirectory)).filter(name => /^(?:000\d|001[0-7])_.*\.sql$/.test(name))) {
  await copyFile(join(migrationsDirectory, file), join(legacyDirectory, file));
}
const migrations = await import("../application-migrations");
const validation = await import("../book-funnel-schema-validation");

async function poolFor(): Promise<pg.Pool> {
  const schema = `book_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
}
async function ledgerCount(pool: pg.Pool): Promise<number> {
  return (await pool.query(`SELECT count(*)::int n FROM train_efficiency_migrations
    WHERE migration_id='0018_book_funnel_schema.sql'`)).rows[0].n;
}
async function legacy(pool: pg.Pool): Promise<void> {
  await migrations.runApplicationMigrations(pool, { migrationsDirectory: legacyDirectory });
  await pool.query(`
    CREATE TABLE book_funnel_leads(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
      first_name text NOT NULL,last_name text,email text NOT NULL UNIQUE,source text DEFAULT 'book_landing',
      amazon_clicked_at timestamp,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
    CREATE TABLE book_funnel_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
      lead_id varchar REFERENCES book_funnel_leads(id) ON DELETE SET NULL,email text,event_type text NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb,created_at timestamp DEFAULT now());
    CREATE TABLE book_receipt_submissions(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
      lead_id varchar REFERENCES book_funnel_leads(id) ON DELETE SET NULL,email text NOT NULL,
      receipt_file_url text NOT NULL,original_filename text NOT NULL,mime_type text NOT NULL,file_size integer NOT NULL,
      status text NOT NULL DEFAULT 'pending_review',uploaded_at timestamp DEFAULT now(),created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now(),promo_code text UNIQUE);
  `);
}

const defaultDrifts = [
  {
    name: "status text containment",
    mutation: `ALTER TABLE book_receipt_submissions ALTER COLUMN status SET DEFAULT 'pending_review_later'`,
    repair: `ALTER TABLE book_receipt_submissions ALTER COLUMN status SET DEFAULT 'pending_review'`,
  },
  {
    name: "timestamp expression containment",
    mutation: `ALTER TABLE book_funnel_leads ALTER COLUMN created_at SET DEFAULT (now() + interval '1 day')`,
    repair: `ALTER TABLE book_funnel_leads ALTER COLUMN created_at SET DEFAULT now()`,
  },
  {
    name: "source text containment",
    mutation: `ALTER TABLE book_funnel_leads ALTER COLUMN source SET DEFAULT 'book_landing_extra'`,
    repair: `ALTER TABLE book_funnel_leads ALTER COLUMN source SET DEFAULT 'book_landing'`,
  },
  {
    name: "source text case change",
    mutation: `ALTER TABLE book_funnel_leads ALTER COLUMN source SET DEFAULT 'BOOK_LANDING'`,
    repair: `ALTER TABLE book_funnel_leads ALTER COLUMN source SET DEFAULT 'book_landing'`,
  },
  {
    name: "different JSONB value",
    mutation: `ALTER TABLE book_funnel_events ALTER COLUMN metadata SET DEFAULT '{"unexpected":true}'::jsonb`,
    repair: `ALTER TABLE book_funnel_events ALTER COLUMN metadata SET DEFAULT '{}'::jsonb`,
  },
  {
    name: "wrapped UUID generator",
    mutation: `ALTER TABLE book_funnel_leads ALTER COLUMN id SET DEFAULT coalesce(gen_random_uuid()::text, 'fallback')`,
    repair: `ALTER TABLE book_funnel_leads ALTER COLUMN id SET DEFAULT gen_random_uuid()::text`,
  },
] as const;

after(async () => {
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(legacyDirectory, { recursive: true, force: true });
});

test("fresh, repeated, and three concurrent migrators formally own Book Funnel", async () => {
  const pool = await poolFor();
  await Promise.all([1, 2, 3].map(() => migrations.runApplicationMigrations(pool, { migrationsDirectory })));
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateBookFunnelSchema(drizzle(pool));
  await pool.end();
});

test("compatible runtime-created legacy rows are preserved and nullable columns are adopted", async () => {
  const pool = await poolFor();
  await legacy(pool);
  const lead = (await pool.query(`INSERT INTO book_funnel_leads(first_name,email) VALUES('A','a@example.test') RETURNING id`)).rows[0];
  await pool.query(`INSERT INTO book_receipt_submissions(lead_id,email,receipt_file_url,original_filename,mime_type,file_size,promo_code)
    VALUES($1,'a@example.test','private/path','receipt.pdf','application/pdf',4,'TRAINCHAT')`, [lead.id]);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal((await pool.query(`SELECT count(*)::int n FROM book_funnel_leads`)).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM book_receipt_submissions`)).rows[0].n, 1);
  assert.equal(await ledgerCount(pool), 1);
  await validation.validateBookFunnelSchema(drizzle(pool));
  await pool.end();
});

test("incompatible legacy schema fails transactionally and repaired retry converges", async () => {
  const pool = await poolFor();
  await legacy(pool);
  await pool.query(`ALTER TABLE book_funnel_events ALTER COLUMN event_type TYPE varchar(20)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /Book Funnel column contract mismatch/);
  assert.equal(await ledgerCount(pool), 0);
  assert.equal((await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='book_receipt_submissions' AND column_name='utm_source'`)).rowCount, 0);
  await pool.query(`ALTER TABLE book_funnel_events ALTER COLUMN event_type TYPE text`);
  await migrations.runApplicationMigrations(pool, { migrationsDirectory });
  assert.equal(await ledgerCount(pool), 1);
  await pool.end();
});

test("noncanonical legacy defaults fail atomically and repaired retry converges", async t => {
  for (const drift of defaultDrifts) await t.test(drift.name, async () => {
    const pool = await poolFor();
    await legacy(pool);
    await pool.query(`INSERT INTO book_funnel_leads(first_name,email) VALUES('Preserved','preserved@example.test')`);
    await pool.query(drift.mutation);
    await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /Book Funnel column contract mismatch/);
    assert.equal(await ledgerCount(pool), 0);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM book_funnel_leads`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='book_receipt_submissions' AND column_name='utm_source'`)).rowCount, 0);
    await pool.query(drift.repair);
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    assert.equal(await ledgerCount(pool), 1);
    await validation.validateBookFunnelSchema(drizzle(pool));
    await pool.end();
  });
});

test("ambiguous legacy promo constraint fails without ledger advancement", async () => {
  const pool = await poolFor();
  await legacy(pool);
  await pool.query(`ALTER TABLE book_receipt_submissions DROP CONSTRAINT book_receipt_submissions_promo_code_key;
    ALTER TABLE book_receipt_submissions ADD CONSTRAINT book_receipt_submissions_promo_code_key UNIQUE(email,promo_code)`);
  await assert.rejects(migrations.runApplicationMigrations(pool, { migrationsDirectory }), /promo constraint is ambiguous/);
  assert.equal(await ledgerCount(pool), 0);
  await pool.end();
});

test("runtime validator rejects representative drift and performs no repair", async t => {
  const mutations = [
    `DROP TABLE book_funnel_events`,
    `ALTER TABLE book_receipt_submissions DROP COLUMN utm_source`,
    `ALTER TABLE book_receipt_submissions ALTER COLUMN file_size TYPE bigint`,
    `ALTER TABLE book_receipt_submissions ALTER COLUMN id TYPE varchar(20)`,
    `ALTER TABLE book_funnel_leads ALTER COLUMN first_name DROP NOT NULL`,
    `ALTER TABLE book_funnel_leads ALTER COLUMN last_name SET NOT NULL`,
    `ALTER TABLE book_receipt_submissions ALTER COLUMN status SET DEFAULT 'approved'`,
    ...defaultDrifts.map(drift => drift.mutation),
    `ALTER TABLE book_funnel_leads DROP CONSTRAINT book_funnel_leads_pkey CASCADE; ALTER TABLE book_funnel_leads ADD PRIMARY KEY(id,email)`,
    `ALTER TABLE book_receipt_submissions DROP CONSTRAINT book_receipt_submissions_pkey; CREATE UNIQUE INDEX book_receipt_submissions_id_unique ON book_receipt_submissions(id)`,
    `ALTER TABLE book_funnel_events DROP CONSTRAINT book_funnel_events_lead_id_fkey`,
    `ALTER TABLE book_funnel_events DROP CONSTRAINT book_funnel_events_lead_id_fkey; ALTER TABLE book_funnel_events ADD FOREIGN KEY(lead_id) REFERENCES book_receipt_submissions(id) ON DELETE SET NULL`,
    `ALTER TABLE book_funnel_events DROP CONSTRAINT book_funnel_events_lead_id_fkey; ALTER TABLE book_funnel_events ADD FOREIGN KEY(lead_id) REFERENCES book_funnel_leads(id) ON DELETE CASCADE`,
    `ALTER TABLE book_funnel_leads DROP CONSTRAINT book_funnel_leads_email_key`,
    `CREATE UNIQUE INDEX book_receipt_submissions_promo_unique ON book_receipt_submissions(promo_code)`,
  ];
  for (const mutation of mutations) await t.test(mutation.slice(0, 44), async () => {
    const pool = await poolFor();
    await migrations.runApplicationMigrations(pool, { migrationsDirectory });
    await pool.query(mutation);
    await assert.rejects(validation.validateBookFunnelSchema(drizzle(pool)), validation.BookFunnelSchemaUnavailableError);
    await assert.rejects(validation.validateBookFunnelSchema(drizzle(pool)), validation.BookFunnelSchemaUnavailableError);
    if (mutation.includes("SET DEFAULT")) {
      const [table, column] = mutation.match(/ALTER TABLE (\w+) ALTER COLUMN (\w+)/)!.slice(1);
      assert.ok((await pool.query(`SELECT column_default FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2`, [table, column])).rows[0].column_default);
    }
    await pool.end();
  });
});

test("default drift returns safe 503 before any public Book Funnel behavior", async t => {
  await migrations.runApplicationMigrations(admin, { migrationsDirectory });
  await admin.query(`ALTER TABLE book_receipt_submissions ALTER COLUMN status SET DEFAULT 'pending_review_later'`);
  const { registerBookFunnelRoutes } = await import("../book-funnel-routes");
  const app = express();
  app.use(express.json());
  await registerBookFunnelRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const requests = [
    ["POST /api/book-funnel/leads", "/api/book-funnel/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: "A", email: "a@example.test" }) }],
    ["POST /api/book-funnel/events", "/api/book-funnel/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: "view" }) }],
    ["POST /api/book-funnel/receipt", "/api/book-funnel/receipt", { method: "POST", body: new FormData() }],
    ["GET /api/book-funnel/receipt/:id", "/api/book-funnel/receipt/not-run", {}],
    ["POST /api/book-funnel/initiate-checkout", "/api/book-funnel/initiate-checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }],
  ] as const;
  try {
    for (const [name, path, init] of requests) await t.test(name, async () => {
      const response = await fetch(`${base}${path}`, init);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { message: "Book Funnel unavailable" });
    });
    assert.equal((await admin.query(`SELECT count(*)::int n FROM book_funnel_leads`)).rows[0].n, 0);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM book_funnel_events`)).rows[0].n, 0);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM book_receipt_submissions`)).rows[0].n, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("empty schema validation fails closed without creating tables", async () => {
  const pool = await poolFor();
  await assert.rejects(validation.validateBookFunnelSchema(drizzle(pool)), validation.BookFunnelSchemaUnavailableError);
  for (const table of ["book_funnel_leads", "book_funnel_events", "book_receipt_submissions"]) {
    assert.equal((await pool.query(`SELECT to_regclass($1) relation`, [table])).rows[0].relation, null);
  }
  await pool.end();
});

test("runtime source contains no structural DDL and gates every public side-effect route", async () => {
  const source = await readFile(new URL("../book-funnel-routes.ts", import.meta.url), "utf8");
  const validator = await readFile(new URL("../book-funnel-schema-validation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP CONSTRAINT|ADD COLUMN/i);
  assert.doesNotMatch(validator, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE|ADD COLUMN/i);
  assert.match(source, /"\/api\/book-funnel\/leads", requireBookFunnelSchema/);
  assert.match(source, /"\/api\/book-funnel\/events", requireBookFunnelSchema/);
  assert.match(source, /"\/api\/book-funnel\/receipt",\s*requireBookFunnelSchema/);
  assert.match(source, /"\/api\/book-funnel\/receipt\/:submissionId", requireBookFunnelSchema/);
  assert.match(source, /"\/api\/book-funnel\/initiate-checkout", requireBookFunnelSchema/);
  assert.match(validator, /status\(503\)\.json\(\{ message: "Book Funnel unavailable" \}\)/);
});
