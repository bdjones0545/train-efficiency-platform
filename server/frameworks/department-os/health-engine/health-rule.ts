/**
 * Department OS v2 — Health Rule
 * Declarative health rule contract. Departments define rules as config objects;
 * the DepartmentHealthEngine evaluates them and returns DepartmentHealthCheck results.
 */

import type { HealthSeverity, DepartmentHealthCheck } from "../department-health";

// ─── Health rule ───────────────────────────────────────────────────────────────

export interface HealthRule {
  id:          string;
  department:  string;
  severity:    HealthSeverity;
  title:       string;
  evaluate():  Promise<{
    passed:         boolean;
    detail:         string;
    recommendation: string;
  }>;
}

// ─── Rule factory helpers ──────────────────────────────────────────────────────

/** Wrap any async evaluation into a HealthRule */
export function defineRule(opts: {
  id:         string;
  department: string;
  severity:   HealthSeverity;
  title:      string;
  check:      () => Promise<{ passed: boolean; detail: string; recommendation: string }>;
}): HealthRule {
  return {
    id:         opts.id,
    department: opts.department,
    severity:   opts.severity,
    title:      opts.title,
    evaluate:   opts.check,
  };
}

/** Run a HealthRule and map it to a DepartmentHealthCheck */
export async function evaluateRule(rule: HealthRule): Promise<DepartmentHealthCheck> {
  const result = await rule.evaluate();
  return {
    id:             rule.id,
    department:     rule.department,
    severity:       rule.severity,
    passed:         result.passed,
    title:          rule.title,
    detail:         result.detail,
    recommendation: result.recommendation,
    checkedAt:      new Date(),
  };
}

// ─── Rule set ──────────────────────────────────────────────────────────────────

export interface HealthRuleSet {
  departmentId: string;
  rules:        HealthRule[];
}
