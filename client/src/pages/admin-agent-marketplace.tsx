import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Store, ArrowLeft, RefreshCw, Star, Award, TrendingUp, BarChart3,
  Zap, DollarSign, Clock, Brain, Users, Shield, Globe, CheckCircle2,
  Target, Activity, Package, ChevronUp, ChevronDown, Minus, Building,
  Cpu, Trophy, AlertTriangle, Sparkles, Code2, MessageSquare,
  GitBranch, Copy, Plus, ArrowRight, Layers,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Cert Badge ───────────────────────────────────────────────────────────────

const CERT_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  platform_recommended: { label: "Platform Recommended", color: "text-yellow-300", icon: Star, bg: "bg-yellow-500/10 border-yellow-500/30" },
  elite_performer:      { label: "Elite Performer",      color: "text-purple-300", icon: Award, bg: "bg-purple-500/10 border-purple-500/30" },
  high_performer:       { label: "High Performer",       color: "text-blue-300",   icon: TrendingUp, bg: "bg-blue-500/10 border-blue-500/30" },
  certified:            { label: "Certified",            color: "text-green-300",  icon: CheckCircle2, bg: "bg-green-500/10 border-green-500/30" },
  uncertified:          { label: "Uncertified",          color: "text-gray-400",   icon: Shield, bg: "bg-gray-500/10 border-gray-500/30" },
};

