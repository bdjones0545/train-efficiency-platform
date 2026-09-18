import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";
import * as appSchema from "@shared/schema";

/**
 * Generic guard: every ON CONFLICT target in server/ must name a real index.
 *
 * Postgres does not resolve an ON CONFLICT target by column *name*; it infers a
 * unique index whose key columns are exactly the target's. When no such index
 * exists it raises 42P10 — "there is no unique or exclusion constraint matching
 * the ON CONFLICT specification" — on EVERY execution, including the very first
 * insert into an empty table. Four such upserts shipped in this repo, each one
 * wrapped in a try/catch that swallowed the error, so the feature was silently
 * dead rather than loudly broken:
 *
 *   server/booking-events.ts                            target source_id
 *   server/services/opportunity-qualification-agent.ts  ON CONFLICT (opportunity_id)
 *   server/services/opportunity-outreach-agent.ts       ON CONFLICT (opportunity_id)
 *   server/kevin-slack/conversation-state.ts            ON CONFLICT (event_id)
 *
 * This test scans server/**\/*.ts for raw `ON CONFLICT (...)` and Drizzle
 * `.onConflictDo*({ target: ... })`, resolves each one's table from the
 * surrounding `INSERT INTO <table>` / `.insert(<drizzleTable>)`, and checks the
 * target column set against pg_index in the test database. Anything it cannot
 * resolve is skipped and listed rather than failed.
 *
 * Schema note: the database must carry BOTH halves of this repo's schema —
 * `drizzle-kit push` for the shared/schema.ts tables and the committed
 * migrations/*.sql for the tables that live only there (kevin_slack_event_dedup,
 * opportunity_*). `before` runs the repo's own migration runner to guarantee the
 * second half. It also runs initializeAttentionInfrastructure(), because
 * attention_items' partial unique index is created at runtime by
 * server/attention-engine.ts, not by push.
 */

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = connectionString;

const { Pool } = pg;
const pool = new Pool({ connectionString });
const { runApplicationMigrations } = await import("../application-migrations");
const { initializeAttentionInfrastructure } = await import("../attention-engine");
const { pool: appPool } = await import("../db");

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── Source scanning ──────────────────────────────────────────────────────────

interface Site {
  file: string;
  line: number;
  kind: "raw" | "drizzle";
  snippet: string;
  table?: string;
  columns?: string[];
  predicate: boolean;
  unresolved?: string;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Test files build throwaway schemas of their own, so pg_index in the
      // application database is not the right oracle for them.
      if (entry === "node_modules" || entry === "tests" || entry === "__tests__") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Blanks whole-line `//` and leading `/* *\/` comments, preserving every byte
 * offset (and therefore line numbers). Only comments that start a line are
 * touched, so a `//` or `/*` inside a string literal is never disturbed.
 */
function blankComments(source: string): string {
  let out = source;
  out = out.replace(/^[ \t]*\/\/[^\n]*/gm, (m) => " ".repeat(m.length));
  out = out.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

function balanced(src: string, openIdx: number, open: string, close: string): { inner: string; end: number } | null {
  if (src[openIdx] !== open) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return { inner: src.slice(openIdx + 1, i), end: i };
    }
  }
  return null;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function normalizeColumn(raw: string): string {
  return raw.trim().replace(/^"(.*)"$/, "$1").toLowerCase();
}

/** Drizzle table exports, keyed by the identifier the source imports them by. */
function drizzleTables(): Map<string, { table: string; columns: Map<string, string> }> {
  const map = new Map<string, { table: string; columns: Map<string, string> }>();
  for (const [exportName, value] of Object.entries(appSchema)) {
    const anyValue = value as any;
    const config = anyValue?.[Symbol.for("drizzle:Name")] ? anyValue : null;
    if (!config) continue;
    const tableName = anyValue[Symbol.for("drizzle:Name")];
    if (typeof tableName !== "string") continue;
    const columns = new Map<string, string>();
    for (const prop of Object.keys(anyValue)) {
      const column = anyValue[prop];
      if (column && typeof column === "object" && typeof column.name === "string" && column.columnType) {
        columns.set(prop, column.name);
      }
    }
    if (columns.size > 0) map.set(exportName, { table: tableName, columns });
  }
  return map;
}

function scanRaw(file: string, source: string, sites: Site[]): void {
  const pattern = /ON\s+CONFLICT/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    let cursor = match.index + match[0].length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    // `ON CONFLICT DO NOTHING` (no inference) and `ON CONFLICT ON CONSTRAINT`
    // do not name a column set.
    if (source[cursor] !== "(") continue;

    const line = lineOf(source, match.index);
    const parens = balanced(source, cursor, "(", ")");
    const base: Site = { file, line, kind: "raw", snippet: source.slice(match.index, match.index + 80).replace(/\s+/g, " "), predicate: false };
    if (!parens) {
      sites.push({ ...base, unresolved: "unbalanced ON CONFLICT target list" });
      continue;
    }

    const tail = source.slice(parens.end + 1, parens.end + 400);
    const doIndex = tail.search(/\bDO\b/i);
    base.predicate = doIndex >= 0 && /\bWHERE\b/i.test(tail.slice(0, doIndex));

    const columns = splitTopLevel(parens.inner).map(normalizeColumn);
    if (columns.length === 0 || columns.some((c) => c.includes("${") || /[()]/.test(c))) {
      sites.push({ ...base, unresolved: `target is an expression or interpolation: (${parens.inner.trim()})` });
      continue;
    }

    const before = source.slice(0, match.index);
    const insert = [...before.matchAll(/INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?/gi)].pop();
    if (!insert) {
      sites.push({ ...base, columns, unresolved: "no INSERT INTO <table> precedes this ON CONFLICT" });
      continue;
    }
    sites.push({ ...base, columns, table: insert[1].toLowerCase() });
  }
}

