import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(...relativePath.split("/")),
    ts.ScriptTarget.ES2020,
    true,
  );
}

/**
 * Every object literal in the file, reported as the list of its statically
 * named properties. Parsed rather than pattern-matched, so this catches a
 * duplicate key anywhere in the file and not just the one that was fixed.
 */
function objectLiteralKeys(source: ts.SourceFile): { line: number; keys: string[] }[] {
  const literals: { line: number; keys: string[] }[] = [];

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keys: string[] = [];
      for (const property of node.properties) {
        const name = property.name;
        if (!name) continue;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) keys.push(name.text);
      }
      literals.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        keys,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return literals;
}

test("no object literal in beta-wave6-routes declares the same key twice", () => {
  // A duplicate key is silent at runtime: the last one wins and the earlier
  // value is discarded. Here it replaced an array of candidate objects with a
  // number, which the only consumer then called .map() on.
  const literals = objectLiteralKeys(parse("server/beta-wave6-routes.ts"));
  assert.ok(literals.length > 0, "expected to parse object literals");

  for (const { line, keys } of literals) {
    const seen = new Set<string>();
    for (const key of keys) {
      assert.ok(!seen.has(key), `duplicate key "${key}" in object literal at line ${line}`);
      seen.add(key);
    }
  }
});

test("first-success-stories sends candidates as the mapped array, and the count separately", () => {
  const routes = read("server", "beta-wave6-routes.ts");
  const start = routes.indexOf('app.get("/api/platform/first-success-stories"');
  assert.ok(start >= 0, "route not found");
  const block = routes.slice(start, routes.indexOf("app.", start + 10));

  assert.match(block, /candidates: candidates\.map\(/, "candidates must be the mapped array");
  assert.match(block, /candidateCount: candidate_\.length/, "the count needs its own key");
  assert.doesNotMatch(block, /\n\s+candidates: candidate_\.length/, "the count must not reuse the array's key");
});

test("the page that renders it treats candidates as an array", () => {
  // This is the contract the duplicate key broke: `.map` on a number throws,
  // and `?? []` does not catch a number because a number is not nullish.
  const page = read("client", "src", "pages", "admin-org-recruitment.tsx");
  assert.match(page, /success\?\.candidates \?\? \[\]\)\.map\(/);
  assert.match(page, /success\?\.candidates\?\.length/);
});

test("the negative-deferred-revenue message reports the released amount, not its negation", () => {
  const source = read("server", "financial-brain.ts");
  const start = source.indexOf('key: "negative_deferred_revenue"');
  assert.ok(start >= 0, "anomaly not found");
  const block = source.slice(start, start + 400);

  assert.match(block, /\(\(defRow\?\.released \?\? 0\) \/ 100\)/);
  // `-defRow?.released ?? 0` negates first, so `??` can never fire and the
  // message printed a negative number (or NaN when the row was absent).
  assert.doesNotMatch(block, /-defRow\?\.released \?\? 0/);
});

test("both files are out of the typecheck baseline, so neither bug can come back quietly", () => {
  const baseline = JSON.parse(read("config", "server-typecheck-baseline.json"));
  for (const file of ["server/beta-wave6-routes.ts", "server/financial-brain.ts"]) {
    assert.ok(
      !(file in baseline.counts),
      `${file} must stay clean — the build gate is what blocks a reintroduction`,
    );
  }
});
