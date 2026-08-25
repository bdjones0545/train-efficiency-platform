import { sql } from "drizzle-orm";
import { db } from "./db";

export type FeatureSchema = "autonomous" | "hermes" | "opportunity" | "sponsorship" | "partnership" | "forecasting";

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
  forecasting: {
    business_forecasts: ["id", "org_id", "horizon_days", "metric", "current_value", "projected_value", "change_pct", "confidence", "variance_low", "variance_high", "supporting_factors", "generated_at", "forecast_date"],
    risk_signals: ["id", "org_id", "category", "title", "description", "risk_level", "metric_name", "metric_value", "threshold", "trend_pct", "status", "detected_at", "resolved_at"],
    opportunity_signals: ["id", "org_id", "category", "title", "description", "impact_level", "metric_name", "metric_value", "trend_pct", "recommended_action", "status", "detected_at"],
    scenario_simulations: ["id", "org_id", "name", "scenario_type", "parameters", "baseline", "projected", "impact_summary", "created_by", "created_at"],
    strategic_plans: ["id", "org_id", "horizon_days", "title", "objectives", "risks", "opportunities", "actions", "expected_outcomes", "obsidian_path", "generated_at"],
    forecast_accuracy: ["id", "org_id", "metric", "horizon_days", "predicted_value", "actual_value", "variance_pct", "accuracy_score", "recorded_at"],
    business_twin_state: ["id", "org_id", "monthly_revenue", "active_clients", "active_coaches", "sessions_per_week", "lead_volume_30d", "conversion_rate", "retention_rate", "capacity_utilization", "revenue_trend_pct", "lead_trend_pct", "last_updated"],
  },
};

type ColumnContract = { type: string; notNull: boolean };

const FORECASTING_COLUMN_CONTRACT: Record<string, Record<string, ColumnContract>> = {
  business_forecasts: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    horizon_days: { type: "integer", notNull: true }, metric: { type: "text", notNull: true },
    current_value: { type: "numeric(14,2)", notNull: false }, projected_value: { type: "numeric(14,2)", notNull: false },
    change_pct: { type: "numeric(8,2)", notNull: false }, confidence: { type: "integer", notNull: false },
    variance_low: { type: "numeric(14,2)", notNull: false }, variance_high: { type: "numeric(14,2)", notNull: false },
    supporting_factors: { type: "jsonb", notNull: false }, generated_at: { type: "timestamp with time zone", notNull: false },
    forecast_date: { type: "date", notNull: true },
  },
  risk_signals: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    category: { type: "text", notNull: true }, title: { type: "text", notNull: true },
    description: { type: "text", notNull: false }, risk_level: { type: "text", notNull: false },
    metric_name: { type: "text", notNull: false }, metric_value: { type: "numeric(14,2)", notNull: false },
    threshold: { type: "numeric(14,2)", notNull: false }, trend_pct: { type: "numeric(8,2)", notNull: false },
    status: { type: "text", notNull: false }, detected_at: { type: "timestamp with time zone", notNull: false },
    resolved_at: { type: "timestamp with time zone", notNull: false },
  },
  opportunity_signals: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    category: { type: "text", notNull: true }, title: { type: "text", notNull: true },
    description: { type: "text", notNull: false }, impact_level: { type: "text", notNull: false },
    metric_name: { type: "text", notNull: false }, metric_value: { type: "numeric(14,2)", notNull: false },
    trend_pct: { type: "numeric(8,2)", notNull: false }, recommended_action: { type: "text", notNull: false },
    status: { type: "text", notNull: false }, detected_at: { type: "timestamp with time zone", notNull: false },
  },
  scenario_simulations: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    name: { type: "text", notNull: true }, scenario_type: { type: "text", notNull: true },
    parameters: { type: "jsonb", notNull: false }, baseline: { type: "jsonb", notNull: false },
    projected: { type: "jsonb", notNull: false }, impact_summary: { type: "jsonb", notNull: false },
    created_by: { type: "text", notNull: false }, created_at: { type: "timestamp with time zone", notNull: false },
  },
  strategic_plans: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    horizon_days: { type: "integer", notNull: true }, title: { type: "text", notNull: true },
    objectives: { type: "jsonb", notNull: false }, risks: { type: "jsonb", notNull: false },
    opportunities: { type: "jsonb", notNull: false }, actions: { type: "jsonb", notNull: false },
    expected_outcomes: { type: "jsonb", notNull: false }, obsidian_path: { type: "text", notNull: false },
    generated_at: { type: "timestamp with time zone", notNull: false },
  },
  forecast_accuracy: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    metric: { type: "text", notNull: true }, horizon_days: { type: "integer", notNull: true },
    predicted_value: { type: "numeric(14,2)", notNull: false }, actual_value: { type: "numeric(14,2)", notNull: false },
    variance_pct: { type: "numeric(8,2)", notNull: false }, accuracy_score: { type: "integer", notNull: false },
    recorded_at: { type: "timestamp with time zone", notNull: false },
  },
  business_twin_state: {
    id: { type: "text", notNull: true }, org_id: { type: "text", notNull: true },
    monthly_revenue: { type: "numeric(14,2)", notNull: false }, active_clients: { type: "integer", notNull: false },
    active_coaches: { type: "integer", notNull: false }, sessions_per_week: { type: "numeric(8,2)", notNull: false },
    lead_volume_30d: { type: "integer", notNull: false }, conversion_rate: { type: "numeric(8,4)", notNull: false },
    retention_rate: { type: "numeric(8,4)", notNull: false }, capacity_utilization: { type: "numeric(8,4)", notNull: false },
    revenue_trend_pct: { type: "numeric(8,2)", notNull: false }, lead_trend_pct: { type: "numeric(8,2)", notNull: false },
    last_updated: { type: "timestamp with time zone", notNull: false },
  },
};

