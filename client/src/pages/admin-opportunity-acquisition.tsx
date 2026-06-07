import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Target, Search, Plus, CheckCircle, AlertTriangle,
  Clock, DollarSign, Star, Activity, Settings, BarChart3,
  Building2, MapPin, Zap, User, Shield, Eye, TrendingUp,
  Bot, Radio, X, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type OpportunityStatus =
  | "new" | "qualified" | "outreach_ready" | "contacted"
  | "interested" | "demo" | "won" | "lost";
type OpportunityType = "coaching" | "consulting" | "partnership" | "content" | "training";

interface Opportunity {
  id: string;
  title: string;
  source: string;
  company: string;
  type: OpportunityType;
  location: "Remote" | "Hybrid" | "Local";
  estimatedValue: number;
  status: OpportunityStatus;
  fitScore: number;
  notes: string;
  createdAt: string;
}

interface AgentEvent {
  id: string;
  agentName: string;
  action: string;
  eventType: string;
  createdAt: string;
}

interface Summary {
  foundToday: number;
  qualified: number;
  outreachReady: number;
  pipelineValue: number;
}

interface Settings {
  sources: Record<string, boolean>;
  qualRules: Record<string, boolean>;
  outreachRules: Record<string, boolean>;
  agentPerms: Record<string, string>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OpportunityStatus, { label: string; color: string }> = {
  new:            { label: "New",            color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  qualified:      { label: "Qualified",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  outreach_ready: { label: "Outreach Ready", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  contacted:      { label: "Contacted",      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  interested:     { label: "Interested",     color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  demo:           { label: "Demo",           color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  won:            { label: "Won",            color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  lost:           { label: "Lost",           color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

const TYPE_CONFIG: Record<OpportunityType, { label: string; color: string }> = {
  coaching:    { label: "Coaching",    color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  consulting:  { label: "Consulting",  color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  partnership: { label: "Partnership", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  content:     { label: "Content",     color: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  training:    { label: "Training",    color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

const KANBAN_COLUMNS: { id: OpportunityStatus; label: string; color: string }[] = [
  { id: "new",            label: "New",            color: "border-slate-400" },
  { id: "qualified",      label: "Qualified",      color: "border-blue-400" },
  { id: "outreach_ready", label: "Outreach Ready", color: "border-violet-400" },
  { id: "contacted",      label: "Contacted",      color: "border-amber-400" },
  { id: "interested",     label: "Interested",     color: "border-teal-400" },
  { id: "demo",           label: "Demo",           color: "border-cyan-400" },
  { id: "won",            label: "Won",            color: "border-emerald-400" },
  { id: "lost",           label: "Lost",           color: "border-rose-400" },
];

const EVENT_ICONS: Record<string, { icon: typeof Search; color: string }> = {
  scan:    { icon: Search,        color: "bg-blue-500" },
  qualify: { icon: Star,          color: "bg-violet-500" },
  draft:   { icon: Zap,           color: "bg-amber-500" },
  flag:    { icon: AlertTriangle, color: "bg-rose-500" },
  info:    { icon: Activity,      color: "bg-slate-400" },
  update:  { icon: BarChart3,     color: "bg-teal-500" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fitScoreColor(score: number): string {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 75) return "text-blue-600 dark:text-blue-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-500";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusBadge({ s }: { s: OpportunityStatus }) {
  const cfg = STATUS_CONFIG[s] ?? { label: s, color: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}

function TypeBadge({ t }: { t: OpportunityType }) {
  const cfg = TYPE_CONFIG[t] ?? { label: t, color: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}

function CardSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <Card key={i} className="border"><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
      ))}
    </div>
  );
}

// ─── Add Opportunity Modal ────────────────────────────────────────────────────

interface AddModalProps { onClose: () => void; onSaved: () => void }

function AddOpportunityModal({ onClose, onSaved }: AddModalProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", company: "", source: "Manual", type: "coaching" as OpportunityType,
    location: "Remote" as "Remote" | "Hybrid" | "Local", estimatedValue: "", fitScore: "",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", "/api/opportunity-acquisition/opportunities", {
        ...data,
        estimatedValue: Number(data.estimatedValue) || 0,
        fitScore: Number(data.fitScore) || 0,
      }),
    onSuccess: () => {
      toast({ title: "Opportunity added" });
      onSaved();
      onClose();
    },
    onError: () => toast({ title: "Failed to add opportunity", variant: "destructive" }),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md border shadow-xl">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Add Opportunity</CardTitle>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-modal"><X className="h-3.5 w-3.5" /></Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Title *</Label>
            <Input className="h-8 text-xs" placeholder="e.g. Remote Strength Programming Coach" value={form.title} onChange={e => set("title")(e.target.value)} data-testid="input-opp-title" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Company</Label>
              <Input className="h-8 text-xs" placeholder="Company name" value={form.company} onChange={e => set("company")(e.target.value)} data-testid="input-opp-company" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Input className="h-8 text-xs" placeholder="LinkedIn, Indeed…" value={form.source} onChange={e => set("source")(e.target.value)} data-testid="input-opp-source" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={v => set("type")(v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-opp-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coaching">Coaching</SelectItem>
                  <SelectItem value="consulting">Consulting</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="content">Content</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Select value={form.location} onValueChange={v => set("location")(v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-opp-location"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Remote">Remote</SelectItem>
                  <SelectItem value="Hybrid">Hybrid</SelectItem>
                  <SelectItem value="Local">Local</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Est. Value ($)</Label>
              <Input className="h-8 text-xs" type="number" placeholder="60000" value={form.estimatedValue} onChange={e => set("estimatedValue")(e.target.value)} data-testid="input-opp-value" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fit Score (0–100)</Label>
              <Input className="h-8 text-xs" type="number" placeholder="80" value={form.fitScore} onChange={e => set("fitScore")(e.target.value)} data-testid="input-opp-fitscore" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="flex-1 text-xs gap-1" disabled={!form.title || mutation.isPending} onClick={() => mutation.mutate(form)} data-testid="button-save-opportunity">
              {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ data, isLoading }: { data?: Summary; isLoading: boolean }) {
  const cards = [
    { label: "Found Today",    value: data?.foundToday ?? 0,      icon: Search,     color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20",    fmt: String },
    { label: "Qualified",      value: data?.qualified ?? 0,        icon: Star,       color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20", fmt: String },
    { label: "Outreach Ready", value: data?.outreachReady ?? 0,    icon: Zap,        color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20",  fmt: String },
    { label: "Pipeline Value", value: data?.pipelineValue ?? 0,    icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", fmt: (v: number) => `$${(v / 1000).toFixed(0)}K` },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <Card key={c.label} className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                {isLoading
                  ? <Skeleton className="h-7 w-16 mt-1" />
                  : <p className="text-2xl font-bold mt-0.5" data-testid={`text-summary-${c.label.replace(/\s/g, "-").toLowerCase()}`}>{c.fmt(c.value)}</p>
                }
              </div>
              <div className={`p-2 rounded-lg ${c.bg}`}>
                <c.icon className={`h-4 w-4 ${c.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Discovery Tab ─────────────────────────────────────────────────────────────

function DiscoveryTab({ opportunities, isLoading }: { opportunities: Opportunity[]; isLoading: boolean }) {
  if (isLoading) return <CardSkeleton />;

  if (!opportunities.length) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
        <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium text-sm">No opportunities yet</p>
        <p className="text-xs mt-1">Run a discovery scan or add one manually to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {opportunities.map(opp => (
        <Card key={opp.id} className="border shadow-sm hover:shadow-md transition-shadow" data-testid={`card-opportunity-${opp.id}`}>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-semibold truncate" data-testid={`text-opp-title-${opp.id}`}>{opp.title}</h3>
                  <StatusBadge s={opp.status} />
                  <TypeBadge t={opp.type} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {opp.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{opp.company}</span>}
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{opp.location}</span>
                  <span className="flex items-center gap-1"><Search className="h-3 w-3" />{opp.source}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(opp.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Est. Value</p>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    {opp.estimatedValue ? `$${(opp.estimatedValue / 1000).toFixed(0)}K` : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Fit Score</p>
                  <p className={`text-sm font-bold ${fitScoreColor(opp.fitScore)}`}>{opp.fitScore || "—"}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" data-testid={`button-review-${opp.id}`}>
                  <Eye className="h-3 w-3" />Review
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Qualification Tab ────────────────────────────────────────────────────────

function QualificationTab({ opportunities }: { opportunities: Opportunity[] }) {
  const opp = opportunities[0] ?? null;

  if (!opp) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
        <Star className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium text-sm">No opportunities to qualify</p>
        <p className="text-xs mt-1">Add opportunities in the Discovery tab first.</p>
      </div>
    );
  }

  const aiCanFulfill = ["Program design", "Exercise selection", "Progression logic", "Athlete education", "Reporting"];
  const humanRequired = ["Sales approval", "Relationship ownership", "Contract review"];

  return (
    <div className="space-y-4">
      <Card className="border shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">{opp.title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {opp.company && `${opp.company} · `}{opp.location}
                {opp.estimatedValue ? ` · $${(opp.estimatedValue / 1000).toFixed(0)}K` : ""}
              </p>
            </div>
            <StatusBadge s={opp.status} />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-500" />
                <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-300">AI Can Fulfill</h4>
              </div>
              <ul className="space-y-1.5">
                {aiCanFulfill.map(item => (
                  <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-amber-500" />
                <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-300">Human Required</h4>
              </div>
              <ul className="space-y-1.5">
                {humanRequired.map(item => (
                  <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-500" />
                <h4 className="text-xs font-semibold text-violet-700 dark:text-violet-300">Assessment</h4>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Revenue Potential", value: "High",   color: "text-emerald-600 dark:text-emerald-400" },
                  { label: "Risk Level",         value: "Low",    color: "text-teal-600 dark:text-teal-400" },
                  { label: "Fit Score",          value: opp.fitScore ? `${opp.fitScore}/100` : "—", color: fitScoreColor(opp.fitScore) },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={`font-semibold ${row.color}`}>{row.value}</span>
                  </div>
                ))}
                <div className="pt-1 border-t">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Recommended Action</p>
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mt-0.5">Proceed to Outreach</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground text-sm">
        <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium">Showing most recent opportunity above</p>
        <p className="text-xs mt-1">Full qualification engine coming in Phase 3.</p>
      </div>
    </div>
  );
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────────

function PipelineTab({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-3">
      <div className="flex gap-3 min-w-max">
        {KANBAN_COLUMNS.map(col => {
          const items = opportunities.filter(o => o.status === col.id);
          return (
            <div key={col.id} className="w-52 shrink-0" data-testid={`kanban-col-${col.id}`}>
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 ${col.color} bg-muted/40`}>
                <span className="text-xs font-semibold">{col.label}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{items.length}</Badge>
              </div>
              <div className="border border-t-0 rounded-b-lg p-2 space-y-2 min-h-[120px] bg-background">
                {items.map(opp => (
                  <div key={opp.id} className="rounded-md border bg-card p-2.5 cursor-pointer hover:shadow-sm transition-shadow space-y-1.5" data-testid={`kanban-card-${opp.id}`}>
                    <p className="text-xs font-medium leading-snug">{opp.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{opp.company || "—"}</span>
                      {opp.fitScore > 0 && <span className={`text-[10px] font-bold ${fitScoreColor(opp.fitScore)}`}>{opp.fitScore}</span>}
                    </div>
                    {opp.estimatedValue > 0 && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">${(opp.estimatedValue / 1000).toFixed(0)}K</p>
                    )}
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="flex items-center justify-center h-16 text-[11px] text-muted-foreground">Empty</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agent Activity Tab ───────────────────────────────────────────────────────

function AgentActivityTab({ events, isLoading }: { events: AgentEvent[]; isLoading: boolean }) {
  if (isLoading) return <CardSkeleton />;

  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium text-sm">No agent activity yet</p>
        <p className="text-xs mt-1">Run a discovery scan to generate the first event.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agent Timeline</h3>
        <Badge variant="secondary" className="text-xs gap-1"><Activity className="h-3 w-3" />{events.length} events</Badge>
      </div>
      <div className="space-y-0">
        {events.map((event, idx) => {
          const cfg = EVENT_ICONS[event.eventType] ?? EVENT_ICONS.info;
          const IconComp = cfg.icon;
          return (
            <div key={event.id} className="flex gap-3" data-testid={`timeline-event-${event.id}`}>
              <div className="flex flex-col items-center">
                <div className={`h-7 w-7 ${cfg.color} rounded-full flex items-center justify-center shrink-0 z-10`}>
                  <IconComp className="h-3.5 w-3.5 text-white" />
                </div>
                {idx < events.length - 1 && <div className="w-px flex-1 bg-border mt-1 mb-1" />}
              </div>
              <div className="pb-4 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold">{event.agentName}</span>
                    <span className="text-xs text-muted-foreground"> {event.action}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  sources:       { linkedin: true, indeed: true, agentScan: false, directReferrals: true },
  qualRules:     { minFitScore70: true, remoteOnly: false, revenueMin40k: true, autoQualifyHigh: false },
  outreachRules: { requireHumanApproval: true, autoSendHighConf: false, ccFounder: true },
  agentPerms:    { discovery: "scan_only", qualification: "score_qualify", outreach: "draft_only", executive: "flag_escalate" },
};

function SettingsTab({ settings: serverSettings, isLoading }: { settings?: Settings | null; isLoading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [local, setLocal] = useState<Settings | null>(null);

  const effective: Settings = local ?? serverSettings ?? DEFAULT_SETTINGS;

  const saveSettings = useMutation({
    mutationFn: (data: Settings) => apiRequest("PATCH", "/api/opportunity-acquisition/settings", data),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/settings"] });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  function toggleSource(key: string) {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, sources: { ...base.sources, [key]: !base.sources[key] } };
    });
  }
  function toggleQual(key: string) {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, qualRules: { ...base.qualRules, [key]: !base.qualRules[key] } };
    });
  }
  function toggleOutreach(key: string) {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, outreachRules: { ...base.outreachRules, [key]: !base.outreachRules[key] } };
    });
  }
  function setAgentPerm(key: string, val: string) {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, agentPerms: { ...base.agentPerms, [key]: val } };
    });
  }

  if (isLoading) return <CardSkeleton />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sources */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Radio className="h-4 w-4 text-muted-foreground" />Opportunity Sources</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "linkedin",        label: "LinkedIn Jobs",    desc: "Scan for coaching and consulting roles" },
              { key: "indeed",          label: "Indeed",           desc: "Scan Indeed job board daily" },
              { key: "agentScan",       label: "Agent Deep Scan",  desc: "AI-driven web discovery mode" },
              { key: "directReferrals", label: "Direct Referrals", desc: "Include manually added opportunities" },
            ].map(s => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                </div>
                <Switch checked={!!effective.sources[s.key]} onCheckedChange={() => toggleSource(s.key)} data-testid={`toggle-source-${s.key}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Qualification Rules */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Star className="h-4 w-4 text-muted-foreground" />Qualification Rules</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "minFitScore70",    label: "Minimum Fit Score 70+",    desc: "Discard opportunities below threshold" },
              { key: "remoteOnly",       label: "Remote-Only Filter",       desc: "Only qualify remote opportunities" },
              { key: "revenueMin40k",    label: "Revenue Minimum $40K",     desc: "Skip low-value opportunities" },
              { key: "autoQualifyHigh",  label: "Auto-Qualify High Scores", desc: "Auto-move 90+ scores to Outreach Ready" },
            ].map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                </div>
                <Switch checked={!!effective.qualRules[r.key]} onCheckedChange={() => toggleQual(r.key)} data-testid={`toggle-qual-${r.key}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Outreach Approval Rules */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4 text-muted-foreground" />Outreach Approval Rules</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "requireHumanApproval",   label: "Require Human Approval",    desc: "All outreach must be approved before send" },
              { key: "autoSendHighConf",        label: "Auto-Send High Confidence", desc: "Auto-send when fit score ≥ 95" },
              { key: "ccFounder",               label: "CC Founder on Outreach",    desc: "Add founder to every outreach email" },
            ].map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                </div>
                <Switch checked={!!effective.outreachRules[r.key]} onCheckedChange={() => toggleOutreach(r.key)} data-testid={`toggle-outreach-${r.key}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Agent Permissions */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Bot className="h-4 w-4 text-muted-foreground" />Agent Permissions</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "discovery",      label: "Discovery Agent" },
              { key: "qualification",  label: "Qualification Agent" },
              { key: "outreach",       label: "Outreach Agent" },
              { key: "executive",      label: "Executive Agent" },
            ].map(a => (
              <div key={a.key} className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium">{a.label}</p>
                <Select value={effective.agentPerms[a.key] ?? "disabled"} onValueChange={v => setAgentPerm(a.key, v)}>
                  <SelectTrigger className="h-7 text-xs w-36" data-testid={`select-agent-${a.key}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scan_only">Scan Only</SelectItem>
                    <SelectItem value="score_qualify">Score & Qualify</SelectItem>
                    <SelectItem value="draft_only">Draft Only</SelectItem>
                    <SelectItem value="flag_escalate">Flag & Escalate</SelectItem>
                    <SelectItem value="auto_send">Auto Send</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          className="text-xs gap-1.5"
          disabled={!local || saveSettings.isPending}
          onClick={() => saveSettings.mutate(effective)}
          data-testid="button-save-settings"
        >
          {saveSettings.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function AdminOpportunityAcquisitionPage() {
  const [activeTab, setActiveTab] = useState("discovery");
  const [showAddModal, setShowAddModal] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const summaryQ = useQuery<Summary>({
    queryKey: ["/api/opportunity-acquisition/summary"],
  });

  const oppsQ = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunity-acquisition/opportunities"],
  });

  const eventsQ = useQuery<AgentEvent[]>({
    queryKey: ["/api/opportunity-acquisition/events"],
  });

  const settingsQ = useQuery<Settings | null>({
    queryKey: ["/api/opportunity-acquisition/settings"],
  });

  const runScan = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunity-acquisition/run-scan", {}),
    onSuccess: () => {
      toast({ title: "Discovery scan queued", description: "Agent event logged." });
      qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/events"] });
      qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/summary"] });
      setActiveTab("agent-activity");
    },
    onError: () => toast({ title: "Scan failed", variant: "destructive" }),
  });

  const opportunities: Opportunity[] = oppsQ.data ?? [];
  const events: AgentEvent[] = eventsQ.data ?? [];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {showAddModal && (
        <AddOpportunityModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/opportunities"] });
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/summary"] });
          }}
        />
      )}

      <div className="flex-1 container max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-0.5" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-bold">Opportunity Acquisition</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                AI agents find, qualify, and convert external opportunities into revenue.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowAddModal(true)}
              data-testid="button-add-opportunity"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Opportunity
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              disabled={runScan.isPending}
              onClick={() => runScan.mutate()}
              data-testid="button-run-discovery"
            >
              {runScan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Run Discovery Scan
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <SummaryCards data={summaryQ.data} isLoading={summaryQ.isLoading} />

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full sm:w-auto flex overflow-x-auto" data-testid="tabs-main">
            <TabsTrigger value="discovery"      className="text-xs gap-1.5" data-testid="tab-discovery"><Search className="h-3 w-3" />Discovery</TabsTrigger>
            <TabsTrigger value="qualification"  className="text-xs gap-1.5" data-testid="tab-qualification"><Star className="h-3 w-3" />Qualification</TabsTrigger>
            <TabsTrigger value="pipeline"       className="text-xs gap-1.5" data-testid="tab-pipeline"><TrendingUp className="h-3 w-3" />Pipeline</TabsTrigger>
            <TabsTrigger value="agent-activity" className="text-xs gap-1.5" data-testid="tab-agent-activity"><Activity className="h-3 w-3" />Agent Activity</TabsTrigger>
            <TabsTrigger value="settings"       className="text-xs gap-1.5" data-testid="tab-settings"><Settings className="h-3 w-3" />Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="discovery"      className="mt-4">
            <DiscoveryTab opportunities={opportunities} isLoading={oppsQ.isLoading} />
          </TabsContent>
          <TabsContent value="qualification"  className="mt-4">
            <QualificationTab opportunities={opportunities} />
          </TabsContent>
          <TabsContent value="pipeline"       className="mt-4">
            <PipelineTab opportunities={opportunities} />
          </TabsContent>
          <TabsContent value="agent-activity" className="mt-4">
            <AgentActivityTab events={events} isLoading={eventsQ.isLoading} />
          </TabsContent>
          <TabsContent value="settings"       className="mt-4">
            <SettingsTab settings={settingsQ.data} isLoading={settingsQ.isLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
