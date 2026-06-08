/**
 * Department OS v2 — Builder Guide
 * The authoritative reference for creating new departments.
 * All required components, optional components, and API gotchas documented here.
 */

// ─── Component guide entry ────────────────────────────────────────────────────

export interface ComponentGuideEntry {
  name:         string;
  category:     "required" | "optional";
  file:         string;
  description:  string;
  frameworkAPIs: string[];
  notes:        string[];
}

// ─── Required components ──────────────────────────────────────────────────────

export const REQUIRED_COMPONENTS: ComponentGuideEntry[] = [
  {
    name:         "1. Database Tables",
    category:     "required",
    file:         "{name}-routes.ts (createTables function)",
    description:  "Domain tables for the department's core entities and signals. Tables are created on startup via createTables() inside the route registration function.",
    frameworkAPIs: ["db.execute(sql`CREATE TABLE IF NOT EXISTS ...`)", "db from server/db"],
    notes:        [
      "Always use IF NOT EXISTS for idempotent startup",
      "Add org_id column to every table for multi-tenancy",
      "Index on org_id + status for query performance",
      "Include created_at and updated_at for time-based health checks",
    ],
  },
  {
    name:         "2. Assessment Agent",
    category:     "required",
    file:         "{name}-assessment-agent.ts",
    description:  "Scores and qualifies entities using the Assessment Framework's keyword scoring and composite score engines.",
    frameworkAPIs: [
      "scoreKeywords(text, rules: KeywordRule[])",
      "compositeScore(dimensions: Record<string,number>, weights: ScoringWeight[])",
      "KeywordRule = { keywords: string[], points: number }",
      "ScoringWeight = { key: string, weight: number }",
    ],
    notes:        [
      "KeywordRule[] NOT string[] — always pass objects with { keywords, points }",
      "compositeScore() NOT AssessmentDimension[] — pass Record<string,number> + ScoringWeight[]",
      "Score range is 0–100 by convention",
    ],
  },
  {
    name:         "3. Learning Agent",
    category:     "required",
    file:         "{name}-learning-agent.ts",
    description:  "Maps domain data to the Signal type, then calls buildLearningReport and generateStandardInsights from the Learning Engine.",
    frameworkAPIs: [
      "Signal = { orgId, department, source, category, score, contacted, responded, converted, terminal, won, recordedAt: Date }",
      "buildLearningReport(departmentId, orgId, signals, totalEntities, insights)",
      "generateStandardInsights(cfg: InsightGeneratorConfig)",
      "InsightGeneratorConfig = { department, orgId, entityLabel, signals, totalEntities, ... }",
    ],
    notes:        [
      "Signal.responded NOT Signal.replied — use the correct field name",
      "Signal.won + Signal.terminal NOT Signal.declined — use terminal=true, won=false for losses",
      "buildLearningReport takes 5 positional args — do NOT pass LearningReport as InsightGeneratorConfig",
      "Pass pre-generated insights as the 5th arg to buildLearningReport",
    ],
  },
  {
    name:         "4. Executive Agent",
    category:     "required",
    file:         "{name}-executive-agent.ts",
    description:  "Generates the BestAction ranking, ExecutiveBrief, and prioritized DepartmentRecommendations using the Executive Engine.",
    frameworkAPIs: [
      "rankBestActions(department: string, candidates: BestActionCandidate[])",
      "candidate(condition: boolean, action: Omit<BestAction,'department'>, priorityScore?: number)",
      "composeBrief({ department, orgId, summary, bestActionToday, keyWins, keyRisks, keyOpportunities, metrics })",
      "prioritizeRecommendations(recs: DepartmentRecommendation[])",
      "buildWinsFromCounts(metrics, labels)",
      "buildRisksFromChecks(counts, rules)",
      "formatPipelineSummary(opts)",
    ],
    notes:        [
      "BestAction = { department, title, description, priority, route, estimatedImpact? }",
      "candidate() action arg is Omit<BestAction,'department'> — do NOT include department field",
      "rankBestActions() 1st arg is department string — NOT candidates array",
      "DepartmentRecommendation NOT Recommendation — use the full type name",
      "composeBrief() field is bestActionToday NOT bestAction or action",
    ],
  },
  {
    name:         "5. Department Coordinator",
    category:     "required",
    file:         "{name}-department-coordinator.ts",
    description:  "Implements the DepartmentCoordinator interface (or extends BaseDepartmentCoordinator). This is the single object registered with the Department Registry.",
    frameworkAPIs: [
      "BaseDepartmentCoordinator from department-coordinator.ts",
      "HeartbeatReviewResult = { departmentId, departmentName, checksRun, checksPassed, alertsCreated, bestAction, executiveSummary, healthChecks }",
      "DepartmentSummaryResult = { departmentId, departmentName, executiveSummary, metrics, bestAction, generatedAt }",
      "DepartmentHealthCheck = { id, department, severity, passed: boolean, title, detail, recommendation, checkedAt: Date }",
      "departmentHealthEngine.createAttentionItemsFromFailed(orgId, agentName, sourceSystem, checks)",
    ],
    notes:        [
      "HeartbeatReviewResult has NO attentionItems field — removed in v2",
      "DepartmentSummaryResult has NO status or highlights fields",
      "DepartmentHealthCheck uses passed:boolean NOT status:'failed'/'passed'",
      "DepartmentHealthCheck uses title/detail/recommendation NOT name/message/suggestedAction",
      "createAttentionItemsFromFailed takes 4 args: orgId, agentName, sourceSystem, checks",
      "checkedAt is Date NOT string",
    ],
  },
  {
    name:         "6. Routes",
    category:     "required",
    file:         "{name}-routes.ts",
    description:  "14+ REST endpoints for the department. Must be registered inside registerRoutes() in server/routes.ts — NOT in server/index.ts.",
    frameworkAPIs: [
      "registerRoutes() in server/routes.ts",
      "isAuthenticated middleware",
      "requireRole middleware",
    ],
    notes:        [
      "CRITICAL: ALL routes must go inside registerRoutes() in server/routes.ts",
      "Routes added to server/index.ts are shadowed by Vite SPA catch-all and return HTML",
      "Use static imports at top of routes file — dynamic import() causes TS errors in strict mode",
      "departmentRegistry.register(coordinator, meta) takes 2 args — meta is required",
      "meta = { name, description, version, enabled, discoveryEnabled, outreachEnabled, executionEnabled, learningEnabled, executiveEnabled }",
    ],
  },
  {
    name:         "7. Admin UI Page",
    category:     "required",
    file:         "client/src/pages/admin-{name}.tsx",
    description:  "6-tab React admin page at /admin/{name}. Uses TanStack Query for data, Shadcn UI components, and data-testid on all interactive elements.",
    frameworkAPIs: [
      "useQuery from @tanstack/react-query",
      "Tabs/TabsContent/TabsList/TabsTrigger from @/components/ui/tabs",
      "Card/CardContent/CardHeader/CardTitle from @/components/ui/card",
      "Badge from @/components/ui/badge",
    ],
    notes:        [
      "Add data-testid to every button, input, and interactive element",
      "Add route to client/src/App.tsx",
      "Add sidebar entry to client/src/components/app-sidebar.tsx",
      "Do NOT import React explicitly — Vite JSX transform handles it",
    ],
  },
  {
    name:         "8. Registry Registration",
    category:     "required",
    file:         "server/routes.ts (inside registerRoutes)",
    description:  "Register the department coordinator with the Department Registry during startup.",
    frameworkAPIs: [
      "departmentRegistry.register(coordinator, meta)",
      "DepartmentRegistry from server/services/department-registry.ts",
    ],
    notes:        [
      "Use static imports — NOT dynamic import().then() chains",
      "Call register() inside a try/catch — registration failure should not crash startup",
      "Log success: console.log('[{name}] department registered with Department OS')",
    ],
  },
];

