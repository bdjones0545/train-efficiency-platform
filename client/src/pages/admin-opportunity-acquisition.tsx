import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Target, Search, Plus, CheckCircle, AlertTriangle,
  Clock, DollarSign, Star, Activity, Settings, BarChart3,
  Building2, MapPin, Zap, User, Shield, Eye, TrendingUp,
  Briefcase, Radio, ChevronRight, Bot, Calendar,
} from "lucide-react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type OpportunityStatus = "new" | "qualified" | "outreach_ready" | "contacted" | "interested" | "demo" | "won" | "lost";
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
  postedAt: string;
}

const MOCK_OPPORTUNITIES: Opportunity[] = [
  { id: "1", title: "Remote Strength Programming Coach", source: "LinkedIn Jobs", company: "ElitePerform Labs", type: "coaching", location: "Remote", estimatedValue: 72000, status: "qualified", fitScore: 94, postedAt: "2h ago" },
  { id: "2", title: "Online Athlete Development Specialist", source: "Indeed", company: "ProAthlete Academy", type: "coaching", location: "Remote", estimatedValue: 65000, status: "outreach_ready", fitScore: 88, postedAt: "4h ago" },
  { id: "3", title: "Corporate Wellness Programming Partner", source: "Agent Scan", company: "Apex Wellness Corp", type: "partnership", location: "Hybrid", estimatedValue: 120000, status: "new", fitScore: 76, postedAt: "6h ago" },
  { id: "4", title: "Sports Performance Content Coach", source: "LinkedIn Jobs", company: "AthleteMedia Group", type: "content", location: "Remote", estimatedValue: 55000, status: "contacted", fitScore: 82, postedAt: "1d ago" },
  { id: "5", title: "Youth Athlete Training Consultant", source: "Agent Scan", company: "NextGen Sports Academy", type: "training", location: "Local", estimatedValue: 48000, status: "interested", fitScore: 71, postedAt: "1d ago" },
];

const KANBAN_COLUMNS: { id: OpportunityStatus; label: string; color: string }[] = [
  { id: "new",           label: "New",           color: "border-slate-400" },
  { id: "qualified",     label: "Qualified",     color: "border-blue-400" },
  { id: "outreach_ready",label: "Outreach Ready",color: "border-violet-400" },
  { id: "contacted",     label: "Contacted",     color: "border-amber-400" },
  { id: "interested",    label: "Interested",    color: "border-teal-400" },
  { id: "demo",          label: "Demo",          color: "border-cyan-400" },
  { id: "won",           label: "Won",           color: "border-emerald-400" },
  { id: "lost",          label: "Lost",          color: "border-rose-400" },
];

