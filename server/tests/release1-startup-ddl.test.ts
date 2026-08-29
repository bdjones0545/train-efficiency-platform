import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:1/unused";

const { StartupSchemaUnavailableError, verifyStartupRelations } = await import("../release1-startup-readiness");

test("startup relation readiness emits SELECT only and preserves typed unavailable evidence", async () => {
  const statements: string[] = [];
  const pool = {
    connect: async () => ({
      query: async (statement: string) => {
        statements.push(statement);
        return { rows: [{ name: "optional_table", present: false }] };
      },
      release() {},
    }),
  } as any;
  await assert.rejects(
    verifyStartupRelations("optional", ["optional_table"], pool),
    (error: unknown) => error instanceof StartupSchemaUnavailableError
      && error.family === "optional" && error.missing[0] === "optional_table",
  );
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT\b/i);
  assert.doesNotMatch(statements[0], /\b(CREATE|ALTER|DROP)\b/i);
});

test("reachable production startup registrations no longer invoke structural initializers", async () => {
  const index = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const routes = await readFile(new URL("../routes.ts", import.meta.url), "utf8");
  const guardian = await readFile(new URL("../services/guardian-admin-service.ts", import.meta.url), "utf8");
  const composio = await readFile(new URL("../services/composio-service.ts", import.meta.url), "utf8");
  const softwareKb = await readFile(new URL("../services/software-kb-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /runMigrations\s*\(/);
  assert.doesNotMatch(routes, /await (?:bootstrapKevinSlackTables|ensureIntentTables|createAgentTables|ensureCallbackNoncesTable)\s*\(/);
  assert.doesNotMatch(guardian, /CREATE TABLE/i);
  assert.doesNotMatch(composio.slice(composio.indexOf("export async function ensureComposioLogTable"), composio.indexOf("// ─── Logging")), /CREATE (?:TABLE|INDEX)/i);
  assert.doesNotMatch(softwareKb, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)\b/i);
  assert.match(softwareKb, /validateSoftwareKbSchema/);
});
