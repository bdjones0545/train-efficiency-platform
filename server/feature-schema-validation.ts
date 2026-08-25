import { sql } from "drizzle-orm";
import { db } from "./db";

export type FeatureSchema = "autonomous" | "hermes" | "opportunity" | "sponsorship" | "partnership";

const REQUIRED_COLUMNS: Record<FeatureSchema, Record<string, readonly string[]>> = {
  autonomous: {
    decision_trust_registry: ["id", "org_id", "decision_type", "label", "autonomy_score", "risk_level", "recommended_mode"],
    autonomous_action_queue: ["id", "org_id", "decision_type", "agent_type", "action", "status", "source_system", "source_action_id", "source_conversation_id", "gmail_thread_id"],
    autonomy_overrides: ["id", "org_id", "decision_type", "original_recommendation", "override_type"],
    business_objectives: ["id", "org_id", "title", "status", "progress", "execution_plan"],
    autonomous_initiatives: ["id", "org_id", "name", "status", "automation_mode"],
    business_memory: ["id", "org_id", "memory_type", "title", "metadata"],
    autonomous_actions: ["id", "org_id", "action_type", "approval_status", "rolled_back"],
    recommendation_tracking: ["id", "org_id", "title", "status"],
    execution_events: ["id", "org_id", "execution_type", "status", "input", "output"],
  },
  hermes: {
    composio_hermes_events: ["id", "org_id", "agent", "tool", "action", "result", "hermes_processed"],
    hermes_auto_learnings: ["id", "org_id", "domain", "outcome", "observation", "learning", "content_hash", "occurrence_count", "last_seen_at", "retrieved_count"],
    hermes_recommendations: ["id", "org_id", "type", "title", "reason", "confidence", "status"],
    hermes_recommendation_feedback: ["id", "recommendation_id", "outcome", "approved_as_type"],
  },
  opportunity: {
    opportunity_acquisition_opportunities: ["id", "org_id", "title", "status", "fingerprint", "final_outcome"],
    opportunity_agent_events: ["id", "org_id", "agent_name", "action", "event_type"],
    opportunity_qualification_assessments: ["id", "org_id", "opportunity_id", "fit_score", "reasoning", "updated_at"],
    opportunity_outreach_drafts: ["id", "org_id", "opportunity_id", "subject", "body", "status", "recipient_name", "recipient_email", "updated_at"],
    opportunity_source_settings: ["id", "org_id", "sources", "discovery_filters"],
    opportunity_discovery_runs: ["id", "org_id", "status", "opportunities_scanned"],
    opportunity_acquisition_cycles: ["id", "org_id", "status", "errors"],
    opportunity_outreach_executions: ["id", "org_id", "opportunity_id", "draft_id", "recipient_email", "status"],
    opportunity_reply_events: ["id", "org_id", "opportunity_id", "execution_id", "classification"],
    opportunity_learning_signals: ["id", "org_id", "opportunity_id", "final_outcome"],
    opportunity_learning_insights: ["id", "org_id", "insight", "supporting_data"],
    opportunity_executive_briefs: ["id", "org_id", "summary", "supporting_metrics"],
    opportunity_recommendations: ["id", "org_id", "recommendation", "status"],
  },
  sponsorship: {
    sponsorship_opportunities: ["id", "org_id", "organization_name", "status", "created_at", "updated_at"],
    sponsorship_assessments: ["id", "org_id", "sponsorship_id", "fit_score", "created_at"],
    sponsorship_outreach_drafts: ["id", "org_id", "sponsorship_id", "subject", "body", "status"],
    sponsorship_relationships: ["id", "org_id", "sponsorship_id", "stage"],
    sponsorship_learning_signals: ["id", "org_id", "sponsorship_id", "fit_score"],
    sponsorship_executive_briefs: ["id", "org_id", "summary", "generated_at"],
    sponsorship_recommendations: ["id", "org_id", "recommendation", "created_at"],
  },
  partnership: {
    partnership_opportunities: ["id", "org_id", "organization_name", "status", "created_at", "updated_at"],
    partnership_assessments: ["id", "org_id", "partnership_id", "fit_score", "created_at"],
    partnership_outreach_drafts: ["id", "org_id", "partnership_id", "subject", "body", "status"],
    partnership_relationships: ["id", "org_id", "partnership_id", "stage"],
    partnership_learning_signals: ["id", "org_id", "partnership_id", "fit_score"],
    partnership_executive_briefs: ["id", "org_id", "summary", "generated_at"],
    partnership_recommendations: ["id", "org_id", "recommendation", "created_at"],
  },
};

