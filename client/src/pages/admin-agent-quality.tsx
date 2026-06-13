import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw, Shield, ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion,
  TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, XCircle,
  Edit3, Brain, BarChart3, Eye, Settings2, ChevronDown, ChevronRight,
  Activity, Zap, BookOpen, Award, Users,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const TRUST_TIERS = ["training", "assisted", "trusted", "high_trust", "restricted"] as const;
type TrustTier = typeof TRUST_TIERS[number];

const TIER_CONFIG: Record<TrustTier, { label: string; bg: string; text: string; border: string; icon: any }> = {
  training:   { label: "Training",   bg: "bg-gray-100 dark:bg-gray-800",   text: "text-gray-700 dark:text-gray-300",   border: "border-gray-200 dark:border-gray-700",   icon: ShieldQuestion },
  assisted:   { label: "Assisted",   bg: "bg-blue-100 dark:bg-blue-900/30",text: "text-blue-700 dark:text-blue-300",   border: "border-blue-200 dark:border-blue-800",   icon: Shield },
  trusted:    { label: "Trusted",    bg: "bg-green-100 dark:bg-green-900/30",text:"text-green-700 dark:text-green-300",border: "border-green-200 dark:border-green-800", icon: ShieldCheck },
  high_trust: { label: "High Trust", bg: "bg-purple-100 dark:bg-purple-900/30",text:"text-purple-700 dark:text-purple-300",border:"border-purple-200 dark:border-purple-800",icon: Award },
  restricted: { label: "Restricted", bg: "bg-red-100 dark:bg-red-900/30",  text: "text-red-700 dark:text-red-300",    border: "border-red-200 dark:border-red-800",     icon: ShieldOff },
};

const AGENT_LABELS: Record<string, string> = {
  athletic_director_outreach_agent: "Athletic Director Outreach",
  business_outreach_agent: "Business Outreach",
  ceo_heartbeat: "CEO Heartbeat",
  coach_outreach_agent: "Coach Outreach",
  corporate_wellness_outreach_agent: "Corporate Wellness Outreach",
  daily_operations_engine: "Daily Operations Engine",
  employment_outreach_agent: "Employment Outreach",
  facility_partnership_outreach_agent: "Facility Partnership Outreach",
  gmail_agent: "Gmail Agent",
  gym_owner_outreach_agent: "Gym Owner Outreach",
  organization_outreach_agent: "Organization Outreach",
  revenue_agent: "Revenue Agent",
  school_partnership_outreach_agent: "School Partnership Outreach",
  workflow_orchestrator: "Workflow Orchestrator",
  business_brain: "Business Brain",
};

function agentLabel(name: string) {
  return AGENT_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: any): string {
  if (v == null) return "—";
  return `${Math.round(Number(v) * 100)}%`;
}

function score(v: any): string {
  if (v == null) return "—";
  return Number(v).toFixed(1);
}

function TierBadge({ tier, hasOverride }: { tier: TrustTier; hasOverride?: boolean }) {
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.training;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
      {hasOverride && <span className="opacity-70">(manual)</span>}
    </span>
  );
}

function ScorePill({ value }: { value: any }) {
  const n = Number(value ?? 0);
  const color = n >= 75 ? "text-purple-600 dark:text-purple-400"
    : n >= 55 ? "text-green-600 dark:text-green-400"
    : n >= 35 ? "text-blue-600 dark:text-blue-400"
    : n >= 10 ? "text-yellow-600 dark:text-yellow-400"
    : "text-gray-400";
  return <span className={`text-lg font-bold tabular-nums ${color}`}>{score(value)}<span className="text-xs text-muted-foreground font-normal">/100</span></span>;
}

function TrendIcon({ delta }: { delta: any }) {
  const d = Number(delta ?? 0);
  if (Math.abs(d) < 1) return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (d > 0) return <TrendingUp className="w-3 h-3 text-green-500" />;
  return <TrendingDown className="w-3 h-3 text-red-500" />;
}

