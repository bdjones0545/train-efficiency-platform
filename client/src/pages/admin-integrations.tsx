import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Globe, Mail, Calendar, Users, DollarSign, FileText,
  Megaphone, Monitor, Shield, Zap, ChevronRight, CheckCircle,
  AlertTriangle, XCircle, RefreshCw, Activity, Link2, Link2Off,
  Clock, BarChart3,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type IntStatus = "connected" | "disconnected" | "needs_attention";
type Integration = { id: string; name: string; category: string; status: IntStatus; healthScore: number; lastSync: string | null; errorRate: number; usageLast30d: number; tokenHealth: string; description: string; capabilities: string[] };
type CategoryHealth = { category: string; connected: number; total: number; avgHealth: number };
type OverviewData = { connected: number; needsAttention: number; disconnected: number; totalIntegrations: number; avgHealthScore: number; totalUsageLast30d: number; categoryHealth: CategoryHealth[]; generatedAt: string };
type CategoryData = { integrations: Integration[]; category: string; generatedAt: string };
type AgentTool = { agentName: string; role: string; tools: string[]; permissions: string[]; connectedSystems: string[] };
type RegistryData = { registry: AgentTool[]; totalAgents: number; totalToolConnections: number; generatedAt: string };
type AuditAction = { id: string; action: string; agent: string; system: string; outcome: string; timestamp: string; detail: string };
type AuditData = { actions: AuditAction[]; totalActions: number; last24h: number; systemsUsed: number; uniqueAgents: number; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusIcon({ s }: { s: IntStatus }) {
  if (s === "connected")       return <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (s === "needs_attention") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function StatusBadge({ s }: { s: IntStatus }) {
  const cfg: Record<IntStatus, string> = { connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", needs_attention: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", disconnected: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  const labels: Record<IntStatus, string> = { connected: "Connected", needs_attention: "Needs Attention", disconnected: "Disconnected" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s]}`}>{labels[s]}</Badge>;
}

function HealthBar({ value }: { value: number }) {
  const color = value >= 90 ? "bg-emerald-500" : value >= 70 ? "bg-blue-500" : value >= 50 ? "bg-amber-500" : "bg-muted";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div>
      <span className="text-[9px] font-bold w-6 text-muted-foreground">{value > 0 ? value : "—"}</span>
    </div>
  );
}

function OutcomeBadge({ o }: { o: string }) {
  const cfg: Record<string, string> = { delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", stored: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", pending_sig: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", alert_sent: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${cfg[o] ?? "bg-muted text-muted-foreground"}`}>{o.replace("_", " ")}</Badge>;
}

// ─── Integration Card ─────────────────────────────────────────────────────────

function IntegrationCard({ int: i, onConnect, onDisconnect, onRefresh, isLoading }: { int: Integration; onConnect: (id: string) => void; onDisconnect: (id: string) => void; onRefresh: (id: string) => void; isLoading: boolean }) {
  return (
    <div className={`p-4 rounded-xl border bg-card ${i.status === "needs_attention" ? "border-amber-200 dark:border-amber-900 bg-amber-500/5" : ""}`} data-testid={`integration-${i.id}`}>
      <div className="flex items-start gap-3">
        <StatusIcon s={i.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-xs font-semibold">{i.name}</p>
            <StatusBadge s={i.status} />
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">{i.description}</p>

          {i.status !== "disconnected" && (
            <div className="grid grid-cols-3 gap-2 mb-2 text-[9px]">
              <div>
                <p className="text-muted-foreground">Health</p>
                <HealthBar value={i.healthScore} />
              </div>
              <div>
                <p className="text-muted-foreground">Error Rate</p>
                <p className={`font-bold ${i.errorRate > 2 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{i.errorRate}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Usage (30d)</p>
                <p className="font-bold">{i.usageLast30d.toLocaleString()}</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {i.capabilities.slice(0, 3).map(c => <Badge key={c} variant="outline" className="text-[8px] px-1.5 py-0 h-4">{c}</Badge>)}
            {i.capabilities.length > 3 && <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">+{i.capabilities.length - 3}</Badge>}
          </div>

          {i.lastSync && <p className="text-[9px] text-muted-foreground mt-1.5 flex items-center gap-1"><Clock className="h-2.5 w-2.5" />Last sync {formatDistanceToNow(new Date(i.lastSync), { addSuffix: true })}</p>}
          {i.tokenHealth === "expiring" && <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" />Token expiring — refresh recommended</p>}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {i.status === "connected" && (
            <>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[10px]" onClick={() => onRefresh(i.id)} disabled={isLoading} data-testid={`button-refresh-${i.id}`}>
                <RefreshCw className="h-3 w-3" />Refresh
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-[10px] text-muted-foreground hover:text-rose-500" onClick={() => onDisconnect(i.id)} disabled={isLoading} data-testid={`button-disconnect-${i.id}`}>
                <Link2Off className="h-3 w-3" />Disconnect
              </Button>
            </>
          )}
          {i.status === "needs_attention" && (
            <Button size="sm" className="h-7 gap-1 text-[10px]" onClick={() => onRefresh(i.id)} disabled={isLoading} data-testid={`button-fix-${i.id}`}>
              <RefreshCw className="h-3 w-3" />Fix Now
            </Button>
          )}
          {i.status === "disconnected" && (
            <Button size="sm" className="h-7 gap-1 text-[10px]" onClick={() => onConnect(i.id)} disabled={isLoading} data-testid={`button-connect-${i.id}`}>
              <Link2 className="h-3 w-3" />Connect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Category Tab ─────────────────────────────────────────────────────────────

function CategoryTab({ cat }: { cat: string }) {
  const { data, isLoading } = useQuery<CategoryData>({ queryKey: [`/api/integrations/category/${cat}`], staleTime: 60_000 });
  const qc = useQueryClient();
  const { toast } = useToast();

  const connectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/integrations/connect", { integrationId: id }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: [`/api/integrations/category/${cat}`] }); qc.invalidateQueries({ queryKey: ["/api/integrations/overview"] }); toast({ title: `${id} connected`, description: "Integration active and ready for agents." }); },
    onError: () => toast({ title: "Connection failed", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/integrations/disconnect", { integrationId: id }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: [`/api/integrations/category/${cat}`] }); qc.invalidateQueries({ queryKey: ["/api/integrations/overview"] }); toast({ title: `${id} disconnected` }); },
    onError: () => toast({ title: "Disconnect failed", variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/integrations/refresh", { integrationId: id }),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: [`/api/integrations/category/${cat}`] }); qc.invalidateQueries({ queryKey: ["/api/integrations/overview"] }); toast({ title: `${id} refreshed`, description: "Token renewed and connection verified." }); },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const isLoading2 = connectMutation.isPending || disconnectMutation.isPending || refreshMutation.isPending;

  return (
    <div className="space-y-3" data-testid={`tab-cat-${cat}`}>
      {isLoading ? (
        Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
      ) : (
        (data?.integrations ?? []).map(int => (
          <IntegrationCard key={int.id} int={int} isLoading={isLoading2}
            onConnect={id => connectMutation.mutate(id)}
            onDisconnect={id => disconnectMutation.mutate(id)}
            onRefresh={id => refreshMutation.mutate(id)} />
        ))
      )}
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

const CAT_META: Record<string, { label: string; icon: React.ElementType; tab: string }> = {
  communication: { label: "Communication", icon: Mail,       tab: "communication" },
  scheduling:    { label: "Scheduling",    icon: Calendar,   tab: "scheduling" },
  crm:           { label: "CRM",           icon: Users,      tab: "crm" },
  payments:      { label: "Payments",      icon: DollarSign, tab: "payments" },
  documents:     { label: "Documents",     icon: FileText,   tab: "documents" },
  marketing:     { label: "Marketing",     icon: Megaphone,  tab: "marketing" },
  website:       { label: "Website",       icon: Monitor,    tab: "website" },
};

function OverviewTab({ setTab }: { setTab: (t: string) => void }) {
  const { data, isLoading } = useQuery<OverviewData>({ queryKey: ["/api/integrations/overview"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-integrations-overview">
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Connected",       value: data.connected,             color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Needs Attention", value: data.needsAttention,        color: "text-amber-600 dark:text-amber-400" },
              { label: "Disconnected",    value: data.disconnected,          color: "text-muted-foreground" },
              { label: "Avg Health",      value: `${data.avgHealthScore}/100`, color: data.avgHealthScore >= 90 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
            ].map(m => (
              <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`int-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
                <p className="text-[9px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.categoryHealth.map(ch => {
              const meta = CAT_META[ch.category];
              const Icon = meta?.icon ?? Globe;
              return (
                <button key={ch.category} onClick={() => setTab(ch.category)} className="flex items-center gap-3 p-3.5 rounded-xl border bg-card text-left hover:bg-muted/30 transition-colors group" data-testid={`cat-card-${ch.category}`}>
                  <div className="p-2 rounded-lg bg-muted shrink-0"><Icon className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold capitalize">{meta?.label ?? ch.category}</p>
                      <span className="text-[9px] text-muted-foreground">{ch.connected}/{ch.total}</span>
                    </div>
                    <HealthBar value={ch.avgHealth} />
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Tool Registry ───────────────────────────────────────────────────────

function ToolRegistryTab() {
  const { data, isLoading } = useQuery<RegistryData>({ queryKey: ["/api/integrations/tool-registry"], staleTime: 60_000 });

  return (
    <div className="space-y-4" data-testid="tab-tool-registry">
      {data && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Agent Roles",        value: data.totalAgents,          color: "text-primary" },
            { label: "Active Tool Links",  value: data.totalToolConnections, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-2xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(data?.registry ?? []).map((agent, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card" data-testid={`registry-${agent.agentName.replace(/\s+/g, "-").toLowerCase()}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-semibold">{agent.agentName}</p>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{agent.role}</Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Connected Tools</p>
                      <div className="flex flex-wrap gap-1">
                        {agent.tools.map(tool => {
                          const isConnected = agent.connectedSystems.includes(tool);
                          return (
                            <div key={tool} className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium border ${isConnected ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800" : "bg-muted text-muted-foreground"}`}>
                              {isConnected ? <CheckCircle className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                              {tool}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1.5">Permissions</p>
                      <div className="flex flex-wrap gap-1">
                        {agent.permissions.slice(0, 3).map(p => <Badge key={p} variant="outline" className="text-[8px] px-1.5 py-0 h-4">{p}</Badge>)}
                        {agent.permissions.length > 3 && <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">+{agent.permissions.length - 3}</Badge>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center shrink-0">
                  <p className={`text-lg font-extrabold ${agent.connectedSystems.length === agent.tools.length ? "text-emerald-600 dark:text-emerald-400" : agent.connectedSystems.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{agent.connectedSystems.length}/{agent.tools.length}</p>
                  <p className="text-[8px] text-muted-foreground">tools</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Execution Audit ─────────────────────────────────────────────────────

function ExecutionAuditTab() {
  const { data, isLoading } = useQuery<AuditData>({ queryKey: ["/api/integrations/execution-audit"], staleTime: 30_000 });
  const [agentFilter, setAgentFilter] = useState("all");

  const agents = [...new Set((data?.actions ?? []).map(a => a.agent))];
  const filtered = (data?.actions ?? []).filter(a => agentFilter === "all" || a.agent === agentFilter);

  const SYSTEM_ICONS: Record<string, string> = { Gmail: "✉️", "Google Cal": "📅", HubSpot: "🔵", Twilio: "💬", Stripe: "💳", DocuSign: "📝", "Google Drive": "📁", Calendly: "🗓️", "Meta Ads": "📢", Salesforce: "☁️" };

  return (
    <div className="space-y-4" data-testid="tab-execution-audit">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Actions",   value: data.totalActions,  color: "text-primary" },
            { label: "Last 24 Hours",   value: data.last24h,       color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Systems Used",    value: data.systemsUsed,   color: "text-blue-600 dark:text-blue-400" },
            { label: "Active Agents",   value: data.uniqueAgents,  color: "text-violet-600 dark:text-violet-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center" data-testid={`audit-stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", ...agents].map(f => (
          <button key={f} onClick={() => setAgentFilter(f)} data-testid={`filter-agent-${f.replace(/\s+/g, "-").toLowerCase()}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${agentFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{f === "all" ? "All Agents" : f}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold flex-1">Real-World Execution Log</h3>
            <span className="text-[9px] text-muted-foreground">Live</span>
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="divide-y">
            {filtered.map(action => (
              <div key={action.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/10 transition-colors" data-testid={`audit-action-${action.id}`}>
                <span className="text-base shrink-0 mt-0.5">{SYSTEM_ICONS[action.system] ?? "⚡"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-semibold">{action.action}</p>
                    <OutcomeBadge o={action.outcome} />
                    <span className="text-[9px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(action.timestamp), { addSuffix: true })}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{action.detail}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{action.agent} · {action.system}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tabs definition ──────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",       label: "Overview",      icon: Activity },
  { id: "communication",  label: "Communication", icon: Mail },
  { id: "scheduling",     label: "Scheduling",    icon: Calendar },
  { id: "crm",            label: "CRM",           icon: Users },
  { id: "payments",       label: "Payments",      icon: DollarSign },
  { id: "documents",      label: "Documents",     icon: FileText },
  { id: "marketing",      label: "Marketing",     icon: Megaphone },
  { id: "website",        label: "Website",       icon: Monitor },
  { id: "registry",       label: "Tool Registry", icon: Shield },
  { id: "audit",          label: "Execution Audit", icon: BarChart3 },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminIntegrationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { data: overview } = useQuery<OverviewData>({ queryKey: ["/api/integrations/overview"], staleTime: 60_000 });

  const CAT_TABS: TabId[] = ["communication", "scheduling", "crm", "payments", "documents", "marketing", "website"];

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-integrations">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/ecosystem">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Ecosystem
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Real-World Agent Infrastructure &amp; Integrations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect business systems so AI agents can take real actions — send emails, schedule meetings, update CRMs, and process payments.
          </p>
        </div>
        {overview && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0">
            {[
              { label: "Connected",   value: overview.connected,    color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Attention",   value: overview.needsAttention, color: overview.needsAttention > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
              { label: "Health",      value: `${overview.avgHealthScore}%`, color: "text-primary" },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-base font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Workforce",  href: "/admin/ai-workforce" },
          { label: "Operations", href: "/admin/ai-operations" },
          { label: "Execution",  href: "/admin/execution-center" },
          { label: "Ecosystem",  href: "/admin/ecosystem" },
          { label: "Integrations", href: null },
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
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-integrations">
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

      {/* Needs Attention Banner */}
      {overview && overview.needsAttention > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-amber-500/5 border-amber-200 dark:border-amber-900" data-testid="attention-banner">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
            <span className="font-semibold">{overview.needsAttention} integration{overview.needsAttention > 1 ? "s" : ""} need attention</span> — tokens expiring or error rates elevated. Refresh now to maintain agent effectiveness.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-[10px] shrink-0 border-amber-300 dark:border-amber-700" onClick={() => setActiveTab("overview")}>Review</Button>
        </div>
      )}

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === "overview"      && <OverviewTab setTab={t => setActiveTab(t as TabId)} />}
        {CAT_TABS.includes(activeTab as any) && <CategoryTab cat={activeTab} />}
        {activeTab === "registry"      && <ToolRegistryTab />}
        {activeTab === "audit"         && <ExecutionAuditTab />}
      </div>

      {/* Forward navigation → Workforce OS */}
      <Link href="/admin/workforce-os">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-violet-500/5 hover:from-primary/10 hover:to-violet-500/10 transition-colors cursor-pointer group" data-testid="nav-workforce-os">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Digital Employees &amp; Agent Workforce OS</p>
            <p className="text-xs text-muted-foreground mt-0.5">Manage AI agents as persistent digital employees — org chart, performance reviews, OKRs, promotions, training, compensation ROI, and workforce planning.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>
    </div>
  );
}
