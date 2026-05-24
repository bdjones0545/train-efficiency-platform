/**
 * Recommendation Panel — Phase 7
 *
 * Shows operator-facing recommendations based on org state analysis.
 * All recommendations are explainable, dismissible, logged, and non-autonomous.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lightbulb, X, ChevronRight, ArrowRight, AlertTriangle, CheckCircle,
  Zap, TrendingUp, Shield, GitBranch, Cpu, Info,
} from "lucide-react";

type Recommendation = {
  id: string;
  type: "workflow" | "integration" | "governance" | "approval" | "agent" | "automation";
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  action?: string;
  actionUrl?: string;
  actionLabel?: string;
  impact: string;
};

const PRIORITY_CONFIG = {
  high:   { badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",    dot: "bg-red-500" },
  medium: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-500" },
  low:    { badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",  dot: "bg-blue-400" },
};

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
  workflow: GitBranch, integration: Zap, governance: Shield,
  approval: CheckCircle, agent: Cpu, automation: TrendingUp,
};

function RecommendationCard({ rec, onDismiss, onAccept }: {
  rec: Recommendation;
  onDismiss: (id: string) => void;
  onAccept: (id: string, actionUrl?: string) => void;
}) {
  const Icon = TYPE_ICONS[rec.type] ?? Lightbulb;
  const pCfg = PRIORITY_CONFIG[rec.priority];

  return (
    <div
      className="flex items-start gap-3 p-3.5 rounded-xl border bg-card hover:shadow-sm transition-shadow"
      data-testid={`recommendation-${rec.id}`}
    >
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
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
          <p className="text-xs font-semibold leading-tight">{rec.title}</p>
          <button
            onClick={() => onDismiss(rec.id)}
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            data-testid={`dismiss-${rec.id}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{rec.reason}</p>

        <div className="flex items-center gap-2 mt-2">
          <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-medium ${pCfg.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full inline-block ${pCfg.dot}`} />
            {rec.priority}
          </span>
          <span className="text-[10px] text-muted-foreground">{rec.impact}</span>
        </div>

        {rec.actionLabel && (
          <button
            onClick={() => onAccept(rec.id, rec.actionUrl)}
            className="mt-2 text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
            data-testid={`accept-${rec.id}`}
          >
            {rec.actionLabel} <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

interface RecommendationPanelProps {
  compact?: boolean;
  className?: string;
}

export function RecommendationPanel({ compact = false, className = "" }: RecommendationPanelProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data: recs, isLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations"],
    select: (d: any) => Array.isArray(d) ? d : [],
    refetchInterval: 120000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/recommendations/${id}/dismiss`),
    onSuccess: (_, id) => {
      setDismissed(prev => new Set([...prev, id]));
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/recommendations/${id}/accept`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
  });

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id);
    setDismissed(prev => new Set([...prev, id]));
  };

  const handleAccept = (id: string, url?: string) => {
    acceptMutation.mutate(id);
    if (url) window.location.href = url;
  };

  const visible = (recs ?? []).filter(r => !dismissed.has(r.id));
  const highPriority = visible.filter(r => r.priority === "high");
  const rest = visible.filter(r => r.priority !== "high");
  const displayList = compact ? visible.slice(0, 3) : [...highPriority, ...rest];

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  if (displayList.length === 0) {
    return (
      <div className={`flex items-center gap-2 p-4 rounded-xl border bg-muted/30 ${className}`} data-testid="no-recommendations">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <p className="text-xs text-muted-foreground">No recommendations right now — your setup looks good!</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`} data-testid="recommendation-panel">
      {!compact && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            Recommendations
            {highPriority.length > 0 && (
              <span className="h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {highPriority.length}
              </span>
            )}
          </p>
          <span className="text-[10px] text-muted-foreground">{visible.length} suggestion{visible.length !== 1 ? "s" : ""}</span>
        </div>
      )}
      {displayList.map(rec => (
        <RecommendationCard
          key={rec.id}
          rec={rec}
          onDismiss={handleDismiss}
          onAccept={handleAccept}
        />
      ))}
      {compact && visible.length > 3 && (
        <p className="text-xs text-center text-muted-foreground">{visible.length - 3} more recommendations</p>
      )}
    </div>
  );
}
