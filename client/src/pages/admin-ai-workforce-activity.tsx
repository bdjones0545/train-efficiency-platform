import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity, ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle,
  RefreshCw, Filter, ChevronDown, Brain, Zap, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; cls: string; label: string }> = {
  completed: { icon: CheckCircle, cls: "text-green-600", label: "Completed" },
  success: { icon: CheckCircle, cls: "text-green-600", label: "Success" },
  failed: { icon: XCircle, cls: "text-red-600", label: "Failed" },
  error: { icon: XCircle, cls: "text-red-600", label: "Error" },
  pending: { icon: Clock, cls: "text-amber-600", label: "Pending Approval" },
  running: { icon: Zap, cls: "text-blue-600", label: "Running" },
  pending_approval: { icon: AlertTriangle, cls: "text-amber-600", label: "Awaiting Approval" },
};

const RISK_COLOR: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function ActivityRow({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[item.status] ?? { icon: Clock, cls: "text-muted-foreground", label: item.status };
  const Icon = cfg.icon;

  return (
    <div className="border-b last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors" data-testid={`row-activity-${item.id}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.cls}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{item.agentName}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{item.department}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.actionType?.replace(/_/g, " ")}</Badge>
            {item.riskLevel && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${RISK_COLOR[item.riskLevel] ?? "bg-muted text-muted-foreground"}`}>
                {item.riskLevel} risk
              </span>
            )}
            {item.requiresApproval && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700">
                Approval Required
              </Badge>
            )}
          </div>
          {item.reasoningSummary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{item.reasoningSummary}</p>
          )}
          {item.errorMessage && (
            <p className="text-xs text-red-600 mt-1 line-clamp-1">{item.errorMessage}</p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          <p className="text-[10px] text-muted-foreground">
            {item.timestamp ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }) : "—"}
          </p>
          {item.entityType && (
            <p className="text-[10px] text-muted-foreground">{item.entityType}</p>
          )}
        </div>
      </div>
      {(item.toolName || item.workflowRunId) && (
        <div className="mt-1.5 ml-7 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          {item.toolName && <span>Tool: <span className="font-mono">{item.toolName}</span></span>}
          {item.workflowRunId && <span>Run: <span className="font-mono truncate max-w-[120px] inline-block">{item.workflowRunId}</span></span>}
          {item.confidenceScore != null && <span>Confidence: {Math.round(Number(item.confidenceScore) * 100)}%</span>}
        </div>
      )}
    </div>
  );
}

export default function AdminAiWorkforceActivityPage() {
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [limit, setLimit] = useState("50");

  const { data: activity, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/workforce/activity", agentFilter, statusFilter, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit });
      if (agentFilter !== "all") params.set("agent", agentFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/workforce/activity?${params}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const AGENT_OPTIONS = [
    { value: "all", label: "All Agents" },
    { value: "executive_agent", label: "Atlas (Executive)" },
    { value: "retention_agent", label: "Pulse (Retention)" },
    { value: "growth_agent", label: "Apex (Revenue)" },
    { value: "scheduling_agent", label: "Tempo (Scheduling)" },
    { value: "finance_agent", label: "Ledger (Finance)" },
    { value: "communication_agent", label: "Relay (Communications)" },
    { value: "research_agent", label: "Vector (Intelligence)" },
    { value: "workflow_agent", label: "Workflow Agent" },
    { value: "system_agent", label: "System Agent" },
  ];

  const counts = {
    total: activity?.length ?? 0,
    pending: activity?.filter(a => a.status === "pending" || a.requiresApproval).length ?? 0,
    failed: activity?.filter(a => a.status === "failed" || a.status === "error").length ?? 0,
    success: activity?.filter(a => a.status === "completed" || a.status === "success").length ?? 0,
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="page-workforce-activity">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/ai-workforce">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2">
                <ArrowLeft className="h-3.5 w-3.5" /> AI Workforce
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Agent Activity Feed
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live timeline of all AI agent actions, approvals, and workflow executions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-activity">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Actions", value: counts.total, cls: "text-primary" },
          { label: "Successful", value: counts.success, cls: "text-green-600" },
          { label: "Failed", value: counts.failed, cls: "text-red-600" },
          { label: "Pending Approval", value: counts.pending, cls: "text-amber-600" },
        ].map(s => (
          <Card key={s.label} className="p-4 text-center" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-agent-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-status-filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="w-28 h-8 text-xs" data-testid="select-limit-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 rows</SelectItem>
            <SelectItem value="50">50 rows</SelectItem>
            <SelectItem value="100">100 rows</SelectItem>
            <SelectItem value="200">200 rows</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity list */}
      <Card data-testid="list-activity-feed">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded" />)}
          </div>
        ) : !activity?.length ? (
          <div className="text-center py-16 text-sm text-muted-foreground border-2 border-dashed rounded-lg" data-testid="text-no-activity">
            <Activity className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium">No activity yet</p>
            <p className="text-xs mt-1">Agent actions will appear here once workflows are running.</p>
          </div>
        ) : (
          <div className="divide-y">
            {activity.map(item => <ActivityRow key={item.id} item={item} />)}
          </div>
        )}
      </Card>
    </div>
  );
}