const FORECASTING_PRIMARY_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  Object.keys(FORECASTING_COLUMN_CONTRACT).map((table) => [table, ["id"]]),
);

const REQUIRED_UNIQUES: Partial<Record<FeatureSchema, Array<{ table: string; columns: string[] }>>> = {
  autonomous: [{ table: "decision_trust_registry", columns: ["org_id", "decision_type"] }],
  hermes: [{ table: "hermes_auto_learnings", columns: ["content_hash"] }],
  opportunity: [
    { table: "opportunity_qualification_assessments", columns: ["org_id", "opportunity_id"] },
    { table: "opportunity_outreach_drafts", columns: ["org_id", "opportunity_id"] },
    { table: "opportunity_source_settings", columns: ["org_id"] },
  ],
  forecasting: [
    { table: "business_forecasts", columns: ["org_id", "horizon_days", "metric", "forecast_date"] },
    { table: "business_twin_state", columns: ["org_id"] },
  ],
};

const REQUIRED_INDEXES: Partial<Record<FeatureSchema, Array<{ table: string; columns: string[]; unique?: boolean }>>> = {
  sponsorship: [{ table: "sponsorship_opportunities", columns: ["org_id", "created_at"] }],
  partnership: [{ table: "partnership_opportunities", columns: ["org_id", "created_at"] }],
  forecasting: [
    { table: "risk_signals", columns: ["org_id", "status", "detected_at"] },
    { table: "opportunity_signals", columns: ["org_id", "status", "detected_at"] },
    { table: "scenario_simulations", columns: ["org_id", "created_at"] },
    { table: "strategic_plans", columns: ["org_id", "generated_at"] },
    { table: "forecast_accuracy", columns: ["org_id", "metric", "horizon_days"] },
  ],
};

const STRICT_TENANT_FEATURES = new Set<FeatureSchema>(["sponsorship", "partnership", "forecasting"]);

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
    SELECT column_definition.table_name, column_definition.column_name,
      format_type(attribute.atttypid, attribute.atttypmod) AS canonical_type,
      attribute.attnotnull AS is_not_null
    FROM information_schema.columns column_definition
    JOIN pg_namespace table_namespace ON table_namespace.nspname = column_definition.table_schema
    JOIN pg_class table_definition
      ON table_definition.relnamespace = table_namespace.oid
     AND table_definition.relname = column_definition.table_name
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_definition.oid
     AND attribute.attname = column_definition.column_name
    WHERE column_definition.table_schema = current_schema()
      AND column_definition.table_name IN (${tableList})
  `));
  const actual = new Set(actualRows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(expected).flatMap(([table, columns]) =>
    columns.filter((column) => !actual.has(`${table}.${column}`)).map((column) => `${table}.${column}`),
  );

  if (feature === "forecasting") {
    for (const [table, columns] of Object.entries(FORECASTING_COLUMN_CONTRACT)) {
      for (const [column, contract] of Object.entries(columns)) {
        const actualColumn = actualRows.find((row) => row.table_name === table && row.column_name === column);
        if (actualColumn && (actualColumn.canonical_type !== contract.type
          || actualColumn.is_not_null !== contract.notNull)) {
          missing.push(`${table}.${column} ${contract.type} ${contract.notNull ? "NOT NULL" : "NULLABLE"}`);
        }
      }
    }
  }

  const primaryKeyRows = rows(await db.execute(sql`
    SELECT table_definition.relname AS table_name,
      array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS columns
    FROM pg_constraint constraint_definition
    JOIN pg_class table_definition ON table_definition.oid = constraint_definition.conrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
    JOIN unnest(constraint_definition.conkey) WITH ORDINALITY key(attribute_number, ordinality) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_definition.conrelid
     AND attribute.attnum = key.attribute_number
    WHERE table_namespace.nspname = current_schema()
      AND constraint_definition.contype = 'p'
      AND table_definition.relname IN (${tableList})
    GROUP BY table_definition.relname, constraint_definition.oid
  `));
  if (feature === "forecasting") {
    for (const [table, columns] of Object.entries(FORECASTING_PRIMARY_KEYS)) {
      const present = primaryKeyRows.some((row) => row.table_name === table
        && Array.isArray(row.columns)
        && row.columns.length === columns.length
        && row.columns.every((column: string, index: number) => column === columns[index]));
      if (!present) missing.push(`${table} PRIMARY KEY(${columns.join(",")})`);
    }
  }

  const uniqueRows = rows(await db.execute(sql`
    SELECT table_definition.relname AS table_name, index_definition.indisunique AS is_unique,
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
      AND index_definition.indisvalid
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
      if (tenant && (tenant.canonical_type !== "text" || tenant.is_not_null !== true)) {
        missing.push(`${table}.org_id TEXT NOT NULL`);
      }
    }
  }

  const indexRows = rows(await db.execute(sql`
    SELECT table_definition.relname AS table_name, index_definition.indisunique AS is_unique,
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
      && row.is_unique === (requirement.unique ?? false)
      && row.columns.length === requirement.columns.length
      && row.columns.every((column: string, index: number) => column === requirement.columns[index]));
    if (!present) missing.push(`${requirement.table} INDEX(${requirement.columns.join(",")})`);
  }

  if (missing.length) {
    throw new Error(`${feature} schema migration is not ready: ${missing.join(", ")}`);
  }
}
