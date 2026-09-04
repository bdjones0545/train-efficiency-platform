/**
 * Server typecheck gate.
 *
 * Runs tsc over server/ + shared/ + script/ and compares the result against
 * config/server-typecheck-baseline.json. Fails when the count of any error
 * code in any file rises above its baseline.
 *
 *   npm run typecheck:server              check (exits 1 on a regression)
 *   npm run typecheck:server -- --update  rewrite the baseline from the current tree
 *
 * The 4GB heap matches the existing `check` script — tsc aborts on this
 * project with the default heap.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseTscOutput,
  countErrors,
  compareToBaseline,
  totalOf,
  type Baseline,
} from "./lib/typecheck-ratchet";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(repoRoot, "config", "server-typecheck-baseline.json");
const PROJECT = "tsconfig.server.json";
const COMMAND = `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit -p ${PROJECT}`;

function runTsc(): string {
  try {
    execFileSync(
      process.execPath,
      ["--max-old-space-size=4096", "./node_modules/typescript/bin/tsc", "--noEmit", "-p", PROJECT],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return "";
  } catch (error: any) {
    // tsc exits non-zero when it reports errors; that is the expected path.
    const stdout: string = error?.stdout ?? "";
    const stderr: string = error?.stderr ?? "";
    if (error?.status === undefined) {
      console.error("Could not run tsc:", error?.message ?? error);
      process.exit(1);
    }
    return `${stdout}\n${stderr}`;
  }
}

function main() {
  const update = process.argv.includes("--update");

  console.log(`typechecking server (tsc --noEmit -p ${PROJECT})...`);
  const output = runTsc();
  const errors = parseTscOutput(output);
  const counts = countErrors(errors);
  const total = totalOf(counts);

  if (update) {
    const baseline: Baseline = {
      description:
        "Standing server type errors. The build gate fails when any file gains an error. " +
        "Lower is better — regenerate with: npm run typecheck:server -- --update",
      command: COMMAND,
      totalErrors: total,
      counts,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`baseline written: ${total} error(s) across ${Object.keys(counts).length} file(s)`);
    return;
  }

  let baseline: Baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(`Missing or unreadable baseline at ${BASELINE_PATH}.`);
    console.error("Create it with: npm run typecheck:server -- --update");
    process.exit(1);
  }

  const { regressions, improvements, passed } = compareToBaseline(baseline.counts, counts);

  if (improvements.length > 0) {
    const fixed = improvements.reduce((sum, i) => sum + (i.baseline - i.current), 0);
    console.log(`${fixed} standing error(s) fixed — tighten the baseline:`);
    console.log("  npm run typecheck:server -- --update");
  }

  if (!passed) {
    console.error(`\nserver typecheck FAILED — ${regressions.length} new error group(s):\n`);
    for (const r of regressions) {
      console.error(`  ${r.file}  ${r.code}: ${r.baseline} -> ${r.current}`);
      for (const error of errors.filter((e) => e.file === r.file && e.code === r.code)) {
        console.error(`      ${r.file}(${error.line},${error.column}): ${error.message}`);
      }
    }
    console.error(
      "\nThese are new server type errors. Fix them — do not raise the baseline to " +
        "accommodate them. The baseline exists to retire the standing errors, not to absorb new ones.",
    );
    process.exit(1);
  }

  console.log(`server typecheck passed ✓ (${total} standing error(s), none new)`);
}

main();
