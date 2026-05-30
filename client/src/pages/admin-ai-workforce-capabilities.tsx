import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ShieldCheck, ArrowLeft, CheckCircle, XCircle, Minus,
  RefreshCw, AlertTriangle, Zap, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

const AUTONOMY_COLOR: Record<string, string> = {
  supervised: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  collaborative: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  autonomous: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const RISK_COLOR: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
  critical: "bg-red-200 text-red-800",
};

const INTEGRATION_LABELS: Record<string, string> = {
  gmail: "Gmail",
  google_calendar: "Calendar",
  stripe: "Stripe",
  meta_ads: "Meta Ads",
  twilio: "Twilio",
  slack: "Slack",
  hubspot: "HubSpot",
};

function CapabilityRow({ agent }: { agent: any }) {
  return (
    <tr className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-capability-${agent.agentType}`}>
      {/* Agent */}
      <td className="px-4 py-3">
        <div>
          <Link href={`/admin/ai-employee/${agent.agentType}`}>
            <span className="text-sm font-semibold hover:text-primary cursor-pointer">{agent.agentName}</span>
          </Link>
          <p className="text-[10px] text-muted-foreground">{agent.department}</p>
        </div>
      </td>
      {/* Enabled */}
      <td className="px-4 py-3">
        {agent.enabled ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </td>
      {/* Governance mode */}
      <td className="px-4 py-3">
        <span className={`text-[10px] px-2 py-0.5 rounded font-medium capitalize ${AUTONOMY_COLOR[agent.maxAutonomyLevel] ?? "bg-muted text-muted-foreground"}`}>
          {agent.maxAutonomyLevel ?? "supervised"}
        </span>
      </td>
      {/* Requires approval */}
      <td className="px-4 py-3">
        {agent.requiresApproval ? (
          <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">Yes</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 border-green-200">No</Badge>
        )}
      </td>
      {/* Allowed risk */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {Array.isArray(agent.allowedRiskLevels) && agent.allowedRiskLevels.length > 0
            ? agent.allowedRiskLevels.map((r: string) => (
              <span key={r} className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize ${RISK_COLOR[r] ?? "bg-muted text-muted-foreground"}`}>
                {r}
              </span>
            ))
            : <span className="text-[10px] text-muted-foreground">—</span>}
        </div>
      </td>
      {/* Connected tools */}
      <td className="px-4 py-3">
        <div className="space-y-0.5">
          {agent.connectedTools?.map((t: string) => (
            <span key={t} className="inline-flex items-center gap-0.5 mr-1 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
              <CheckCircle className="h-2.5 w-2.5" />{INTEGRATION_LABELS[t] ?? t}
            </span>
          ))}
          {agent.missingTools?.map((t: string) => (
            <span key={t} className="inline-flex items-center gap-0.5 mr-1 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">
              <XCircle className="h-2.5 w-2.5" />{INTEGRATION_LABELS[t] ?? t}
            </span>
          ))}
          {(!agent.connectedTools?.length && !agent.missingTools?.length) && (
            <span className="text-[10px] text-muted-foreground">None required</span>
          )}
        </div>
      </td>
      {/* Workflows */}
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-semibold">{agent.workflowsAttached ?? 0}</span>
      </td>
      {/* Actions last 30d */}
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-semibold">{agent.actionsLast30Days ?? 0}</span>
      </td>
      {/* Last active */}
      <td className="px-4 py-3">
        <span className="text-[10px] text-muted-foreground">
          {agent.lastActive
            ? formatDistanceToNow(new Date(agent.lastActive), { addSuffix: true })
            : "Never"}
        </span>
      </td>
    </tr>
  );
}

export default function AdminAiWorkforceCapabilitiesPage() {
  const { data, isLoading, refetch } = useQuery<{
    matrix: any[];
    governanceMode: string;
    onboardingCompleted: boolean;
  }>({
    queryKey: ["/api/workforce/capabilities"],
    queryFn: async () => {
      const res = await fetch("/api/workforce/capabilities");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const matrix = data?.matrix ?? [];
  const enabledCount = matrix.filter(a => a.enabled).length;
  const approvalCount = matrix.filter(a => a.requiresApproval).length;
  const connectedToolCount = matrix.reduce((s, a) => s + (a.connectedTools?.length ?? 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-workforce-capabilities">
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
            <ShieldCheck className="h-6 w-6 text-primary" />
            Agent Capability Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operating view of every agent's permissions, tools, and activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-workforce/settings">
            <Button variant="outline" size="sm" data-testid="button-settings-link">
              Workforce Settings
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-matrix">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{enabledCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Enabled Agents</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{approvalCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Require Approval</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{connectedToolCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Connected Tools</p>
        </Card>
        <Card className="p-4 text-center">
          <p className={`text-2xl font-bold capitalize ${
            data?.governanceMode === "autonomous" ? "text-purple-600"
            : data?.governanceMode === "supervised" ? "text-blue-600"
            : "text-teal-600"
          }`}>
            {data?.governanceMode ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Governance Mode</p>
        </Card>
      </div>

      {/* Matrix table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-capability-matrix">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Agent</th>
                  <th className="px-4 py-2.5 text-left font-medium">Enabled</th>
                  <th className="px-4 py-2.5 text-left font-medium">Autonomy Level</th>
                  <th className="px-4 py-2.5 text-left font-medium">Approval</th>
                  <th className="px-4 py-2.5 text-left font-medium">Allowed Risk</th>
                  <th className="px-4 py-2.5 text-left font-medium">Connected Tools</th>
                  <th className="px-4 py-2.5 text-center font-medium">Workflows</th>
                  <th className="px-4 py-2.5 text-center font-medium">30d Actions</th>
                  <th className="px-4 py-2.5 text-left font-medium">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(agent => <CapabilityRow key={agent.agentType} agent={agent} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> Supervised — all actions need approval</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-400" /> Collaborative — low-risk auto, high-risk approval</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-400" /> Autonomous — operates independently</span>
      </div>
    </div>
  );
}
