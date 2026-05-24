/**
 * Trust Signals Widget — Phase 7
 *
 * Shows operators evidence that the system is protecting them.
 * Surfaces: approvals triggered, unsafe actions blocked, workflows recovered,
 * governance policies enforced, retries handled.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, CheckCircle, AlertTriangle, RefreshCw, ShieldCheck, Lock } from "lucide-react";

interface TrustMetric {
  label: string;
  value: number | string;
  desc: string;
  icon: typeof Shield;
  color: string;
  positive: boolean;
}

function TrustMetricCard({ metric }: { metric: TrustMetric }) {
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-lg border bg-card`} data-testid={`trust-metric-${metric.label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
        metric.positive ? "bg-green-100 dark:bg-green-900/30" : "bg-amber-100 dark:bg-amber-900/30"
      }`}>
        <metric.icon className={`h-4 w-4 ${metric.positive ? "text-green-600" : "text-amber-600"}`} />
      </div>
      <div>
        <p className="text-lg font-bold leading-tight">{metric.value}</p>
        <p className="text-xs font-medium">{metric.label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{metric.desc}</p>
      </div>
    </div>
  );
}

export function TrustSignalsWidget({ className = "" }: { className?: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/trust-signals"],
    refetchInterval: 60000,
  });

  const metrics: TrustMetric[] = [
    {
      label: "Approvals Triggered",
      value: data?.approvalsTriggered ?? 0,
      desc: "Times AI paused for your review",
      icon: CheckCircle,
      color: "green",
      positive: true,
    },
    {
      label: "Unsafe Actions Blocked",
      value: data?.blockedActions ?? 0,
      desc: "Actions stopped by governance policy",
      icon: Lock,
      color: "green",
      positive: true,
    },
    {
      label: "Workflows Recovered",
      value: data?.recoveredWorkflows ?? 0,
      desc: "Failed workflows auto-retried successfully",
      icon: RefreshCw,
      color: "green",
      positive: true,
    },
    {
      label: "Governance Rules Active",
      value: data?.activeGovernanceRules ?? 0,
      desc: "Policies protecting your operations",
      icon: Shield,
      color: "green",
      positive: true,
    },
    {
      label: "Duplicate Actions Prevented",
      value: data?.duplicatesPrevented ?? 0,
      desc: "Rate limits stopped double-sending",
      icon: ShieldCheck,
      color: "green",
      positive: true,
    },
    {
      label: "Escalations Handled",
      value: data?.escalations ?? 0,
      desc: "Complex situations escalated to your team",
      icon: AlertTriangle,
      color: "amber",
      positive: false,
    },
  ];

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <Card className={className} data-testid="trust-signals-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" />
          System Protection Summary
        </CardTitle>
        <p className="text-xs text-muted-foreground">Evidence of governance working on your behalf</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-2">
          {metrics.map(m => <TrustMetricCard key={m.label} metric={m} />)}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-3 flex items-center justify-center gap-1">
          <ShieldCheck className="h-3 w-3 text-green-500" />
          The system is protecting your organization automatically
        </p>
      </CardContent>
    </Card>
  );
}