const REQUIRED_UNIQUES: Partial<Record<FeatureSchema, Array<{ table: string; columns: string[] }>>> = {
  autonomous: [{ table: "decision_trust_registry", columns: ["org_id", "decision_type"] }],
  hermes: [{ table: "hermes_auto_learnings", columns: ["content_hash"] }],
  opportunity: [
    { table: "opportunity_qualification_assessments", columns: ["org_id", "opportunity_id"] },
    { table: "opportunity_outreach_drafts", columns: ["org_id", "opportunity_id"] },
    { table: "opportunity_source_settings", columns: ["org_id"] },
  ],
};

const REQUIRED_INDEXES: Partial<Record<FeatureSchema, Array<{ table: string; columns: string[] }>>> = {
  sponsorship: [{ table: "sponsorship_opportunities", columns: ["org_id", "created_at"] }],
  partnership: [{ table: "partnership_opportunities", columns: ["org_id", "created_at"] }],
};

const STRICT_TENANT_FEATURES = new Set<FeatureSchema>(["sponsorship", "partnership"]);

function rows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  return Array.isArray((result as any)?.rows) ? (result as any).rows : [];
}

/** Read-only validation for optional, migration-owned feature schemas. */
export async function validateFeatureSchema(feature: FeatureSchema): Promise<void> {
  const expected = REQUIRED_COLUMNS[feature];
  const tableNames = Object.keys(expected);
  const tableList = sql.join(tableNames.map((table) => sql`${table}`), sql`, `);
  const actualRows = rows(await db.execute(sql`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${tableList})
  `));
  const actual = new Set(actualRows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(expected).flatMap(([table, columns]) =>
    columns.filter((column) => !actual.has(`${table}.${column}`)).map((column) => `${table}.${column}`),
  );

  const uniqueRows = rows(await db.execute(sql`
    SELECT table_definition.relname AS table_name,
      array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
    FROM pg_index index_definition
    JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
    JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = index_definition.indrelid
     AND attribute.attnum = key.attribute_number
    WHERE table_namespace.nspname = current_schema()
      AND index_definition.indisunique
      AND table_definition.relname IN (${tableList})
    GROUP BY table_definition.relname, index_definition.indexrelid
  `));
  for (const requirement of REQUIRED_UNIQUES[feature] ?? []) {
    const present = uniqueRows.some((row) => row.table_name === requirement.table
      && Array.isArray(row.columns)
      && row.columns.length === requirement.columns.length
      && row.columns.every((column: string, index: number) => column === requirement.columns[index]));
    if (!present) missing.push(`${requirement.table} UNIQUE(${requirement.columns.join(",")})`);
  }

  if (STRICT_TENANT_FEATURES.has(feature)) {
    for (const table of tableNames) {
      const tenant = actualRows.find((row) => row.table_name === table && row.column_name === "org_id");
      if (tenant && (tenant.data_type !== "text" || tenant.is_nullable !== "NO")) {
        missing.push(`${table}.org_id TEXT NOT NULL`);
      }
    }
  }

  const indexRows = rows(await db.execute(sql`
    SELECT table_definition.relname AS table_name,
      array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
    FROM pg_index index_definition
    JOIN pg_class table_definition ON table_definition.oid = index_definition.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
    JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = index_definition.indrelid
     AND attribute.attnum = key.attribute_number
    WHERE table_namespace.nspname = current_schema()
      AND index_definition.indisvalid
      AND table_definition.relname IN (${tableList})
    GROUP BY table_definition.relname, index_definition.indexrelid
  `));
  for (const requirement of REQUIRED_INDEXES[feature] ?? []) {
    const present = indexRows.some((row) => row.table_name === requirement.table
      && Array.isArray(row.columns)
      && row.columns.length === requirement.columns.length
      && row.columns.every((column: string, index: number) => column === requirement.columns[index]));
    if (!present) missing.push(`${requirement.table} INDEX(${requirement.columns.join(",")})`);
  }

  if (missing.length) {
    throw new Error(`${feature} schema migration is not ready: ${missing.join(", ")}`);
  }
}