function scanDrizzle(
  file: string,
  source: string,
  tables: Map<string, { table: string; columns: Map<string, string> }>,
  sites: Site[],
): void {
  const pattern = /\.onConflictDo(?:Update|Nothing)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const openIdx = match.index + match[0].length - 1;
    const line = lineOf(source, match.index);
    const base: Site = { file, line, kind: "drizzle", snippet: match[0], predicate: false };

    const args = balanced(source, openIdx, "(", ")");
    if (!args || !args.inner.trim()) continue; // .onConflictDoNothing() — no inference

    const targetMatch = /(?:^|[\s,{])target\s*:/.exec(args.inner);
    if (!targetMatch) continue; // no target — no inference

    base.predicate = /(?:^|[\s,{])targetWhere\s*:/.test(args.inner);

    const valueStart = targetMatch.index + targetMatch[0].length;
    let value: string;
    let probe = valueStart;
    while (probe < args.inner.length && /\s/.test(args.inner[probe])) probe++;
    if (args.inner[probe] === "[") {
      const list = balanced(args.inner, probe, "[", "]");
      if (!list) {
        sites.push({ ...base, unresolved: "unbalanced target array" });
        continue;
      }
      value = list.inner;
    } else {
      value = splitTopLevel(args.inner.slice(valueStart))[0] ?? "";
    }

    const refs = [...value.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g)];
    if (refs.length === 0) {
      sites.push({ ...base, unresolved: `target is not a table.column reference: ${value.trim()}` });
      continue;
    }

    const before = source.slice(0, match.index);
    const insert = [...before.matchAll(/\.insert\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].pop();
    const identifiers = new Set(refs.map((r) => r[1]));
    const tableIdentifier = insert?.[1] ?? (identifiers.size === 1 ? [...identifiers][0] : undefined);
    if (!tableIdentifier) {
      sites.push({ ...base, unresolved: "no .insert(<table>) precedes this onConflict call" });
      continue;
    }

    const resolved = tables.get(tableIdentifier);
    if (!resolved) {
      sites.push({ ...base, unresolved: `"${tableIdentifier}" is not an exported @shared/schema table` });
      continue;
    }
    if (refs.some((r) => r[1] !== tableIdentifier)) {
      sites.push({ ...base, table: resolved.table, unresolved: "target mixes columns from more than one table" });
      continue;
    }

    const columns: string[] = [];
    let unknown: string | undefined;
    for (const ref of refs) {
      const column = resolved.columns.get(ref[2]);
      if (!column) {
        unknown = `${ref[1]}.${ref[2]} is not a column of ${resolved.table}`;
        break;
      }
      columns.push(column.toLowerCase());
    }
    if (unknown) {
      sites.push({ ...base, table: resolved.table, unresolved: unknown });
      continue;
    }
    sites.push({ ...base, table: resolved.table, columns });
  }
}

function collectSites(): Site[] {
  const tables = drizzleTables();
  const sites: Site[] = [];
  for (const file of sourceFiles(serverRoot)) {
    const source = blankComments(readFileSync(file, "utf8"));
    const relative = path.relative(path.resolve(serverRoot, ".."), file);
    scanRaw(relative, source, sites);
    scanDrizzle(relative, source, tables, sites);
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ─── Database ─────────────────────────────────────────────────────────────────

interface IndexRow {
  table: string;
  index: string;
  primary: boolean;
  partial: boolean;
  columns: string[];
}

let indexesByTable = new Map<string, IndexRow[]>();
let knownTables = new Set<string>();

before(async () => {
  // The repo's schema lives in two places: shared/schema.ts (drizzle-kit push)
  // and migrations/*.sql. Both halves must be present or the guard would report
  // real defects as "unknown table".
  await runApplicationMigrations(appPool as any);
  // attention_items' partial unique index is created at runtime, not by push.
  await initializeAttentionInfrastructure();

  const tableRows = await pool.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
  );
  knownTables = new Set(tableRows.rows.map((r) => r.relname.toLowerCase()));

  const rows = await pool.query<{
    table_name: string;
    index_name: string;
    is_primary: boolean;
    is_partial: boolean;
    key_defs: string[];
  }>(`
    SELECT t.relname AS table_name,
           i.relname AS index_name,
           ix.indisprimary AS is_primary,
           (ix.indpred IS NOT NULL) AS is_partial,
           (SELECT array_agg(pg_get_indexdef(ix.indexrelid, k, true) ORDER BY k)
              FROM generate_series(1, ix.indnkeyatts) AS k) AS key_defs
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND (ix.indisunique OR ix.indisprimary)
       AND ix.indislive
  `);

  indexesByTable = new Map();
  for (const row of rows.rows) {
    const key = row.table_name.toLowerCase();
    const list = indexesByTable.get(key) ?? [];
    list.push({
      table: key,
      index: row.index_name,
      primary: row.is_primary,
      partial: row.is_partial,
      columns: (row.key_defs ?? []).map((c) => normalizeColumn(c)),
    });
    indexesByTable.set(key, list);
  }
});

after(async () => {
  await pool.end();
  await appPool.end();
});

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, i) => value === right[i]);
}

