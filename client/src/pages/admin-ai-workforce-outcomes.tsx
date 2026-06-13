import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign, Clock, TrendingUp, Zap, ArrowLeft, RefreshCw,
  CheckCircle2, AlertTriangle, Target, Calendar, Lightbulb,
  BarChart3, Award, Shield,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { parseApiResponse } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  resolved: "bg-green-500/10 text-green-400 border-green-500/30",
  expired: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const CATEGORY_ICONS: Record<string, any> = {
  lead_recovery: Target,
  scheduling_capacity: Calendar,
  communication_efficiency: Zap,
  operational_intelligence: BarChart3,
  revenue_recovery: DollarSign,
  retention_risk: Shield,
  default: Lightbulb,
};

function MetricCard({ label, value, sub, icon: Icon, color, trend }: {
  label: string; value: string; sub?: string; icon: any; color: string; trend?: string;
}) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
          </div>
          <Icon className={`h-5 w-5 ${color} opacity-70`} />
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="h-3 w-3 text-green-400" />
            <span className="text-xs text-green-400">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminAiWorkforceOutcomes() {
  const [period, setPeriod] = useState("30d");
  const [oppTab, setOppTab] = useState("open");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: roi, isLoading: roiLoading } = useQuery<any>({
    queryKey: ["/api/workforce/roi", period],
    queryFn: () => fetch(`/api/workforce/roi?period=${period}`).then(r => r.json()),
  });

  const { data: revenueAttr, isLoading: revLoading } = useQuery<any>({
    queryKey: ["/api/workforce/revenue-attribution", period],
    queryFn: () => fetch(`/api/workforce/revenue-attribution?period=${period}`).then(r => r.json()),
  });

  const { data: timeSavings } = useQuery<any>({
    queryKey: ["/api/workforce/time-savings"],
    queryFn: () => fetch("/api/workforce/time-savings").then(r => r.json()),
  });

  const { data: opportunities, isLoading: oppLoading, refetch: refetchOpps } = useQuery<any[]>({
    queryKey: ["/api/workforce/opportunities"],
    queryFn: () => fetch("/api/workforce/opportunities").then(r => r.json()),
    initialData: [],
  });

  const { data: execSummary, isLoading: execLoading } = useQuery<any>({
    queryKey: ["/api/workforce/executive-summary"],
    queryFn: () => fetch("/api/workforce/executive-summary").then(r => r.json()),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/workforce/opportunities/refresh").then(parseApiResponse),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/opportunities"] });
      toast({ title: `${data?.inserted ?? 0} new opportunities found` });
    },
  });

  const updateOppMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/workforce/opportunities/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/opportunities"] });
    },
  });

  const filteredOpps = (opportunities ?? []).filter((o: any) =>
    oppTab === "all" ? true : o.status === oppTab
  );

  const totalPotentialValue = filteredOpps.reduce((s: number, o: any) => s + (o.potentialValue ?? 0), 0);

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
              <BarChart3 className="h-6 w-6 text-green-400" />
              Business Impact & ROI
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Evidence-based outcomes from every AI agent action</p>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-36 bg-gray-800 border-gray-700" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="quarter">Quarter</SelectItem>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Executive Snapshot Score */}
      {execSummary && !execLoading && (
        <Card className="bg-gradient-to-r from-gray-900 to-gray-800 border-gray-700">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="h-5 w-5 text-yellow-400" />
                  <span className="font-semibold text-white">Executive Snapshot</span>
                  <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 text-xs">
                    Score: {execSummary.snapshotScore}/100
                  </Badge>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">
                  {execSummary.workforcePerformance.activeAgents} of {execSummary.workforcePerformance.totalAgents} agents active this week.
                  {" "}{execSummary.revenueImpact.hoursSaved > 0 && `${execSummary.revenueImpact.hoursSaved}h saved.`}
                  {" "}{execSummary.revenueImpact.generated > 0 && `$${execSummary.revenueImpact.generated.toFixed(0)} revenue generated.`}
                  {" "}{execSummary.topOpportunities.length > 0 && `${execSummary.topOpportunities.length} open opportunities.`}
                </p>
                {execSummary.recommendedActions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {execSummary.recommendedActions.slice(0, 2).map((a: string, i: number) => (
                      <span key={i} className="text-xs bg-gray-700 rounded-full px-3 py-1 text-gray-300">
                        → {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {execSummary.mostValuableAgent && (
                <div className="text-center sm:text-right flex-shrink-0">
                  <div className="text-xs text-gray-400">Top Agent</div>
                  <div className="text-lg font-bold text-white">{execSummary.mostValuableAgent.name}</div>
                  <div className="text-xs text-green-400">{execSummary.mostValuableAgent.highlight}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ROI metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Revenue Generated"
          value={`$${(roi?.revenueGenerated ?? 0).toFixed(0)}`}
          sub="Directly closed"
          icon={DollarSign}
          color="text-green-400"
        />
        <MetricCard
          label="Revenue Recovered"
          value={`$${(roi?.revenueRecovered ?? 0).toFixed(0)}`}
          sub="Lost revenue brought back"
          icon={TrendingUp}
          color="text-blue-400"
        />
        <MetricCard
          label="Labor Value Saved"
          value={`$${(roi?.estimatedLaborSavings ?? 0).toFixed(0)}`}
          sub={`${roi?.laborHoursSaved ?? 0}h @ $${roi?.hourlyRateAssumption ?? 35}/hr`}
          icon={Clock}
          color="text-purple-400"
        />
        <MetricCard
          label="Total Business Value"
          value={`$${(roi?.businessValueCreated ?? 0).toFixed(0)}`}
          sub="Revenue + labor savings"
          icon={Award}
          color="text-yellow-400"
        />
      </div>

      {/* Time savings detail row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Hours Saved Today</p>
            <p className="text-xl font-bold text-blue-400">{timeSavings?.timeSavedToday ?? 0}h</p>
            <p className="text-xs text-gray-500">${(timeSavings?.laborSavingsToday ?? 0).toFixed(0)} value</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Hours Saved This Month</p>
            <p className="text-xl font-bold text-blue-400">{timeSavings?.timeSavedThisMonth ?? 0}h</p>
            <p className="text-xs text-gray-500">${(timeSavings?.laborSavingsThisMonth ?? 0).toFixed(0)} value</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Hours Saved All Time</p>
            <p className="text-xl font-bold text-blue-400">{timeSavings?.timeSavedAllTime ?? 0}h</p>
            <p className="text-xs text-gray-500">${(timeSavings?.laborSavingsAllTime ?? 0).toFixed(0)} value</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Attribution by Agent */}
      {revenueAttr && !revLoading && revenueAttr.agents?.length > 0 && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              Revenue Attribution by Agent
              <Badge variant="outline" className="text-xs text-gray-400 ml-auto">
                {revenueAttr.attributedAgents} agents · {Math.round((revenueAttr.attributionConfidence ?? 0) * 100)}% avg confidence
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revenueAttr.agents
                .filter((a: any) => a.revenueInfluenced > 0 || a.revenueGenerated > 0)
                .sort((a: any, b: any) => (b.revenueGenerated + b.revenueInfluenced) - (a.revenueGenerated + a.revenueInfluenced))
                .map((a: any) => (
                  <div key={a.agentType} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                    <div>
                      <span className="font-medium text-white text-sm">{a.agentName}</span>
                      <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                        {a.revenueGenerated > 0 && <span className="text-green-400">${a.revenueGenerated.toFixed(0)} generated</span>}
                        {a.revenueRecovered > 0 && <span className="text-blue-400">${a.revenueRecovered.toFixed(0)} recovered</span>}
                        {a.revenueProtected > 0 && <span className="text-purple-400">${a.revenueProtected.toFixed(0)} protected</span>}
                        <span>{a.evidenceCount} evidence records</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-green-400">${(a.revenueGenerated + a.revenueInfluenced).toFixed(0)}</div>
                      <div className="text-xs text-gray-500">total influenced</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* Time Savings by Agent */}
      {roi?.timeSavedBreakdown?.length > 0 && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              Time Savings by Agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {roi.timeSavedBreakdown.map((a: any) => {
                const maxHours = Math.max(...roi.timeSavedBreakdown.map((x: any) => x.timeSavedHours), 1);
                const pct = Math.round((a.timeSavedHours / maxHours) * 100);
                return (
                  <div key={a.agentType} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-300">{a.agentName}</span>
                      <span className="text-blue-400">{a.timeSavedHours}h · <span className="text-purple-400">${a.estimatedSavings.toFixed(0)}</span></span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Opportunities */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              Identified Opportunities
              {filteredOpps.length > 0 && (
                <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 text-xs">
                  ${totalPotentialValue.toFixed(0)} potential
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Tabs value={oppTab} onValueChange={setOppTab}>
                <TabsList className="bg-gray-800 h-8">
                  <TabsTrigger value="open" className="text-xs px-3 h-6">Open</TabsTrigger>
                  <TabsTrigger value="in_progress" className="text-xs px-3 h-6">In Progress</TabsTrigger>
                  <TabsTrigger value="resolved" className="text-xs px-3 h-6">Resolved</TabsTrigger>
                  <TabsTrigger value="all" className="text-xs px-3 h-6">All</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-700 h-8"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                data-testid="button-refresh-opportunities"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {oppLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-20 bg-gray-800 rounded-lg animate-pulse" />)}
            </div>
          ) : filteredOpps.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No {oppTab === "all" ? "" : oppTab} opportunities found.</p>
              <p className="text-xs mt-1">Click Refresh to scan for new opportunities.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOpps.map((opp: any) => {
                const IconComp = CATEGORY_ICONS[opp.category] ?? CATEGORY_ICONS.default;
                return (
                  <div
                    key={opp.id}
                    data-testid={`opportunity-${opp.id}`}
                    className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <IconComp className="h-4 w-4 text-yellow-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white text-sm leading-snug">{opp.title}</p>
                          {opp.description && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{opp.description}</p>}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className={`text-xs border ${STATUS_COLORS[opp.status]}`}>{opp.status.replace("_", " ")}</Badge>
                            <span className="text-xs text-gray-500">{opp.agentId.replace("_agent", "").toUpperCase()}</span>
                            <span className="text-xs text-gray-500">{Math.round((opp.confidence ?? 0.8) * 100)}% confidence</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {(opp.potentialValue ?? 0) > 0 && (
                          <div className="text-right">
                            <div className="text-sm font-bold text-green-400">${(opp.potentialValue ?? 0).toFixed(0)}</div>
                            <div className="text-xs text-gray-500">potential</div>
                          </div>
                        )}
                        {opp.status === "open" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs border-gray-600 hover:bg-gray-700"
                              onClick={() => updateOppMutation.mutate({ id: opp.id, status: "in_progress" })}
                              data-testid={`button-start-opp-${opp.id}`}
                            >
                              Start
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs border-gray-600 hover:bg-gray-700"
                              onClick={() => updateOppMutation.mutate({ id: opp.id, status: "expired" })}
                              data-testid={`button-dismiss-opp-${opp.id}`}
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                        {opp.status === "in_progress" && (
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => updateOppMutation.mutate({ id: opp.id, status: "resolved" })}
                            data-testid={`button-resolve-opp-${opp.id}`}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attribution methodology note */}
      <Card className="bg-gray-900/50 border-gray-800/50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-gray-300">Attribution Methodology</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                All outcomes are derived from real records in your system — action logs, bookings, communication history, and revenue events.
                Time savings are estimated using configurable industry benchmarks for S&C business operations (${timeSavings?.hourlyRateAssumption ?? 35}/hr).
                No synthetic data is used. Revenue attribution requires real revenue events in your pipeline.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
