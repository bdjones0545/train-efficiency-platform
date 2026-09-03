import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => readFileSync(path.resolve(serverDir, relativePath), "utf8");

function routeBlock(source: string, method: string, routePath: string): string {
  const lines = source.split("\n");
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((line) => new RegExp(`app\\.${method}\\(\\s*["']${escaped}["']`).test(line));
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found`);
  let block = lines[start];
  for (let index = start + 1; index < lines.length && !/app\.(get|post|put|patch|delete)\(/.test(lines[index]); index++) {
    block += `\n${lines[index]}`;
  }
  return block;
}

test("attention GET is bounded and has no synchronization side effects", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/attention");
  assert.match(block, /getAttentionItems\(orgId, \{ limit, offset, level \}\)/);
  assert.doesNotMatch(block, /syncAttentionItems|runEscalation/);
});

test("attention inbox pagination is server-side and level-aware", () => {
  const route = routeBlock(read("routes.ts"), "get", "/api/attention");
  const engine = read("attention-engine.ts");
  const page = read("../client/src/pages/attention-inbox.tsx");

  assert.match(route, /req\.query\.offset/);
  assert.match(route, /req\.query\.level/);
  assert.match(engine, /opts\.level === "critical"/);
  assert.match(page, /offset=\$\{page \* ATTENTION_PAGE_SIZE\}/);
  assert.match(page, /button-attention-next-page/);
  assert.match(page, /button-attention-previous-page/);
});

test("attention exposes an organization-scoped aggregate count endpoint", () => {
  const block = routeBlock(read("routes.ts"), "get", "/api/attention/count");
  assert.match(block, /resolveOrgIdOrThrow\(req\)/);
  assert.match(block, /getAttentionCount\(orgId\)/);
});

for (const action of ["snooze", "dismiss", "complete"]) {
  test(`attention ${action} mutation is scoped to the authenticated organization`, () => {
    const block = routeBlock(read("routes.ts"), "patch", `/api/attention/:id/${action}`);
    assert.match(block, /resolveOrgIdOrThrow\(req\)/);
    assert.match(block, new RegExp(`${action}AttentionItem\\(orgId, id`));
    assert.match(block, /Attention item not found/);
  });
}

test("attention lifecycle storage updates include both id and orgId", () => {
  const source = read("attention-engine.ts");
  for (const action of ["snooze", "dismiss", "complete"]) {
    const start = source.indexOf(`export async function ${action}AttentionItem`);
    assert.ok(start >= 0, `${action} helper not found`);
    const block = source.slice(start, source.indexOf("\n}\n", start) + 3);
    assert.match(block, /eq\(attentionItems\.id, id\)/);
    assert.match(block, /eq\(attentionItems\.orgId, orgId\)/);
    assert.match(block, /returning\(\{ id: attentionItems\.id \}\)/);
  }
});

test("attention schema and runtime migration prevent duplicate live source signals", () => {
  assert.match(read("../shared/schema.ts"), /attention_items_active_source_unique/);
  const source = read("attention-engine.ts");
  assert.match(source, /CREATE UNIQUE INDEX IF NOT EXISTS attention_items_active_source_unique/);
  assert.match(source, /PARTITION BY org_id, source_id/);
});

test("attention list query enforces a hard server-side maximum", () => {
  const source = read("attention-engine.ts");
  assert.match(source, /MAX_ATTENTION_LIMIT = 200/);
  assert.match(source, /\.limit\(limit\)/);
  assert.match(source, /\.offset\(offset\)/);
});
