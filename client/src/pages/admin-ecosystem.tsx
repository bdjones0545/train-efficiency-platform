import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Layers, Building2, Palette, GitBranch, Package,
  Users, BarChart3, ShoppingBag, Bot, Shield, ChevronRight,
  CheckCircle, AlertTriangle, TrendingUp, Download, Star,
  RefreshCw, Globe, Copy, Search, ArrowUpRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type EcosystemOverview = { totalOrganizations: number; totalActiveUsers: number; totalRevenue: number; totalAiExecutions: number; totalWorkflowsRunning: number; totalActiveAgents: number; totalDeployments: number; platformGrowthVelocity: number; avgHealthScore: number; avgGrowthScore: number; planDistribution: Record<string, number>; generatedAt: string };
type OrgEntry = { id: string; name: string; plan: string; healthScore: number; growthScore: number; users: number; clients: number; activeAgents: number; revenue: number; status: string; location: string };
type OrgsData = { organizations: OrgEntry[]; total: number; generatedAt: string };
type BrandingData = { whiteLabel: { logoUrl: string | null; brandColor: string; typography: string; customDomain: string | null; emailTemplate: string; landingPageTheme: string; aiAssistantName: string; aiAssistantPersonality: string }; whiteLabelReadinessScore: number; brandConsistencyScore: number; checklist: { item: string; done: boolean; impact: string }[]; generatedAt: string };
type FranchiseData = { hierarchy: { name: string; type: string; regions: { name: string; locations: { name: string; users: number; clients: number }[] }[] }; sharedTemplates: number; syncedPolicies: number; lastSync: string; generatedAt: string };
type Template = { id: string; name: string; type: string; installs: number; successRate: number; revenueImpact: string; rating: number; category: string; author: string };
type TemplatesData = { templates: Template[]; categories: string[]; generatedAt: string };
type AgencyData = { portfolioSize: number; totalRevenueManaged: number; activeDeployments: number; avgWorkforceHealth: number; avgGrowthScore: number; clients: (OrgEntry & { lastActivity: string })[]; generatedAt: string };
type HierarchyNode = { name: string; type: string; revenue: number; users: number; agents: number; children: HierarchyNode[] };
type HierarchyData = { levels: string[]; tree: HierarchyNode; generatedAt: string };
type BenchmarkRow = { metric: string; yourValue: number; p25: number; p50: number; p75: number; p90: number; percentile: number };
type BenchmarkData = { yourOrg: any; benchmarks: BenchmarkRow[]; topPerformers: { name: string; revenue: number; retention: number; growthVelocity: number }[]; improvements: { area: string; gap: number; recommendation: string; potentialGain: string }[]; generatedAt: string };
type MarketAsset = { id: string; name: string; category: string; installs: number; successScore: number; roiScore: number; description: string };
type MarketplaceData = { assets: MarketAsset[]; categories: string[]; generatedAt: string };
type TrainChatData = { connectedBrains: string[]; apiHealth: string; avgLatencyMs: number; usageLast30d: { programsGenerated: number; coachingSessionsAssisted: number; athleteProfilesBuilt: number; educationModulesServed: number }; tokensUsed30d: number; generatedAt: string };
type SecurityAuditData = { enterpriseSecurityScore: number; checks: { check: string; passed: boolean; severity: string; note?: string }[]; violations: number; warnings: number; lastAuditAt: string; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string }) {
  const cfg: Record<string, string> = { enterprise: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", growth: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", professional: "bg-primary/10 text-primary", starter: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[plan] ?? "bg-muted text-muted-foreground"}`}>{plan}</Badge>;
}

function ScoreBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const color = value >= 85 ? "bg-emerald-500" : value >= 70 ? "bg-blue-500" : value >= 55 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div>
      {showLabel && <span className="text-[9px] font-bold text-muted-foreground w-6">{value}</span>}
    </div>
  );
}

function SevBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s}</Badge>;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",     label: "Overview",       icon: Layers },
  { id: "orgs",         label: "Organizations",  icon: Building2 },
  { id: "branding",     label: "White Label",    icon: Palette },
  { id: "franchise",    label: "Franchise",      icon: GitBranch },
  { id: "templates",    label: "Templates",      icon: Package },
  { id: "agency",       label: "Agency Mode",    icon: Users },
  { id: "hierarchy",    label: "Hierarchy",      icon: Layers },
  { id: "benchmarking", label: "Benchmarking",   icon: BarChart3 },
  { id: "marketplace",  label: "Marketplace",    icon: ShoppingBag },
  { id: "trainchat",    label: "TrainChat",      icon: Bot },
  { id: "security",     label: "Security Audit", icon: Shield },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<EcosystemOverview>({ queryKey: ["/api/ecosystem/overview"], staleTime: 60_000 });

  const kpis = data ? [
    { label: "Organizations",   value: data.totalOrganizations,                                 color: "text-primary",                                  tab: "orgs" as TabId },
    { label: "Active Users",    value: data.totalActiveUsers.toLocaleString(),                  color: "text-blue-600 dark:text-blue-400",               tab: "orgs" as TabId },
    { label: "Total Revenue",   value: `$${(data.totalRevenue / 1000).toFixed(1)}k`,            color: "text-emerald-600 dark:text-emerald-400",         tab: "benchmarking" as TabId },
    { label: "Active Agents",   value: data.totalActiveAgents,                                  color: "text-violet-600 dark:text-violet-400",           tab: "orgs" as TabId },
    { label: "Growth Velocity", value: data.platformGrowthVelocity,                             color: "text-amber-600 dark:text-amber-400",             tab: "benchmarking" as TabId },
    { label: "Deployments",     value: data.totalDeployments,                                   color: "text-muted-foreground",                         tab: "orgs" as TabId },
  ] : [];

  return (
    <div className="space-y-4" data-testid="tab-ecosystem-overview">
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {kpis.map(k => (
              <button key={k.label} onClick={() => setTab(k.tab)} className="p-4 rounded-xl border bg-card text-left hover:bg-muted/30 transition-colors group" data-testid={`ecosystem-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
              </button>
            ))}
          </div>

          {data && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border bg-card">
                <p className="text-xs font-semibold mb-3">Platform Scores</p>
                <div className="space-y-2">
                  {[
                    { label: "Avg Health Score",  value: data.avgHealthScore },
                    { label: "Avg Growth Score",  value: data.avgGrowthScore },
                    { label: "Growth Velocity",   value: data.platformGrowthVelocity },
                  ].map(m => (
                    <div key={m.label}>
                      <div className="flex justify-between text-[10px] mb-0.5"><span className="text-muted-foreground">{m.label}</span><span className="font-bold">{m.value}</span></div>
                      <ScoreBar value={m.value} showLabel={false} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 rounded-xl border bg-card">
                <p className="text-xs font-semibold mb-3">Plan Distribution</p>
                {Object.entries(data.planDistribution).map(([plan, count]) => (
                  <div key={plan} className="flex items-center gap-2 mb-1.5">
                    <PlanBadge plan={plan} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((count / data.totalOrganizations) * 100)}%` }} /></div>
                    <span className="text-[9px] text-muted-foreground w-3">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Organizations ───────────────────────────────────────────────────────

function OrgsTab() {
  const { data, isLoading } = useQuery<OrgsData>({ queryKey: ["/api/ecosystem/organizations"], staleTime: 60_000 });
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const { toast } = useToast();
  const qc = useQueryClient();

  const cloneMutation = useMutation({
    mutationFn: (org: OrgEntry) => apiRequest("POST", "/api/ecosystem/clone", { sourceOrgId: org.id, newOrgName: `${org.name} — Copy` }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/ecosystem/organizations"] }); toast({ title: "Organization cloned", description: "New location ready to configure." }); },
    onError: () => toast({ title: "Clone failed", variant: "destructive" }),
  });

  const filtered = (data?.organizations ?? []).filter(o =>
    (planFilter === "all" || o.plan === planFilter) &&
    (o.name.toLowerCase().includes(search.toLowerCase()) || o.location.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4" data-testid="tab-orgs">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-36">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search organizations..." className="w-full h-8 pl-8 pr-3 rounded-lg border bg-card text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-org-search" />
        </div>
        {["all", "enterprise", "growth", "professional", "starter"].map(p => (
          <button key={p} onClick={() => setPlanFilter(p)} data-testid={`filter-plan-${p}`}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium capitalize transition-colors ${planFilter === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{p}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
            <span className="col-span-4">Organization</span>
            <span className="col-span-2 text-center">Health</span>
            <span className="col-span-2 text-center">Growth</span>
            <span className="col-span-2 text-right">Revenue</span>
            <span className="col-span-2 text-right">Actions</span>
          </div>
          <div className="divide-y">
            {filtered.map(org => (
              <div key={org.id} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`org-row-${org.id}`}>
                <div className="col-span-4">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-medium">{org.name}</p>
                    <PlanBadge plan={org.plan} />
                  </div>
                  <p className="text-[9px] text-muted-foreground">{org.location} · {org.users} users · {org.clients} clients</p>
                </div>
                <div className="col-span-2 px-2"><ScoreBar value={org.healthScore} /></div>
                <div className="col-span-2 px-2"><ScoreBar value={org.growthScore} /></div>
                <span className="col-span-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 text-right">${org.revenue.toLocaleString()}</span>
                <div className="col-span-2 flex justify-end">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => cloneMutation.mutate(org)} disabled={cloneMutation.isPending} data-testid={`button-clone-${org.id}`} title="Clone organization">
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: White Label ─────────────────────────────────────────────────────────

function BrandingTab() {
  const { data, isLoading } = useQuery<BrandingData>({ queryKey: ["/api/ecosystem/branding"], staleTime: 60_000 });
  const { toast } = useToast();
  const [aiName, setAiName] = useState("");
  const [personality, setPersonality] = useState("");

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/ecosystem/branding", { aiAssistantName: aiName || data?.whiteLabel?.aiAssistantName, aiAssistantPersonality: personality || data?.whiteLabel?.aiAssistantPersonality }),
    onSuccess: () => toast({ title: "Branding saved" }),
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const IMPACT_COLORS: Record<string, string> = { high: "text-rose-600 dark:text-rose-400", medium: "text-amber-600 dark:text-amber-400", low: "text-muted-foreground" };

  return (
    <div className="space-y-4" data-testid="tab-branding">
      {!isLoading && data && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "White Label Readiness", value: data.whiteLabelReadinessScore, color: data.whiteLabelReadinessScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
            { label: "Brand Consistency",     value: data.brandConsistencyScore,    color: data.brandConsistencyScore >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-4 rounded-xl border bg-card text-center" data-testid={`branding-score-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-3xl font-extrabold ${m.color}`}>{m.value}<span className="text-lg">/100</span></p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <div className="mt-1"><ScoreBar value={m.value} showLabel={false} /></div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">White-Label Checklist</h3></div>
          <div className="divide-y">
            {(data?.checklist ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`branding-check-${i}`}>
                {c.done ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className="text-xs flex-1">{c.item}</span>
                <span className={`text-[9px] font-medium ${IMPACT_COLORS[c.impact]}`}>{c.impact}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="p-4 rounded-xl border bg-card space-y-3">
          <p className="text-xs font-semibold">AI Assistant Configuration</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Assistant Name</label>
              <input defaultValue={data.whiteLabel.aiAssistantName} onChange={e => setAiName(e.target.value)} className="w-full h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-ai-name" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Personality</label>
              <select defaultValue={data.whiteLabel.aiAssistantPersonality} onChange={e => setPersonality(e.target.value)} className="w-full h-8 px-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-ai-personality">
                {["professional", "friendly", "motivating", "concise", "energetic"].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-branding">
            {saveMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}Save Branding
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Franchise ───────────────────────────────────────────────────────────

function FranchiseTab() {
  const { data, isLoading } = useQuery<FranchiseData>({ queryKey: ["/api/ecosystem/franchise"], staleTime: 60_000 });
  const { toast } = useToast();

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ecosystem/franchise/sync", {}),
    onSuccess: () => toast({ title: "Sync complete", description: "Policies and templates pushed to all locations." }),
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="tab-franchise">
      {!isLoading && data && (
        <div className="flex items-center justify-between p-3.5 rounded-xl border bg-primary/5">
          <div className="flex items-center gap-3">
            <GitBranch className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-semibold">{data.hierarchy.name}</p>
              <p className="text-[10px] text-muted-foreground">{data.sharedTemplates} shared templates · {data.syncedPolicies} synced policies · Last sync {formatDistanceToNow(new Date(data.lastSync), { addSuffix: true })}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-franchise">
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />Sync All
          </Button>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.hierarchy?.regions ?? []).map((region, ri) => (
            <div key={ri} className="rounded-xl border overflow-hidden" data-testid={`region-${ri}`}>
              <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">{region.name}</span>
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4 ml-auto">{region.locations.length} locations</Badge>
              </div>
              <div className="divide-y">
                {region.locations.map((loc, li) => (
                  <div key={li} className="flex items-center gap-3 px-4 py-3" data-testid={`location-${ri}-${li}`}>
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs flex-1">{loc.name}</span>
                    <span className="text-[9px] text-muted-foreground">{loc.users} users · {loc.clients} clients</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Templates ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data, isLoading } = useQuery<TemplatesData>({ queryKey: ["/api/ecosystem/templates"], staleTime: 60_000 });
  const [catFilter, setCatFilter] = useState("All");
  const { toast } = useToast();

  const installMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/ecosystem/templates/install", { templateId: id }),
    onSuccess: () => toast({ title: "Template installed" }),
    onError: () => toast({ title: "Install failed", variant: "destructive" }),
  });

  const filtered = (data?.templates ?? []).filter(t => catFilter === "All" || t.category === catFilter);
  const TYPE_COLORS: Record<string, string> = { campaign: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", workforce: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", automation: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", initiative: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", industry: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", governance: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

  return (
    <div className="space-y-4" data-testid="tab-templates">
      <div className="flex gap-1.5 flex-wrap">
        {(data?.categories ?? ["All"]).map(c => (
          <button key={c} onClick={() => setCatFilter(c)} data-testid={`filter-cat-${c.toLowerCase()}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{c}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(t => (
            <div key={t.id} className="p-4 rounded-xl border bg-card" data-testid={`template-${t.id}`}>
              <div className="flex items-start gap-2 mb-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold">{t.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${TYPE_COLORS[t.type] ?? "bg-muted text-muted-foreground"}`}>{t.type}</Badge>
                    <span className="text-[9px] text-muted-foreground">{t.author}</span>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 gap-1 shrink-0 text-[10px]" onClick={() => installMutation.mutate(t.id)} disabled={installMutation.isPending} data-testid={`button-install-template-${t.id}`}>
                  <Download className="h-3 w-3" />Install
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
                <div><p className="font-bold">{t.installs.toLocaleString()}</p><p className="text-muted-foreground">Installs</p></div>
                <div><p className="font-bold text-emerald-600 dark:text-emerald-400">{t.successRate}%</p><p className="text-muted-foreground">Success</p></div>
                <div><p className="font-bold text-primary">{t.revenueImpact}</p><p className="text-muted-foreground">Impact</p></div>
              </div>
              <div className="flex items-center gap-1 mt-2">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-2.5 w-2.5 ${i < Math.floor(t.rating) ? "text-amber-400 fill-amber-400" : "text-muted-foreground"}`} />)}
                <span className="text-[9px] text-muted-foreground ml-0.5">{t.rating}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Agency Mode ─────────────────────────────────────────────────────────

function AgencyTab() {
  const { data, isLoading } = useQuery<AgencyData>({ queryKey: ["/api/ecosystem/agency"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-agency">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Clients",              value: data.portfolioSize,                                   color: "text-primary" },
            { label: "Revenue Managed",      value: `$${(data.totalRevenueManaged / 1000).toFixed(1)}k`, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Active Deployments",   value: data.activeDeployments,                               color: "text-blue-600 dark:text-blue-400" },
            { label: "Avg Workforce Health", value: data.avgWorkforceHealth,                              color: data.avgWorkforceHealth >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`agency-stat-${m.label.toLowerCase().replace(/[\s]+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h3 className="text-xs font-semibold">Client Portfolio</h3></div>
          <div className="divide-y">
            {(data?.clients ?? []).map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`agency-client-${c.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs font-medium truncate">{c.name}</p>
                    <PlanBadge plan={c.plan} />
                  </div>
                  <p className="text-[9px] text-muted-foreground">{c.location} · Last active {formatDistanceToNow(new Date(c.lastActivity), { addSuffix: true })}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-xs font-bold">{c.healthScore}</p>
                    <p className="text-[8px] text-muted-foreground">Health</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${c.revenue.toLocaleString()}</p>
                    <p className="text-[8px] text-muted-foreground">Revenue</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Hierarchy ───────────────────────────────────────────────────────────

function HierarchyTab() {
  const { data, isLoading } = useQuery<HierarchyData>({ queryKey: ["/api/ecosystem/hierarchy"], staleTime: 60_000 });

  function NodeRow({ node, depth }: { node: HierarchyNode; depth: number }) {
    const TYPE_ICONS: Record<string, string> = { enterprise: "🏢", region: "🗺️", location: "📍", division: "🏗️", department: "👥" };
    return (
      <>
        <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/10 transition-colors border-b last:border-0" style={{ paddingLeft: `${16 + depth * 20}px` }} data-testid={`hierarchy-node-${node.name.replace(/\s+/g, "-").toLowerCase()}`}>
          <span className="text-sm">{TYPE_ICONS[node.type] ?? "📦"}</span>
          <div className="flex-1">
            <span className="text-xs font-medium">{node.name}</span>
            <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4 capitalize ml-2">{node.type}</Badge>
          </div>
          <div className="flex items-center gap-4 text-[9px] text-muted-foreground">
            <span>{node.users} users</span>
            <span>{node.agents} agents</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">${node.revenue.toLocaleString()}</span>
          </div>
        </div>
        {node.children.map((child, i) => <NodeRow key={i} node={child} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <div className="space-y-4" data-testid="tab-hierarchy">
      {data && (
        <div className="flex items-center gap-2 p-3 rounded-xl border bg-primary/5 flex-wrap">
          {data.levels.map((lvl, i) => (
            <div key={lvl} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <Badge variant="outline" className="text-[9px] px-2">{lvl}</Badge>
            </div>
          ))}
        </div>
      )}
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Organization Tree</h3></div>
          {data && <NodeRow node={data.tree} depth={0} />}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Benchmarking ────────────────────────────────────────────────────────

function BenchmarkingTab() {
  const { data, isLoading } = useQuery<BenchmarkData>({ queryKey: ["/api/ecosystem/benchmarking"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-benchmarking">
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <>
          <div className="rounded-xl border overflow-hidden">
            <div className="grid grid-cols-8 px-4 py-2 bg-muted/30 border-b text-[9px] text-muted-foreground font-semibold uppercase tracking-wide">
              <span className="col-span-2">Metric</span>
              <span className="col-span-1 text-right">You</span>
              <span className="col-span-1 text-right">P25</span>
              <span className="col-span-1 text-right">P50</span>
              <span className="col-span-1 text-right">P75</span>
              <span className="col-span-1 text-right">P90</span>
              <span className="col-span-1 text-right">Rank</span>
            </div>
            <div className="divide-y">
              {(data?.benchmarks ?? []).map((b, i) => (
                <div key={i} className="grid grid-cols-8 items-center px-4 py-3" data-testid={`benchmark-row-${i}`}>
                  <span className="col-span-2 text-xs font-medium">{b.metric}</span>
                  <span className="col-span-1 text-xs font-bold text-primary text-right">{b.yourValue > 1000 ? `$${(b.yourValue / 1000).toFixed(1)}k` : b.yourValue}</span>
                  {[b.p25, b.p50, b.p75, b.p90].map((v, vi) => (
                    <span key={vi} className="col-span-1 text-[10px] text-muted-foreground text-right">{v > 1000 ? `$${(v / 1000).toFixed(0)}k` : v}</span>
                  ))}
                  <div className="col-span-1 flex justify-end">
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${b.percentile >= 70 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : b.percentile >= 50 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>{b.percentile}th</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-primary" /><h3 className="text-xs font-semibold">Top Performers</h3></div>
              <div className="divide-y">
                {(data?.topPerformers ?? []).map((tp, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`top-performer-${i}`}>
                    <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}.</span>
                    <span className="text-xs flex-1">{tp.name}</span>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">${(tp.revenue / 1000).toFixed(0)}k</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-primary" /><h3 className="text-xs font-semibold">Improvement Opportunities</h3></div>
              <div className="divide-y">
                {(data?.improvements ?? []).map((imp, i) => (
                  <div key={i} className="px-4 py-3" data-testid={`improvement-${i}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold">{imp.area}</span>
                      <span className="text-[9px] text-amber-600 dark:text-amber-400">Gap: {imp.gap} pts</span>
                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 ml-auto">{imp.potentialGain}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{imp.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Marketplace ─────────────────────────────────────────────────────────

function MarketplaceTab() {
  const { data, isLoading } = useQuery<MarketplaceData>({ queryKey: ["/api/ecosystem/marketplace"], staleTime: 60_000 });
  const [catFilter, setCatFilter] = useState("All");
  const { toast } = useToast();

  const installMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/ecosystem/marketplace/install", { assetId: id }),
    onSuccess: () => toast({ title: "Asset installed", description: "Activated in your workspace." }),
    onError: () => toast({ title: "Install failed", variant: "destructive" }),
  });

  const filtered = (data?.assets ?? []).filter(a => catFilter === "All" || a.category === catFilter);
  const CAT_COLORS: Record<string, string> = { "AI Agents": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", "Integrations": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", "Campaigns": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", "Workflows": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", "Templates": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", "Playbooks": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

  return (
    <div className="space-y-4" data-testid="tab-marketplace">
      <div className="flex gap-1.5 flex-wrap">
        {(data?.categories ?? ["All"]).map(c => (
          <button key={c} onClick={() => setCatFilter(c)} data-testid={`filter-mkt-${c.toLowerCase().replace(/\s+/g, "-")}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{c}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(asset => (
            <div key={asset.id} className="p-4 rounded-xl border bg-card" data-testid={`market-asset-${asset.id}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold">{asset.name}</p>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${CAT_COLORS[asset.category] ?? "bg-muted text-muted-foreground"}`}>{asset.category}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">{asset.description}</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-[9px]">
                    <div><p className="font-bold">{asset.installs.toLocaleString()}</p><p className="text-muted-foreground">Installs</p></div>
                    <div><p className="font-bold text-emerald-600 dark:text-emerald-400">{asset.successScore}%</p><p className="text-muted-foreground">Success</p></div>
                    <div><p className="font-bold text-primary">{asset.roiScore}%</p><p className="text-muted-foreground">ROI</p></div>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0 text-[10px]" onClick={() => installMutation.mutate(asset.id)} disabled={installMutation.isPending} data-testid={`button-install-asset-${asset.id}`}>
                  <Download className="h-3 w-3" />Get
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: TrainChat ───────────────────────────────────────────────────────────

function TrainChatTab() {
  const { data, isLoading } = useQuery<TrainChatData>({ queryKey: ["/api/ecosystem/trainchat"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-trainchat">
      {!isLoading && data && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-primary/5">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs">TrainChat API: <span className={`font-bold ${data.apiHealth === "operational" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{data.apiHealth}</span> · {data.avgLatencyMs}ms avg · {data.tokensUsed30d.toLocaleString()} tokens (30d)</p>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="rounded-xl border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Connected Brain Modules</h3></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y">
              {(data?.connectedBrains ?? []).map(brain => (
                <div key={brain} className="flex items-center gap-2 p-3" data-testid={`brain-${brain.replace(/\s+/g, "-").toLowerCase()}`}>
                  <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-xs">{brain}</span>
                </div>
              ))}
            </div>
          </div>

          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Programs Generated",  value: data.usageLast30d.programsGenerated,         color: "text-primary" },
                { label: "Sessions Assisted",   value: data.usageLast30d.coachingSessionsAssisted,  color: "text-blue-600 dark:text-blue-400" },
                { label: "Athlete Profiles",    value: data.usageLast30d.athleteProfilesBuilt,      color: "text-violet-600 dark:text-violet-400" },
                { label: "Education Modules",   value: data.usageLast30d.educationModulesServed,    color: "text-emerald-600 dark:text-emerald-400" },
              ].map(m => (
                <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`trainchat-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <p className={`text-xl font-extrabold ${m.color}`}>{m.value.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">{m.label} (30d)</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Security Audit ──────────────────────────────────────────────────────

function SecurityAuditTab() {
  const { data, isLoading } = useQuery<SecurityAuditData>({ queryKey: ["/api/ecosystem/security-audit"], staleTime: 10 * 60_000 });
  const scoreColor = (data?.enterpriseSecurityScore ?? 0) >= 95 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="space-y-4" data-testid="tab-security">
      {!isLoading && data && (
        <div className="flex items-center gap-4 p-5 rounded-xl border bg-gradient-to-r from-primary/5 to-emerald-500/5">
          <div className="text-center shrink-0">
            <p className={`text-5xl font-extrabold ${scoreColor}`}>{data.enterpriseSecurityScore}<span className="text-lg">/100</span></p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Enterprise Security</p>
          </div>
          <div className="flex-1 grid grid-cols-3 gap-2">
            {[
              { label: "Checks Passed", value: data.checks.filter(c => c.passed).length, color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Violations",    value: data.violations,  color: data.violations > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400" },
              { label: "Warnings",      value: data.warnings,    color: data.warnings > 0  ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" },
            ].map(m => (
              <div key={m.label} className="p-2.5 rounded-lg bg-background border text-center">
                <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b"><h3 className="text-xs font-semibold">Enterprise Security Checks</h3></div>
          <div className="divide-y">
            {(data?.checks ?? []).map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3" data-testid={`security-check-${i}`}>
                {c.passed
                  ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-xs">{c.check}</p>
                  {c.note && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{c.note}</p>}
                </div>
                <SevBadge s={c.severity} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminEcosystemPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<EcosystemOverview>({ queryKey: ["/api/ecosystem/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-ecosystem">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/execution-center">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Execution Center
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Ecosystem, White-Label &amp; Multi-Org Orchestration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage franchises, agencies, enterprise hierarchies, white-label branding, and cross-org benchmarking at scale.
          </p>
        </div>
        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Orgs",   value: overview.totalOrganizations },
              { label: "Users",  value: overview.totalActiveUsers },
              { label: "Agents", value: overview.totalActiveAgents },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className="text-base font-extrabold text-primary">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Setup",      href: "/admin/ai-workforce" },
          { label: "Workforce",  href: "/admin/ai-workforce/settings" },
          { label: "Operations", href: "/admin/ai-operations" },
          { label: "Exec Intel", href: "/admin/executive-intelligence" },
          { label: "Autonomous", href: "/admin/autonomous-management" },
          { label: "Trust",      href: "/admin/trust-attribution" },
          { label: "External",   href: "/admin/market-intelligence" },
          { label: "Network",    href: "/admin/network-intelligence" },
          { label: "Revenue",    href: "/admin/billing-intelligence" },
          { label: "Platform",   href: "/admin/platform-health" },
          { label: "Execution",  href: "/admin/execution-center" },
          { label: "Ecosystem",  href: null },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href ? (
              <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
            ) : (
              <span className="font-semibold text-foreground">{step.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-ecosystem">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "overview"     && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "orgs"         && <OrgsTab />}
        {activeTab === "branding"     && <BrandingTab />}
        {activeTab === "franchise"    && <FranchiseTab />}
        {activeTab === "templates"    && <TemplatesTab />}
        {activeTab === "agency"       && <AgencyTab />}
        {activeTab === "hierarchy"    && <HierarchyTab />}
        {activeTab === "benchmarking" && <BenchmarkingTab />}
        {activeTab === "marketplace"  && <MarketplaceTab />}
        {activeTab === "trainchat"    && <TrainChatTab />}
        {activeTab === "security"     && <SecurityAuditTab />}
      </div>
    </div>
  );
}