// ─── Risk Panel ───────────────────────────────────────────────────────────────

function RisksPanel() {
  const { data: risks } = useQuery<any>({ queryKey: ["/api/admin/agent-quality/risks"] });

  if (!risks || !risks.hasRisks) return null;

  return (
    <div className="space-y-2 mb-6">
      {risks.rejectionSpikeAgents?.length > 0 && risks.rejectionSpikeAgents.map((a: any) => (
        <div key={a.agentName} className="flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Rejection spike — {agentLabel(a.agentName)}</p>
            <p className="text-xs text-red-600 dark:text-red-500">7-day rejection rate jumped more than 50% above the 30-day baseline. Agent automatically restricted.</p>
          </div>
        </div>
      ))}
      {risks.decliningAgents?.length > 0 && risks.decliningAgents.map((a: any) => (
        <div key={a.agentName} className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          <TrendingDown className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Score declining — {agentLabel(a.agentName)}</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">Score dropped {Math.abs(Number(a.scoreDelta)).toFixed(1)} points since last computation. Current: {score(a.currentScore)}/100.</p>
          </div>
        </div>
      ))}
      {risks.lowConfidenceDomain && (
        <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
          <Brain className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-400">
            <span className="font-semibold">Low confidence domain:</span> {risks.lowConfidenceDomain.domain.replace(/_/g, " ")} — avg confidence {pct(risks.lowConfidenceDomain.avgConfidence)}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Top Stats Bar ────────────────────────────────────────────────────────────

function StatsBar({ agents }: { agents: any[] }) {
  const withData = agents.filter((a) => Number(a.total_actions) >= 5);
  const restricted = agents.filter((a) => a.effectiveTier === "restricted").length;
  const highTrust  = agents.filter((a) => a.effectiveTier === "high_trust").length;
  const avgScore   = withData.length > 0
    ? withData.reduce((s, a) => s + Number(a.quality_score ?? 0), 0) / withData.length
    : null;

  const stats = [
    { label: "Total Agents", value: agents.length, icon: Users, color: "text-gray-600" },
    { label: "Avg Quality Score", value: avgScore != null ? `${score(avgScore)}/100` : "—", icon: BarChart3, color: "text-blue-600" },
    { label: "High Trust", value: highTrust, icon: Award, color: "text-purple-600" },
    { label: "Restricted", value: restricted, icon: ShieldOff, color: restricted > 0 ? "text-red-600" : "text-gray-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="bg-card border rounded-lg p-3 flex items-center gap-3">
            <Icon className={`w-5 h-5 shrink-0 ${s.color}`} />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Agent Detail Drawer ──────────────────────────────────────────────────────

function AgentDetail({ agentName, onClose }: { agentName: string; onClose: () => void }) {
  const [window, setWindow] = useState("30");
  const { data: scores } = useQuery<any[]>({
    queryKey: ["/api/admin/agent-quality/scores", agentName],
    queryFn: () => fetchJson(`/api/admin/agent-quality/scores/${encodeURIComponent(agentName)}`),
  });

  const windowScores = (scores ?? []).filter((s) => String(s.window_days) === window && s.communication_domain === "all");
  const s = windowScores[0];

  const domainScores = (scores ?? []).filter((s) => String(s.window_days) === window && s.communication_domain !== "all");

  const metrics = s ? [
    { label: "Approval Rate",        value: pct(s.approval_rate),           good: Number(s.approval_rate) >= 0.7, icon: CheckCircle2 },
    { label: "Rejection Rate",       value: pct(s.rejection_rate),          good: Number(s.rejection_rate) <= 0.2, icon: XCircle },
    { label: "Edit Rate",            value: pct(s.edit_rate),               good: Number(s.edit_rate) <= 0.3, icon: Edit3 },
    { label: "Failure Rate",         value: pct(s.failure_rate),            good: Number(s.failure_rate) <= 0.05, icon: ShieldAlert },
    { label: "Learning Conversion",  value: pct(s.learning_conversion_rate),good: Number(s.learning_conversion_rate) >= 0.3, icon: BookOpen },
    { label: "Avg Confidence",       value: s.average_confidence != null ? pct(s.average_confidence) : "—", good: Number(s.average_confidence) >= 0.6, icon: Brain },
  ] : [];

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-background border-l shadow-xl z-50 overflow-y-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold">{agentLabel(agentName)}</h2>
            <p className="text-xs text-muted-foreground font-mono">{agentName}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-detail"><XCircle className="w-4 h-4" /></Button>
        </div>

        {s && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
            <ScorePill value={s.quality_score} />
            <TierBadge tier={s.effective_tier ?? s.trust_tier} hasOverride={!!s.override_tier} />
            {s.rejection_spike && <span className="text-xs font-semibold text-red-600 flex items-center gap-1"><ShieldAlert className="w-3 h-3" />Spike</span>}
            <TrendIcon delta={s.score_delta} />
            <span className="text-xs text-muted-foreground">{s.score_delta != null && Math.abs(Number(s.score_delta)) >= 0.1 ? `${Number(s.score_delta) > 0 ? "+" : ""}${Number(s.score_delta).toFixed(1)} pts` : "stable"}</span>
          </div>
        )}

        <Tabs value={window} onValueChange={setWindow} className="mb-4">
          <TabsList className="w-full">
            <TabsTrigger value="7"  className="flex-1" data-testid="tab-7d">7 Days</TabsTrigger>
            <TabsTrigger value="30" className="flex-1" data-testid="tab-30d">30 Days</TabsTrigger>
            <TabsTrigger value="90" className="flex-1" data-testid="tab-90d">90 Days</TabsTrigger>
          </TabsList>

          {["7","30","90"].map((w) => (
            <TabsContent key={w} value={w}>
              {!s && window === w ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data for this window — run a score computation first.</p>
              ) : s && window === w ? (
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-2">
                    {metrics.map((m) => {
                      const Icon = m.icon;
                      return (
                        <div key={m.label} className={`border rounded-lg p-3 ${m.good == null ? "" : m.good ? "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10" : "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"}`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Icon className={`w-3 h-3 ${m.good == null ? "text-muted-foreground" : m.good ? "text-green-600" : "text-red-500"}`} />
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                          </div>
                          <p className="text-sm font-semibold">{m.value}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Total actions: <strong className="text-foreground">{s.total_actions}</strong></span>
                    <span>Approved: <strong className="text-foreground">{s.approved_count}</strong></span>
                    <span>Rejected: <strong className="text-foreground">{s.rejected_count}</strong></span>
                    <span>Edited before send: <strong className="text-foreground">{s.edited_count}</strong></span>
                    <span>Failed: <strong className="text-foreground">{s.failed_count}</strong></span>
                    <span>Learning rules created: <strong className="text-foreground">{s.learning_conversion_count}</strong></span>
                  </div>
                </div>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>

        {domainScores.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">By Domain</p>
            <div className="space-y-1.5">
              {domainScores.map((d: any) => (
                <div key={d.communication_domain} className="flex items-center justify-between text-xs border rounded-md px-3 py-2">
                  <span>{d.communication_domain.replace(/_/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    <ScorePill value={d.quality_score} />
                    <TierBadge tier={d.trust_tier} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Override Modal ───────────────────────────────────────────────────────────

function OverrideModal({ agent, onClose }: { agent: any; onClose: () => void }) {
  const [tier, setTier] = useState(agent.effectiveTier ?? "assisted");
  const [reason, setReason] = useState(agent.override_reason ?? "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const setMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/agent-quality/overrides", {
      agentName: agent.agent_name,
      overrideTier: tier,
      reason: reason || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Trust tier override saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-quality/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-quality/risks"] });
      onClose();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/agent-quality/overrides/${encodeURIComponent(agent.agent_name)}`),
    onSuccess: () => {
      toast({ title: "Override removed — computed tier now active" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-quality/scores"] });
      onClose();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Override Trust Tier</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Agent</p>
            <p className="text-sm font-medium">{agentLabel(agent.agent_name)}</p>
            <p className="text-xs text-muted-foreground">Computed tier: <strong>{agent.trust_tier}</strong></p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Override to</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger data-testid="select-override-tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRUST_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>{TIER_CONFIG[t].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              data-testid="input-override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you overriding the computed tier?"
              rows={3}
              className="text-sm"
            />
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-2">
            Manual overrides take precedence over computed scores. High Trust agents can suggest auto-approval eligibility but cannot auto-send unless your org explicitly enables it.
          </p>
        </div>
        <DialogFooter className="gap-2">
          {agent.hasOverride && (
            <Button variant="outline" size="sm" data-testid="button-clear-override"
              disabled={clearMutation.isPending} onClick={() => clearMutation.mutate()}>
              Remove Override
            </Button>
          )}
          <Button size="sm" data-testid="button-save-override"
            disabled={setMutation.isPending} onClick={() => setMutation.mutate()}>
            Save Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Agent Row ────────────────────────────────────────────────────────────────

function AgentRow({ agent, onDetail, onOverride }: { agent: any; onDetail: () => void; onOverride: () => void }) {
  const tier: TrustTier = agent.effectiveTier ?? "training";
  const cfg = TIER_CONFIG[tier];
  const hasData = Number(agent.total_actions) >= 5;

  return (
    <div
      data-testid={`agent-row-${agent.agent_name}`}
      className={`flex items-center gap-3 p-4 border rounded-lg ${agent.rejection_spike ? "border-red-300 dark:border-red-700 bg-red-50/20 dark:bg-red-950/10" : "border-border hover:bg-muted/20"} transition-colors`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">{agentLabel(agent.agent_name)}</p>
          <TierBadge tier={tier} hasOverride={agent.hasOverride} />
          {agent.rejection_spike && (
            <span className="text-xs font-semibold text-red-600 flex items-center gap-0.5">
              <ShieldAlert className="w-3 h-3" />Spike
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.agent_name}</p>
      </div>

      {/* Score */}
      <div className="text-right shrink-0">
        {hasData ? (
          <div className="flex items-center gap-1.5 justify-end">
            <TrendIcon delta={agent.score_delta} />
            <ScorePill value={agent.quality_score} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Insufficient data</span>
        )}
      </div>

      {/* Quick stats */}
      {hasData && (
        <div className="hidden sm:flex gap-3 text-xs text-muted-foreground shrink-0">
          <span title="Approval rate" className="flex items-center gap-0.5">
            <CheckCircle2 className="w-3 h-3 text-green-500" />{pct(agent.approval_rate)}
          </span>
          <span title="Rejection rate" className="flex items-center gap-0.5">
            <XCircle className="w-3 h-3 text-red-400" />{pct(agent.rejection_rate)}
          </span>
          <span title="Edit rate" className="flex items-center gap-0.5">
            <Edit3 className="w-3 h-3 text-amber-400" />{pct(agent.edit_rate)}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" data-testid={`button-detail-${agent.agent_name}`} onClick={onDetail}>
          <Eye className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" data-testid={`button-override-${agent.agent_name}`} onClick={onOverride}>
          <Settings2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentQualityPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [detailAgent, setDetailAgent] = useState<string | null>(null);
  const [overrideAgent, setOverrideAgent] = useState<any | null>(null);

  const { data: agents = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/agent-quality/scores"],
    refetchInterval: 120_000,
  });

  const computeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/agent-quality/compute", {}),
    onSuccess: (data: any) => {
      toast({ title: `Scores recomputed — ${data?.updated ?? 0} records updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-quality/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-quality/risks"] });
    },
    onError: () => toast({ title: "Compute failed", variant: "destructive" }),
  });

  const filterOptions = [
    { key: "all",        label: "All Agents" },
    { key: "restricted", label: "Restricted" },
    { key: "training",   label: "Training" },
    { key: "assisted",   label: "Assisted" },
    { key: "trusted",    label: "Trusted" },
    { key: "high_trust", label: "High Trust" },
    { key: "spike",      label: "Spike Detected" },
  ];

  const filtered = agents.filter((a) => {
    if (activeFilter === "all")    return true;
    if (activeFilter === "spike")  return a.rejection_spike;
    return a.effectiveTier === activeFilter;
  });

  const detailAgentData = detailAgent ? agents.find((a) => a.agent_name === detailAgent) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            Agent Quality & Trust
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-agent trust scores computed from approvals, rejections, edits, failures, and learning conversions.
          </p>
        </div>
        <Button
          data-testid="button-recompute"
          variant="outline"
          size="sm"
          disabled={computeMutation.isPending}
          onClick={() => computeMutation.mutate()}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${computeMutation.isPending ? "animate-spin" : ""}`} />
          {computeMutation.isPending ? "Computing…" : "Recompute Scores"}
        </Button>
      </div>

      {/* Trust tier explainer */}
      <div className="flex flex-wrap gap-2">
        {(["training","assisted","trusted","high_trust","restricted"] as TrustTier[]).map((t) => {
          const cfg = TIER_CONFIG[t];
          const Icon = cfg.icon;
          return (
            <div key={t} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
              <Icon className="w-3 h-3" />
              <span className="font-semibold">{cfg.label}</span>
              {t === "training" && <span className="opacity-70">— &lt;5 actions or score &lt;35</span>}
              {t === "assisted" && <span className="opacity-70">— score 35–55</span>}
              {t === "trusted"  && <span className="opacity-70">— score 55–75</span>}
              {t === "high_trust" && <span className="opacity-70">— score &gt;75, approval-eligible</span>}
              {t === "restricted" && <span className="opacity-70">— spike or manual lock</span>}
            </div>
          );
        })}
      </div>

      {/* Risk alerts */}
      <RisksPanel />

      {/* Stats bar */}
      {agents.length > 0 && <StatsBar agents={agents} />}

      {/* Guardrail note */}
      <div className="flex items-start gap-2 bg-muted/30 border rounded-lg px-4 py-3 text-sm">
        <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Guardrail policy: </span>
          Training, Assisted, and Restricted agents always require human approval before sending.
          High Trust agents can be suggested for auto-approval eligibility only when your org explicitly enables auto-send in Automation Settings.
          No agent can auto-send without that permission.
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {filterOptions.map((f) => (
          <button
            key={f.key}
            data-testid={`filter-${f.key}`}
            onClick={() => setActiveFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeFilter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-muted text-muted-foreground"
            }`}
          >
            {f.label}
            {f.key !== "all" && (
              <span className="ml-1.5 opacity-60">
                {f.key === "spike"
                  ? agents.filter((a) => a.rejection_spike).length
                  : agents.filter((a) => a.effectiveTier === f.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Agent list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => <div key={i} className="h-16 bg-muted/40 rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">No agents scored yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Recompute Scores" to generate scores from your approval and feedback history.</p>
            <Button size="sm" className="mt-4" data-testid="button-recompute-empty"
              disabled={computeMutation.isPending} onClick={() => computeMutation.mutate()}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${computeMutation.isPending ? "animate-spin" : ""}`} />
              Compute Now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((agent) => (
            <AgentRow
              key={agent.agent_name}
              agent={agent}
              onDetail={() => setDetailAgent(agent.agent_name)}
              onOverride={() => setOverrideAgent(agent)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {detailAgent && (
        <AgentDetail agentName={detailAgent} onClose={() => setDetailAgent(null)} />
      )}

      {/* Override modal */}
      {overrideAgent && (
        <OverrideModal agent={overrideAgent} onClose={() => setOverrideAgent(null)} />
      )}
    </div>
  );
}
