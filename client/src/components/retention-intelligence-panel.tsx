/**
 * RetentionIntelligencePanel — UI component for Retention Agent analysis.
 *
 * States: not_analyzed | requesting | queued | analyzing | completed |
 *         requires_approval | failed | unavailable
 *
 * Uses polling (with exponential backoff) that stops on terminal state.
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "low" | "moderate" | "high" | "critical";
type JobStatus =
  | "requested"
  | "dispatching"
  | "queued"
  | "running"
  | "requires_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked_by_policy";

interface RetentionAnalysis {
  id: string;
  riskLevel: RiskLevel;
  riskScore: number;
  confidenceScore: number;
  summary: string;
  riskFactors: string[];
  recommendedActions: string[];
  draftMessage: string | null;
  evidence: string[];
  modelVersion: string | null;
  createdAt: string | null;
}

interface AgentJob {
  id: string;
  status: JobStatus;
  agentId: string;
  taskType: string;
  clientId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string | null;
}

interface LatestResponse {
  analysis: RetentionAnalysis | null;
  activeJob: AgentJob | null;
  latestJob: AgentJob | null;
  meta: {
    hasResult: boolean;
    hasPendingJob: boolean;
    canAnalyze: boolean;
  };
}

// ─── Terminal states that stop polling ────────────────────────────────────────

const TERMINAL: Set<JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked_by_policy",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskLevelColor(level: RiskLevel): string {
  switch (level) {
    case "critical": return "bg-red-100 text-red-800 border-red-200";
    case "high":     return "bg-orange-100 text-orange-800 border-orange-200";
    case "moderate": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "low":      return "bg-green-100 text-green-800 border-green-200";
    default:         return "bg-gray-100 text-gray-700";
  }
}

function riskScoreBarColor(score: number): string {
  if (score >= 75) return "bg-red-500";
  if (score >= 50) return "bg-orange-400";
  if (score >= 25) return "bg-yellow-400";
  return "bg-green-400";
}

function statusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    requested: "Requesting",
    dispatching: "Dispatching",
    queued: "Queued",
    running: "Analyzing",
    requires_approval: "Requires Approval",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    timed_out: "Timed Out",
    blocked_by_policy: "Blocked by Policy",
  };
  return labels[status] ?? status;
}

function isPending(status: JobStatus): boolean {
  return !TERMINAL.has(status);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  className?: string;
}

export function RetentionIntelligencePanel({ clientId, className = "" }: Props) {
  const queryClient = useQueryClient();
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number | null>(null);

  // ── Fetch latest analysis + job state ─────────────────────────────────────
  const { data: latest, isLoading: latestLoading, refetch: refetchLatest } = useQuery<LatestResponse>({
    queryKey: ["/api/clients", clientId, "retention-analyses", "latest"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/retention-analyses/latest`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 5000,
  });

  // ── Poll active job ───────────────────────────────────────────────────────
  const { data: jobData } = useQuery<{ job: AgentJob; meta: { isTerminal: boolean } }>({
    queryKey: ["/api/agent-jobs", pollingJobId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-jobs/${pollingJobId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!pollingJobId,
    refetchInterval: pollInterval ?? false,
    staleTime: 0,
  });

  // Stop polling when job reaches terminal state
  useEffect(() => {
    if (!jobData) return;
    const { isTerminal } = jobData.meta;
    if (isTerminal) {
      setPollInterval(null);
      setPollingJobId(null);
      // Refresh the latest analysis data
      setTimeout(() => refetchLatest(), 500);
    }
  }, [jobData, refetchLatest]);

  // Pick up active job from latest response
  useEffect(() => {
    const activeJob = latest?.activeJob;
    if (activeJob && !TERMINAL.has(activeJob.status) && pollingJobId !== activeJob.id) {
      setPollingJobId(activeJob.id);
      setPollInterval(3000);
    }
  }, [latest?.activeJob, pollingJobId]);

  // ── Trigger analysis ──────────────────────────────────────────────────────
  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/retention-analysis`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Request failed with status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      const job = data.job as AgentJob;
      setPollingJobId(job.id);
      setPollInterval(2000);
      refetchLatest();
    },
  });

  // ── Determine UI state ────────────────────────────────────────────────────

  const activeJob = latest?.meta.hasPendingJob
    ? (latest.activeJob ?? jobData?.job ?? null)
    : null;
  const analysis = latest?.analysis ?? null;
  const canAnalyze = latest?.meta.canAnalyze ?? true;
  const latestJob = latest?.latestJob ?? null;

  const currentJobStatus: JobStatus | null =
    activeJob?.status ?? (triggerMutation.isPending ? "requesting" as any : null);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className={`border ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-600" />
            <CardTitle className="text-base font-semibold">Retention Intelligence</CardTitle>
            <Badge variant="outline" className="text-xs text-violet-600 border-violet-300">
              Powered by Kevin
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {/* Status badge */}
            {currentJobStatus && isPending(currentJobStatus) && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                {statusLabel(currentJobStatus)}
              </Badge>
            )}

            {/* Action button */}
            {canAnalyze && !triggerMutation.isPending && !activeJob && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending}
                className="gap-1.5"
              >
                {analysis ? <RefreshCw className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
                {analysis ? "Re-analyze" : "Analyze Retention Risk"}
              </Button>
            )}

            {/* Retry button for failed jobs */}
            {!canAnalyze === false && latestJob && TERMINAL.has(latestJob.status) && latestJob.status !== "completed" && !activeJob && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
          </div>
        </div>

        {analysis && (
          <CardDescription className="text-xs">
            Last analyzed {fmtDate(analysis.createdAt)}
            {analysis.modelVersion && ` · ${analysis.modelVersion}`}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error from trigger */}
        {triggerMutation.isError && (
          <StatusBanner
            icon={<XCircle className="h-4 w-4 text-red-500" />}
            message={(triggerMutation.error as Error)?.message ?? "Failed to start analysis."}
            variant="error"
          />
        )}

        {/* ── Loading initial state ── */}
        {latestLoading && (
          <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        )}

        {/* ── Not analyzed yet ── */}
        {!latestLoading && !analysis && !activeJob && !triggerMutation.isPending && (
          <EmptyState onAnalyze={() => triggerMutation.mutate()} />
        )}

        {/* ── Active job progress ── */}
        {activeJob && isPending(activeJob.status) && (
          <PendingState job={activeJob} />
        )}

        {/* ── Failed job ── */}
        {!activeJob && latestJob && latestJob.status !== "completed" && TERMINAL.has(latestJob.status) && !analysis && (
          <FailedState job={latestJob} onRetry={() => triggerMutation.mutate()} />
        )}

        {/* ── Completed analysis ── */}
        {analysis && (
          <AnalysisResult analysis={analysis} />
        )}

        {/* Requires approval notice */}
        {activeJob?.status === "requires_approval" && (
          <StatusBanner
            icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}
            message="This analysis requires administrator approval before results are released."
            variant="warning"
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ onAnalyze }: { onAnalyze: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Brain className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium text-muted-foreground">No retention analysis yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Run an analysis to get AI-powered retention risk insights and recommendations.
        </p>
      </div>
      <Button size="sm" onClick={onAnalyze} className="gap-2 mt-1">
        <Brain className="h-3.5 w-3.5" />
        Analyze Retention Risk
      </Button>
    </div>
  );
}

function PendingState({ job }: { job: AgentJob }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <Loader2 className="h-9 w-9 animate-spin text-violet-500" />
      <div>
        <p className="text-sm font-medium">{statusLabel(job.status)}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {job.status === "queued"
            ? "Analysis has been accepted by Kevin and is queued."
            : "Kevin's Retention Agent is analyzing this client's data…"}
        </p>
        {job.requestedAt && (
          <p className="text-xs text-muted-foreground/60 mt-1">
            Started {fmtDate(job.requestedAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function FailedState({ job, onRetry }: { job: AgentJob; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
      <XCircle className="h-9 w-9 text-red-400" />
      <div>
        <p className="text-sm font-medium text-red-700">
          {job.status === "timed_out" ? "Analysis timed out" :
           job.status === "blocked_by_policy" ? "Blocked by policy" :
           "Analysis failed"}
        </p>
        {job.errorCode && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">{job.errorCode}</p>
        )}
        {job.failedAt && (
          <p className="text-xs text-muted-foreground/60">{fmtDate(job.failedAt)}</p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry Analysis
      </Button>
    </div>
  );
}

function AnalysisResult({ analysis }: { analysis: RetentionAnalysis }) {
  const riskFactors = Array.isArray(analysis.riskFactors) ? analysis.riskFactors : [];
  const recommendedActions = Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [];
  const evidence = Array.isArray(analysis.evidence) ? analysis.evidence : [];

  return (
    <div className="space-y-4">
      {/* Risk headline */}
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold border ${riskLevelColor(analysis.riskLevel)}`}
        >
          {analysis.riskLevel.charAt(0).toUpperCase() + analysis.riskLevel.slice(1)} Risk
        </span>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Score:</span>
          <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${riskScoreBarColor(analysis.riskScore)}`}
              style={{ width: `${analysis.riskScore}%` }}
            />
          </div>
          <span className="font-medium tabular-nums">{analysis.riskScore}/100</span>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          <span>{analysis.confidenceScore}% confidence</span>
        </div>
      </div>

      {/* Summary */}
      <div>
        <p className="text-sm leading-relaxed text-foreground">{analysis.summary}</p>
      </div>

      {/* Risk factors */}
      {riskFactors.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-orange-400" />
            Risk Factors
          </h4>
          <ul className="space-y-1.5">
            {riskFactors.map((f: any, i: number) => (
              <li key={i} className="text-sm text-foreground flex gap-2">
                <span className="text-orange-400 shrink-0">•</span>
                <span>{typeof f === "string" ? f : f?.description ?? JSON.stringify(f)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Evidence */}
      {evidence.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Supporting Evidence
          </h4>
          <ul className="space-y-1">
            {evidence.map((e: any, i: number) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="shrink-0">·</span>
                <span>{typeof e === "string" ? e : JSON.stringify(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Separator />

      {/* Recommended interventions */}
      {recommendedActions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recommended Interventions
          </h4>
          <ol className="space-y-1.5">
            {recommendedActions.map((a: any, i: number) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-violet-500 font-medium shrink-0">{i + 1}.</span>
                <span>{typeof a === "string" ? a : a?.action ?? JSON.stringify(a)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Draft message */}
      {analysis.draftMessage && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Draft Retention Message
          </h4>
          <div className="bg-muted/50 rounded-md p-3 text-sm leading-relaxed border border-border/50 whitespace-pre-wrap">
            {analysis.draftMessage}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-1.5">
            Review and personalise before sending. Retention Agent does not send messages automatically.
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBanner({
  icon,
  message,
  variant,
}: {
  icon: React.ReactNode;
  message: string;
  variant: "error" | "warning" | "info";
}) {
  const colors = {
    error: "bg-red-50 border-red-200 text-red-700",
    warning: "bg-amber-50 border-amber-200 text-amber-700",
    info: "bg-blue-50 border-blue-200 text-blue-700",
  };

  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${colors[variant]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{message}</span>
    </div>
  );
}