const AGENT_TIMELINE = [
  { id: "1", agent: "Discovery Agent",      action: "found 5 new opportunities from LinkedIn and job boards", time: "8 min ago",  icon: Search,    color: "bg-blue-500" },
  { id: "2", agent: "Qualification Agent",  action: "scored 3 opportunities — 2 high-fit, 1 medium-fit",    time: "22 min ago", icon: Star,      color: "bg-violet-500" },
  { id: "3", agent: "Outreach Agent",       action: "drafted 2 personalized outreach messages for review",   time: "45 min ago", icon: Zap,       color: "bg-amber-500" },
  { id: "4", agent: "Executive Agent",      action: "flagged 1 high-value partnership opportunity ($120K)",  time: "1h ago",     icon: AlertTriangle, color: "bg-rose-500" },
  { id: "5", agent: "Discovery Agent",      action: "scanned 48 sources — 0 new qualified results",         time: "3h ago",     icon: Radio,     color: "bg-slate-400" },
  { id: "6", agent: "Qualification Agent",  action: "updated fit scores for 4 existing opportunities",      time: "5h ago",     icon: BarChart3, color: "bg-teal-500" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OpportunityStatus, { label: string; color: string }> = {
  new:           { label: "New",           color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  qualified:     { label: "Qualified",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  outreach_ready:{ label: "Outreach Ready",color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  contacted:     { label: "Contacted",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  interested:    { label: "Interested",    color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  demo:          { label: "Demo",          color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  won:           { label: "Won",           color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  lost:          { label: "Lost",          color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

const TYPE_CONFIG: Record<OpportunityType, { label: string; color: string }> = {
  coaching:    { label: "Coaching",    color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  consulting:  { label: "Consulting",  color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  partnership: { label: "Partnership", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  content:     { label: "Content",     color: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  training:    { label: "Training",    color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

function fitScoreColor(score: number): string {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 75) return "text-blue-600 dark:text-blue-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-500";
}

function StatusBadge({ s }: { s: OpportunityStatus }) {
  const cfg = STATUS_CONFIG[s];
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}

function TypeBadge({ t }: { t: OpportunityType }) {
  const cfg = TYPE_CONFIG[t];
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards() {
  const cards = [
    { label: "Found Today",      value: "5",      sub: "+3 from agents",       icon: Search,      color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20" },
    { label: "Qualified",        value: "3",      sub: "2 high-fit",           icon: Star,        color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
    { label: "Outreach Ready",   value: "2",      sub: "Awaiting approval",    icon: Zap,         color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/20" },
    { label: "Pipeline Value",   value: "$360K",  sub: "5 active deals",       icon: DollarSign,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                <p className="text-2xl font-bold mt-0.5" data-testid={`text-summary-${c.label.replace(/\s/g, "-").toLowerCase()}`}>{c.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</p>
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

function DiscoveryTab() {
  return (
    <div className="space-y-3">
      {MOCK_OPPORTUNITIES.map((opp) => (
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
                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{opp.company}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{opp.location}</span>
                  <span className="flex items-center gap-1"><Search className="h-3 w-3" />{opp.source}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{opp.postedAt}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Est. Value</p>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">${(opp.estimatedValue / 1000).toFixed(0)}K</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Fit Score</p>
                  <p className={`text-sm font-bold ${fitScoreColor(opp.fitScore)}`}>{opp.fitScore}</p>
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

function QualificationTab() {
  const opp = MOCK_OPPORTUNITIES[1];
  const aiCanFulfill = ["Program design", "Exercise selection", "Progression logic", "Athlete education", "Reporting"];
  const humanRequired = ["Sales approval", "Relationship ownership", "Contract review"];

  return (
    <div className="space-y-4">
      <Card className="border shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">{opp.title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{opp.company} · {opp.location} · ${(opp.estimatedValue / 1000).toFixed(0)}K</p>
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
                {aiCanFulfill.map((item) => (
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
                {humanRequired.map((item) => (
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
                  { label: "Revenue Potential", value: "High", color: "text-emerald-600 dark:text-emerald-400" },
                  { label: "Risk Level",         value: "Low",  color: "text-teal-600 dark:text-teal-400" },
                  { label: "Fit Score",          value: `${opp.fitScore}/100`, color: fitScoreColor(opp.fitScore) },
                ].map((row) => (
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
        <p className="font-medium">Select an opportunity to run AI qualification</p>
        <p className="text-xs mt-1">Qualification engine analyzes fit, risk, and revenue potential in seconds</p>
      </div>
    </div>
  );
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────────

function PipelineTab() {
  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-3">
      <div className="flex gap-3 min-w-max">
        {KANBAN_COLUMNS.map((col) => {
          const items = MOCK_OPPORTUNITIES.filter((o) => o.status === col.id);
          return (
            <div key={col.id} className="w-52 shrink-0" data-testid={`kanban-col-${col.id}`}>
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 ${col.color} bg-muted/40`}>
                <span className="text-xs font-semibold">{col.label}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1">{items.length}</Badge>
              </div>
              <div className="border border-t-0 rounded-b-lg p-2 space-y-2 min-h-[120px] bg-background">
                {items.map((opp) => (
                  <div key={opp.id} className="rounded-md border bg-card p-2.5 cursor-pointer hover:shadow-sm transition-shadow space-y-1.5" data-testid={`kanban-card-${opp.id}`}>
                    <p className="text-xs font-medium leading-snug">{opp.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">{opp.company}</span>
                      <span className={`text-[10px] font-bold ${fitScoreColor(opp.fitScore)}`}>{opp.fitScore}</span>
                    </div>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">${(opp.estimatedValue / 1000).toFixed(0)}K</p>
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

function AgentActivityTab() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agent Timeline</h3>
        <Badge variant="secondary" className="text-xs gap-1"><Activity className="h-3 w-3" />Live</Badge>
      </div>
      <div className="space-y-0">
        {AGENT_TIMELINE.map((event, idx) => (
          <div key={event.id} className="flex gap-3 group" data-testid={`timeline-event-${event.id}`}>
            <div className="flex flex-col items-center">
              <div className={`h-7 w-7 ${event.color} rounded-full flex items-center justify-center shrink-0 z-10`}>
                <event.icon className="h-3.5 w-3.5 text-white" />
              </div>
              {idx < AGENT_TIMELINE.length - 1 && <div className="w-px flex-1 bg-border mt-1 mb-1" />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold">{event.agent}</span>
                  <span className="text-xs text-muted-foreground"> {event.action}</span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{event.time}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

interface SettingToggleRow {
  label: string;
  description: string;
  defaultOn?: boolean;
}

function SettingsCard({ title, icon: Icon, rows }: { title: string; icon: React.ElementType; rows: SettingToggleRow[] }) {
  const [states, setStates] = useState<boolean[]>(rows.map((r) => r.defaultOn ?? false));
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {rows.map((row, i) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium">{row.label}</p>
              <p className="text-[11px] text-muted-foreground">{row.description}</p>
            </div>
            <Switch
              checked={states[i]}
              onCheckedChange={(v) => setStates((prev) => prev.map((s, j) => (j === i ? v : s)))}
              data-testid={`toggle-${title.replace(/\s/g, "-").toLowerCase()}-${i}`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SettingsCard
        title="Opportunity Sources"
        icon={Radio}
        rows={[
          { label: "LinkedIn Jobs",  description: "Scan for coaching and consulting roles", defaultOn: true },
          { label: "Indeed",         description: "Scan Indeed job board daily",            defaultOn: true },
          { label: "Agent Deep Scan",description: "AI-driven web discovery mode",           defaultOn: false },
          { label: "Direct Referrals", description: "Include manually added opportunities", defaultOn: true },
        ]}
      />
      <SettingsCard
        title="Qualification Rules"
        icon={Star}
        rows={[
          { label: "Minimum Fit Score 70+",    description: "Discard opportunities below threshold", defaultOn: true },
          { label: "Remote-Only Filter",       description: "Only qualify remote opportunities",      defaultOn: false },
          { label: "Revenue Minimum $40K",     description: "Skip low-value opportunities",           defaultOn: true },
          { label: "Auto-Qualify High Scores", description: "Auto-move 90+ scores to Outreach Ready", defaultOn: false },
        ]}
      />
      <SettingsCard
        title="Outreach Approval Rules"
        icon={Shield}
        rows={[
          { label: "Require Human Approval",   description: "All outreach must be approved before send", defaultOn: true },
          { label: "Auto-Send High Confidence",description: "Auto-send when fit score ≥ 95",             defaultOn: false },
          { label: "CC Founder on Outreach",   description: "Add founder to every outreach email",       defaultOn: true },
        ]}
      />
      <Card className="border shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            Agent Permissions
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {[
            { label: "Discovery Agent",    permission: "scan_only" },
            { label: "Qualification Agent",permission: "score_qualify" },
            { label: "Outreach Agent",     permission: "draft_only" },
            { label: "Executive Agent",    permission: "flag_escalate" },
          ].map((a) => (
            <div key={a.label} className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium">{a.label}</p>
              <Select defaultValue={a.permission}>
                <SelectTrigger className="h-7 text-xs w-36" data-testid={`select-agent-${a.label.replace(/\s/g, "-").toLowerCase()}`}>
                  <SelectValue />
                </SelectTrigger>
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
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function AdminOpportunityAcquisitionPage() {
  const [activeTab, setActiveTab] = useState("discovery");

  return (
    <div className="flex flex-col min-h-screen bg-background">
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
          <div className="flex items-center gap-2 shrink-0 sm:mt-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              data-testid="button-add-opportunity"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Opportunity
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              data-testid="button-run-discovery"
            >
              <Search className="h-3.5 w-3.5" />
              Run Discovery Scan
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <SummaryCards />

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full sm:w-auto flex overflow-x-auto" data-testid="tabs-main">
            <TabsTrigger value="discovery"      className="text-xs gap-1.5" data-testid="tab-discovery"><Search className="h-3 w-3" />Discovery</TabsTrigger>
            <TabsTrigger value="qualification"  className="text-xs gap-1.5" data-testid="tab-qualification"><Star className="h-3 w-3" />Qualification</TabsTrigger>
            <TabsTrigger value="pipeline"       className="text-xs gap-1.5" data-testid="tab-pipeline"><TrendingUp className="h-3 w-3" />Pipeline</TabsTrigger>
            <TabsTrigger value="agent-activity" className="text-xs gap-1.5" data-testid="tab-agent-activity"><Activity className="h-3 w-3" />Agent Activity</TabsTrigger>
            <TabsTrigger value="settings"       className="text-xs gap-1.5" data-testid="tab-settings"><Settings className="h-3 w-3" />Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="discovery"      className="mt-4"><DiscoveryTab /></TabsContent>
          <TabsContent value="qualification"  className="mt-4"><QualificationTab /></TabsContent>
          <TabsContent value="pipeline"       className="mt-4"><PipelineTab /></TabsContent>
          <TabsContent value="agent-activity" className="mt-4"><AgentActivityTab /></TabsContent>
          <TabsContent value="settings"       className="mt-4"><SettingsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
