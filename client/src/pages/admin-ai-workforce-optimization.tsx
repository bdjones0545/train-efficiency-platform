import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Brain, ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Lightbulb, Target, Clock, DollarSign,
  Activity, BarChart3, Zap, ChevronRight, Award, Shield, Rocket,
  Calendar, Mail, Users, Star, Eye,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  low: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const CATEGORY_ICONS: Record<string, any> = {
  lead_followup: Target,
  scheduling: Calendar,
  retention: Users,
  communication: Mail,
  workflow: Zap,
  governance: Shield,
  revenue: DollarSign,
  operations: Activity,
};

const GRADE_COLORS: Record<string, string> = {
  A: "text-green-400",
  B: "text-blue-400",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-red-400",
};

function HealthBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400">{value}/{max}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ForecastCard({ item }: { item: any }) {
  const confidence = Math.round((item.confidence ?? 0) * 100);
  const hasData = item.expected > 0;
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-200">{item.metric}</p>
          <Badge variant="outline" className={`text-xs ${confidence >= 70 ? "border-green-600 text-green-400" : "border-yellow-600 text-yellow-400"}`}>
            {confidence}% confidence
          </Badge>
        </div>
        {hasData ? (
          <div className="space-y-2">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{item.expected.toLocaleString()}</div>
              <div className="text-xs text-gray-500">{item.unit} (expected)</div>
            </div>
            <div className="flex justify-between text-xs">
              <div className="text-center">
                <div className="text-green-400 font-medium">{item.bestCase.toLocaleString()}</div>
                <div className="text-gray-600">best case</div>
              </div>
              <div className="text-center">
                <div className="text-red-400 font-medium">{item.worstCase.toLocaleString()}</div>
                <div className="text-gray-600">worst case</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-3 text-gray-600 text-sm">Insufficient historical data</div>
        )}
        <p className="text-xs text-gray-600 mt-2 border-t border-gray-700 pt-2">{item.basis}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminAiWorkforceOptimization() {
  const [tab, setTab] = useState("recommendations");
  const [forecastWindow, setForecastWindow] = useState("7d");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: recs, isLoading: recsLoading, refetch: refetchRecs } = useQuery<any[]>({
    queryKey: ["/api/workforce/optimization-recommendations"],
    queryFn: () => fetch("/api/workforce/optimization-recommendations").then(r => r.json()),
    initialData: [],
  });

  const { data: health, isLoading: healthLoading } = useQuery<any>({
    queryKey: ["/api/workforce/business-health"],
    queryFn: () => fetch("/api/workforce/business-health").then(r => r.json()),
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/forecast", forecastWindow],
    queryFn: () => fetch(`/api/workforce/forecast?window=${forecastWindow}`).then(r => r.json()),
    initialData: [],
  });

  const { data: workflows, isLoading: workflowsLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/workflow-effectiveness"],
    queryFn: () => fetch("/api/workforce/workflow-effectiveness").then(r => r.json()),
    initialData: [],
  });

  const { data: execInsights, isLoading: execLoading } = useQuery<any>({
    queryKey: ["/api/workforce/executive-insights"],
    queryFn: () => fetch("/api/workforce/executive-insights").then(r => r.json()),
  });

  const { data: scorecard } = useQuery<any>({
    queryKey: ["/api/workforce/intelligence-scorecard"],
    queryFn: () => fetch("/api/workforce/intelligence-scorecard").then(r => r.json()),
  });

  const approveRec = useMutation({
    mutationFn: (rec: any) => apiRequest("POST", "/api/workforce/memory", {
      memoryType: "recommendation",
      key: rec.id,
      title: rec.title,
      summary: rec.recommendation,
      outcome: "accepted",
      value: rec.estimatedImpactValue ?? 0,
      context: { category: rec.category, agentResponsible: rec.agentResponsible },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/optimization-recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/intelligence-scorecard"] });
      toast({ title: "Recommendation approved and saved to memory" });
    },
  });

  const rejectRec = useMutation({
    mutationFn: (rec: any) => apiRequest("POST", "/api/workforce/memory", {
      memoryType: "recommendation",
      key: rec.id,
      title: rec.title,
      summary: rec.recommendation,
      outcome: "rejected",
      value: 0,
      context: { category: rec.category },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/optimization-recommendations"] });
      toast({ title: "Recommendation dismissed — won't repeat for 30 days" });
    },
  });

  const workflowStatusStyles: Record<string, string> = {
    best_performing: "bg-green-500/10 text-green-400 border-green-500/30",
    efficient: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    underperforming: "bg-red-500/10 text-red-400 border-red-500/30",
    inactive: "bg-gray-500/10 text-gray-400 border-gray-500/30",
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
              <Brain className="h-6 w-6 text-purple-400" />
              Optimization Center
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Continuous improvement — observe, evaluate, optimize</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/ai-workforce/approvals">
            <Button variant="outline" size="sm" className="border-purple-700 text-purple-400 hover:bg-purple-900/20" data-testid="button-approvals-link">
              <CheckCircle2 className="h-4 w-4 mr-1.5" />Approvals
            </Button>
          </Link>
          <Button variant="ghost" size="sm" className="text-gray-400" onClick={() => { refetchRecs(); }} data-testid="button-refresh-optimization">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Business Health Banner */}
      {health && !healthLoading && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="text-center flex-shrink-0">
                <div className={`text-5xl font-black ${GRADE_COLORS[health.grade] ?? "text-white"}`}>
                  {health.grade}
                </div>
                <div className="text-2xl font-bold text-white">{health.overall}/100</div>
                <div className="text-xs text-gray-500 mt-0.5">Business Health</div>
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <HealthBar label="Revenue Trend" value={health.components.revenueTrend} max={20} />
                <HealthBar label="Lead Pipeline" value={health.components.leadTrend} max={15} />
                <HealthBar label="Scheduling" value={health.components.schedulingUtilization} max={15} />
                <HealthBar label="Workflows" value={health.components.workflowPerformance} max={15} />
                <HealthBar label="Agents" value={health.components.agentPerformance} max={15} />
                <HealthBar label="Approvals" value={health.components.approvalEfficiency} max={10} />
                <HealthBar label="Comms" value={health.components.communicationVolume} max={10} />
                <HealthBar label="Integrations" value={health.components.integrationCoverage} max={10} />
              </div>
              <div className="flex-shrink-0 space-y-1 min-w-[180px]">
                {health.strengths.slice(0, 2).map((s: string) => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-green-400">
                    <CheckCircle2 className="h-3 w-3 flex-shrink-0" />{s}
                  </div>
                ))}
                {health.improvementAreas.slice(0, 2).map((s: string) => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-orange-400">
                    <AlertTriangle className="h-3 w-3 flex-shrink-0" />{s}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-800 border border-gray-700 flex-wrap h-auto">
          <TabsTrigger value="recommendations" className="data-[state=active]:bg-purple-600">
            <Lightbulb className="h-4 w-4 mr-1.5" />Recommendations
            {(recs ?? []).length > 0 && (
              <Badge className="ml-1.5 bg-purple-500 text-white text-xs h-5 px-1.5">{(recs ?? []).length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="atlas" className="data-[state=active]:bg-indigo-600">
            <Brain className="h-4 w-4 mr-1.5" />Atlas Insights
          </TabsTrigger>
          <TabsTrigger value="forecast" className="data-[state=active]:bg-blue-600">
            <TrendingUp className="h-4 w-4 mr-1.5" />Forecasts
          </TabsTrigger>
          <TabsTrigger value="workflows" className="data-[state=active]:bg-teal-600">
            <BarChart3 className="h-4 w-4 mr-1.5" />Workflows
          </TabsTrigger>
          <TabsTrigger value="scorecard" className="data-[state=active]:bg-gray-600">
            <Award className="h-4 w-4 mr-1.5" />Intelligence
          </TabsTrigger>
        </TabsList>

        {/* ── Recommendations ── */}
        <TabsContent value="recommendations" className="mt-4 space-y-3">
          {recsLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-800 rounded-xl animate-pulse" />)}</div>
          ) : (recs ?? []).length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400 opacity-50" />
                <p className="text-gray-300 font-medium">No optimization recommendations right now</p>
                <p className="text-sm text-gray-500 mt-1">Your workforce is operating well. Check back as more data accumulates.</p>
              </CardContent>
            </Card>
          ) : (recs ?? []).map((rec: any) => {
            const IconComp = CATEGORY_ICONS[rec.category] ?? Lightbulb;
            return (
              <Card key={rec.id} className="bg-gray-900 border-gray-800 hover:border-gray-700 transition-colors" data-testid={`rec-${rec.id}`}>
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mt-0.5">
                      <IconComp className="h-5 w-5 text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-white text-sm">{rec.title}</span>
                        <Badge className={`text-xs border ${PRIORITY_STYLES[rec.priority]}`}>{rec.priority}</Badge>
                        {rec.requiresApproval && (
                          <Badge className="text-xs border border-blue-500/30 text-blue-400 bg-blue-500/10">Needs Approval</Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                        <div className="bg-gray-800 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Current State</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{rec.currentState}</p>
                        </div>
                        <div className="bg-gray-800 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Recommendation</p>
                          <p className="text-xs text-gray-300 leading-relaxed">{rec.recommendation}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <DollarSign className="h-3.5 w-3.5 text-green-400" />
                          <span className="text-green-400 font-medium">{rec.estimatedImpact}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Target className="h-3.5 w-3.5" />
                          <span>{Math.round((rec.confidence ?? 0) * 100)}% confidence</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Activity className="h-3.5 w-3.5" />
                          <span>{rec.agentName}</span>
                        </div>
                      </div>

                      {rec.evidence?.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Evidence</p>
                          <ul className="space-y-0.5">
                            {rec.evidence.slice(0, 2).map((e: string, i: number) => (
                              <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                                <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>{e}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0 justify-start sm:justify-center">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white h-8 px-3"
                        onClick={() => approveRec.mutate(rec)}
                        disabled={approveRec.isPending}
                        data-testid={`button-approve-${rec.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        {rec.requiresApproval ? "Approve" : "Accept"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-gray-600 text-gray-300 hover:bg-gray-800 h-8 px-3"
                        onClick={() => rejectRec.mutate(rec)}
                        disabled={rejectRec.isPending}
                        data-testid={`button-dismiss-${rec.id}`}
                      >
                        Dismiss
                      </Button>
                      {rec.actionUrl && (
                        <Link href={rec.actionUrl}>
                          <Button size="sm" variant="ghost" className="text-purple-400 h-8 px-3 w-full">
                            <Rocket className="h-3.5 w-3.5 mr-1" />Act
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Atlas Executive Insights ── */}
        <TabsContent value="atlas" className="mt-4 space-y-4">
          {execLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-40 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : execInsights ? (
            <>
              {/* Priority Score */}
              <Card className="bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border-indigo-700/50">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-indigo-300 mb-1">Executive Priority Score</p>
                    <p className="text-3xl font-black text-white">{execInsights.priorityScore}</p>
                    <p className="text-xs text-indigo-400 mt-0.5">
                      {execInsights.priorityScore >= 60 ? "🔴 Immediate action needed" :
                       execInsights.priorityScore >= 30 ? "🟡 Several items need attention" :
                       "🟢 Business running smoothly"}
                    </p>
                  </div>
                  <Brain className="h-10 w-10 text-indigo-400 opacity-60" />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Focus Today */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Star className="h-4 w-4 text-yellow-400" />What to focus on today
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {execInsights.focusToday.length === 0 ? (
                      <p className="text-sm text-gray-500">No urgent items today.</p>
                    ) : execInsights.focusToday.map((item: any, i: number) => (
                      <div key={i} className="p-2 bg-gray-800 rounded-lg">
                        <p className="text-xs font-medium text-white">{item.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.action}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Costing Money */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-red-400" />What is costing you money
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {execInsights.costingMoney.length === 0 ? (
                      <p className="text-sm text-gray-500">No major cost issues detected.</p>
                    ) : execInsights.costingMoney.map((item: any, i: number) => (
                      <div key={i} className="p-2 bg-gray-800 rounded-lg">
                        <p className="text-xs font-medium text-white">{item.title}</p>
                        {item.estimatedLoss > 0 && (
                          <p className="text-xs text-red-400 mt-0.5">Est. impact: ${item.estimatedLoss.toFixed(0)}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Biggest Opportunity */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Rocket className="h-4 w-4 text-green-400" />Biggest opportunity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {execInsights.biggestOpportunity ? (
                      <div className="p-3 bg-green-900/20 border border-green-800/50 rounded-lg">
                        <p className="text-sm font-medium text-white">{execInsights.biggestOpportunity.title}</p>
                        {execInsights.biggestOpportunity.value > 0 && (
                          <p className="text-xs text-green-400 mt-1">${execInsights.biggestOpportunity.value.toFixed(0)} potential value</p>
                        )}
                        <Link href="/admin/ai-workforce/outcomes">
                          <Button size="sm" variant="ghost" className="text-green-400 h-6 px-2 text-xs mt-1">
                            View opportunities <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-gray-500">No open opportunities</p>
                        <Link href="/admin/ai-workforce/outcomes">
                          <Button size="sm" variant="outline" className="mt-2 text-xs border-gray-600">Generate opportunities</Button>
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Biggest Risk */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-400" />Biggest risk
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {execInsights.biggestRisk ? (
                      <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">{execInsights.biggestRisk.title}</span>
                          <Badge className="text-xs border border-red-500/30 text-red-400 bg-red-500/10">{execInsights.biggestRisk.level}</Badge>
                        </div>
                        {execInsights.biggestRisk.description && (
                          <p className="text-xs text-gray-400 leading-relaxed">{execInsights.biggestRisk.description.substring(0, 120)}</p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500 text-sm">No active risks detected</div>
                    )}
                  </CardContent>
                </Card>

                {/* Approve Next */}
                {execInsights.approveNext && (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-400" />What to approve next
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                        <p className="text-sm font-medium text-white capitalize">{execInsights.approveNext.title}</p>
                        <p className="text-xs text-gray-400 mt-1">{execInsights.approveNext.description}</p>
                        <Link href="/admin/ai-workforce/approvals">
                          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-6 px-3 text-xs mt-2">
                            Review <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Automate Next */}
                {execInsights.automateNext && (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-400" />What to automate next
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
                        <p className="text-sm font-medium text-white">{execInsights.automateNext.title}</p>
                        <p className="text-xs text-gray-400 mt-1">{execInsights.automateNext.rationale}</p>
                        {execInsights.automateNext.estimatedSavings > 0 && (
                          <p className="text-xs text-yellow-400 mt-1">${execInsights.automateNext.estimatedSavings}/mo savings potential</p>
                        )}
                        <Link href="/admin/ai-workforce/capabilities">
                          <Button size="sm" variant="ghost" className="text-yellow-400 h-6 px-2 text-xs mt-1">
                            Enable agent <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : null}
        </TabsContent>

        {/* ── Forecasts ── */}
        <TabsContent value="forecast" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-400">Simple linear projection from 30-day historical data</p>
            <Select value={forecastWindow} onValueChange={setForecastWindow}>
              <SelectTrigger className="w-32 bg-gray-800 border-gray-700 h-8 text-sm" data-testid="select-forecast-window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="7d">Next 7 Days</SelectItem>
                <SelectItem value="30d">Next 30 Days</SelectItem>
                <SelectItem value="90d">Next 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {forecastLoading ? (
            <div className="grid grid-cols-2 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-36 bg-gray-800 rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(forecast ?? []).map((item: any) => <ForecastCard key={item.metric} item={item} />)}
            </div>
          )}
          <Card className="bg-gray-800/50 border-gray-700/50">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                <strong className="text-gray-400">Forecast methodology:</strong> Linear extrapolation from 30-day rolling average.
                Best case = +25–40% variance. Worst case = -20–30% variance. Confidence scores reflect data density — more historical activity produces more accurate forecasts.
                These are estimates to support planning, not guarantees.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Workflow Effectiveness ── */}
        <TabsContent value="workflows" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-teal-400" />
                Workflow Effectiveness Rankings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {workflowsLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-gray-800 rounded-lg animate-pulse" />)}</div>
              ) : (workflows ?? []).length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No workflow execution data yet.</p>
                  <p className="text-xs mt-1">Publish workflows to start tracking their effectiveness.</p>
                  <Link href="/admin/workflow-builder">
                    <Button size="sm" variant="outline" className="mt-3 border-gray-600 text-gray-300">Build Workflows</Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {(workflows ?? []).map((wf: any) => (
                    <div key={wf.workflowId} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg" data-testid={`workflow-${wf.workflowId}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{wf.workflowName}</span>
                          <Badge className={`text-xs border ${workflowStatusStyles[wf.status]}`}>
                            {wf.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                          <span>{wf.executions} runs</span>
                          <span className={wf.successRate >= 80 ? "text-green-400" : "text-red-400"}>{wf.successRate}% success</span>
                          <span className="text-blue-400">{wf.hoursSaved}h saved</span>
                          {wf.roi > 0 && <span className="text-purple-400">${wf.roi.toFixed(0)} ROI</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Intelligence Scorecard ── */}
        <TabsContent value="scorecard" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {scorecard && [
              { label: "Recommendations Generated", value: scorecard.recommendationsGenerated, color: "text-purple-400" },
              { label: "Recommendations Accepted", value: scorecard.recommendationsAccepted, color: "text-green-400" },
              { label: "Acceptance Rate", value: `${scorecard.recommendationAcceptanceRate}%`, color: "text-blue-400" },
              { label: "Learning Events", value: scorecard.learningEventsRecorded, color: "text-yellow-400" },
              { label: "Opportunities Generated", value: scorecard.opportunitiesGenerated, color: "text-orange-400" },
              { label: "Opportunities Resolved", value: scorecard.opportunitiesResolved, color: "text-teal-400" },
              { label: "Opportunity Conversion", value: `${scorecard.opportunityConversionRate}%`, color: "text-pink-400" },
              { label: "Predicted Revenue", value: `$${(scorecard.predictedRevenue ?? 0).toFixed(0)}`, color: "text-green-400" },
              { label: "Labor Savings", value: `$${(scorecard.laborSavings ?? 0).toFixed(0)}`, color: "text-purple-400" },
            ].map(item => (
              <Card key={item.label} className="bg-gray-900 border-gray-800">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                  <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                </CardContent>
              </Card>
            ))}
            {!scorecard && (
              <div className="col-span-3 text-center py-10 text-gray-500 text-sm">Loading scorecard...</div>
            )}
          </div>
          <Card className="bg-gray-800/50 border-gray-700/50 mt-4">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                <strong className="text-gray-400">Intelligence metrics</strong> track the quality of the AI workforce's reasoning over time.
                As you approve recommendations and resolve opportunities, the system accumulates organizational memory that prevents repeated suggestions and improves future recommendations.
                Forecast accuracy will be available once historical forecasts can be compared against actual outcomes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