// ─── Optional components ──────────────────────────────────────────────────────

export const OPTIONAL_COMPONENTS: ComponentGuideEntry[] = [
  {
    name:         "Outreach Agent",
    category:     "optional",
    file:         "{name}-outreach-agent.ts",
    description:  "Generates outreach email drafts for qualified entities using OpenAI. Required for Level 3 (Operations) maturity.",
    frameworkAPIs: ["OpenAI client from server/lib/openai", "gmail_agent_actions table for draft storage"],
    notes:        [
      "Store drafts in gmail_agent_actions with action_type='send_email'",
      "Always gate sending through evaluatePolicy() — never auto-send",
    ],
  },
  {
    name:         "Execution Agent",
    category:     "optional",
    file:         "{name}-execution-agent.ts",
    description:  "Runs execution logic (scheduling calls, processing replies, updating deal stages).",
    frameworkAPIs: [],
    notes:        ["Always implement with approval gates — no autonomous execution without policy check"],
  },
  {
    name:         "Reply Intelligence",
    category:     "optional",
    file:         "{name}-reply-classifier.ts",
    description:  "Classifies inbound replies (interested / not interested / needs follow-up) using OpenAI.",
    frameworkAPIs: ["reply-classifier pattern from server/email-agent/reply-classifier.ts"],
    notes:        [],
  },
  {
    name:         "Pipeline Stages",
    category:     "optional",
    file:         "Embedded in domain tables",
    description:  "A status column with named pipeline stages (new / qualified / contacted / meeting / negotiation / closed).",
    frameworkAPIs: [],
    notes:        ["Use a text status column with a domain-specific set of stages"],
  },
  {
    name:         "Learning Signals Table",
    category:     "optional",
    file:         "{name}_learning_signals (DB table)",
    description:  "Dedicated table for recording outreach signal data (sent, replied, converted, etc.) used by the Learning Agent.",
    frameworkAPIs: ["Signal type from learning-engine"],
    notes:        ["Only needed if domain data doesn't already encode contacted/responded/won"],
  },
];

