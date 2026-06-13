import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play, CheckCircle2, XCircle, Clock, ArrowLeft, AlertTriangle,
  Activity, Zap, DollarSign, Eye, RefreshCw, ChevronDown, ChevronRight,
  Shield, BarChart3, Brain, Pause,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  awaiting_approval: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  approved: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  executing: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  completed: "bg-green-500/10 text-green-400 border-green-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const RISK_STYLES: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

function AuditTrailPanel({ trail }: { trail: any[] }) {
  if (!trail?.length) return <p className="text-xs text-gray-600">No audit entries</p>;
  return (
    <div className="space-y-1 mt-2">
      {trail.map((entry: any, i: number) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="text-gray-600 flex-shrink-0 w-20 tabular-nums">
            {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ""}
          </span>
          <span className={entry.action?.includes("fail") ? "text-red-400" : entry.action?.includes("complet") ? "text-green-400" : "text-gray-400"}>
            {entry.details}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlanCard({ plan, onApprove, onReject, onExecute, approving, rejecting, executing }: any) {
  const [expanded, setExpanded] = useState(false);
  const steps = (plan.executionSteps as any[]) ?? [];
  const trail = (plan.auditTrail as any[]) ?? [];

  const duration = plan.startedAt && plan.completedAt
    ? Math.round((new Date(plan.completedAt).getTime() - new Date(plan.startedAt).getTime()) / 1000)
    : null;

  return (
    <Card className="bg-gray-900 border-gray-800" data-testid={`plan-${plan.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge className={`text-xs border ${STATUS_STYLES[plan.executionStatus] ?? STATUS_STYLES.draft}`}>
                {plan.executionStatus.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className={`text-xs ${RISK_STYLES[plan.riskLevel] ?? "text-gray-400"}`}>
                {plan.riskLevel} risk
              </Badge>
              {plan.approvalStatus === "auto_approved" && (
                <Badge className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30 border">auto-approved</Badge>
              )}
            </div>

            <p className="font-semibold text-white text-sm mb-1">{plan.title}</p>
            {plan.notes && <p className="text-xs text-gray-400 leading-relaxed mb-2">{plan.notes.substring(0, 120)}</p>}

            <div className="flex flex-wrap gap-3 text-xs mt-2">
              {plan.estimatedValue > 0 && (
                <span className="flex items-center gap-1 text-green-400">
                  <DollarSign className="h-3.5 w-3.5" />Est. ${plan.estimatedValue.toFixed(0)}
                </span>
              )}
              {plan.actualValue != null && (
                <span className={`flex items-center gap-1 ${plan.actualValue > 0 ? "text-green-400" : "text-red-400"}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />Actual ${plan.actualValue.toFixed(0)}
                </span>
              )}
              {duration != null && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Clock className="h-3.5 w-3.5" />{duration}s
                </span>
              )}
              <span className="text-gray-500">{new Date(plan.createdAt).toLocaleDateString()}</span>
            </div>

            {/* Expandable audit trail + steps */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {expanded ? "Hide" : "Show"} execution details ({steps.length} steps, {trail.length} audit entries)
            </button>

            {expanded && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {steps.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Execution Steps</p>
                    <div className="space-y-1">
                      {steps.map((step: any) => (
                        <div key={step.step} className="flex items-start gap-2 text-xs">
                          <span className="text-purple-400 font-mono flex-shrink-0">{step.step}.</span>
                          <div>
                            <span className="text-gray-300">{step.name}</span>
                            {step.governanceRequired && <Badge className="ml-1 text-xs bg-yellow-500/10 text-yellow-400 border-none py-0 h-4">gov. required</Badge>}
                            <p className="text-gray-600">{step.estimatedDuration}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {trail.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Audit Trail</p>
                    <AuditTrailPanel trail={trail} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 flex-shrink-0 justify-start">
            {plan.executionStatus === "awaiting_approval" && (
              <>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8 px-3 text-xs"
                  onClick={() => onApprove(plan.id)} disabled={approving}
                  data-testid={`button-approve-plan-${plan.id}`}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                </Button>
                <Button size="sm" variant="outline" className="border-red-800 text-red-400 h-8 px-3 text-xs hover:bg-red-900/20"
                  onClick={() => onReject(plan.id)} disabled={rejecting}
                  data-testid={`button-reject-plan-${plan.id}`}>
                  <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                </Button>
              </>
            )}
            {plan.executionStatus === "approved" && (
              <Button size="sm" className="bg-purple-600 hover:bg-purple-700 h-8 px-3 text-xs"
                onClick={() => onExecute(plan.id)} disabled={executing}
                data-testid={`button-execute-plan-${plan.id}`}>
                <Play className="h-3.5 w-3.5 mr-1" />{executing ? "Running..." : "Execute"}
              </Button>
            )}
            {(plan.executionStatus === "completed" || plan.executionStatus === "failed") && (
              <Button size="sm" variant="ghost" className="text-gray-400 h-8 px-3 text-xs" onClick={() => setExpanded(!expanded)}>
                <Eye className="h-3.5 w-3.5 mr-1" />Details
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAiWorkforceExecutions() {
  const [tab, setTab] = useState("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: plans, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/workforce/executions"],
    queryFn: () => fetchJson("/api/workforce/executions"),
    initialData: [],
    refetchInterval: 10000,
  });

  const { data: trustData } = useQuery<any>({
    queryKey: ["/api/workforce/trust"],
    queryFn: () => fetchJson("/api/workforce/trust"),
  });

  const { data: cooData } = useQuery<any>({
    queryKey: ["/api/workforce/coo-dashboard"],
    queryFn: () => fetchJson("/api/workforce/coo-dashboard"),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/workforce/executions/${id}`, { action: "approve" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/workforce/executions"] }); toast({ title: "Plan approved" }); },
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/workforce/executions/${id}`, { action: "reject" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/workforce/executions"] }); toast({ title: "Plan rejected" }); },
  });

  const execute = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/workforce/executions/${id}/run`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/workforce/executions"] }); toast({ title: "Execution started" }); },
    onError: () => toast({ title: "Execution failed", variant: "destructive" }),
  });

  const filterMap: Record<string, string[]> = {
    all: ["draft", "awaiting_approval", "approved", "executing", "completed", "failed", "cancelled"],
    pending: ["awaiting_approval"],
    executing: ["executing", "approved"],
    completed: ["completed"],
    failed: ["failed", "cancelled"],
  };

  const filtered = (plans ?? []).filter(p => filterMap[tab]?.includes(p.executionStatus));

  const counts = {
    pending: (plans ?? []).filter(p => p.executionStatus === "awaiting_approval").length,
    executing: (plans ?? []).filter(p => ["executing", "approved"].includes(p.executionStatus)).length,
    completed: (plans ?? []).filter(p => p.executionStatus === "completed").length,
    failed: (plans ?? []).filter(p => ["failed", "cancelled"].includes(p.executionStatus)).length,
  };

  const tierColors: Record<string, string> = {
    "Autonomous Ready": "text-green-400",
    "Highly Trusted": "text-blue-400",
    "Trusted": "text-purple-400",
    "Developing": "text-yellow-400",
    "Emerging": "text-gray-400",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/ai-workforce">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Workforce
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6 text-cyan-400" />
              Agent Action Center
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Controlled autonomous execution — governed, auditable, measurable</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-workforce/simulator">
            <Button variant="outline" size="sm" className="border-purple-700 text-purple-400 hover:bg-purple-900/20" data-testid="button-simulator-link">
              <Brain className="h-4 w-4 mr-1.5" />Simulator
            </Button>
          </Link>
          <Button variant="ghost" size="sm" className="text-gray-400" onClick={() => refetch()} data-testid="button-refresh-executions">
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
        </div>
      </div>

      {/* Trust + Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="bg-gray-900 border-gray-800 col-span-2 sm:col-span-1">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Trust Score</p>
            <p className="text-2xl font-bold text-white">{trustData?.overall ?? "—"}</p>
            <p className={`text-xs font-medium mt-0.5 ${tierColors[trustData?.tier] ?? "text-gray-400"}`}>{trustData?.tier ?? "Loading..."}</p>
          </CardContent>
        </Card>
        {[
          { label: "Needs Approval", value: counts.pending, color: "text-yellow-400" },
          { label: "Executing", value: counts.executing, color: "text-purple-400" },
          { label: "Completed", value: counts.completed, color: "text-green-400" },
          { label: "Failed", value: counts.failed, color: "text-red-400" },
        ].map(stat => (
          <Card key={stat.label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* COO Dashboard Strip */}
      {cooData && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs text-gray-500">COO Score</p>
                <p className="text-xl font-bold text-white">{cooData.executiveCooScore}/100</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Projected ROI</p>
                <p className="text-sm font-semibold text-green-400">${cooData.projectedROI?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Realized ROI</p>
                <p className="text-sm font-semibold text-blue-400">${cooData.actualROI?.toLocaleString()}</p>
              </div>
              <div className="flex-1 min-w-0">
                {(cooData.recommendedActions ?? []).filter(Boolean).slice(0, 2).map((action: string, i: number) => (
                  <p key={i} className="text-xs text-gray-400 flex items-center gap-1.5">
                    <span className="text-cyan-400">›</span>{action}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution Plans */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-800 border border-gray-700 flex-wrap h-auto">
          <TabsTrigger value="all">All Plans ({(plans ?? []).length})</TabsTrigger>
          <TabsTrigger value="pending">
            Needs Approval
            {counts.pending > 0 && <Badge className="ml-1.5 bg-yellow-500 text-white text-xs h-4 px-1.5">{counts.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="executing">Executing</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>

        {["all", "pending", "executing", "completed", "failed"].map(tabKey => (
          <TabsContent key={tabKey} value={tabKey} className="mt-4 space-y-3">
            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-800 rounded-xl animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="p-10 text-center">
                  <Activity className="h-10 w-10 mx-auto mb-3 text-gray-600" />
                  <p className="text-gray-400 text-sm">No execution plans in this category</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {tabKey === "pending" ? "Approve a recommendation from the Optimization Center to create execution plans" :
                     tabKey === "executing" ? "Approved plans will appear here when execution begins" :
                     tabKey === "completed" ? "Completed executions will appear here with outcome data" :
                     "Failed executions appear here for review and remediation"}
                  </p>
                  {tabKey === "pending" && (
                    <Link href="/admin/ai-workforce/optimization">
                      <Button size="sm" variant="outline" className="mt-3 border-gray-600 text-gray-300">Go to Optimization Center</Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            ) : filtered.map((plan: any) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onApprove={approve.mutate}
                onReject={reject.mutate}
                onExecute={execute.mutate}
                approving={approve.isPending}
                rejecting={reject.isPending}
                executing={execute.isPending}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>

      {/* Governance note */}
      <Card className="bg-gray-800/40 border-gray-700/40">
        <CardContent className="p-4">
          <p className="text-xs text-gray-500 flex items-center gap-2">
            <Shield className="h-4 w-4 text-gray-600 flex-shrink-0" />
            <span><strong className="text-gray-400">Governance guarantee:</strong> No agent may execute a high or critical risk action without explicit human approval. Financial actions are always supervisor-only. All executions are logged with full audit trails. Auto-approval rules apply only to low-risk operational actions.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
