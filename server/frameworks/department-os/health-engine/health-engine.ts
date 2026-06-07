/**
 * Department OS v2 — Health Engine
 * Runs a set of HealthRules in parallel, maps results to DepartmentHealthChecks,
 * and creates attention inbox items for failed checks.
 * Replaces duplicated `runHealthChecks` + `createAttentionItems` in each coordinator.
 */

import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { DepartmentHealthCheck, HealthSeverity } from "../department-health";
import { summarizeHealthChecks } from "../department-health";
import type { HealthRule, HealthRuleSet } from "./health-rule";
import { evaluateRule } from "./health-rule";

// ─── Severity score ────────────────────────────────────────────────────────────

function severityScore(s: HealthSeverity): number {
  return { critical: 90, high: 70, medium: 50, low: 20 }[s] ?? 30;
}

// ─── Run health rules ──────────────────────────────────────────────────────────

export class DepartmentHealthEngine {
  async runRules(ruleSet: HealthRuleSet): Promise<DepartmentHealthCheck[]> {
    const results = await Promise.allSettled(
      ruleSet.rules.map(rule => evaluateRule(rule)),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<DepartmentHealthCheck> => r.status === "fulfilled")
      .map(r => r.value);
  }

  async runAndSummarize(ruleSet: HealthRuleSet) {
    const checks = await this.runRules(ruleSet);
    return summarizeHealthChecks(ruleSet.departmentId, checks);
  }

  // ─── Attention inbox creation ──────────────────────────────────────────────

  async createAttentionItemsFromFailed(
    orgId: string,
    agentName: string,
    sourceSystem: string,
    checks: DepartmentHealthCheck[],
  ): Promise<number> {
    const failed = checks.filter(c => !c.passed);
    let created = 0;
    for (const check of failed) {
      try {
        const score = severityScore(check.severity);
        await db.execute(sql`
          INSERT INTO attention_items
            (org_id, agent_name, severity, urgency, business_impact, title, description,
             recommended_action, source_system, action_type, status)
          VALUES (
            ${orgId}, ${agentName},
            ${score}, ${score}, ${Math.round(score * 0.9)},
            ${check.title}, ${check.detail}, ${check.recommendation},
            ${sourceSystem}, 'review', 'pending'
          )
        `);
        created++;
      } catch { /* non-fatal — attention items are best-effort */ }
    }
    return created;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const departmentHealthEngine = new DepartmentHealthEngine();
