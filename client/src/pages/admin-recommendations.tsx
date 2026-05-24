/**
 * Operator Recommendations Page — Phase 7
 *
 * Full-page view of all AI system recommendations.
 * Each recommendation is explainable, dismissible, and logged.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lightbulb, X, ChevronRight, GitBranch, Zap, Shield,
  CheckCircle, Cpu, TrendingUp, Globe, RefreshCw, Info,
  Filter, BarChart2,
} from "lucide-react";
import { SetupProgressWidget } from "@/components/setup-progress-widget";
import { TrustSignalsWidget } from "@/components/trust-signals-widget";

type Recommendation = {
  id: string;
  type: "workflow" | "integration" | "governance" | "approval" | "agent" | "automation";
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  impact: string;
  actionLabel?: string;
  actionUrl?: string;
};

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  workflow: GitBranch, integration: Zap, governance: Shield,
  approval: CheckCircle, agent: Cpu, automation: TrendingUp,
};

const PRIORITY_CONFIG = {
  high:   { badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",    dot: "bg-red-500",    label: "High Priority" },
  medium: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-500", label: "Medium Priority" },
  low:    { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",  dot: "bg-blue-400",   label: "Low Priority" },
};

export default function AdminRecommendationsPage() {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const { data: recs, isLoading, refetch } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/recommendations/${id}/dismiss`),
    onSuccess: (_, id) => {
      setDismissed(prev => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      toast({ title: "Recommendation dismissed" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/recommendations/${id}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const handleAccept = (rec: Recommendation) => {
    acceptMutation.mutate(rec.id);
    if (rec.actionUrl) window.location.href = rec.actionUrl;
  };

  const visible = (recs ?? []).filter(r => !dismissed.has(r.id));
  const filtered = filter === "all" ? visible : visible.filter(r => r.priority === filter);

  const highCount = visible.filter(r => r.priority === "high").length;
  const medCount = visible.filter(r => r.priority === "medium").length;
  const lowCount = visible.filter(r => r.priority === "low").length;

  return (
    <div className="space-y-6" data-testid="page-recommendations">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Recommendations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Proactive suggestions to optimize your AI operations. All actions are yours to take.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" data-testid="button-refresh-recommendations">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main recommendations */}
        <div className="lg:col-span-2 space-y-4">
          {/* Priority summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "High Priority", count: highCount, priority: "high" as const, dot: "bg-red-500" },
              { label: "Medium", count: medCount, priority: "medium" as const, dot: "bg-amber-500" },
              { label: "Low", count: lowCount, priority: "low" as const, dot: "bg-blue-400" },
            ].map(p => (
              <button
                key={p.priority}
                onClick={() => setFilter(filter === p.priority ? "all" : p.priority)}
                className={`p-3 rounded-xl border text-left transition-all hover:shadow-sm ${
                  filter === p.priority ? "border-primary bg-primary/5 shadow-sm" : "border-border"
                }`}
                data-testid={`filter-${p.priority}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                  <span className="text-lg font-bold">{p.count}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{p.label}</p>
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {filter === "all" ? `Showing all ${visible.length}` : `Showing ${filtered.length} ${filter} priority`}
            </span>
            {filter !== "all" && (
              <button onClick={() => setFilter("all")} className="text-xs text-primary hover:underline">
                Clear filter
              </button>
            )}
          </div>

          {/* Cards */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl border border-dashed" data-testid="empty-recommendations">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <div>
                <p className="text-sm font-semibold">
                  {visible.length === 0 ? "All clear — no recommendations right now" : "No recommendations at this priority level"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Your setup looks great! We'll surface suggestions as your usage grows.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(rec => {
                const Icon = TYPE_ICONS[rec.type] ?? Lightbulb;
                const pCfg = PRIORITY_CONFIG[rec.priority];
                return (
                  <Card key={rec.id} className="hover:shadow-sm transition-shadow" data-testid={`rec-${rec.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                          rec.priority === "high" ? "bg-red-100 dark:bg-red-900/30" :
                          rec.priority === "medium" ? "bg-amber-100 dark:bg-amber-900/30" :
                          "bg-blue-100 dark:bg-blue-900/30"
                        }`}>
                          <Icon className={`h-4 w-4 ${
                            rec.priority === "high" ? "text-red-600" :
                            rec.priority === "medium" ? "text-amber-600" : "text-blue-600"
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold">{rec.title}</p>
                            <button
                              onClick={() => dismissMutation.mutate(rec.id)}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              data-testid={`dismiss-${rec.id}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.reason}</p>

                          {/* Impact */}
                          <div className="flex items-start gap-1.5 mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                            <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{rec.impact}</span>
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-2 border-t">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${pCfg.badge}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${pCfg.dot}`} />
                                {pCfg.label}
                              </span>
                              <Badge variant="outline" className="text-[10px] h-4 capitalize">{rec.type}</Badge>
                            </div>
                            {rec.actionLabel && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                onClick={() => handleAccept(rec)}
                                data-testid={`action-${rec.id}`}
                              >
                                {rec.actionLabel} <ChevronRight className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Explainability callout */}
          <div className="flex items-start gap-2.5 p-4 rounded-xl border bg-muted/30">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium">About these recommendations</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Recommendations are generated by analyzing your connected integrations, active workflows, governance settings, and operational patterns.
                All suggestions are for you to act on — nothing happens automatically.
                Dismissed recommendations won't return unless the underlying condition changes.
              </p>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <SetupProgressWidget />
          <TrustSignalsWidget />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Open Workflow Builder", url: "/admin/workflow-builder", icon: GitBranch },
                { label: "View AI Workforce", url: "/admin/ai-workforce", icon: Cpu },
                { label: "Configure Governance", url: "/admin/ai-governance", icon: Shield },
                { label: "Run Setup Wizard", url: "/onboarding/ai-workforce", icon: Zap },
              ].map(a => (
                <Link key={a.url} href={a.url}>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-8 text-xs">
                    <a.icon className="h-3.5 w-3.5" />{a.label}
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
