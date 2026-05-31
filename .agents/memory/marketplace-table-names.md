---
name: Marketplace Real Table Names
description: Actual DB table/column names for marketplace-related data — frequently mismatched when writing new analytics queries
---

## Rule
Always use these table names for marketplace analytics queries — not invented names.

| Concept                  | Real Table                      | Key Columns                                                      |
|--------------------------|----------------------------------|------------------------------------------------------------------|
| Agent installs           | `org_installed_agents`           | id, org_id, agent_template_id, agent_id, status, created_at      |
| Agent reviews            | `agent_reviews`                  | id, agent_id, org_id, rating, review, created_at                 |
| Developer royalty accts  | `developer_royalty_accounts`     | id, developer_id, balance, lifetime_earned, lifetime_paid        |
| Royalty payouts          | `royalty_distributions`          | id, developer_id, agent_id, gross_revenue, developer_share       |
| Agent catalog            | `agent_templates`                | id, agent_id, agent_name, status ('active'/'pending_review'), NO org/creator FK |
| Executions               | `unified_agent_action_log`       | id, org_id, entity_id (agent), entity_type, created_at           |
| Revenue events           | `ai_revenue_events`              | created_at                                                       |

**Why:** These names were wrong in first-draft code and caused runtime 500 errors (relation does not exist / column does not exist).

**How to apply:**
- `agent_templates` has NO `created_by_org_id` or `org_id` — use `developer_royalty_accounts` to count devs, `maintainer` text column for display only.
- `org_installed_agents.status` values: `'active'` | `'inactive'`
- `agent_templates.status` values: `'active'` | `'pending_review'`
- Always wrap `db.execute()` results with the `rows()` / `row0()` helpers to handle the array-vs-QueryResult shape difference.
- Dynamic import modules (`await import("./beta-wave1-routes")`) require a full workflow restart to pick up file changes — tsx does NOT hot-reload dynamically-imported modules automatically.
