import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const manifest = JSON.parse(
  readFileSync(new URL("../config/test-suites.json", import.meta.url), "utf8"),
);
const requested = process.argv[2] ?? "default";
const knownSuites = new Set(Object.keys(manifest.suites));
const sentinelDatabaseUrl = "postgres://test:test@127.0.0.1:1/no_database_access";
// Some modules construct provider clients at import time, so a wiring test cannot
// even import them without a key. A sentinel satisfies construction and makes any
// real call fail loudly — and stops a developer's own key being used by a test run.
const sentinelOpenAiKey = "sk-test-sentinel-tests-must-not-call-openai";

function filesFor(suite) {
  return [...new Set(manifest.inventory
    .filter((entry) => entry.suites.includes(suite))
    .flatMap((entry) => entry.files))];
}

function unavailable(suite, reason) {
  console.log(`\nENVIRONMENT NOT AVAILABLE — ${suite}: ${reason}`);
  return 2;
}

function suiteHeader(suite, log = console.log) {
  const metadata = manifest.suites[suite];
  log(`\n=== ${suite.toUpperCase()} ===`);
  log(metadata.description);
  log(`mutation: ${metadata.mutating ? "allowed against test infrastructure" : "none"}`);
}

function runNodeTests(suite, env = {}) {
  const files = filesFor(suite);
  suiteHeader(suite);

  // node --test runs files in parallel by default. Suites the manifest marks
  // serial must not, so pin concurrency for them.
  const concurrency = manifest.suites[suite].serial ? ["--test-concurrency=1"] : [];

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...concurrency, ...files],
    {
      stdio: "inherit",
      env: { ...process.env, ...env },
    },
  );
  if (result.error) {
    console.error(`FAIL — ${suite}: ${result.error.message}`);
    return 1;
  }
  if (result.status === 0) {
    console.log(`PASS — ${suite}`);
    return 0;
  }
  console.error(`FAIL — ${suite} (exit ${result.status ?? "unknown"})`);
  return result.status ?? 1;
}

/* ------------------------------------------------------------------ *
 * db suite: one throwaway clone database per test file
 *
 * Every db file used to run against the one database named by
 * TEST_DATABASE_URL, and 21 of them execute destructive DDL to build the
 * tables they assert on. server/tests/cashout-tenant-isolation.test.ts:38
 * runs `DROP TABLE IF EXISTS revenue_ledger_events,cashouts,coach_profiles,
 * user_profiles,users CASCADE`, and CASCADE also removes the foreign keys on
 * bookings, booking_participants, availability_blocks and blocked_times. Every
 * later file that calls runApplicationMigrations() then dies inside
 * validateExistingBaseline. Serial execution ordered the damage; it did not
 * prevent it.
 *
 * So the database named by TEST_DATABASE_URL is now only a TEMPLATE — built
 * once by `drizzle-kit push` — and each file gets `CREATE DATABASE <tpl>_f<N>
 * TEMPLATE <tpl>`, its own child process, and a `DROP DATABASE ... WITH
 * (FORCE)` afterwards. Each file is also run directly rather than under
 * `node --test`, which removes the supervisor process whose stream parser
 * raises "Unable to deserialize cloned data due to invalid or unsupported
 * version" — see runTestFile below.
 * ------------------------------------------------------------------ */

// Postgres truncates identifiers at 63 bytes, which would collide two clones
// of a long template name onto one database.
const cloneSuffixBudget = 8;
const maxTemplateNameInClone = 63 - cloneSuffixBudget;

function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function databaseNameOf(connectionString) {
  const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  if (!name) throw new Error(`TEST_DATABASE_URL names no database: ${connectionString}`);
  return name;
}

