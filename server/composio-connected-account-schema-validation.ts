import type { Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = Pick<typeof db, "execute">;

export class ComposioConnectionSchemaUnavailableError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Composio connected-account ownership unavailable: ${problems.join(", ")}`);
    this.name = "ComposioConnectionSchemaUnavailableError";
  }
}

export function sendComposioConnectionUnavailable(error: unknown, response: Response): boolean {
  if (!(error instanceof ComposioConnectionSchemaUnavailableError)) return false;
  response.status(503).json({ message: "Composio connections temporarily unavailable" });
  return true;
}

function rows(result: any): any[] { return Array.isArray(result) ? result : result?.rows ?? []; }
function normalized(value: unknown): string { return String(value ?? "").replace(/[\s()'":]/g, "").toLowerCase(); }

/** Catalog-only validation. Never creates, alters, or repairs schema. */
export async function validateComposioConnectionSchema(executor: Executor = db): Promise<void> {
  const problems: string[] = [];
  const found = rows(await executor.execute(sql`
    SELECT c.table_name,c.column_name,format_type(a.atttypid,a.atttypmod) canonical_type,a.attnotnull is_not_null,
      pg_get_expr(d.adbin,d.adrelid) column_default
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE c.table_schema=current_schema() AND c.table_name IN
      ('composio_connected_account_ownership','composio_platform_account_authorizations')
  `));
  const expected = {
    composio_connected_account_ownership: [
      ["connected_account_id","text",true],["toolkit","text",true],["ownership_class","text",true],
      ["org_id","character varying(256)",false],["provider_entity_id","text",false],["active","boolean",true],
      ["authorized_by","text",false],["created_at","timestamp with time zone",true],["updated_at","timestamp with time zone",true],
    ],
    composio_platform_account_authorizations: [
      ["org_id","character varying(256)",true],["connected_account_id","text",true],["active","boolean",true],
      ["authorized_by","text",false],["created_at","timestamp with time zone",true],["updated_at","timestamp with time zone",true],
    ],
  } as const;
  for (const [table, columns] of Object.entries(expected)) for (const [name,type,notNull] of columns) {
    const actual = found.find(row => row.table_name===table && row.column_name===name);
    if (!actual || actual.canonical_type!==type || actual.is_not_null!==notNull) problems.push(`${table}.${name}`);
  }
  for (const table of Object.keys(expected)) {
    for (const [column, expectedDefault] of [
      ["connected_account_id", null], ["toolkit", null], ["ownership_class", null], ["org_id", null],
      ["provider_entity_id", null], ["active", "true"], ["authorized_by", null],
      ["created_at", "now"], ["updated_at", "now"],
    ] as const) {
      const actual = found.find(row => row.table_name===table && row.column_name===column);
      if (!actual) continue;
      const rendered = normalized(actual?.column_default);
      const valid = expectedDefault === null ? rendered === "" : rendered === expectedDefault;
      if (!valid) problems.push(`${table}.${column} DEFAULT`);
    }
  }
  const constraints = rows(await executor.execute(sql`
    SELECT t.relname table_name,c.contype,
      array_agg(a.attname ORDER BY k.ordinality)::text[] columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE n.nspname=current_schema() AND t.relname IN
      ('composio_connected_account_ownership','composio_platform_account_authorizations')
    GROUP BY t.relname,c.oid,c.contype
  `));
  const same=(a:unknown,b:readonly string[])=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  if (!constraints.some(c=>c.table_name==='composio_connected_account_ownership'&&c.contype==='p'&&same(c.columns,['connected_account_id']))) problems.push('ownership PRIMARY KEY');
  if (!constraints.some(c=>c.table_name==='composio_platform_account_authorizations'&&c.contype==='p'&&same(c.columns,['org_id','connected_account_id']))) problems.push('platform authorization PRIMARY KEY');
  const definitions = rows(await executor.execute(sql`
    SELECT t.relname table_name,c.conname,c.contype,pg_get_constraintdef(c.oid,true) definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname IN
      ('composio_connected_account_ownership','composio_platform_account_authorizations')
  `));
  const ownershipCheck = definitions.find(c=>c.table_name==='composio_connected_account_ownership'&&c.conname==='composio_connected_account_ownership_contract_check'&&c.contype==='c');
  const expectedCheck = "CHECK (btrim(connected_account_id) <> ''::text AND (toolkit = ANY (ARRAY['gmail'::text, 'googlecalendar'::text, 'slack'::text, 'googlesheets'::text, 'github'::text, 'stripe'::text])) AND (ownership_class = ANY (ARRAY['organization'::text, 'platform'::text])) AND (ownership_class = 'organization'::text AND org_id IS NOT NULL AND btrim(org_id::text) <> ''::text OR ownership_class = 'platform'::text AND org_id IS NULL))";
  if (normalized(ownershipCheck?.definition)!==normalized(expectedCheck)) problems.push('ownership contract CHECK');
  const foreignKeys = [
    ["composio_connected_account_ownership", "composio_connected_account_ownership_org_fk", "FOREIGNKEY(org_id)REFERENCESorganizations(id)ONUPDATERESTRICTONDELETERESTRICT"],
    ["composio_platform_account_authorizations", "composio_platform_account_authorizations_org_fk", "FOREIGNKEY(org_id)REFERENCESorganizations(id)ONUPDATERESTRICTONDELETERESTRICT"],
    ["composio_platform_account_authorizations", "composio_platform_account_authorizations_account_fk", "FOREIGNKEY(connected_account_id)REFERENCEScomposio_connected_account_ownership(connected_account_id)ONUPDATERESTRICTONDELETERESTRICT"],
  ] as const;
  for (const [table,name,definition] of foreignKeys) {
    const actual = definitions.find(c=>c.table_name===table&&c.conname===name&&c.contype==='f');
    if (normalized(actual?.definition)!==normalized(definition)) problems.push(`${table}.${name}`);
  }
  const indexes = rows(await executor.execute(sql`
    SELECT t.relname table_name,idx.relname index_name,i.indisunique,i.indisvalid,
      i.indnkeyatts key_count,i.indnatts attribute_count,(i.indexprs IS NULL) no_expressions,
      (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum) columns,
      pg_get_expr(i.indpred,i.indrelid) predicate
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND idx.relname IN
      ('composio_connected_account_ownership_org_toolkit_idx','composio_platform_account_authorizations_account_idx')
  `));
  const ownershipIndex = indexes.find(index=>index.index_name==='composio_connected_account_ownership_org_toolkit_idx');
  if (!ownershipIndex || ownershipIndex.indisunique || !ownershipIndex.indisvalid || !ownershipIndex.no_expressions ||
      ownershipIndex.key_count!==2 || ownershipIndex.attribute_count!==2 || !same(ownershipIndex.columns,['org_id','toolkit']) ||
      normalized(ownershipIndex.predicate)!==normalized("active AND ownership_class = 'organization'::text"))
    problems.push('composio_connected_account_ownership_org_toolkit_idx INDEX');
  const platformIndex = indexes.find(index=>index.index_name==='composio_platform_account_authorizations_account_idx');
  if (!platformIndex || platformIndex.indisunique || !platformIndex.indisvalid || !platformIndex.no_expressions ||
      platformIndex.key_count!==1 || platformIndex.attribute_count!==1 || !same(platformIndex.columns,['connected_account_id']) || normalized(platformIndex.predicate)!=='active')
    problems.push('composio_platform_account_authorizations_account_idx INDEX');
  const accidentalUnique = rows(await executor.execute(sql`
    SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname='composio_connected_account_ownership' AND i.indisunique
      AND (SELECT array_agg(a.attname ORDER BY k.ordinality)::text[] FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)=ARRAY['org_id','toolkit']::text[]
  `));
  if (accidentalUnique.length) problems.push('unexpected UNIQUE(org_id,toolkit)');
  if (problems.length) throw new ComposioConnectionSchemaUnavailableError(problems);
}
