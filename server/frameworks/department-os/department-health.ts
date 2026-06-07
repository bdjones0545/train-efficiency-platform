/**
 * Department OS — Health Check Model
 * Reusable health check contract. Each department implements its own checks
 * but they all conform to this interface so the CEO Heartbeat can surface
 * them uniformly in the Attention Inbox and dashboard.
 */

// ─── Health check result ───────────────────────────────────────────────────────

export type HealthSeverity = "critical" | "high" | "medium" | "low";

export interface DepartmentHealthCheck {
  id:             string;
  department:     string;
  severity:       HealthSeverity;
  passed:         boolean;
  title:          string;
  detail:         string;
  recommendation: string;
  checkedAt:      Date;
}

// ─── Health summary ────────────────────────────────────────────────────────────

export interface DepartmentHealthSummary {
  departmentId: string;
  total:        number;
  passed:       number;
  failed:       number;
  critical:     number;
  high:         number;
  medium:       number;
  low:          number;
  checks:       DepartmentHealthCheck[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function summarizeHealthChecks(
  departmentId: string,
  checks: DepartmentHealthCheck[],
): DepartmentHealthSummary {
  const failed = checks.filter(c => !c.passed);
  return {
    departmentId,
    total:    checks.length,
    passed:   checks.filter(c => c.passed).length,
    failed:   failed.length,
    critical: failed.filter(c => c.severity === "critical").length,
    high:     failed.filter(c => c.severity === "high").length,
    medium:   failed.filter(c => c.severity === "medium").length,
    low:      failed.filter(c => c.severity === "low").length,
    checks,
  };
}

export function healthStatusLabel(summary: DepartmentHealthSummary): string {
  if (summary.critical > 0) return "critical";
  if (summary.high > 0)     return "degraded";
  if (summary.medium > 0)   return "warning";
  if (summary.failed > 0)   return "notice";
  return "healthy";
}

export function severityToAttentionScore(severity: HealthSeverity): {
  severity: number; urgency: number; businessImpact: number;
} {
  const map: Record<HealthSeverity, { severity: number; urgency: number; businessImpact: number }> = {
    critical: { severity: 90, urgency: 90, businessImpact: 85 },
    high:     { severity: 70, urgency: 75, businessImpact: 70 },
    medium:   { severity: 50, urgency: 50, businessImpact: 55 },
    low:      { severity: 20, urgency: 15, businessImpact: 25 },
  };
  return map[severity];
}