function connectionStringFor(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

function cloneNameFor(template, index) {
  const base = template.length > maxTemplateNameInClone
    ? template.slice(0, maxTemplateNameInClone)
    : template;
  return `${base}_f${index}`;
}

const importPgDefault = () => import("pg");

async function openClient(importPg, connectionString) {
  const { default: pg } = await importPg();
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * CREATE DATABASE ... TEMPLATE refuses to run while anything else is connected
 * to the template, so the runner must not hold a connection to it while
 * cloning. This opens one, counts tables, and closes it before any clone.
 */
async function inspectTemplate(importPg, templateUrl) {
  const client = await openClient(importPg, templateUrl);
  try {
    const result = await client.query(
      `SELECT count(*)::int AS tables
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
    );
    return { tables: result.rows[0].tables };
  } finally {
    await client.end();
  }
}

// 55006 = object_in_use: "source database is being accessed by other users".
async function terminateOwnTemplateSessions(maintenance, template) {
  const result = await maintenance.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid() AND usename = current_user`,
    [template],
  );
  return result.rowCount ?? 0;
}

async function createClone(maintenance, template, clone, log = console.log) {
  await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(clone)} WITH (FORCE)`);
  const create = `CREATE DATABASE ${quoteIdentifier(clone)} TEMPLATE ${quoteIdentifier(template)}`;
  try {
    await maintenance.query(create);
  } catch (error) {
    if (error?.code !== "55006") throw error;
    // Only ever terminate sessions this runner's own role owns: a shared server
    // may have other people's connections, and they are not ours to drop.
    const terminated = await terminateOwnTemplateSessions(maintenance, template);
    log(`note: template ${template} was busy; terminated ${terminated} session(s) owned by this role`);
    await maintenance.query(create);
  }
}

async function dropClone(maintenance, clone) {
  await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(clone)} WITH (FORCE)`);
}

/**
 * Runs the file directly — `node --import tsx <file>` — rather than through
 * `node --test <file>`. node:test executes the tests either way and sets a
 * non-zero exit code on failure, but `--test` makes this process a supervisor
 * that spawns the file in yet another child and parses a serialized stream back
 * from it. That parser is where Node's "Unable to deserialize cloned data due
 * to invalid or unsupported version" comes from — it surfaced on Node 20 in
 * #proccessRawBuffer (node:internal/test_runner/runner) and failed
 * stripe-webhook.test.ts in CI *after* all 15 of its subtests had passed.
 * Running the file directly removes that layer, so there is nothing to
 * mis-parse.
 */
function runTestFile(file, env, capture) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", file],
      { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", env: { ...process.env, ...env } },
    );
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
    }
    child.on("error", (error) => resolve({ status: 1, output, error }));
    child.on("close", (status, signal) => resolve({
      status: status ?? (signal ? 1 : 0),
      output,
      signal,
    }));
  });
}

/**
 * Runs `worker` over `items` with at most `jobs` in flight, preserving result
 * order. `jobs` is 1 today — the db suite is declared serial — but the per-file
 * database means nothing in the design requires it to stay 1.
 */
async function runWithJobs(items, jobs, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, lane));
  return results;
}

/**
 * Every collaborator is injectable so server/tests/test-manifest-integrity.test.ts
 * can drive the real clone/spawn/drop sequence against a stub pg client.
 */
export async function runDbSuiteForTests(options) {
  return runDbSuite(options);
}

