/**
 * Daily Operations Panel — Phase 4
 *
 * Surfaces the proactive daily operations brief: critical athletes,
 * unresolved interventions, churn risks, coach action priorities,
 * recommended org actions, and staffing concerns.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2, RefreshCw, AlertTriangle, TrendingDown, Users, Clock,
  ChevronDown, ChevronUp, Zap, Target, ShieldAlert, BarChart3, ArrowRight
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CriticalAthlete {
  athleteUserId: string;
  athleteName: string;
  riskLevel: "red" | "yellow";
  priorityScore: number;
  activeSignals: string[];
  unresolvedInterventions: number;
  daysSinceLastAction: number;
}

interface ChurnRisk {
  athleteUserId: string;
  athleteName: string;
  churnProbability: "high" | "medium";
  complianceRate: number;
  signals: string[];
}

interface CoachAction {
  rank: number;
  athleteUserId: string;
  athleteName: string;
  actionType: string;
  rationale: string;
  urgency: "critical" | "high" | "medium" | "low";
  estimatedTimeMin: number;
}

interface OrgAction {
  category: string;
  action: string;
  rationale: string;
  urgency: "critical" | "high" | "medium";
  affectedCount?: number;
}

interface DailyOpsBrief {
  orgId: string;
  generatedAt: string;
  criticalAthletes: CriticalAthlete[];
  unresolvedInterventions: Array<{
    draftId: string;
    athleteUserId: string;
    athleteName: string;
    interventionType: string;
    daysWaiting: number;
  }>;
  predictedChurnRisks: ChurnRisk[];
  coachActionPriorities: CoachAction[];
  recommendedOrgActions: OrgAction[];
  recoveryBottlenecks: Array<{ athleteUserId: string; athleteName: string; bottleneck: string }>;
  staffingConcerns: string[];
  summary: {
    criticalCount: number;
    churnsAtRisk: number;
    unresolvedCount: number;
    topPriority: string;
    overallOrgStatus: "healthy" | "caution" | "critical";
  };
}

interface Props {
  orgId: string;
  headers: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyBadge(urgency: string): string {
  const map: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    low: "bg-muted/20 text-muted-foreground border-border/30",
  };
  return map[urgency] ?? map.low;
}

function statusBanner(status: string): { label: string; color: string; bg: string } {
  if (status === "critical") return { label: "Critical — Immediate Action Required", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" };
  if (status === "caution") return { label: "Caution — Attention Needed", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" };
  return { label: "Healthy — No Critical Issues", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, count, colorClass = "text-muted-foreground" }: {
  icon: any; title: string; count?: number; colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
      <span className="text-xs font-semibold">{title}</span>
      {count !== undefined && (
        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-muted/20 text-muted-foreground border-border/30">
          {count}
        </Badge>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DailyOperationsPanel({ orgId, headers }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["coach-actions", "critical"]));

  const { data: brief, isLoading } = useQuery({
    queryKey: ["/api/org/intelligence/daily-ops", orgId],
    queryFn: async () => {
      const res = await fetch("/api/org/intelligence/daily-ops", { headers });
      if (!res.ok) throw new Error("Failed to load daily ops brief");
      return res.json() as Promise<DailyOpsBrief>;
    },
    staleTime: 10 * 60 * 1000,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/intelligence/daily-ops/regenerate", {}, headers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/intelligence/daily-ops", orgId] });
      toast({ title: "Daily ops brief regenerated" });
    },
  });

  function toggleSection(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs py-4">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Generating daily operations brief…
    </div>
  );

  if (!brief) return null;

  const banner = statusBanner(brief.summary.overallOrgStatus);

  return (
    <div className="space-y-4" data-testid="daily-operations-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Daily Operations Brief</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{timeAgo(brief.generatedAt)}</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            data-testid="button-regenerate-daily-ops">
            <RefreshCw className={`h-3 w-3 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Status banner */}
      <div className={`px-3 py-2.5 rounded-lg border ${banner.bg}`}>
        <p className={`text-xs font-semibold ${banner.color}`}>{banner.label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Top priority: {brief.summary.topPriority}
        </p>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        <div className={`px-2.5 py-1 rounded-md border text-[11px] font-medium ${brief.summary.criticalCount > 0 ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}
          data-testid="stat-critical-count">
          {brief.summary.criticalCount} critical
        </div>
        <div className={`px-2.5 py-1 rounded-md border text-[11px] font-medium ${brief.summary.unresolvedCount > 3 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-muted/10 text-muted-foreground border-border/30"}`}
          data-testid="stat-unresolved-count">
          {brief.summary.unresolvedCount} drafts pending
        </div>
        <div className={`px-2.5 py-1 rounded-md border text-[11px] font-medium ${brief.summary.churnsAtRisk > 1 ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-muted/10 text-muted-foreground border-border/30"}`}
          data-testid="stat-churn-count">
          {brief.summary.churnsAtRisk} churn risks
        </div>
      </div>

      {/* Coach Action Priorities */}
      <div>
        <button
          onClick={() => toggleSection("coach-actions")}
          className="flex items-center justify-between w-full group"
          data-testid="toggle-coach-actions">
          <SectionHeader icon={Zap} title="Coach Action Priorities" count={brief.coachActionPriorities.length} colorClass="text-primary" />
          {expandedSections.has("coach-actions") ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </button>
        {expandedSections.has("coach-actions") && (
          <div className="space-y-1.5 mt-1">
            {brief.coachActionPriorities.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">No priority actions — great coaching!</p>
            ) : (
              brief.coachActionPriorities.map((action, i) => (
                <div key={i} data-testid={`row-coach-action-${i}`}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-lg border bg-muted/5 border-border/40">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted/20 text-[10px] font-bold flex items-center justify-center text-muted-foreground">
                    {action.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium capitalize">{action.actionType.replace(/_/g, " ")} — {action.athleteName}</p>
                      <Badge className={`text-[9px] px-1.5 py-0 h-4 border flex-shrink-0 ${urgencyBadge(action.urgency)}`}>
                        {action.urgency}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{action.rationale}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">~{action.estimatedTimeMin} min</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Critical Athletes */}
      {brief.criticalAthletes.length > 0 && (
        <div>
          <button onClick={() => toggleSection("critical")}
            className="flex items-center justify-between w-full"
            data-testid="toggle-critical-athletes">
            <SectionHeader icon={ShieldAlert} title="Critical Athletes" count={brief.criticalAthletes.length} colorClass="text-rose-400" />
            {expandedSections.has("critical") ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
          {expandedSections.has("critical") && (
            <div className="space-y-1.5 mt-1">
              {brief.criticalAthletes.slice(0, 5).map((a, i) => (
                <div key={i} data-testid={`row-critical-athlete-${a.athleteUserId}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${a.riskLevel === "red" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{a.athleteName}</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {a.activeSignals.slice(0, 3).map((sig, j) => (
                        <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-muted/20 text-muted-foreground">
                          {sig.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground flex-shrink-0">
                    <span className={`font-semibold ${a.riskLevel === "red" ? "text-rose-400" : "text-amber-400"}`}>
                      {a.priorityScore}pts
                    </span>
                    {a.unresolvedInterventions > 0 && (
                      <span className="text-amber-400">{a.unresolvedInterventions} draft{a.unresolvedInterventions > 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Predicted Churn Risks */}
      {brief.predictedChurnRisks.length > 0 && (
        <div>
          <button onClick={() => toggleSection("churn")}
            className="flex items-center justify-between w-full"
            data-testid="toggle-churn-risks">
            <SectionHeader icon={TrendingDown} title="Predicted Churn Risks" count={brief.predictedChurnRisks.length} colorClass="text-orange-400" />
            {expandedSections.has("churn") ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
          {expandedSections.has("churn") && (
            <div className="space-y-1.5 mt-1">
              {brief.predictedChurnRisks.slice(0, 5).map((a, i) => (
                <div key={i} data-testid={`row-churn-risk-${a.athleteUserId}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-orange-500/5 border-orange-500/15">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{a.athleteName}</p>
                    <p className="text-[10px] text-muted-foreground">{Math.round(a.complianceRate)}% compliance</p>
                  </div>
                  <Badge className={`text-[9px] px-1.5 py-0 h-4 border flex-shrink-0 ${a.churnProbability === "high" ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-orange-500/20 text-orange-400 border-orange-500/30"}`}>
                    {a.churnProbability} risk
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommended Org Actions */}
      {brief.recommendedOrgActions.length > 0 && (
        <div>
          <button onClick={() => toggleSection("org-actions")}
            className="flex items-center justify-between w-full"
            data-testid="toggle-org-actions">
            <SectionHeader icon={BarChart3} title="Recommended Actions" count={brief.recommendedOrgActions.length} colorClass="text-blue-400" />
            {expandedSections.has("org-actions") ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
          {expandedSections.has("org-actions") && (
            <div className="space-y-1.5 mt-1">
              {brief.recommendedOrgActions.map((action, i) => (
                <div key={i} data-testid={`row-org-action-${i}`}
                  className="flex gap-2.5 px-3 py-2.5 rounded-lg border bg-muted/5 border-border/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-snug">{action.action}</p>
                      <Badge className={`text-[9px] px-1.5 py-0 h-4 border flex-shrink-0 capitalize ${urgencyBadge(action.urgency)}`}>
                        {action.category}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{action.rationale}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Staffing concerns */}
      {brief.staffingConcerns.length > 0 && (
        <div className="px-3 py-2.5 rounded-lg border bg-amber-500/5 border-amber-500/20">
          <p className="text-[11px] font-semibold text-amber-400 mb-1.5">Staffing Concerns</p>
          {brief.staffingConcerns.map((concern, i) => (
            <p key={i} className="text-[10px] text-muted-foreground">{concern}</p>
          ))}
        </div>
      )}
    </div>
  );
}