// ─── API Gotcha Registry ──────────────────────────────────────────────────────

export interface ApiGotcha {
  id:          string;
  function:    string;
  problem:     string;
  correct:     string;
  discoveredIn: string;
}

export const API_GOTCHAS: ApiGotcha[] = [
  {
    id:           "register_2_args",
    function:     "departmentRegistry.register()",
    problem:      "Called with 1 arg: departmentRegistry.register(coordinator)",
    correct:      "departmentRegistry.register(coordinator, { name, description, version, enabled, ... })",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "candidate_action_shape",
    function:     "candidate()",
    problem:      "Passed BestAction with department field: candidate(true, { department, title, ... })",
    correct:      "candidate(condition, { title, description, priority, route }, score) — action is Omit<BestAction,'department'>",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "rank_best_actions_dept_first",
    function:     "rankBestActions()",
    problem:      "Called as rankBestActions(candidates) — 1 arg",
    correct:      "rankBestActions('department-id', candidates) — department string is first arg",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "signal_responded_not_replied",
    function:     "Signal interface",
    problem:      "Used Signal.replied or Signal.declined",
    correct:      "Signal.responded (for reply), Signal.won + Signal.terminal (for outcome). No 'declined' field — use terminal=true, won=false",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "build_learning_report_5_args",
    function:     "buildLearningReport()",
    problem:      "Called as buildLearningReport(report) — 1 arg passing the report object",
    correct:      "buildLearningReport(departmentId, orgId, signals, totalEntities, insights) — 5 positional args",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "generate_standard_insights_config",
    function:     "generateStandardInsights()",
    problem:      "Called as generateStandardInsights(orgId, signals) or passed a LearningReport",
    correct:      "generateStandardInsights({ department, orgId, entityLabel, signals, totalEntities, ... }) — InsightGeneratorConfig object",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "health_check_passed_not_status",
    function:     "DepartmentHealthCheck",
    problem:      "Used status:'failed'/'passed', name, message, suggestedAction fields",
    correct:      "Use passed:boolean, title, detail, recommendation, checkedAt:Date fields",
    discoveredIn: "Hiring + Partnerships",
  },
  {
    id:           "heartbeat_no_attention_items",
    function:     "HeartbeatReviewResult",
    problem:      "Added attentionItems field to HeartbeatReviewResult",
    correct:      "HeartbeatReviewResult has no attentionItems — use alertsCreated (number) instead",
    discoveredIn: "Hiring + Partnerships",
  },
  {
    id:           "summary_no_status",
    function:     "DepartmentSummaryResult",
    problem:      "Added status or highlights fields to DepartmentSummaryResult",
    correct:      "DepartmentSummaryResult = { departmentId, departmentName, executiveSummary, metrics, bestAction, generatedAt }",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "create_attention_items_4_args",
    function:     "createAttentionItemsFromFailed()",
    problem:      "Called as createAttentionItemsFromFailed(checks) — 1 arg",
    correct:      "createAttentionItemsFromFailed(orgId, agentName, sourceSystem, checks) — 4 args, returns Promise<number>",
    discoveredIn: "Hiring + Partnerships",
  },
  {
    id:           "static_import_preferred",
    function:     "Dynamic import()",
    problem:      "Used dynamic import().then() chains for coordinator registration",
    correct:      "Use static imports at top of routes file — dynamic import() in non-async contexts causes TS strict-mode errors",
    discoveredIn: "Partnerships Department",
  },
  {
    id:           "routes_inside_register_routes",
    function:     "Route registration location",
    problem:      "Registered routes in server/index.ts after registerRoutes()",
    correct:      "ALL routes MUST be inside registerRoutes() in server/routes.ts — index.ts routes are shadowed by Vite SPA catch-all",
    discoveredIn: "Multiple departments",
  },
  {
    id:           "keyword_rule_shape",
    function:     "scoreKeywords()",
    problem:      "Passed string[] as rules: scoreKeywords(text, ['word1', 'word2'])",
    correct:      "scoreKeywords(text, rules: KeywordRule[]) where KeywordRule = { keywords: string[], points: number }",
    discoveredIn: "Hiring Department",
  },
];

// ─── Builder guide export ──────────────────────────────────────────────────────

export const BUILDER_GUIDE = {
  requiredComponents: REQUIRED_COMPONENTS,
  optionalComponents: OPTIONAL_COMPONENTS,
  apiGotchas:         API_GOTCHAS,
  version:            "2.0.0",
  lastUpdated:        "2025-06",
};
