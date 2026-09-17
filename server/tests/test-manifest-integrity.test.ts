import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "test-suites.json"), "utf8"),
);

/**
 * config/test-suites.json decides which files each suite runs. A file listed
 * there but missing from the tree is not a run failure everywhere:
 *
 *   node --test missing-file.test.ts
 *
 * prints "Could not find ..." and exits 0 on Node 22, and exits non-zero on
 * Node 20. So a deleted test can vanish from the suite while `npm test` still
 * reports PASS on a developer machine — which is exactly what happened to
 * server/tests/phase1f-authz.test.ts, deleted in a cleanup commit and then
 * listed in the manifest afterwards.
 *
 * These tests make the manifest wrong in a way that fails on every version.
 */

test("every file the manifest lists exists", () => {
  const missing: string[] = [];
  for (const entry of manifest.inventory) {
    for (const file of entry.files) {
      if (!existsSync(path.join(repoRoot, file))) missing.push(file);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `the manifest lists files that do not exist — a deleted test silently leaves the suite:\n  ${missing.join("\n  ")}`,
  );
});

test("no file is listed twice in the same inventory entry", () => {
  for (const entry of manifest.inventory) {
    const seen = new Set<string>();
    for (const file of entry.files) {
      assert.ok(!seen.has(file), `${file} is listed twice in the ${entry.classification} entry`);
      seen.add(file);
    }
  }
});

function testFilesOnDisk(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
        continue;
      }
      if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) {
        found.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, "server"));
  return found.sort();
}

test("no NEW test file goes unrun", () => {
  // A test nobody runs is worth as little as a test that cannot fail. 51 files
  // are already in this state — recorded in config/unrun-tests.json as a
  // backlog, not an approval. This ratchet stops the number growing.
  const listed = new Set<string>(
    manifest.inventory.flatMap((entry: any) => entry.files as string[]),
  );
  const known = new Set<string>(
    JSON.parse(readFileSync(path.join(repoRoot, "config", "unrun-tests.json"), "utf8")).files,
  );

  const unclaimed = testFilesOnDisk().filter((f) => !listed.has(f));
  const brandNew = unclaimed.filter((f) => !known.has(f));
  assert.deepEqual(
    brandNew,
    [],
    `test file(s) exist that no suite runs — add them to config/test-suites.json:\n  ${brandNew.join("\n  ")}`,
  );
});

test("the unrun backlog does not silently grow, and stale entries are removed", () => {
  const listed = new Set<string>(
    manifest.inventory.flatMap((entry: any) => entry.files as string[]),
  );
  const backlog = JSON.parse(
    readFileSync(path.join(repoRoot, "config", "unrun-tests.json"), "utf8"),
  );
  const known: string[] = backlog.files;
  assert.equal(backlog.count, known.length, "config/unrun-tests.json miscounts itself");

  const onDisk = new Set(testFilesOnDisk());
  const resolved = known.filter((f) => !onDisk.has(f) || listed.has(f));
  assert.deepEqual(
    resolved,
    [],
    `these are no longer unrun — remove them from config/unrun-tests.json:\n  ${resolved.join("\n  ")}`,
  );
});

test("every suite the inventory references is a declared suite", () => {
  const declared = new Set(Object.keys(manifest.suites));
  for (const entry of manifest.inventory) {
    for (const suite of entry.suites) {
      assert.ok(declared.has(suite), `inventory references undeclared suite "${suite}"`);
    }
  }
});

/**
 * The manifest marks the db suite safeForCI, but for a long time nothing in CI
 * ran it: `npm test` and `npm run test:security` are mostly source-inspection
 * tests, and the db suite is the only one whose tenant-isolation tests execute
 * real code against a real PostgreSQL. In a mutation check on 2026-09-16, three
 * of four deliberate security breaks passed the CI-run suites. This pins the
 * db job into the workflow so it cannot quietly disappear again.
 */
test("CI runs the db suite against a postgres service", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

  // Isolate the db job: from its key to the next job key at the same indent.
  const jobStart = workflow.search(/^  db-tests:\s*$/m);
  assert.notEqual(jobStart, -1, ".github/workflows/ci.yml has no `db-tests` job");
  const rest = workflow.slice(jobStart + "  db-tests:".length);
  const nextJob = rest.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  const job = nextJob === -1 ? rest : rest.slice(0, nextJob);

  assert.match(job, /image:\s*postgres:16\b/, "db job does not start a postgres:16 service");
  assert.match(job, /--health-cmd\s+"?pg_isready/, "postgres service has no readiness health check");
  assert.match(
    job,
    /^\s+POSTGRES_HOST_AUTH_METHOD:\s*trust\s*$/m,
    "the postgres service must trust loopback logins: agent-outcome-attribution-migration.test.ts creates a passwordless role and connects as it, which fails with 28P01 under the image's default scram-sha-256",
  );
  assert.match(
    job,
    /^\s+TEST_DATABASE_URL:\s*postgresql:\/\/postgres:postgres@localhost:5432\/te_test\s*$/m,
    "TEST_DATABASE_URL must point at the postgres service, which the runner maps to DATABASE_URL",
  );
  assert.match(
    job,
    /node \.\/node_modules\/drizzle-kit\/bin\.cjs push --force/,
    "db job must build the schema with drizzle-kit push (script/migrate.ts cannot bootstrap an empty database)",
  );
  assert.match(job, /run:\s*npm run test:db\s*$/m, "db job does not run `npm run test:db`");
  assert.doesNotMatch(job, /npx /, "never npx in CI: a missing binary silently resolves to an unrelated package");

  const suite = manifest.suites.db;
  assert.equal(suite.safeForCI, true);
  assert.deepEqual(suite.requiredEnvironment, ["TEST_DATABASE_URL"]);
});