function describe(site: Site): string {
  return `${site.file}:${site.line} [${site.kind}]`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("the scanner finds the ON CONFLICT sites it is supposed to police", () => {
  const sites = collectSites();
  assert.ok(sites.length >= 50, `expected the scanner to find the repo's upserts, found ${sites.length}`);

  const resolved = sites.filter((s) => s.table && s.columns);
  assert.ok(
    resolved.length >= 40,
    `expected most sites to resolve to a table and column set, only ${resolved.length}/${sites.length} did`,
  );

  // The four sites this PR fixes must be inside the scanner's reach, or the
  // guard could go green while they regress.
  for (const file of [
    "server/booking-events.ts",
    "server/services/opportunity-qualification-agent.ts",
    "server/services/opportunity-outreach-agent.ts",
    "server/kevin-slack/conversation-state.ts",
  ]) {
    assert.ok(
      resolved.some((s) => s.file === file),
      `${file} has an ON CONFLICT the scanner failed to resolve`,
    );
  }
});

test("every resolvable ON CONFLICT target matches a real unique index or primary key", () => {
  const sites = collectSites();
  const failures: string[] = [];
  const skipped: string[] = [];
  const partial: string[] = [];

  for (const site of sites) {
    if (site.unresolved || !site.table || !site.columns) {
      skipped.push(`${describe(site)} — ${site.unresolved ?? "no table/columns"}`);
      continue;
    }
    if (!knownTables.has(site.table)) {
      skipped.push(`${describe(site)} — table "${site.table}" does not exist in the test database`);
      continue;
    }

    const candidates = indexesByTable.get(site.table) ?? [];
    const matches = candidates.filter((index) => sameSet(index.columns, site.columns!));
    if (matches.length === 0) {
      const available = candidates.length
        ? candidates.map((c) => `${c.index}(${c.columns.join(", ")})${c.partial ? " [partial]" : ""}`).join("; ")
        : "none";
      failures.push(
        `${describe(site)} — ON CONFLICT (${site.columns.join(", ")}) on "${site.table}" matches no unique index or primary key. ` +
          `Postgres raises 42P10 on every call. Unique/PK indexes present: ${available}`,
      );
      continue;
    }

    // A partial index is only inferrable when the statement repeats its
    // predicate; without one Postgres raises 42P10 just the same.
    if (matches.every((m) => m.partial)) {
      const names = matches.map((m) => m.index).join(", ");
      if (!site.predicate) {
        failures.push(
          `${describe(site)} — ON CONFLICT (${site.columns.join(", ")}) on "${site.table}" matches only the PARTIAL index ` +
            `${names}, but supplies no index predicate, so Postgres cannot infer it (42P10). ` +
            `Repeat the index WHERE clause (raw SQL) or pass targetWhere (Drizzle).`,
        );
        continue;
      }
      partial.push(`${describe(site)} — inferred via PARTIAL index ${names} (predicate supplied)`);
    }
  }

  if (skipped.length) console.log(`[on-conflict-guard] skipped ${skipped.length} unresolvable site(s):\n  ${skipped.join("\n  ")}`);
  if (partial.length) console.log(`[on-conflict-guard] ${partial.length} site(s) rely on a partial unique index:\n  ${partial.join("\n  ")}`);

  assert.deepEqual(
    failures,
    [],
    `ON CONFLICT target(s) name no existing unique index — the upsert is dead on every call:\n  ${failures.join("\n  ")}`,
  );
});
