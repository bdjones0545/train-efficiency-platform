import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

function runNodeTests(suite, env = {}) {
  const metadata = manifest.suites[suite];
  const files = filesFor(suite);
  console.log(`\n=== ${suite.toUpperCase()} ===`);
  console.log(metadata.description);
  console.log(`mutation: ${metadata.mutating ? "allowed against test infrastructure" : "none"}`);

  // Database tests each build the schema they need, dropping and recreating
  // shared tables. node --test runs files in parallel by default, so they
  // destroy one another's setup: run in one process, one file at a time.
  // Serially, all 26 previously unrun db files pass; in parallel, 20 failed.
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
      status = runNodeTests(suite, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? sentinelOpenAiKey,
      });
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