async function runDbSuite({
  jobs = 1,
  files = filesFor("db"),
  templateUrl = process.env.TEST_DATABASE_URL,
  importPg = importPgDefault,
  spawnTestFile = runTestFile,
  log = console.log,
  logError = console.error,
} = {}) {
  const suite = "db";
  const template = databaseNameOf(templateUrl);
  suiteHeader(suite, log);

  let inspection;
  try {
    inspection = await inspectTemplate(importPg, templateUrl);
  } catch (error) {
    logError(`FAIL — ${suite}: cannot connect to the template database ${template}: ${error.message}`);
    return 1;
  }
  if (inspection.tables === 0) {
    logError(
      `FAIL — ${suite}: the template database ${template} has no tables. Build its schema first:\n` +
      `  DATABASE_URL="$TEST_DATABASE_URL" node ./node_modules/drizzle-kit/bin.cjs push --force`,
    );
    return 1;
  }

  let maintenance;
  try {
    maintenance = await openClient(importPg, connectionStringFor(templateUrl, "postgres"));
  } catch (error) {
    logError(
      `FAIL — ${suite}: cannot connect to the "postgres" maintenance database, which is required ` +
      `to create a per-file clone of ${template}: ${error.message}`,
    );
    return 1;
  }

  log(
    `isolation: one clone database per file (CREATE DATABASE <clone> TEMPLATE ${template}), ` +
    `${files.length} files, ${jobs} at a time`,
  );

  const live = new Set();
  let suiteStatus = 0;
  const onSignal = () => { process.exitCode = 130; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const outcomes = await runWithJobs(files, jobs, async (file, index) => {
      const clone = cloneNameFor(template, index + 1);
      try {
        await createClone(maintenance, template, clone, log);
      } catch (error) {
        logError(`FAIL — ${suite} ${file}: could not clone ${template} into ${clone}: ${error.message}`);
        return 1;
      }
      live.add(clone);
      const cloneUrl = connectionStringFor(templateUrl, clone);
      if (jobs === 1) log(`\n--- ${file} (database ${clone})`);
      try {
        const result = await spawnTestFile(file, {
          DATABASE_URL: cloneUrl,
          TEST_DATABASE_URL: cloneUrl,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? sentinelOpenAiKey,
        }, jobs !== 1);
        if (jobs !== 1) {
          log(`\n--- ${file} (database ${clone})`);
          process.stdout.write(result.output ?? "");
        }
        if (result.error) {
          logError(`  FAIL — ${suite} ${file}: ${result.error.message}`);
          return 1;
        }
        if (result.status === 0) {
          log(`  PASS — ${suite} ${file}`);
          return 0;
        }
        logError(`  FAIL — ${suite} ${file} (exit ${result.status})`);
        return result.status;
      } finally {
        try {
          await dropClone(maintenance, clone);
          live.delete(clone);
        } catch (error) {
          logError(`  warning: could not drop ${clone}: ${error.message}`);
        }
      }
    });
    suiteStatus = outcomes.find((status) => status !== 0) ?? 0;
  } finally {
    for (const clone of live) {
      await dropClone(maintenance, clone).catch(() => undefined);
    }
    await maintenance.end().catch(() => undefined);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  if (suiteStatus === 0) {
    log(`PASS — ${suite}`);
    return 0;
  }
  logError(`FAIL — ${suite} (exit ${suiteStatus})`);
  return suiteStatus;
}

async function checkServer(baseUrl) {
  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

function requestedJobs() {
  const flag = process.argv.slice(3).find((argument) => argument.startsWith("--jobs"));
  if (!flag) return 1;
  const raw = flag.includes("=") ? flag.split("=")[1] : process.argv[process.argv.indexOf(flag) + 1];
  const jobs = Number(raw);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs expects a positive integer, got ${raw}`);
  return jobs;
}

async function run(suite, allowUnavailable = false) {
  let status;
  if (suite === "default" || suite === "unit" || suite === "security") {
    // Import-only tests may load server/db.ts. Never inherit a real DB URL into a
    // safe suite; an accidental query must fail against the local closed port.
    status = runNodeTests(suite, { DATABASE_URL: sentinelDatabaseUrl, OPENAI_API_KEY: sentinelOpenAiKey });
  } else if (suite === "db") {
    if (!process.env.TEST_DATABASE_URL) {
      status = unavailable(suite, "set TEST_DATABASE_URL to an isolated, disposable test database");
    } else {
      status = await runDbSuite({ jobs: requestedJobs() });
    }
  } else if (suite === "server") {
    if (!process.env.TEST_BASE_URL) {
      status = unavailable(suite, "set TEST_BASE_URL to a running non-production TrainEfficiency API");
    } else if (!(await checkServer(process.env.TEST_BASE_URL))) {
      status = unavailable(suite, `no server responded at ${process.env.TEST_BASE_URL}`);
    } else {
      status = runNodeTests(suite);
    }
  } else if (suite === "e2e") {
    status = unavailable(suite, "no browser/E2E runner is installed or configured");
  }

  if (allowUnavailable && status === 2) {
    console.log(`SKIPPED — ${suite}`);
    return 0;
  }
  return status;
}

// Only run a suite when invoked as a command. The wiring test imports this
// module to drive runDbSuiteForTests, and must not launch a suite by doing so.
const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  if (requested === "all") {
    let exitCode = await run("default");
    for (const suite of ["db", "server", "e2e"]) {
      exitCode ||= await run(suite, true);
    }
    process.exitCode = exitCode;
  } else if (!knownSuites.has(requested)) {
    console.error(`Unknown suite '${requested}'. Expected: ${[...knownSuites, "all"].join(", ")}`);
    process.exitCode = 1;
  } else {
    process.exitCode = await run(requested);
  }
}
