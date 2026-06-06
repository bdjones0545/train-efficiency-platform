import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, Target, Award, BarChart3, Brain,
  CheckCircle, XCircle, RefreshCw, Star, Repeat2, DollarSign,
  BookOpen, Zap, ArrowRight, Plus, Search, Calendar, ChevronUp,
  ChevronDown, Clock, Loader2, Activity, Lightbulb, AlertTriangle,
} from "lucide-react";

const AGENT_LABELS: Record<string, string> = {
  executive_agent:        "Executive Agent",
  revenue_agent:          "Revenue Agent",
  growth_agent:           "Growth Agent",
  scheduling_agent:       "Scheduling Agent",
  retention_agent:        "Retention Agent",
  hermes_learning_engine: "Hermes",
};

const AGENT_COLORS: Record<string, string> = {
  executive_agent:        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  revenue_agent:          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  growth_agent:           "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scheduling_agent:       "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  retention_agent:        "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  hermes_learning_engine: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function scoreBadge(score: number | null) {
  if (score === null || score === undefined) return <Badge variant="outline" className="text-xs">Pending</Badge>;
  if (score >= 80) return <Badge className="text-xs bg-green-600 hover:bg-green-600">{score}</Badge>;
  if (score >= 50) return <Badge className="text-xs bg-yellow-600 hover:bg-yellow-600">{score}</Badge>;
  return <Badge className="text-xs bg-red-600 hover:bg-red-600">{score}</Badge>;
}