function CertBadge({ level }: { level: string }) {
  const cfg = CERT_CONFIG[level] ?? CERT_CONFIG.uncertified;
  const Icon = cfg.icon;
  return (
    <Badge className={`text-xs border flex items-center gap-1 ${cfg.bg} ${cfg.color}`}>
      <Icon className="h-3 w-3" />{cfg.label}
    </Badge>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, onInstall, installing }: { agent: any; onInstall: (a: any) => void; installing: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="bg-gray-900 border-gray-800 hover:border-gray-600 transition-colors" data-testid={`agent-card-${agent.agentId}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-white text-sm">{agent.agentName}</h3>
              <Badge variant="outline" className="text-xs text-gray-400 border-gray-600">{agent.department}</Badge>
            </div>
            <CertBadge level={agent.certificationLevel} />
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold text-white">{agent.benchmarkScore}</p>
            <p className="text-xs text-gray-500">Benchmark</p>
          </div>
        </div>

        <p className="text-xs text-gray-400 leading-relaxed mb-3">{agent.description?.substring(0, 100)}...</p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Avg ROI</p>
            <p className="text-sm font-bold text-green-400">{agent.averageRoi > 0 ? `${agent.averageRoi}x` : "—"}</p>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Success Rate</p>
            <p className="text-sm font-bold text-blue-400">{agent.averageSuccessRate > 0 ? `${agent.averageSuccessRate}%` : "—"}</p>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Revenue/mo</p>
            <p className="text-sm font-bold text-purple-400">{agent.averageRevenueInfluenced > 0 ? `$${agent.averageRevenueInfluenced.toLocaleString()}` : "—"}</p>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Sample Size</p>
            <p className="text-sm font-bold text-gray-300">{agent.sampleSize}</p>
          </div>
        </div>

        <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 mb-3">
          {expanded ? "Hide" : "Show"} capabilities {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="space-y-2 mb-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Capabilities</p>
              <div className="flex flex-wrap gap-1">
                {(agent.capabilities ?? []).map((c: string, i: number) => (
                  <Badge key={i} className="text-xs bg-gray-700 text-gray-300 border-none">{c}</Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Supported Industries</p>
              <div className="flex flex-wrap gap-1">
                {(agent.supportedIndustries ?? []).map((ind: string, i: number) => (
                  <Badge key={i} className="text-xs bg-gray-800 text-gray-400 border-gray-700 border">{ind}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button size="sm" className="w-full bg-cyan-600 hover:bg-cyan-700 h-8 text-xs"
          onClick={() => onInstall(agent)} disabled={installing}
          data-testid={`button-install-${agent.agentId}`}>
          <Package className="h-3.5 w-3.5 mr-1.5" />Install Agent
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Ranking Row ─────────────────────────────────────────────────────────────

function RankRow({ entry, highlight }: { entry: any; highlight: string }) {
  const score = highlight === "roi" ? entry.roiScore :
    highlight === "revenue" ? entry.revenueScore :
    highlight === "time" ? entry.timeSavedScore :
    highlight === "trust" ? entry.trustScore :
    entry.overallScore;

  const displayScore = highlight === "roi" ? `${score}x` :
    highlight === "revenue" ? `$${score.toLocaleString()}` :
    highlight === "time" ? `${score}h` :
    highlight === "trust" ? `${score}/100` :
    score;

  const trend = entry.trend === "rising" ? <ChevronUp className="h-3 w-3 text-green-400" /> :
    entry.trend === "declining" ? <ChevronDown className="h-3 w-3 text-red-400" /> :
    <Minus className="h-3 w-3 text-gray-500" />;

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg" data-testid={`rank-row-${entry.agentId}`}>
      <span className={`text-lg font-bold w-7 flex-shrink-0 ${entry.rank === 1 ? "text-yellow-400" : entry.rank === 2 ? "text-gray-300" : entry.rank === 3 ? "text-orange-400" : "text-gray-500"}`}>
        #{entry.rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{entry.agentName}</p>
        <p className="text-xs text-gray-500">{entry.department}</p>
      </div>
      <CertBadge level={entry.certificationLevel} />
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-white">{displayScore}</p>
        {trend}
      </div>
    </div>
  );
}

// ─── Industry Card ────────────────────────────────────────────────────────────

function IndustryCard({ industry, metrics }: { industry: string; metrics: Record<string, number> }) {
  const metricLabels: Record<string, { label: string; unit: string; icon: any; color: string }> = {
    revenue_growth:        { label: "Revenue Growth", unit: "%", icon: TrendingUp, color: "text-green-400" },
    retention_rate:        { label: "Retention Rate", unit: "%", icon: Users, color: "text-blue-400" },
    lead_conversion:       { label: "Lead Conversion", unit: "%", icon: Target, color: "text-purple-400" },
    scheduling_utilization:{ label: "Schedule Util.", unit: "%", icon: Clock, color: "text-orange-400" },
    workforce_adoption:    { label: "AI Adoption", unit: "%", icon: Brain, color: "text-cyan-400" },
  };
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Building className="h-4 w-4 text-gray-400" />{industry}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(metrics).map(([key, val]) => {
          const meta = metricLabels[key] ?? { label: key, unit: "", icon: Activity, color: "text-gray-400" };
          const Icon = meta.icon;
          return (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-gray-400"><Icon className="h-3 w-3" />{meta.label}</span>
              <span className={`font-semibold ${meta.color}`}>{val}{meta.unit}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentMarketplace() {
  const [tab, setTab] = useState("library");
  const [rankSort, setRankSort] = useState("overall");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: agents = [], isLoading: agentsLoading, refetch: refetchAgents } = useQuery<any[]>({
    queryKey: ["/api/marketplace/agents"],
    queryFn: () => fetch("/api/marketplace/agents").then(r => r.json()),
    initialData: [],
  });

  const { data: rankings } = useQuery<any>({
    queryKey: ["/api/marketplace/rankings"],
    queryFn: () => fetch("/api/marketplace/rankings").then(r => r.json()),
  });

  const { data: industryData } = useQuery<any>({
    queryKey: ["/api/marketplace/industry"],
    queryFn: () => fetch("/api/marketplace/industry").then(r => r.json()),
  });

  const { data: analytics } = useQuery<any>({
    queryKey: ["/api/marketplace/analytics"],
    queryFn: () => fetch("/api/marketplace/analytics").then(r => r.json()),
  });

  const { data: trustLayer = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/trust"],
    queryFn: () => fetch("/api/marketplace/trust").then(r => r.json()),
    initialData: [],
  });

  const { data: versions = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/versions"],
    queryFn: () => fetch("/api/marketplace/versions").then(r => r.json()),
    initialData: [],
  });

  const { data: health } = useQuery<any>({
    queryKey: ["/api/marketplace/health"],
    queryFn: () => fetch("/api/marketplace/health").then(r => r.json()),
  });

  const { data: ecosystem } = useQuery<any>({
    queryKey: ["/api/marketplace/ecosystem"],
    queryFn: () => fetch("/api/marketplace/ecosystem").then(r => r.json()),
    enabled: tab === "ecosystem",
  });

  const { data: allReviews = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/reviews"],
    queryFn: () => fetch("/api/marketplace/reviews").then(r => r.json()),
    enabled: tab === "reviews",
    initialData: [],
  });

  const { data: reputation = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/reputation"],
    queryFn: () => fetch("/api/marketplace/reputation").then(r => r.json()),
    enabled: tab === "reviews",
    initialData: [],
  });

  const { data: whiteLabelAgents = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/white-label"],
    queryFn: () => fetch("/api/marketplace/white-label").then(r => r.json()),
    enabled: tab === "whitelabel",
    initialData: [],
  });

  const { data: lifecycleEvents = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/lifecycle"],
    queryFn: () => fetch("/api/marketplace/lifecycle").then(r => r.json()),
    enabled: tab === "lifecycle",
    initialData: [],
  });

  const refreshBenchmarks = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketplace/benchmarks/refresh", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace"] });
      toast({ title: "Benchmarks refreshed — marketplace data updated" });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const installAgent = useMutation({
    mutationFn: (agent: any) => apiRequest("POST", "/api/marketplace/install", { agentId: agent.agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace"] });
      toast({ title: "Agent installed — it will now appear in your workforce dashboard" });
    },
    onError: () => toast({ title: "Installation failed", variant: "destructive" }),
  });

  const currentRankings = rankings ? (
    rankSort === "roi" ? rankings.byRoi :
    rankSort === "revenue" ? rankings.byRevenue :
    rankSort === "time" ? rankings.byTimeSaved :
    rankSort === "trust" ? rankings.byTrust :
    rankings.overall
  ) : [];

  const healthColor = health?.status === "healthy" ? "text-green-400" : health?.status === "warning" ? "text-yellow-400" : "text-red-400";

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
              <Store className="h-6 w-6 text-indigo-400" />
              Agent Marketplace
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              Benchmarked · Certified · Installable · Comparable — internal marketplace infrastructure
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/marketplace/store">
            <Button variant="outline" size="sm" className="border-indigo-700 text-indigo-400 hover:bg-indigo-900/20" data-testid="button-store-link">
              <Store className="h-4 w-4 mr-1.5" />Store
            </Button>
          </Link>
          <Link href="/developer">
            <Button variant="outline" size="sm" className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/20" data-testid="button-developer-link">
              <Code2 className="h-4 w-4 mr-1.5" />Developer Portal
            </Button>
          </Link>
          <Button onClick={() => refreshBenchmarks.mutate()} disabled={refreshBenchmarks.isPending}
            className="bg-indigo-600 hover:bg-indigo-700" size="sm" data-testid="button-refresh-benchmarks">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshBenchmarks.isPending ? "animate-spin" : ""}`} />
            {refreshBenchmarks.isPending ? "Refreshing..." : "Refresh Benchmarks"}
          </Button>
        </div>
      </div>

      {/* Stats Strip */}
      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Agents",         value: analytics.totalAgents,           color: "text-indigo-400" },
            { label: "Installations",  value: analytics.activeInstallations,   color: "text-cyan-400" },
            { label: "Organizations",  value: analytics.totalOrgsUsing,        color: "text-green-400" },
            { label: "Certified",      value: analytics.certificationBreakdown?.certified + analytics.certificationBreakdown?.high_performer + analytics.certificationBreakdown?.elite_performer + analytics.certificationBreakdown?.platform_recommended, color: "text-yellow-400" },
            { label: "Health",         value: `${analytics.healthScore || 0}/100`, color: healthColor },
          ].map(s => (
            <Card key={s.label} className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Health Banner */}
      {health?.issues?.length > 0 && (
        <Card className="bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-yellow-400 mb-1">Marketplace needs attention</p>
                {health.issues.map((issue: string, i: number) => (
                  <p key={i} className="text-xs text-gray-400">• {issue}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-800 border border-gray-700 flex-wrap h-auto">
          <TabsTrigger value="library">Agent Library</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
          <TabsTrigger value="industry">Industry Intelligence</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="analytics">Installation Analytics</TabsTrigger>
          <TabsTrigger value="health">Marketplace Health</TabsTrigger>
          <TabsTrigger value="ecosystem">Ecosystem</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="whitelabel">White Label</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        {/* Agent Library */}
        <TabsContent value="library" className="mt-4">
          {agentsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-60 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : agents.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Store className="h-12 w-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400">No agents in marketplace yet</p>
                <p className="text-xs text-gray-600 mt-1">Click "Refresh Benchmarks" to seed agent templates</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent: any) => (
                <AgentCard key={agent.agentId} agent={agent} onInstall={installAgent.mutate} installing={installAgent.isPending} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Benchmarks */}
        <TabsContent value="benchmarks" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-400" />Platform Benchmark Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(agents ?? []).length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No benchmark data — refresh to generate</p>
                ) : (
                  <div className="space-y-3">
                    {(agents ?? []).filter((a: any) => a.averageSuccessRate > 0).map((agent: any) => (
                      <div key={agent.agentId} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-300">{agent.agentName}</span>
                          <span className="text-blue-400">{agent.averageSuccessRate}% success · {agent.averageRoi > 0 ? `${agent.averageRoi}x ROI` : "no ROI data"}</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-600 to-purple-600 rounded-full"
                            style={{ width: `${agent.averageSuccessRate}%` }} />
                        </div>
                      </div>
                    ))}
                    {(agents ?? []).filter((a: any) => a.averageSuccessRate > 0).length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-8">No activity data yet — agents must run actions to generate benchmarks</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-400" />Revenue Benchmark
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(agents ?? []).map((agent: any) => (
                  <div key={agent.agentId} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{agent.agentName}</span>
                    <span className="text-green-400 font-medium">
                      {agent.averageRevenueInfluenced > 0 ? `$${agent.averageRevenueInfluenced.toLocaleString()}/mo` : "No data"}
                    </span>
                  </div>
                ))}
                {agents.length === 0 && <p className="text-xs text-gray-600 text-center py-4">Refresh benchmarks to see data</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Certifications */}
        <TabsContent value="certifications" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {Object.entries(CERT_CONFIG).filter(([k]) => k !== "uncertified").map(([level, cfg]) => {
              const count = (agents ?? []).filter((a: any) => a.certificationLevel === level).length;
              const Icon = cfg.icon;
              return (
                <Card key={level} className={`border ${cfg.bg}`}>
                  <CardContent className="p-4 text-center">
                    <Icon className={`h-6 w-6 mx-auto mb-1 ${cfg.color}`} />
                    <p className={`text-lg font-bold ${cfg.color}`}>{count}</p>
                    <p className="text-xs text-gray-400">{cfg.label}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="space-y-3">
            {(agents ?? []).map((agent: any) => (
              <Card key={agent.agentId} className="bg-gray-900 border-gray-800" data-testid={`cert-card-${agent.agentId}`}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white text-sm">{agent.agentName}</p>
                    <p className="text-xs text-gray-400">{agent.department}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <CertBadge level={agent.certificationLevel} />
                    <span className="text-xs text-gray-500">Sample: {agent.sampleSize} actions</span>
                    <span className="text-xs text-gray-500">Score: {agent.benchmarkScore}/100</span>
                    {agent.averageRoi > 0 && <span className="text-xs text-green-400">ROI: {agent.averageRoi}x</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 font-medium mb-2">Certification Requirements</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-400">
                <p><span className="text-green-400">Certified:</span> 65%+ success rate, 5+ samples</p>
                <p><span className="text-blue-400">High Performer:</span> 75%+ success, 2x+ ROI, 10+ samples</p>
                <p><span className="text-purple-400">Elite Performer:</span> 85%+ success, 3x+ ROI, 25+ samples</p>
                <p><span className="text-yellow-400">Platform Recommended:</span> 90%+ success, 4x+ ROI, 50+ samples, 80+ trust</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Industry Intelligence */}
        <TabsContent value="industry" className="mt-4">
          {!industryData ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-40 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(industryData).map(([industry, metrics]) => (
                  <IndustryCard key={industry} industry={industry} metrics={metrics as Record<string, number>} />
                ))}
              </div>
              <Card className="mt-4 bg-gray-800/40 border-gray-700/40">
                <CardContent className="p-4 text-xs text-gray-500">
                  Industry benchmarks are platform-wide averages computed from anonymized organizational data. Your organization's data contributes to these benchmarks without any identifying information exposed.
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Rankings */}
        <TabsContent value="rankings" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 mb-2">
            {[
              { key: "overall", label: "Overall" },
              { key: "roi", label: "ROI" },
              { key: "revenue", label: "Revenue" },
              { key: "time", label: "Time Saved" },
              { key: "trust", label: "Trust" },
            ].map(s => (
              <Button key={s.key} size="sm" onClick={() => setRankSort(s.key)}
                className={rankSort === s.key ? "bg-indigo-600 hover:bg-indigo-700 h-8 px-3 text-xs" : "bg-gray-800 hover:bg-gray-700 text-gray-300 h-8 px-3 text-xs"}
                data-testid={`button-rank-${s.key}`}>
                {s.label}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            {(currentRankings ?? []).map((entry: any) => (
              <RankRow key={entry.agentId} entry={entry} highlight={rankSort} />
            ))}
            {(!currentRankings || currentRankings.length === 0) && (
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="p-8 text-center">
                  <Trophy className="h-10 w-10 mx-auto mb-3 text-gray-600" />
                  <p className="text-gray-400 text-sm">No ranking data available yet</p>
                  <p className="text-xs text-gray-600 mt-1">Refresh benchmarks to generate agent rankings</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Version Management */}
        <TabsContent value="versions" className="mt-4 space-y-3">
          {versions.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center">
                <Package className="h-10 w-10 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No version history yet</p>
                <p className="text-xs text-gray-600 mt-1">Refresh benchmarks to seed initial versions</p>
              </CardContent>
            </Card>
          ) : versions.map((v: any) => (
            <Card key={v.id} className="bg-gray-900 border-gray-800" data-testid={`version-${v.id}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white text-sm">{v.agentId}</p>
                    <Badge className="bg-gray-700 text-gray-300 border-none text-xs">v{v.version}</Badge>
                    <Badge className={`text-xs border ${v.status === "stable" ? "bg-green-500/10 text-green-400 border-green-500/30" : v.status === "beta" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                      {v.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{v.releaseNotes}</p>
                </div>
                <div className="flex gap-3 text-xs flex-shrink-0">
                  {v.roiDelta !== 0 && <span className={v.roiDelta > 0 ? "text-green-400" : "text-red-400"}>ROI {v.roiDelta > 0 ? "+" : ""}{v.roiDelta}x</span>}
                  {v.trustDelta !== 0 && <span className={v.trustDelta > 0 ? "text-blue-400" : "text-red-400"}>Trust {v.trustDelta > 0 ? "+" : ""}{v.trustDelta}</span>}
                  <span className="text-gray-500">{new Date(v.createdAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Installation Analytics */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          {!analytics ? (
            <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Agents",       value: analytics.totalAgents,         color: "text-indigo-400" },
                  { label: "Active Installs",     value: analytics.activeInstallations, color: "text-cyan-400" },
                  { label: "Orgs Using",          value: analytics.totalOrgsUsing,      color: "text-green-400" },
                  { label: "Benchmark Snapshots", value: analytics.totalBenchmarkSnapshots, color: "text-purple-400" },
                ].map(s => (
                  <Card key={s.label} className="bg-gray-900 border-gray-800">
                    <CardContent className="p-4 text-center">
                      <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Top Installed Agents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(analytics.topInstalled ?? []).length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-4">No installations yet</p>
                    ) : analytics.topInstalled.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs items-center">
                        <span className="text-gray-300">{a.agentName}</span>
                        <span className="text-cyan-400 font-medium">{a.count} install{a.count !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Top Performing Agents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(analytics.topPerforming ?? []).length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-4">No performance data yet</p>
                    ) : analytics.topPerforming.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs items-center">
                        <span className="text-gray-300">{a.agentName}</span>
                        <span className="text-green-400 font-medium">{a.successRate}% · {a.roi}x ROI</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Marketplace Health */}
        <TabsContent value="health" className="mt-4 space-y-4">
          {!health ? (
            <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />
          ) : (
            <>
              <Card className={`border ${health.status === "healthy" ? "bg-green-500/5 border-green-500/20" : health.status === "warning" ? "bg-yellow-500/5 border-yellow-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <p className={`text-2xl font-bold ${healthColor}`}>{health.healthScore}/100</p>
                    <p className="text-xs text-gray-400 mt-0.5">Marketplace Health Score</p>
                    <Badge className={`mt-2 border capitalize ${health.status === "healthy" ? "bg-green-500/10 text-green-400 border-green-500/30" : health.status === "warning" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
                      {health.status}
                    </Badge>
                  </div>
                  <Sparkles className={`h-12 w-12 ${healthColor} opacity-30`} />
                </CardContent>
              </Card>

              {health.highlights?.length > 0 && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-green-400">Highlights</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {health.highlights.map((h: string, i: number) => (
                      <p key={i} className="text-xs text-gray-300 flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />{h}</p>
                    ))}
                  </CardContent>
                </Card>
              )}

              {health.issues?.length > 0 && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-yellow-400">Issues to Resolve</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {health.issues.map((issue: string, i: number) => (
                      <p key={i} className="text-xs text-gray-300 flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />{issue}</p>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card className="bg-gray-800/40 border-gray-700/40">
                <CardContent className="p-4 text-xs text-gray-500">
                  <strong className="text-gray-400">Future Marketplace Vision:</strong> This infrastructure powers the foundation for a future public Agent Marketplace — a "Glassdoor for Agents" where AI agents are benchmarked, certified, discoverable, and installable across organizations. All current data is internal only.
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Ecosystem Tab */}
        <TabsContent value="ecosystem" className="mt-4 space-y-4">
          {!ecosystem ? (
            <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Agents",      value: ecosystem.totalAgents,      color: "text-indigo-400",  icon: Cpu },
                  { label: "Published",         value: ecosystem.publishedAgents,  color: "text-green-400",   icon: CheckCircle2 },
                  { label: "Developers",        value: ecosystem.developers,       color: "text-emerald-400", icon: Code2 },
                  { label: "Total Installs",    value: ecosystem.totalInstalls,    color: "text-blue-400",    icon: Package },
                  { label: "Reviews",           value: ecosystem.totalReviews,     color: "text-yellow-400",  icon: MessageSquare },
                  { label: "Avg Rating",        value: ecosystem.avgRating > 0 ? `${ecosystem.avgRating}★` : "—", color: "text-yellow-300", icon: Star },
                  { label: "Marketplace Rev.",  value: `$${ecosystem.marketplaceRevenue?.toLocaleString() ?? 0}`, color: "text-green-400", icon: DollarSign },
                  { label: "Pending Review",    value: ecosystem.pendingSubmissions ?? 0, color: "text-orange-400", icon: Clock },
                ].map(s => (
                  <Card key={s.label} className="bg-gray-900 border-gray-800">
                    <CardContent className="p-4">
                      <s.icon className={`h-4 w-4 mb-2 ${s.color}`} />
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ecosystem.certificationBreakdown && (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Certification Breakdown</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {Object.entries(ecosystem.certificationBreakdown).map(([level, count]: [string, any]) => (
                        <div key={level} className="flex items-center justify-between text-xs">
                          <span className="text-gray-400 capitalize">{level.replace(/_/g, " ")}</span>
                          <span className="font-medium text-white">{count}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {ecosystem.topReputationAgents?.length > 0 && (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Top Reputation Agents</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {ecosystem.topReputationAgents.map((a: any, i: number) => (
                        <div key={a.agentId} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 w-4">#{i + 1}</span>
                            <span className="text-gray-300">{a.agentName}</span>
                            <span className="text-gray-600">{a.trustTier}</span>
                          </div>
                          <span className="font-bold text-white">{a.reputationScore}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              <Card className="bg-gray-800/40 border-gray-700/40">
                <CardContent className="p-4 text-xs text-gray-500">
                  <strong className="text-gray-400">Agent Economy vision:</strong> Organizations use agents → Developers build agents → Marketplace distributes → Benchmarks rank → Revenue rewards developers → More developers build. This ecosystem panel tracks the health of that entire cycle.
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Reviews Tab (Glassdoor Layer) */}
        <TabsContent value="reviews" className="mt-4 space-y-3">
          {reputation.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {reputation.slice(0, 4).map((r: any) => (
                <Card key={r.agentId} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <p className="text-sm font-medium text-white mb-1">{r.agentName}</p>
                    <div className="flex justify-center gap-0.5 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <Star key={i} className={`h-3 w-3 ${i <= Math.round(r.avgRating ?? 0) ? "text-yellow-400 fill-yellow-400" : "text-gray-700"}`} />
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">{r.reviewCount} reviews · {r.trustTier}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {allReviews.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No reviews submitted yet</p>
                <p className="text-xs text-gray-600 mt-1">Visit the Agent Store to review agents after using them</p>
                <Link href="/marketplace/store">
                  <Button size="sm" className="mt-3 bg-indigo-600 hover:bg-indigo-700">
                    <Store className="h-4 w-4 mr-1.5" />Open Store
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {allReviews.map((review: any) => (
                <Card key={review.id} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-white">
                            {reputation.find((r: any) => r.agentId === review.agentId)?.agentName ?? review.agentId}
                          </p>
                          {review.verifiedUsage && (
                            <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/30 border h-4 px-1">Verified</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 mb-1">
                          {[1,2,3,4,5].map(i => (
                            <Star key={i} className={`h-3 w-3 ${i <= Math.round(review.rating) ? "text-yellow-400 fill-yellow-400" : "text-gray-700"}`} />
                          ))}
                          <span className="text-xs text-gray-500 ml-1">{review.rating}/5</span>
                        </div>
                        {review.review && <p className="text-xs text-gray-400 mt-1">{review.review}</p>}
                        <div className="flex gap-3 mt-2 text-xs text-gray-600">
                          <span>Ease: {review.easeOfUse}/5</span>
                          <span>Impact: {review.businessImpact}/5</span>
                          <span>Reliability: {review.reliability}/5</span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-600 flex-shrink-0">{new Date(review.createdAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4 text-xs text-gray-500">
              <strong className="text-gray-400">Glassdoor layer:</strong> Every verified review contributes to agent reputation scores, certification eligibility, and marketplace rankings. Reviews are weighted by verified usage and recency.
            </CardContent>
          </Card>
        </TabsContent>

        {/* White Label Tab */}
        <TabsContent value="whitelabel" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">Clone platform agents with your organization's branding and custom rules</p>
            <Link href="/marketplace/store">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                <Copy className="h-4 w-4 mr-1.5" />Clone from Store
              </Button>
            </Link>
          </div>

          {whiteLabelAgents.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Layers className="h-12 w-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No white-label agents created yet</p>
                <p className="text-xs text-gray-600 mt-1">Install an agent from the store, then clone it with your branding and custom rules</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {whiteLabelAgents.map((agent: any) => (
                <Card key={agent.id} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-indigo-500/10 rounded-lg flex-shrink-0">
                        <Copy className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm">{agent.customName}</p>
                        {agent.customDescription && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{agent.customDescription}</p>}
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="text-gray-600">Source: {agent.sourceAgentId}</span>
                          <Badge className={`text-xs border ${agent.status === "active" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                            {agent.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4 space-y-2 text-xs text-gray-500">
              <strong className="text-gray-400 block">White-label workflow:</strong>
              <div className="flex items-center gap-2 flex-wrap">
                {["Install Agent", "Customize Rules", "Customize Branding", "Publish Private Version"].map((step, i, arr) => (
                  <div key={step} className="flex items-center gap-1">
                    <span className="text-gray-400">{step}</span>
                    {i < arr.length - 1 && <ArrowRight className="h-3 w-3 text-gray-600" />}
                  </div>
                ))}
              </div>
              <p>Private white-label agents remain organization-owned and are not visible to other organizations on the marketplace.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lifecycle Tab */}
        <TabsContent value="lifecycle" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {["installed", "active", "upgraded", "deprecated", "archived", "removed"].map(state => {
              const count = lifecycleEvents.filter((e: any) => e.toStatus === state || e.eventType === state).length;
              const colors: Record<string, string> = {
                installed: "text-blue-400", active: "text-green-400", upgraded: "text-cyan-400",
                deprecated: "text-yellow-400", archived: "text-orange-400", removed: "text-red-400",
              };
              return (
                <Card key={state} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-3 text-center">
                    <p className={`text-lg font-bold ${colors[state] ?? "text-gray-400"}`}>{count}</p>
                    <p className="text-xs text-gray-500 capitalize">{state}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {lifecycleEvents.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <GitBranch className="h-12 w-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No lifecycle events recorded yet</p>
                <p className="text-xs text-gray-600 mt-1">Events are recorded automatically when agents are installed, upgraded, deprecated, or removed</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {lifecycleEvents.slice(0, 20).map((event: any) => {
                const eventColors: Record<string, string> = {
                  installed: "text-blue-400 bg-blue-500/10", active: "text-green-400 bg-green-500/10",
                  upgraded: "text-cyan-400 bg-cyan-500/10", deprecated: "text-yellow-400 bg-yellow-500/10",
                  archived: "text-orange-400 bg-orange-500/10", removed: "text-red-400 bg-red-500/10",
                  cloned: "text-indigo-400 bg-indigo-500/10", submitted: "text-purple-400 bg-purple-500/10",
                };
                const colorClass = eventColors[event.eventType] ?? "text-gray-400 bg-gray-500/10";
                return (
                  <div key={event.id} className="flex items-center gap-3 p-2 bg-gray-900 rounded-lg border border-gray-800"
                    data-testid={`lifecycle-event-${event.id}`}>
                    <Badge className={`text-xs border-none flex-shrink-0 ${colorClass}`}>{event.eventType}</Badge>
                    <span className="text-xs text-gray-300 flex-1">{event.agentId}</span>
                    {event.notes && <span className="text-xs text-gray-500 hidden sm:block truncate max-w-xs">{event.notes}</span>}
                    <span className="text-xs text-gray-600 flex-shrink-0">{new Date(event.createdAt).toLocaleDateString()}</span>
                  </div>
                );
              })}
            </div>
          )}

          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4 text-xs text-gray-500">
              <strong className="text-gray-400">Lifecycle states:</strong> Installed → Active → Upgraded → Deprecated → Archived → Removed.
              Lifecycle analytics track install rates, upgrade rates, retention rates, and churn rates across all agents for the organization.
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      {/* Trust Layer strip */}
      {trustLayer.length > 0 && tab === "certifications" && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-400" />Marketplace Trust Layer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2">Agent</th>
                    <th className="text-right py-2">Trust</th>
                    <th className="text-right py-2">Cert Level</th>
                    <th className="text-right py-2">Confidence</th>
                    <th className="text-right py-2">Stability</th>
                    <th className="text-right py-2">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {trustLayer.map((t: any) => (
                    <tr key={t.agentId} data-testid={`trust-row-${t.agentId}`}>
                      <td className="py-2 text-gray-300 font-medium">{t.agentName}</td>
                      <td className="py-2 text-right text-blue-400">{t.trustScore || "—"}</td>
                      <td className="py-2 text-right"><CertBadge level={t.certificationLevel} /></td>
                      <td className="py-2 text-right text-gray-400">{t.benchmarkConfidence}%</td>
                      <td className="py-2 text-right text-gray-400">{t.performanceStability}</td>
                      <td className="py-2 text-right text-gray-400">{t.adoptionTrend}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
