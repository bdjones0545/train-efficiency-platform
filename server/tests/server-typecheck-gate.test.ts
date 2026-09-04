import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  parseTscOutput,
  countErrors,
  compareToBaseline,
  totalOf,
} from "../../script/lib/typecheck-ratchet";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const SAMPLE = [
  "server/action-tracking.ts(650,9): error TS2322: Type 'A' is not assignable to type 'B'.",
  "server/storage.ts(4053,17): error TS2339: Property 'db' does not exist on type 'DatabaseStorage'.",
  "server/storage.ts(4064,30): error TS2339: Property 'db' does not exist on type 'DatabaseStorage'.",
  "server/storage.ts(1346,5): error TS2322: Type 'X[]' is not assignable to type 'Y[]'.",
  "  Types of property 'foo' are incompatible.",
  "Found 4 errors in 2 files.",
].join("\n");

// ── Parsing ──────────────────────────────────────────────────────────────────

test("parses tsc error lines and ignores continuations and summaries", () => {
  const errors = parseTscOutput(SAMPLE);
  assert.equal(errors.length, 4);
  assert.deepEqual(errors[0], {
    file: "server/action-tracking.ts",
    line: 650,
    column: 9,
    code: "TS2322",
    message: "Type 'A' is not assignable to type 'B'.",
  });
});

test("parsing empty output yields no errors", () => {
  assert.deepEqual(parseTscOutput(""), []);
  assert.deepEqual(parseTscOutput("\n\n"), []);
});

test("counts group by file and error code", () => {
  const counts = countErrors(parseTscOutput(SAMPLE));
  assert.deepEqual(counts["server/storage.ts"], { TS2339: 2, TS2322: 1 });
  assert.deepEqual(counts["server/action-tracking.ts"], { TS2322: 1 });
  assert.equal(totalOf(counts), 4);
});

// ── The ratchet ──────────────────────────────────────────────────────────────

test("an unchanged tree passes", () => {
  const counts = countErrors(parseTscOutput(SAMPLE));
  const result = compareToBaseline(counts, counts);
  assert.equal(result.passed, true);
  assert.deepEqual(result.regressions, []);
  assert.deepEqual(result.improvements, []);
});

test("a new error in a previously clean file fails", () => {
  const baseline = { "server/storage.ts": { TS2339: 2 } };
  const current = { "server/storage.ts": { TS2339: 2 }, "server/lib/new.ts": { TS2322: 1 } };
  const result = compareToBaseline(baseline, current);
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions, [
    { file: "server/lib/new.ts", code: "TS2322", baseline: 0, current: 1 },
  ]);
});

test("one more of an error a file already has fails", () => {
  const result = compareToBaseline(
    { "server/storage.ts": { TS2339: 5 } },
    { "server/storage.ts": { TS2339: 6 } },
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions, [
    { file: "server/storage.ts", code: "TS2339", baseline: 5, current: 6 },
  ]);
});

test("swapping a fixed error for a new one in the same file still fails", () => {
  // The whole reason counts are keyed by code and not just by file: this
  // trade keeps the file's total identical.
  const result = compareToBaseline(
    { "server/routes.ts": { TS2339: 3 } },
    { "server/routes.ts": { TS2339: 2, TS2322: 1 } },
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions, [
    { file: "server/routes.ts", code: "TS2322", baseline: 0, current: 1 },
  ]);
  assert.deepEqual(result.improvements, [
    { file: "server/routes.ts", code: "TS2339", baseline: 3, current: 2 },
  ]);
});

test("fixing errors passes and is reported as an improvement", () => {
  const result = compareToBaseline(
    { "server/storage.ts": { TS2339: 5 } },
    { "server/storage.ts": { TS2339: 1 } },
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.improvements, [
    { file: "server/storage.ts", code: "TS2339", baseline: 5, current: 1 },
  ]);
});

test("clearing a file entirely passes", () => {
  const result = compareToBaseline({ "server/storage.ts": { TS2339: 5 } }, {});
  assert.equal(result.passed, true);
  assert.equal(result.improvements.length, 1);
});

test("a clean tree against a clean baseline passes", () => {
  assert.equal(compareToBaseline({}, {}).passed, true);
});

test("errors appearing against an empty baseline fail", () => {
  const result = compareToBaseline({}, { "server/x.ts": { TS2339: 1 } });
  assert.equal(result.passed, false);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

test("the build runs the server typecheck, not only the client one", () => {
  const build = read("script", "build.ts");
  const clientAt = build.indexOf("await typecheckClient();");
  const serverAt = build.indexOf("await typecheckServer();");
  assert.ok(clientAt >= 0, "client typecheck must still run");
  assert.ok(serverAt > clientAt, "server typecheck must run in buildAll");
  assert.match(build, /script\/typecheck-server\.ts/);
  assert.match(build, /process\.exit\(1\)/);
});

test("the server project covers server and shared, and excludes the client", () => {
  const config = JSON.parse(read("tsconfig.server.json"));
  assert.ok(config.include.includes("server/**/*"));
  assert.ok(config.include.includes("shared/**/*"));
  assert.ok(config.exclude.includes("client"));
  assert.equal(config.compilerOptions.noEmit, true);
});

test("the baseline is real, and shaped the way the ratchet reads it", () => {
  const baseline = JSON.parse(read("config", "server-typecheck-baseline.json"));
  assert.equal(typeof baseline.totalErrors, "number");
  assert.equal(baseline.totalErrors, totalOf(baseline.counts));
  assert.ok(baseline.totalErrors > 0, "baseline should record the standing errors");

  // Every key must look like a repo-relative source path with error-code counts.
  for (const [file, codes] of Object.entries(baseline.counts as Record<string, any>)) {
    assert.match(file, /^(server|shared|script)\/.+\.tsx?$/, `unexpected file key: ${file}`);
    for (const [code, count] of Object.entries(codes)) {
      assert.match(code, /^TS\d+$/);
      assert.ok(Number.isInteger(count) && (count as number) > 0);
    }
  }
});

test("npm exposes the gate for local use", () => {
  const pkg = JSON.parse(read("package.json"));
  const script = pkg.scripts["typecheck:server"];
  assert.ok(script, "typecheck:server script must exist");

  // Assert what the script must DO, not how it is spelled — the invocation
  // changed once already (the .bin/tsx shim is not always written by npm).
  assert.match(script, /script\/typecheck-server\.ts/);
  assert.doesNotMatch(script, /^npx /, "npx can resolve to an unrelated package");
});