// ─── Flywheel Tab ─────────────────────────────────────────────────────────────
function FlywheelTab() {
  const { data: fw, isLoading } = useQuery<any>({ queryKey: ["/api/agent-outcomes/flywheel"] });
  const { toast } = useToast();
  const qc = useQueryClient();

  const recalc = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-outcomes/recalculate", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/agent-outcomes"] }); toast({ title: "Scores recalculated" }); },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  const flywheel = fw?.flywheel ?? {};
  const summary  = fw?.summary ?? {};
  const trend    = fw?.trend ?? {};

  const stages = [
    { label: "Memory Created",      value: flywheel.memoryCreated ?? 0,    unit: "notes",    icon: Brain,        color: "text-purple-600", desc: "Vault notes written across all agents" },
    { label: "Decisions Improved",  value: flywheel.decisionsImproved ?? 0, unit: "% rate",  icon: TrendingUp,   color: "text-blue-600",   desc: "High-score decisions as % of all outcomes recorded" },
    { label: "Outcomes Improved",   value: flywheel.outcomesImproved ?? 0,  unit: "wins",    icon: CheckCircle,  color: "text-green-600",  desc: "Decisions scoring 80+ (confirmed wins)" },
    { label: "Revenue Generated",   value: `$${(flywheel.revenueGenerated ?? 0).toLocaleString()}`, unit: "", icon: DollarSign, color: "text-emerald-600", desc: "Total revenue influenced by agent recommendations" },
  ];

  return (
    <div className="space-y-6">
      {/* Flywheel health */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Business Flywheel Health</CardTitle>
              <CardDescription>How well your AI memory system is driving real business outcomes</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => recalc.mutate()} disabled={recalc.isPending} data-testid="button-recalculate">
              {recalc.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />} Recalculate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Flywheel Score</span>
              <span className="text-2xl font-bold text-primary">{flywheel.flywheelScore ?? 0}/100</span>
            </div>
            <Progress value={flywheel.flywheelScore ?? 0} className="h-3" />
          </div>

          {/* Stages */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {stages.map((stage, idx) => (
              <div key={stage.label} className="relative">
                <Card className="h-full border-2 border-dashed">
                  <CardContent className="p-4 text-center">
                    <stage.icon className={`w-6 h-6 mx-auto mb-2 ${stage.color}`} />
                    <div className="text-2xl font-bold">{stage.value}</div>
                    <div className="text-xs text-muted-foreground">{stage.unit}</div>
                    <div className="text-xs font-medium mt-1">{stage.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{stage.desc}</div>
                  </CardContent>
                </Card>
                {idx < stages.length - 1 && (
                  <div className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 hidden md:block">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Decisions",        value: summary.totalDecisions ?? 0,        icon: Target },
          { label: "With Outcomes",          value: summary.decisionsWithOutcomes ?? 0,  icon: CheckCircle },
          { label: "Completion Rate",        value: `${trend.completionRate ?? 0}%`,      icon: BarChart3 },
          { label: "Avg Success Score",      value: `${summary.avgSuccess ?? 0}/100`,     icon: Star },
          { label: "Meetings Generated",     value: summary.totalMeetings ?? 0,           icon: Calendar },
          { label: "Active Playbooks",       value: summary.activePlaybooks ?? 0,         icon: BookOpen },
          { label: "CEO Reviews",            value: summary.ceoReviews ?? 0,              icon: Award },
          { label: "Vault Notes",            value: summary.vaultNotes ?? 0,              icon: Brain },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <m.icon className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xl font-bold">{m.value}</div>
                <div className="text-xs text-muted-foreground">{m.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending banner */}
      {(trend.pendingOutcomes ?? 0) > 0 && (
        <Card className="border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
            <div>
              <div className="font-medium text-yellow-900 dark:text-yellow-200">{trend.pendingOutcomes} decisions awaiting outcomes</div>
              <div className="text-sm text-yellow-700 dark:text-yellow-400">Go to the Attribution tab to record actual results for these recommendations.</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Attribution Tab ──────────────────────────────────────────────────────────
function AttributionTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ agentType: "revenue_agent", recommendation: "", actionTaken: "", expectedOutcome: "", domain: "", revenueCents: "" });
  const [outcomeForm, setOutcomeForm] = useState({ id: "", actualOutcome: "", successScore: "80", revenueCents: "", meetingsGenerated: "" });
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

  const { data: outcomes, isLoading } = useQuery<any[]>({ queryKey: ["/api/agent-outcomes"] });

  const log = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/agent-outcomes/log", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/agent-outcomes"] }); setForm({ agentType: "revenue_agent", recommendation: "", actionTaken: "", expectedOutcome: "", domain: "", revenueCents: "" }); toast({ title: "Decision logged" }); },
  });

  const recordOutcome = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/agent-outcomes/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/agent-outcomes"] }); setOutcomeDialogOpen(false); toast({ title: "Outcome recorded" }); },
  });

  return (
    <div className="space-y-6">
      {/* Log new decision */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> Log Agent Decision</CardTitle>
          <CardDescription>Record an agent recommendation to track whether it actually worked</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Agent Type</label>
              <Select value={form.agentType} onValueChange={(v) => setForm((f) => ({ ...f, agentType: v }))}>
                <SelectTrigger data-testid="select-agent-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AGENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Domain (optional)</label>
              <Input placeholder="e.g. Lead Generation, Retention" value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} data-testid="input-domain" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Recommendation</label>
            <Textarea placeholder="What did the agent recommend?" value={form.recommendation} onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))} rows={2} data-testid="textarea-recommendation" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Action Taken</label>
              <Textarea placeholder="What was actually done?" value={form.actionTaken} onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value }))} rows={2} data-testid="textarea-action-taken" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Expected Outcome</label>
              <Textarea placeholder="What outcome was expected?" value={form.expectedOutcome} onChange={(e) => setForm((f) => ({ ...f, expectedOutcome: e.target.value }))} rows={2} data-testid="textarea-expected-outcome" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium mb-1 block">Revenue Influence ($, optional)</label>
              <Input type="number" placeholder="0" value={form.revenueCents} onChange={(e) => setForm((f) => ({ ...f, revenueCents: e.target.value }))} data-testid="input-revenue" />
            </div>
            <Button className="mt-5" onClick={() => log.mutate({ ...form, revenueCents: form.revenueCents ? parseInt(form.revenueCents) * 100 : 0 })} disabled={log.isPending || !form.recommendation} data-testid="button-log-decision">
              {log.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />} Log Decision
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Record actual outcome dialog */}
      <Dialog open={outcomeDialogOpen} onOpenChange={setOutcomeDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Actual Outcome</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Actual Outcome</label>
              <Textarea placeholder="What actually happened?" value={outcomeForm.actualOutcome} onChange={(e) => setOutcomeForm((f) => ({ ...f, actualOutcome: e.target.value }))} rows={3} data-testid="textarea-actual-outcome" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Success Score (0–100)</label>
              <Input type="number" min="0" max="100" value={outcomeForm.successScore} onChange={(e) => setOutcomeForm((f) => ({ ...f, successScore: e.target.value }))} data-testid="input-success-score" />
              <p className="text-xs text-muted-foreground mt-1">100 = perfect outcome, 0 = complete failure, 50 = partial</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Revenue Influenced ($)</label>
                <Input type="number" placeholder="0" value={outcomeForm.revenueCents} onChange={(e) => setOutcomeForm((f) => ({ ...f, revenueCents: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Meetings Generated</label>
                <Input type="number" placeholder="0" value={outcomeForm.meetingsGenerated} onChange={(e) => setOutcomeForm((f) => ({ ...f, meetingsGenerated: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full" onClick={() => recordOutcome.mutate({ id: outcomeForm.id, actualOutcome: outcomeForm.actualOutcome, successScore: parseInt(outcomeForm.successScore), revenueCents: outcomeForm.revenueCents ? parseInt(outcomeForm.revenueCents) * 100 : undefined, meetingsGenerated: outcomeForm.meetingsGenerated ? parseInt(outcomeForm.meetingsGenerated) : undefined })} disabled={recordOutcome.isPending || !outcomeForm.actualOutcome} data-testid="button-save-outcome">
              {recordOutcome.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />} Save Outcome
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recent decisions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Decisions ({outcomes?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !outcomes?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No decisions logged yet. Log your first agent recommendation above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {outcomes.map((o: any) => (
                <div key={o.id} className="border rounded-lg p-3 flex items-start gap-3" data-testid={`card-outcome-${o.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className={`text-xs ${AGENT_COLORS[o.agent_type] ?? ""}`}>{AGENT_LABELS[o.agent_type] ?? o.agent_type}</Badge>
                      {o.domain && <Badge variant="outline" className="text-xs">{o.domain}</Badge>}
                      {scoreBadge(o.success_score)}
                    </div>
                    <p className="text-sm font-medium truncate">{o.recommendation}</p>
                    {o.actual_outcome && <p className="text-xs text-muted-foreground mt-0.5">→ {o.actual_outcome}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</p>
                  </div>
                  {!o.outcome_date && (
                    <Button size="sm" variant="outline" onClick={() => { setOutcomeForm({ id: o.id, actualOutcome: "", successScore: "80", revenueCents: "", meetingsGenerated: "" }); setOutcomeDialogOpen(true); }} data-testid={`button-record-outcome-${o.id}`}>
                      Record Outcome
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Performance Tab ──────────────────────────────────────────────────────────
function PerformanceTab() {
  const { data: scores, isLoading } = useQuery<any[]>({ queryKey: ["/api/agent-outcomes/performance"] });

  const allAgents = Object.keys(AGENT_LABELS);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allAgents.map((agentType) => {
          const s = scores?.find((r: any) => r.agent_type === agentType);
          const issued   = s?.recommendations_issued   ?? 0;
          const executed = s?.recommendations_executed ?? 0;
          const rate     = s?.success_rate             ?? 0;
          const revenue  = Math.round((s?.revenue_influenced ?? 0) / 100);
          const meetings = s?.meetings_generated       ?? 0;
          const execRate = issued > 0 ? Math.round((executed / issued) * 100) : 0;

          return (
            <Card key={agentType} className={issued === 0 ? "opacity-60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{AGENT_LABELS[agentType]}</CardTitle>
                  <Badge className={`text-xs ${AGENT_COLORS[agentType] ?? ""}`}>{rate > 0 ? `${rate}/100` : "No data"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <div className="h-20 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : (
                  <>
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Success Rate</span><span>{rate}/100</span>
                      </div>
                      <Progress value={rate} className="h-2" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-lg font-bold">{issued}</div>
                        <div className="text-[10px] text-muted-foreground">Issued</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-lg font-bold">{executed}</div>
                        <div className="text-[10px] text-muted-foreground">Recorded</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-lg font-bold">{execRate}%</div>
                        <div className="text-[10px] text-muted-foreground">Tracked</div>
                      </div>
                    </div>
                    {(revenue > 0 || meetings > 0) && (
                      <div className="flex gap-3 text-xs text-muted-foreground pt-1 border-t">
                        {revenue > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${revenue.toLocaleString()} influenced</span>}
                        {meetings > 0 && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{meetings} meetings</span>}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Decision Effectiveness Tab ───────────────────────────────────────────────
function EffectivenessTab() {
  const { data: eff, isLoading } = useQuery<any>({ queryKey: ["/api/agent-outcomes/effectiveness"] });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  const sections = [
    { key: "topPerforming",   label: "Top Performing",          icon: TrendingUp,  color: "text-green-600",  data: eff?.topPerforming ?? [] },
    { key: "worstPerforming", label: "Worst Performing",        icon: TrendingDown, color: "text-red-600",   data: eff?.worstPerforming ?? [] },
    { key: "mostRepeated",   label: "Most Repeated",            icon: Repeat2,     color: "text-blue-600",   data: eff?.mostRepeated ?? [] },
    { key: "highestROI",     label: "Highest Revenue Impact",   icon: DollarSign,  color: "text-emerald-600", data: eff?.highestROI ?? [] },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {sections.map(({ key, label, icon: Icon, color, data }) => (
        <Card key={key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon className={`w-4 h-4 ${color}`} /> {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No data yet — log decisions and record outcomes to see patterns here.
              </div>
            ) : (
              <div className="space-y-2">
                {data.map((row: any, idx: number) => (
                  <div key={idx} className="border rounded p-2.5" data-testid={`card-effectiveness-${key}-${idx}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium line-clamp-2">
                          {row.recommendation ?? row.rec_key}
                        </p>
                        {row.domain && <span className="text-[10px] text-muted-foreground">{row.domain}</span>}
                      </div>
                      <div className="shrink-0 text-right">
                        {key === "mostRepeated" ? (
                          <div className="text-center">
                            <div className="text-sm font-bold">{row.times_issued}x</div>
                            <div className="text-[10px] text-muted-foreground">{Math.round(row.avg_success ?? 0)}/100 avg</div>
                          </div>
                        ) : key === "highestROI" ? (
                          <div className="text-sm font-bold text-emerald-600">${Math.round((row.revenue_cents ?? 0) / 100)}</div>
                        ) : (
                          scoreBadge(row.success_score)
                        )}
                      </div>
                    </div>
                    {row.actual_outcome && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">→ {row.actual_outcome}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Self-Improve Tab ─────────────────────────────────────────────────────────
function SelfImproveTab() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [results, setResults] = useState<{ results: any[]; obsidianContext: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/agent-outcomes/search-context", { query, agentType: agentFilter === "all" ? undefined : agentFilter, limit: 8 });
      setResults(await res.json());
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> Self-Improving Recommendation Engine</CardTitle>
          <CardDescription>Search historical decisions before making a new recommendation. Weights suggestions based on what actually worked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="e.g. follow up with parent leads, athlete story outreach..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} className="flex-1" data-testid="input-context-search" />
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All agents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {Object.entries(AGENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={search} disabled={loading || !query.trim()} data-testid="button-search-context">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
          </div>

          {results && (
            <div className="space-y-4 pt-2">
              {/* DB results */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Historical Decisions ({results.results.length})</div>
                {results.results.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">No similar past decisions found.</div>
                ) : (
                  <div className="space-y-2">
                    {results.results.map((r: any, idx: number) => (
                      <div key={idx} className="border rounded p-3" data-testid={`card-similar-${idx}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`text-xs ${AGENT_COLORS[r.agent_type] ?? ""}`}>{AGENT_LABELS[r.agent_type] ?? r.agent_type}</Badge>
                              {r.domain && <Badge variant="outline" className="text-xs">{r.domain}</Badge>}
                            </div>
                            <p className="text-sm font-medium">{r.recommendation}</p>
                            {r.actual_outcome && <p className="text-xs text-muted-foreground mt-1">→ {r.actual_outcome}</p>}
                          </div>
                          <div className="text-center shrink-0">
                            {scoreBadge(r.success_score)}
                            {r.revenue_cents > 0 && <div className="text-[10px] text-emerald-600 mt-0.5">${Math.round(r.revenue_cents / 100)}</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Obsidian context */}
              {results.obsidianContext.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1"><Brain className="w-3 h-3" /> Obsidian Memory Context</div>
                  <div className="space-y-1">
                    {results.obsidianContext.map((ctx: string, i: number) => (
                      <div key={i} className="bg-muted/50 rounded p-2 text-xs text-muted-foreground font-mono">{ctx}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendation weight */}
              {results.results.length > 0 && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">AI Weight Signal</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Average success across {results.results.length} similar decisions:{" "}
                      <span className="font-bold text-foreground">
                        {Math.round(results.results.reduce((a, r) => a + (r.success_score ?? 0), 0) / results.results.length)}/100
                      </span>{" "}
                      — {results.results.filter((r) => r.success_score >= 80).length} high-confidence wins,{" "}
                      {results.results.filter((r) => r.success_score < 40).length} failures to avoid.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── CEO Review Tab ───────────────────────────────────────────────────────────
function CEOReviewTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: reviews, isLoading } = useQuery<any[]>({ queryKey: ["/api/agent-outcomes/ceo-review"] });
  const [activeReview, setActiveReview] = useState<any | null>(null);

  const generate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-outcomes/ceo-review/generate", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      setActiveReview(data);
      qc.invalidateQueries({ queryKey: ["/api/agent-outcomes/ceo-review"] });
      toast({ title: "CEO Review generated and saved to Obsidian" });
    },
    onError: () => toast({ title: "Failed to generate review", variant: "destructive" }),
  });

  const reviewToShow = activeReview ?? reviews?.[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">CEO Outcome Review</h3>
          <p className="text-sm text-muted-foreground">AI-generated daily retrospective on agent decision outcomes</p>
        </div>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-generate-ceo-review">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />} Generate Today's Review
        </Button>
      </div>

      {reviewToShow && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "✅ What Worked",    key: "what_worked",  color: "border-green-200 bg-green-50 dark:bg-green-900/20" },
            { label: "❌ What Failed",    key: "what_failed",  color: "border-red-200 bg-red-50 dark:bg-red-900/20" },
            { label: "🔁 What To Repeat", key: "what_repeat", color: "border-blue-200 bg-blue-50 dark:bg-blue-900/20" },
            { label: "🛑 What To Stop",   key: "what_stop",   color: "border-orange-200 bg-orange-50 dark:bg-orange-900/20" },
          ].map(({ label, key, color }) => (
            <Card key={key} className={`border-2 ${color}`}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{(reviewToShow as any)[key.replace("what_", "what")] ?? (reviewToShow as any)[key]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reviewToShow && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="w-3 h-3" />
          Based on {reviewToShow.outcomes_analyzed ?? reviewToShow.outcomesAnalyzed ?? 0} decisions analyzed
          {reviewToShow.review_date && ` — ${reviewToShow.review_date}`}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !reviewToShow ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Award className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="mb-3">No reviews yet. Generate your first CEO daily review above.</p>
            <p className="text-xs">The review will be saved to both the database and your Obsidian vault.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Review history */}
      {(reviews?.length ?? 0) > 1 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Review History</div>
          <div className="space-y-1">
            {reviews?.slice(1).map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 border rounded p-2.5 cursor-pointer hover:bg-muted/50" onClick={() => setActiveReview(r)} data-testid={`card-review-${r.id}`}>
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{r.review_date}</span>
                <span className="text-xs text-muted-foreground">{r.outcomes_analyzed} decisions</span>
                {r.ai_generated && <Badge variant="outline" className="text-xs ml-auto">AI Generated</Badge>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Playbooks Tab ────────────────────────────────────────────────────────────
function PlaybooksTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: playbooks, isLoading: loadingPlaybooks } = useQuery<any[]>({ queryKey: ["/api/agent-outcomes/playbooks"] });
  const { data: candidates, isLoading: loadingCandidates } = useQuery<any[]>({ queryKey: ["/api/agent-outcomes/playbooks/candidates"] });
  const [promoting, setPromoting] = useState<string | null>(null);

  const promote = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/agent-outcomes/playbooks/promote", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/agent-outcomes/playbooks"] }); qc.invalidateQueries({ queryKey: ["/api/agent-outcomes/playbooks/candidates"] }); setPromoting(null); toast({ title: "Promoted to official playbook and saved to Obsidian" }); },
    onError: () => toast({ title: "Promotion failed", variant: "destructive" }),
  });

  const archive = useMutation({
    mutationFn: ({ id }: { id: string }) => apiRequest("PATCH", `/api/agent-outcomes/playbooks/${id}`, { status: "archived" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/agent-outcomes/playbooks"] }); toast({ title: "Playbook archived" }); },
  });

  return (
    <div className="space-y-6">
      {/* Promotion candidates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ChevronUp className="w-4 h-4 text-primary" /> Promotion Candidates
          </CardTitle>
          <CardDescription>High-performing patterns detected across multiple decisions — ready to become official SOPs</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCandidates ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !candidates?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No patterns detected yet. Log at least 2 similar high-scoring decisions to see promotion candidates.
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((c: any, idx: number) => (
                <div key={idx} className="border rounded p-3 flex items-start gap-3" data-testid={`card-candidate-${idx}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{c.recommendation}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1"><Repeat2 className="w-3 h-3" />{c.occurrences}x</span>
                      <span className="flex items-center gap-1"><Star className="w-3 h-3" />{c.avg_success_score}/100 avg</span>
                      {c.total_revenue > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${Math.round(c.total_revenue / 100)}</span>}
                      {c.domain && <Badge variant="outline" className="text-[10px]">{c.domain}</Badge>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setPromoting(c.recommendation)} data-testid={`button-promote-${idx}`}>
                    Promote to SOP
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Promote dialog */}
      {promoting && (
        <PromoteDialog
          sourceLearning={promoting}
          onConfirm={(opts) => promote.mutate(opts)}
          onClose={() => setPromoting(null)}
          isPending={promote.isPending}
        />
      )}

      {/* Active playbooks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" /> Official Playbooks ({playbooks?.filter((p) => p.status === "active").length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingPlaybooks ? (
            <div className="flex items-center justify-center h-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !playbooks?.filter((p) => p.status === "active").length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No playbooks promoted yet. Promote high-performing patterns from the candidates section above.
            </div>
          ) : (
            <div className="space-y-2">
              {playbooks?.filter((p) => p.status === "active").map((p: any) => (
                <div key={p.id} className="border rounded p-3" data-testid={`card-playbook-${p.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{p.title}</span>
                        <Badge className="text-xs bg-green-600 hover:bg-green-600">Active SOP</Badge>
                      </div>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span>{p.success_rate}% success rate</span>
                        <span>{p.evidence_count} cases</span>
                        <span>Promoted {new Date(p.promoted_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => archive.mutate({ id: p.id })} data-testid={`button-archive-${p.id}`}>
                      <ChevronDown className="w-3 h-3 mr-1" /> Archive
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PromoteDialog({ sourceLearning, onConfirm, onClose, isPending }: { sourceLearning: string; onConfirm: (opts: any) => void; onClose: () => void; isPending: boolean }) {
  const [form, setForm] = useState({
    title: sourceLearning.slice(0, 60),
    description: "",
    patternType: "outreach",
    triggerCondition: "",
    actions: "",
    expectedOutcome: "",
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Promote to Official Playbook</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="bg-muted/50 rounded p-2 text-xs text-muted-foreground">
            <span className="font-medium">Source: </span>{sourceLearning}
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">SOP Title</label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} data-testid="input-playbook-title" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Pattern Type</label>
            <Select value={form.patternType} onValueChange={(v) => setForm((f) => ({ ...f, patternType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outreach">Outreach</SelectItem>
                <SelectItem value="retention">Retention</SelectItem>
                <SelectItem value="scheduling">Scheduling</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
                <SelectItem value="growth">Growth</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Trigger Condition</label>
            <Input placeholder="When does this playbook apply?" value={form.triggerCondition} onChange={(e) => setForm((f) => ({ ...f, triggerCondition: e.target.value }))} data-testid="input-playbook-trigger" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Actions (Steps)</label>
            <Textarea placeholder="Step-by-step actions to take..." value={form.actions} onChange={(e) => setForm((f) => ({ ...f, actions: e.target.value }))} rows={3} data-testid="textarea-playbook-actions" />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Expected Outcome</label>
            <Input placeholder="What result should this produce?" value={form.expectedOutcome} onChange={(e) => setForm((f) => ({ ...f, expectedOutcome: e.target.value }))} data-testid="input-playbook-outcome" />
          </div>
          <Button className="w-full" onClick={() => onConfirm({ title: form.title, description: form.description, sourceLearning, patternType: form.patternType, successRate: 75, evidenceCount: 3, triggerCondition: form.triggerCondition, actions: form.actions, expectedOutcome: form.expectedOutcome })} disabled={isPending || !form.title} data-testid="button-confirm-promote">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <BookOpen className="w-4 h-4 mr-2" />} Promote to Official SOP
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminAgentOutcomePage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-primary" /> Outcome Intelligence
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Phase 3 — Measure whether agent recommendations actually worked, then improve them automatically.
          </p>
        </div>
        <Badge variant="outline" className="text-xs hidden sm:flex items-center gap-1">
          <Activity className="w-3 h-3" /> Continuous Improvement
        </Badge>
      </div>

      <Tabs defaultValue="flywheel">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="flywheel" data-testid="tab-flywheel">🔄 Flywheel</TabsTrigger>
          <TabsTrigger value="attribution" data-testid="tab-attribution">📋 Attribution</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">📊 Performance</TabsTrigger>
          <TabsTrigger value="effectiveness" data-testid="tab-effectiveness">🎯 Decisions</TabsTrigger>
          <TabsTrigger value="self-improve" data-testid="tab-self-improve">🧠 Self-Improve</TabsTrigger>
          <TabsTrigger value="ceo-review" data-testid="tab-ceo-review">👔 CEO Review</TabsTrigger>
          <TabsTrigger value="playbooks" data-testid="tab-playbooks">📖 Playbooks</TabsTrigger>
        </TabsList>

        <TabsContent value="flywheel" className="mt-4"><FlywheelTab /></TabsContent>
        <TabsContent value="attribution" className="mt-4"><AttributionTab /></TabsContent>
        <TabsContent value="performance" className="mt-4"><PerformanceTab /></TabsContent>
        <TabsContent value="effectiveness" className="mt-4"><EffectivenessTab /></TabsContent>
        <TabsContent value="self-improve" className="mt-4"><SelfImproveTab /></TabsContent>
        <TabsContent value="ceo-review" className="mt-4"><CEOReviewTab /></TabsContent>
        <TabsContent value="playbooks" className="mt-4"><PlaybooksTab /></TabsContent>
      </Tabs>
    </div>
  );
}
