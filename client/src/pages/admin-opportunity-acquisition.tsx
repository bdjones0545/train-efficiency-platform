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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Target, Search, Plus, CheckCircle, AlertTriangle,
  Clock, DollarSign, Star, Activity, Settings, BarChart3,
  Building2, MapPin, Zap, User, Shield, Radio, X, Loader2,
  Brain, Flag, ChevronRight, AlertCircle, ThumbsUp, Mail,
  ThumbsDown, CheckCheck, Eye, Pencil, TrendingUp, Bot,
  Database, RefreshCw, Filter, Hash, PlayCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type OpportunityStatus =
  | "new" | "qualified" | "outreach_ready" | "contacted"
  | "interested" | "demo" | "won" | "lost";
type OpportunityType = "coaching" | "consulting" | "partnership" | "content" | "training";
type RiskLevel = "low" | "medium" | "high" | "critical";
type RevPotential = "low" | "medium" | "high";
type DraftStatus = "draft" | "approved" | "rejected" | "sent";

interface Opportunity {
  id: string; title: string; source: string; company: string;
  type: OpportunityType; location: "Remote" | "Hybrid" | "Local";
  estimatedValue: number; status: OpportunityStatus;
  fitScore: number; notes: string; createdAt: string;
}

interface Assessment {
  id: string; opportunityId: string; opportunityTitle: string;
  fitScore: number; aiFulfillmentScore: number; revenuePotentialScore: number;
  riskScore: number; confidenceScore: number; revenuePotential: RevPotential;
  riskLevel: RiskLevel; recommendedAction: string; reasoning: string;
  aiCanFulfill: string[]; humanRequired: string[]; redFlags: string[];
  nextSteps: string[]; updatedAt: string;
}

interface OutreachDraft {
  id: string; opportunityId: string; opportunityTitle: string;
  company: string; fitScore: number; opportunityType: OpportunityType;
  location: string; subject: string; body: string; status: DraftStatus;
  channel: string; confidenceScore: number; createdByAgent: boolean;
  approvedByUserId: string | null; sentAt: string | null;
  callToAction: string; positioningAngle: string;
  recipientEmail?: string; recipientName?: string;
  createdAt: string; updatedAt: string;
}

interface AgentEvent {
  id: string; agentName: string; action: string;
  eventType: string; createdAt: string;
}

interface Summary {
  foundToday: number; qualified: number;
  outreachReady: number; pipelineValue: number;
}

interface DiscoveryRun {
  id: string; startedAt: string; completedAt: string | null;
  status: string; scanned: number; created: number;
  rejected: number; duplicates: number; notes: string;
}

interface DiscoveryStats {
  totalRuns: number; totalScanned: number;
  totalCreated: number; totalDuplicates: number; avgCreatedPerRun: number;
}

interface AcquisitionCycle {
  id: string; startedAt: string; completedAt: string | null;
  status: "completed" | "partial_failure" | "failed" | "running";
  scanned: number; discovered: number; duplicates: number;
  rejected: number; qualified: number; drafts: number;
  errors: string[]; notes: string;
}

interface Execution {
  id: string; opportunityId: string; opportunityTitle: string;
  opportunityCompany: string; draftId: string;
  recipientName: string; recipientEmail: string; subject: string;
  agentmailMessageId: string | null;
  status: "pending" | "sent" | "delivered" | "replied" | "failed";
  deliveryStatus: string; replyDetected: boolean;
  sentAt: string | null; deliveredAt: string | null; repliedAt: string | null;
  errorMessage: string | null; createdAt: string;
}

interface OrgSettings {
  sources: Record<string, boolean>;
  qualRules: Record<string, boolean>;
  outreachRules: Record<string, boolean>;
  agentPerms: Record<string, string>;
  discoveryFilters: Record<string, boolean | number>;
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

const DRAFT_STATUS_CONFIG: Record<DraftStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  draft:    { label: "Draft",    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: Pencil },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCheck },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", icon: ThumbsDown },
  sent:     { label: "Sent",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: Mail },
};

const TYPE_CONFIG: Record<OpportunityType, { label: string; color: string }> = {
  coaching:    { label: "Coaching",    color: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  consulting:  { label: "Consulting",  color: "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  partnership: { label: "Partnership", color: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  content:     { label: "Content",     color: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  training:    { label: "Training",    color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string }> = {
  low:      { label: "Low",      color: "text-emerald-600 dark:text-emerald-400" },
  medium:   { label: "Medium",   color: "text-amber-600 dark:text-amber-400" },
  high:     { label: "High",     color: "text-rose-500" },
  critical: { label: "Critical", color: "text-rose-700 dark:text-rose-400 font-bold" },
};

const REV_CONFIG: Record<RevPotential, { label: string; color: string }> = {
  low:    { label: "Low",    color: "text-muted-foreground" },
  medium: { label: "Medium", color: "text-amber-600 dark:text-amber-400" },
  high:   { label: "High",   color: "text-emerald-600 dark:text-emerald-400" },
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
  scan:    { icon: Search,    color: "bg-blue-500" },
  qualify: { icon: Brain,     color: "bg-violet-500" },
  draft:   { icon: Mail,      color: "bg-amber-500" },
  flag:    { icon: Flag,      color: "bg-rose-500" },
  info:    { icon: Activity,  color: "bg-slate-400" },
  update:  { icon: BarChart3, color: "bg-teal-500" },
};

const RUN_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  running:   { label: "Running",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed:    { label: "Failed",    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

const CYCLE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  running:         { label: "Running",          color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",       icon: Loader2 },
  completed:       { label: "Completed",        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCircle },
  partial_failure: { label: "Partial Failure",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",   icon: AlertTriangle },
  failed:          { label: "Failed",           color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",       icon: AlertCircle },
};

const EXEC_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pending",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  sent:      { label: "Sent",      color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  delivered: { label: "Delivered", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  replied:   { label: "Replied",   color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  failed:    { label: "Failed",    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fitScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 65) return "text-blue-600 dark:text-blue-400";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-rose-500";
}
function fitBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 65) return "bg-blue-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-rose-500";
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function StatusBadge({ s }: { s: OpportunityStatus }) {
  const cfg = STATUS_CONFIG[s] ?? { label: s, color: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}
function TypeBadge({ t }: { t: OpportunityType }) {
  const cfg = TYPE_CONFIG[t] ?? { label: t, color: "bg-muted text-muted-foreground" };
  return <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium ${cfg.color}`}>{cfg.label}</Badge>;
}
function DraftBadge({ s }: { s: DraftStatus }) {
  const cfg = DRAFT_STATUS_CONFIG[s] ?? DRAFT_STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <Badge className={`text-[10px] px-1.5 py-0 h-4 font-medium gap-1 ${cfg.color}`}>
      <Icon className="h-2.5 w-2.5" />{cfg.label}
    </Badge>
  );
}
function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}
function CardSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <Card key={i} className="border"><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
      ))}
    </div>
  );
}

// ─── Add Opportunity Modal ────────────────────────────────────────────────────

function AddOpportunityModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", company: "", source: "Manual", type: "coaching" as OpportunityType,
    location: "Remote" as "Remote" | "Hybrid" | "Local",
    estimatedValue: "", fitScore: "", notes: "",
  });
  const mutation = useMutation({
    mutationFn: (d: typeof form) =>
      apiRequest("POST", "/api/opportunity-acquisition/opportunities", {
        ...d, estimatedValue: Number(d.estimatedValue) || 0, fitScore: Number(d.fitScore) || 0,
      }),
    onSuccess: () => { toast({ title: "Opportunity added" }); onSaved(); onClose(); },
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
            <div className="space-y-1"><Label className="text-xs">Company</Label><Input className="h-8 text-xs" placeholder="Company name" value={form.company} onChange={e => set("company")(e.target.value)} data-testid="input-opp-company" /></div>
            <div className="space-y-1"><Label className="text-xs">Source</Label><Input className="h-8 text-xs" placeholder="LinkedIn, Indeed…" value={form.source} onChange={e => set("source")(e.target.value)} data-testid="input-opp-source" /></div>
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
            <div className="space-y-1"><Label className="text-xs">Est. Value ($)</Label><Input className="h-8 text-xs" type="number" placeholder="60000" value={form.estimatedValue} onChange={e => set("estimatedValue")(e.target.value)} data-testid="input-opp-value" /></div>
            <div className="space-y-1"><Label className="text-xs">Fit Score (optional)</Label><Input className="h-8 text-xs" type="number" placeholder="Auto-scored" value={form.fitScore} onChange={e => set("fitScore")(e.target.value)} data-testid="input-opp-fitscore" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Notes / Description</Label><Input className="h-8 text-xs" placeholder="Any additional context…" value={form.notes} onChange={e => set("notes")(e.target.value)} data-testid="input-opp-notes" /></div>
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

// ─── Edit Draft Modal ─────────────────────────────────────────────────────────

function EditDraftModal({ draft, onClose, onSaved }: { draft: OutreachDraft; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody]       = useState(draft.body);
  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/opportunity-acquisition/outreach-drafts/${draft.id}`, { subject, body }),
    onSuccess: () => { toast({ title: "Draft updated" }); onSaved(); onClose(); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-2xl border shadow-xl max-h-[90vh] flex flex-col">
        <CardHeader className="pb-2 pt-4 px-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Edit Outreach Draft</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{draft.opportunityTitle}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-edit"><X className="h-3.5 w-3.5" /></Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
          <div className="space-y-1"><Label className="text-xs">Subject</Label><Input className="h-8 text-xs" value={subject} onChange={e => setSubject(e.target.value)} data-testid="input-draft-subject" /></div>
          <div className="space-y-1"><Label className="text-xs">Body</Label><Textarea className="text-xs resize-none min-h-[300px]" value={body} onChange={e => setBody(e.target.value)} data-testid="input-draft-body" /></div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="flex-1 text-xs gap-1" disabled={mutation.isPending} onClick={() => mutation.mutate()} data-testid="button-save-draft">
              {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Save Changes
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
    { label: "Found Today",    value: data?.foundToday ?? 0,    icon: Search,     color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-900/20",       fmt: (v: number) => String(v) },
    { label: "Qualified",      value: data?.qualified ?? 0,     icon: Star,       color: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-50 dark:bg-violet-900/20",   fmt: (v: number) => String(v) },
    { label: "Outreach Ready", value: data?.outreachReady ?? 0, icon: Mail,       color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-900/20",     fmt: (v: number) => String(v) },
    { label: "Pipeline Value", value: data?.pipelineValue ?? 0, icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", fmt: (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}` },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <Card key={c.label} className="border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                {isLoading ? <Skeleton className="h-7 w-16 mt-1" /> : <p className="text-2xl font-bold mt-0.5" data-testid={`text-summary-${c.label.replace(/\s/g, "-").toLowerCase()}`}>{c.fmt(c.value)}</p>}
              </div>
              <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`h-4 w-4 ${c.color}`} /></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Discovery Tab ─────────────────────────────────────────────────────────────

function DiscoveryTab({
  opportunities, assessments, drafts, isLoading,
  onQualify, qualifyingId, onGenerateOutreach, generatingOutreachId,
}: {
  opportunities: Opportunity[]; assessments: Assessment[]; drafts: OutreachDraft[];
  isLoading: boolean; onQualify: (id: string) => void; qualifyingId: string | null;
  onGenerateOutreach: (id: string) => void; generatingOutreachId: string | null;
}) {
  const assessedIds = new Set(assessments.map(a => a.opportunityId));
  const draftedIds  = new Set(drafts.map(d => d.opportunityId));
  if (isLoading) return <CardSkeleton />;
  if (!opportunities.length) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
        <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="font-medium text-sm">No opportunities yet</p>
        <p className="text-xs mt-1">Run the Discovery Agent or add one manually to get started.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {opportunities.map(opp => {
        const hasAssessment = assessedIds.has(opp.id);
        const hasDraft      = draftedIds.has(opp.id);
        const isQualifying  = qualifyingId === opp.id;
        const isGenerating  = generatingOutreachId === opp.id;
        const canOutreach   = opp.fitScore >= 65 || hasAssessment;
        return (
          <Card key={opp.id} className="border shadow-sm hover:shadow-md transition-shadow" data-testid={`card-opportunity-${opp.id}`}>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold truncate" data-testid={`text-opp-title-${opp.id}`}>{opp.title}</h3>
                    <StatusBadge s={opp.status} />
                    <TypeBadge t={opp.type} />
                    {hasAssessment && <Badge className="text-[10px] px-1.5 py-0 h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><Brain className="h-2.5 w-2.5 mr-0.5" />Scored</Badge>}
                    {hasDraft      && <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><Mail className="h-2.5 w-2.5 mr-0.5" />Draft</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {opp.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{opp.company}</span>}
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{opp.location}</span>
                    <span className="flex items-center gap-1"><Search className="h-3 w-3" />{opp.source}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(opp.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Est. Value</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{opp.estimatedValue ? `$${(opp.estimatedValue / 1000).toFixed(0)}K` : "—"}</p>
                  </div>
                  {opp.fitScore > 0 && <div className="text-right"><p className="text-xs text-muted-foreground">Fit</p><p className={`text-sm font-bold ${fitScoreColor(opp.fitScore)}`}>{opp.fitScore}</p></div>}
                  <div className="flex flex-col gap-1.5">
                    <Button size="sm" variant={hasAssessment ? "outline" : "default"} className="gap-1.5 text-xs h-7" disabled={isQualifying} onClick={() => onQualify(opp.id)} data-testid={`button-qualify-${opp.id}`}>
                      {isQualifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                      {hasAssessment ? "Re-score" : "Qualify"}
                    </Button>
                    {canOutreach ? (
                      <Button size="sm" variant={hasDraft ? "outline" : "secondary"} className="gap-1.5 text-xs h-7" disabled={isGenerating} onClick={() => onGenerateOutreach(opp.id)} data-testid={`button-outreach-${opp.id}`}>
                        {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                        {hasDraft ? "Re-draft" : "Generate Outreach"}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-7 text-muted-foreground cursor-not-allowed" disabled data-testid={`button-outreach-disabled-${opp.id}`}>
                        <AlertCircle className="h-3 w-3" />Qualify First
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Last Acquisition Cycle Card ─────────────────────────────────────────────

function LastCycleCard({ cycle, isLoading }: { cycle?: AcquisitionCycle | null; isLoading: boolean }) {
  if (isLoading) return <Card className="border shadow-sm"><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>;
  if (!cycle) {
    return (
      <Card className="border border-dashed shadow-sm">
        <CardContent className="p-4 flex items-center gap-3 text-muted-foreground">
          <Bot className="h-5 w-5 shrink-0 opacity-40" />
          <div>
            <p className="text-sm font-medium">No acquisition cycle has run yet</p>
            <p className="text-xs mt-0.5">Click "Run Full Acquisition Cycle" to start the first complete agent workflow.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  const sc = CYCLE_STATUS_CONFIG[cycle.status] ?? CYCLE_STATUS_CONFIG.completed;
  const Icon = sc.icon;
  return (
    <Card className="border shadow-sm" data-testid="card-last-cycle">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded-lg ${cycle.status === "completed" ? "bg-emerald-50 dark:bg-emerald-900/20" : cycle.status === "partial_failure" ? "bg-amber-50 dark:bg-amber-900/20" : cycle.status === "failed" ? "bg-rose-50 dark:bg-rose-900/20" : "bg-blue-50 dark:bg-blue-900/20"}`}>
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold">Last Acquisition Cycle</p>
                <Badge className={`text-[10px] px-1.5 py-0 h-4 gap-1 ${sc.color}`}>
                  <Icon className={`h-2.5 w-2.5 ${cycle.status === "running" ? "animate-spin" : ""}`} />{sc.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Started {fmtTime(cycle.startedAt)}{cycle.completedAt ? ` · Completed ${fmtTime(cycle.completedAt)}` : " · In progress"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center shrink-0">
            {[
              { label: "Scanned",    value: cycle.scanned,    color: "text-foreground" },
              { label: "Discovered", value: cycle.discovered,  color: "text-blue-600 dark:text-blue-400" },
              { label: "Qualified",  value: cycle.qualified,   color: "text-violet-600 dark:text-violet-400" },
              { label: "Drafts",     value: cycle.drafts,      color: "text-amber-600 dark:text-amber-400" },
              { label: "Dupes",      value: cycle.duplicates,  color: "text-muted-foreground" },
              { label: "Errors",     value: cycle.errors.length, color: cycle.errors.length > 0 ? "text-rose-500" : "text-muted-foreground" },
            ].map(s => (
              <div key={s.label}>
                <p className={`text-lg font-bold ${s.color}`} data-testid={`text-cycle-${s.label.toLowerCase()}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        {cycle.errors.length > 0 && (
          <div className="mt-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-2.5 space-y-1">
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" />Errors ({cycle.errors.length})</p>
            {cycle.errors.slice(0, 3).map((e, i) => <p key={i} className="text-[11px] text-rose-600 dark:text-rose-300 font-mono">{e}</p>)}
            {cycle.errors.length > 3 && <p className="text-[11px] text-rose-500">+{cycle.errors.length - 3} more</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cycles Tab ───────────────────────────────────────────────────────────────

function CyclesTab({ cycles, isLoading, onRunCycle, isRunning }: {
  cycles: AcquisitionCycle[]; isLoading: boolean;
  onRunCycle: () => void; isRunning: boolean;
}) {
  if (isLoading) return <CardSkeleton />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Acquisition Cycle History</h3>
          <p className="text-xs text-muted-foreground">{cycles.length > 0 ? `${cycles.length} cycle${cycles.length !== 1 ? "s" : ""} recorded` : "No cycles run yet"}</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs shrink-0" disabled={isRunning} onClick={onRunCycle} data-testid="button-run-cycle-tab">
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Run Cycle Now
        </Button>
      </div>

      {cycles.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No cycles run yet</p>
          <p className="text-xs mt-1">The full acquisition cycle runs Discovery → Qualification → Outreach Drafts in one pass.</p>
        </div>
      ) : (
        <Card className="border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Started</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Completed</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Scanned</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Discovered</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Qualified</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Drafts</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Dupes</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Errors</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle, i) => {
                  const sc = CYCLE_STATUS_CONFIG[cycle.status] ?? CYCLE_STATUS_CONFIG.completed;
                  const CIcon = sc.icon;
                  return (
                    <tr key={cycle.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`} data-testid={`row-cycle-${cycle.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmtTime(cycle.startedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmtTime(cycle.completedAt)}</td>
                      <td className="px-4 py-2.5">
                        <Badge className={`text-[10px] px-1.5 py-0 h-4 gap-1 ${sc.color}`}>
                          <CIcon className={`h-2.5 w-2.5 ${cycle.status === "running" ? "animate-spin" : ""}`} />{sc.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">{cycle.scanned}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-blue-600 dark:text-blue-400">{cycle.discovered}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-violet-600 dark:text-violet-400">{cycle.qualified}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-amber-600 dark:text-amber-400">{cycle.drafts}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{cycle.duplicates}</td>
                      <td className="px-4 py-2.5 text-right">
                        {cycle.errors.length > 0
                          ? <span className="text-rose-500 font-semibold">{cycle.errors.length}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Send Confirm Dialog ──────────────────────────────────────────────────────

function SendConfirmDialog({
  draft, onClose, onSent,
}: { draft: OutreachDraft; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState(draft.recipientEmail ?? "");
  const [name,  setName]  = useState(draft.recipientName  ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/opportunity-acquisition/outreach-drafts/${draft.id}/send`, {
        recipientEmail: email.trim(),
        recipientName:  name.trim(),
      }),
    onSuccess: () => {
      toast({ title: "Outreach sent successfully." });
      onSent();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Send failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const canSend = email.trim().includes("@") && !mutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md border shadow-xl">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />Send Outreach
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-send-dialog">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="rounded-md bg-muted/50 border p-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Draft Preview</p>
            <p className="text-xs font-medium">{draft.subject}</p>
            <p className="text-[11px] text-muted-foreground">{draft.company || draft.opportunityTitle}</p>
          </div>

          <p className="text-xs text-muted-foreground">
            This will send the approved outreach draft to the selected opportunity via AgentMail.
          </p>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Recipient Email *</Label>
              <Input
                className="h-8 text-xs"
                type="email"
                placeholder="contact@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="input-recipient-email"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Recipient Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                className="h-8 text-xs"
                placeholder="John Smith"
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="input-recipient-name"
              />
            </div>
          </div>

          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 flex items-start gap-2">
            <Shield className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              You are about to send a real email via AgentMail. This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose} data-testid="button-cancel-send">
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 text-xs gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              disabled={!canSend}
              onClick={() => mutation.mutate()}
              data-testid="button-confirm-send"
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Executions Tab ───────────────────────────────────────────────────────────

function ExecutionsTab({ executions, isLoading }: { executions: Execution[]; isLoading: boolean }) {
  const byStat = (s: string) => executions.filter(e => e.status === s).length;
  const cards = [
    { label: "Sent",      value: byStat("sent") + byStat("delivered") + byStat("replied"), icon: Mail,       color: "text-teal-600 dark:text-teal-400",         bg: "bg-teal-50 dark:bg-teal-900/20" },
    { label: "Delivered", value: byStat("delivered") + byStat("replied"),                  icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400",  bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: "Replies",   value: executions.filter(e => e.replyDetected).length,           icon: Radio,       color: "text-violet-600 dark:text-violet-400",    bg: "bg-violet-50 dark:bg-violet-900/20" },
    { label: "Failed",    value: byStat("failed"),                                          icon: AlertCircle, color: "text-rose-500",                           bg: "bg-rose-50 dark:bg-rose-900/20" },
  ];

  if (isLoading) return <CardSkeleton />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => (
          <Card key={c.label} className="border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                  <p className="text-2xl font-bold mt-0.5" data-testid={`text-exec-${c.label.toLowerCase()}`}>{c.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`h-4 w-4 ${c.color}`} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {executions.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No outreach has been sent yet</p>
          <p className="text-xs mt-1">Approve a draft in the Outreach tab, then click "Send Now" to execute.</p>
        </div>
      ) : (
        <Card className="border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Sent At</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Company</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Opportunity</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Recipient</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Delivery</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Reply</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec, i) => {
                  const sc = EXEC_STATUS_CONFIG[exec.status] ?? EXEC_STATUS_CONFIG.pending;
                  return (
                    <tr key={exec.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`} data-testid={`row-exec-${exec.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmtTime(exec.sentAt)}</td>
                      <td className="px-4 py-2.5 font-medium">{exec.opportunityCompany || "—"}</td>
                      <td className="px-4 py-2.5 max-w-[160px]">
                        <p className="truncate">{exec.opportunityTitle}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{exec.recipientName || "—"}</p>
                        <p className="text-muted-foreground font-mono text-[10px]">{exec.recipientEmail}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={`text-[10px] px-1.5 py-0 h-4 ${sc.color}`}>{sc.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{exec.deliveryStatus}</td>
                      <td className="px-4 py-2.5">
                        {exec.replyDetected
                          ? <Badge className="text-[10px] px-1.5 py-0 h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Yes</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Discovery Runs Tab ───────────────────────────────────────────────────────

function DiscoveryRunsTab({
  runs, stats, runsLoading, statsLoading, onRunDiscovery, isRunning,
}: {
  runs: DiscoveryRun[]; stats?: DiscoveryStats;
  runsLoading: boolean; statsLoading: boolean;
  onRunDiscovery: () => void; isRunning: boolean;
}) {
  const statCards = [
    { label: "Total Runs",     value: stats?.totalRuns ?? 0,      icon: PlayCircle, color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-900/20" },
    { label: "Total Scanned",  value: stats?.totalScanned ?? 0,   icon: Search,     color: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-50 dark:bg-violet-900/20" },
    { label: "Total Created",  value: stats?.totalCreated ?? 0,   icon: Database,   color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: "Dupes Skipped",  value: stats?.totalDuplicates ?? 0,icon: Hash,       color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-900/20" },
  ];

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map(c => (
          <Card key={c.label} className="border shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                  {statsLoading ? <Skeleton className="h-7 w-12 mt-1" /> : <p className="text-2xl font-bold mt-0.5" data-testid={`text-stat-${c.label.replace(/\s/g, "-").toLowerCase()}`}>{c.value}</p>}
                </div>
                <div className={`p-2 rounded-lg ${c.bg}`}><c.icon className={`h-4 w-4 ${c.color}`} /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Header + run button */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Discovery History</h3>
          <p className="text-xs text-muted-foreground">
            {stats ? `Avg ${stats.avgCreatedPerRun} opportunities created per run` : "Run the agent to see history"}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs shrink-0" disabled={isRunning} onClick={onRunDiscovery} data-testid="button-run-discovery-tab">
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Run Discovery Now
        </Button>
      </div>

      {/* History table */}
      {runsLoading ? (
        <CardSkeleton />
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <PlayCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No discovery runs yet</p>
          <p className="text-xs mt-1">Click "Run Discovery Now" to kick off the first agent run.</p>
        </div>
      ) : (
        <Card className="border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Started</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Completed</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Scanned</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Created</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Dupes</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => {
                  const sc = RUN_STATUS_CONFIG[run.status] ?? RUN_STATUS_CONFIG.completed;
                  return (
                    <tr key={run.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`} data-testid={`row-run-${run.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground">{fmtTime(run.startedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{fmtTime(run.completedAt)}</td>
                      <td className="px-4 py-2.5">
                        <Badge className={`text-[10px] px-1.5 py-0 h-4 ${sc.color}`}>{sc.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{run.scanned}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">{run.created}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-400">{run.duplicates}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{run.rejected}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Assessment Card ──────────────────────────────────────────────────────────

function AssessmentCard({ a }: { a: Assessment }) {
  const risk = RISK_CONFIG[a.riskLevel] ?? RISK_CONFIG.medium;
  const rev  = REV_CONFIG[a.revenuePotential] ?? REV_CONFIG.medium;
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{a.opportunityTitle}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Scored {timeAgo(a.updatedAt)} · {a.recommendedAction}</p>
          </div>
          <div className={`text-2xl font-bold ${fitScoreColor(a.fitScore)}`} data-testid={`text-fit-score-${a.opportunityId}`}>{a.fitScore}</div>
        </div>
        <div className="mt-3 space-y-2">
          <ScoreBar label="AI Fulfillment"    value={a.aiFulfillmentScore}    color={fitBarColor(a.aiFulfillmentScore)} />
          <ScoreBar label="Revenue Potential" value={a.revenuePotentialScore} color="bg-emerald-500" />
          <ScoreBar label="Confidence"        value={a.confidenceScore}       color="bg-blue-500" />
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Risk Score</span>
              <span className={`font-semibold ${risk.color}`}>{risk.label} ({a.riskScore})</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.min(a.riskScore, 100)}%` }} />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {a.reasoning && <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground italic leading-relaxed">{a.reasoning}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2"><Bot className="h-3.5 w-3.5 text-blue-500" /><h4 className="text-xs font-semibold text-blue-700 dark:text-blue-300">AI Can Fulfill</h4></div>
            <ul className="space-y-1">{a.aiCanFulfill.map(item => <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground"><CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />{item}</li>)}</ul>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-amber-500" /><h4 className="text-xs font-semibold text-amber-700 dark:text-amber-300">Human Required</h4></div>
            <ul className="space-y-1">{a.humanRequired.map(item => <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />{item}</li>)}</ul>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {a.redFlags.length > 0 && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-800 p-3 space-y-1.5">
              <div className="flex items-center gap-2"><AlertCircle className="h-3.5 w-3.5 text-rose-500" /><h4 className="text-xs font-semibold text-rose-700 dark:text-rose-400">Red Flags</h4></div>
              <ul className="space-y-1">{a.redFlags.map(f => <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground"><Flag className="h-3 w-3 text-rose-400 shrink-0 mt-0.5" />{f}</li>)}</ul>
            </div>
          )}
          {a.nextSteps.length > 0 && (
            <div className="rounded-lg border p-3 space-y-1.5">
              <div className="flex items-center gap-2"><ThumbsUp className="h-3.5 w-3.5 text-teal-500" /><h4 className="text-xs font-semibold text-teal-700 dark:text-teal-300">Next Steps</h4></div>
              <ul className="space-y-1">{a.nextSteps.map((s, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground"><ChevronRight className="h-3 w-3 text-teal-400 shrink-0 mt-0.5" />{s}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs border-t">
          <span className="text-muted-foreground">Revenue: <span className={`font-semibold ${rev.color}`}>{rev.label}</span></span>
          <span className="text-muted-foreground">Risk: <span className={`font-semibold ${risk.color}`}>{risk.label}</span></span>
          <span className="text-muted-foreground">Confidence: <span className="font-semibold">{a.confidenceScore}/100</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Qualification Tab ────────────────────────────────────────────────────────

function QualificationTab({ assessments, isLoading, onQualifyAll, qualifyAllPending }: {
  assessments: Assessment[]; isLoading: boolean;
  onQualifyAll: () => void; qualifyAllPending: boolean;
}) {
  if (isLoading) return <CardSkeleton />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Qualification Assessments</h3>
          <p className="text-xs text-muted-foreground">{assessments.length > 0 ? `${assessments.length} assessment${assessments.length !== 1 ? "s" : ""} generated` : "No assessments yet"}</p>
        </div>
        <Button size="sm" className="text-xs gap-1.5 shrink-0" onClick={onQualifyAll} disabled={qualifyAllPending} data-testid="button-qualify-all">
          {qualifyAllPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}Qualify All New
        </Button>
      </div>
      {assessments.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No assessments yet</p>
          <p className="text-xs mt-1">Click "Qualify" on any opportunity in the Discovery tab, or use "Qualify All New" above.</p>
        </div>
      ) : (
        <div className="space-y-4">{assessments.map(a => <AssessmentCard key={a.id} a={a} />)}</div>
      )}
    </div>
  );
}

// ─── Outreach Tab ─────────────────────────────────────────────────────────────

function OutreachTab({ drafts, isLoading, onStatusChange, statusChangingId, onEdit, onSend }: {
  drafts: OutreachDraft[]; isLoading: boolean;
  onStatusChange: (id: string, status: DraftStatus) => void;
  statusChangingId: string | null; onEdit: (draft: OutreachDraft) => void;
  onSend: (draft: OutreachDraft) => void;
}) {
  if (isLoading) return <CardSkeleton />;
  const byStatus = (s: DraftStatus) => drafts.filter(d => d.status === s);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Outreach Drafts</h3>
          <p className="text-xs text-muted-foreground">{drafts.length > 0 ? `${drafts.length} draft${drafts.length !== 1 ? "s" : ""} · ${byStatus("approved").length} approved · ${byStatus("sent").length} sent · ${byStatus("rejected").length} rejected` : "No drafts yet"}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className="text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 gap-1"><Pencil className="h-2.5 w-2.5" />{byStatus("draft").length} draft</Badge>
          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1"><CheckCheck className="h-2.5 w-2.5" />{byStatus("approved").length} approved</Badge>
          <Badge className="text-[10px] bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 gap-1"><Mail className="h-2.5 w-2.5" />{byStatus("sent").length} sent</Badge>
        </div>
      </div>
      {drafts.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No outreach drafts yet</p>
          <p className="text-xs mt-1">Go to Discovery and click "Generate Outreach" on any qualified opportunity.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map(draft => {
            const isChanging = statusChangingId === draft.id;
            const isSent     = draft.status === "sent";
            const isApproved = draft.status === "approved";
            const isRejected = draft.status === "rejected";
            return (
              <Card key={draft.id} className={`border shadow-sm ${isApproved ? "border-emerald-200 dark:border-emerald-800" : isRejected ? "border-rose-200 dark:border-rose-800 opacity-70" : isSent ? "border-teal-200 dark:border-teal-800" : ""}`} data-testid={`card-draft-${draft.id}`}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><DraftBadge s={draft.status} /><TypeBadge t={draft.opportunityType} /></div>
                      <h3 className="text-sm font-semibold mt-1.5" data-testid={`text-draft-subject-${draft.id}`}>{draft.subject}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{draft.company || draft.opportunityTitle}</span>
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{draft.location}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(draft.updatedAt)}</span>
                        {isSent && draft.sentAt && <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400 font-medium"><Mail className="h-3 w-3" />Sent {timeAgo(draft.sentAt)}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">Confidence</p>
                      <p className={`text-xl font-bold ${fitScoreColor(draft.confidenceScore)}`} data-testid={`text-conf-score-${draft.id}`}>{draft.confidenceScore}</p>
                      {draft.fitScore > 0 && <p className="text-[10px] text-muted-foreground">Fit: {draft.fitScore}</p>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Eye className="h-3 w-3" />Body Preview</div>
                    <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed line-clamp-6" data-testid={`text-draft-body-${draft.id}`}>{draft.body}</pre>
                  </div>
                  {draft.positioningAngle && (
                    <div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-900/20 p-2.5">
                      <Zap className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <div><p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide">Positioning</p><p className="text-xs text-blue-700 dark:text-blue-300">{draft.positioningAngle}</p></div>
                    </div>
                  )}
                  {draft.callToAction && (
                    <div className="flex items-start gap-2 rounded-md bg-teal-50 dark:bg-teal-900/20 p-2.5">
                      <ChevronRight className="h-3.5 w-3.5 text-teal-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-teal-700 dark:text-teal-300 italic">{draft.callToAction}</p>
                    </div>
                  )}
                  {/* Action buttons — vary by status */}
                  {!isSent && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
                      {!isRejected && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" disabled={isChanging} onClick={() => onEdit(draft)} data-testid={`button-edit-draft-${draft.id}`}>
                          <Pencil className="h-3 w-3" />Edit
                        </Button>
                      )}
                      {!isApproved && !isRejected && (
                        <Button size="sm" className="gap-1.5 text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={isChanging} onClick={() => onStatusChange(draft.id, "approved")} data-testid={`button-approve-draft-${draft.id}`}>
                          {isChanging ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}Approve
                        </Button>
                      )}
                      {isApproved && (
                        <Button size="sm" className="gap-1.5 text-xs h-7 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => onSend(draft)} data-testid={`button-send-draft-${draft.id}`}>
                          <Mail className="h-3 w-3" />Send Now
                        </Button>
                      )}
                      {!isRejected && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20" disabled={isChanging} onClick={() => onStatusChange(draft.id, "rejected")} data-testid={`button-reject-draft-${draft.id}`}>
                          {isChanging ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}Reject
                        </Button>
                      )}
                    </div>
                  )}
                  {isSent && (
                    <div className="flex items-center gap-2 pt-1 border-t">
                      <CheckCircle className="h-3.5 w-3.5 text-teal-500" />
                      <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">Outreach sent via AgentMail</span>
                      {draft.recipientEmail && <span className="text-xs text-muted-foreground ml-1">→ {draft.recipientEmail}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
                    {opp.estimatedValue > 0 && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">${(opp.estimatedValue / 1000).toFixed(0)}K</p>}
                  </div>
                ))}
                {items.length === 0 && <div className="flex items-center justify-center h-16 text-[11px] text-muted-foreground">Empty</div>}
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
        <p className="text-xs mt-1">Run the Discovery Agent to generate events.</p>
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
                  <div><span className="text-xs font-semibold">{event.agentName}</span><span className="text-xs text-muted-foreground"> {event.action}</span></div>
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

const DEFAULT_SETTINGS: OrgSettings = {
  sources:          { linkedin: true, indeed: true, teamworkOnline: true, higherEdJobs: true, ncaaCareers: true, directReferrals: true },
  qualRules:        { minFitScore70: true, remoteOnly: false, revenueMin40k: true, autoQualifyHigh: false },
  outreachRules:    { requireHumanApproval: true, autoSendHighConf: false, ccFounder: true },
  agentPerms:       { discovery: "scan_only", qualification: "score_qualify", outreach: "draft_only", executive: "flag_escalate" },
  discoveryFilters: { remoteCoaching: true, programming: true, wellness: true, consulting: true, partnerships: true, minScore: 65 },
};

function SettingsTab({ settings: serverSettings, isLoading }: { settings?: OrgSettings | null; isLoading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [local, setLocal] = useState<OrgSettings | null>(null);
  const effective: OrgSettings = local ?? serverSettings ?? DEFAULT_SETTINGS;

  const saveSettings = useMutation({
    mutationFn: (data: OrgSettings) => apiRequest("PATCH", "/api/opportunity-acquisition/settings", data),
    onSuccess: () => { toast({ title: "Settings saved" }); qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/settings"] }); },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const toggle = (section: keyof OrgSettings, key: string) => () => {
    setLocal(prev => {
      const base = prev ?? effective;
      const s = base[section] as Record<string, boolean | number>;
      return { ...base, [section]: { ...s, [key]: !s[key] } };
    });
  };
  const setNum = (section: keyof OrgSettings, key: string, val: number) => {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, [section]: { ...(base[section] as Record<string, any>), [key]: val } };
    });
  };
  const setPerm = (key: string, val: string) => {
    setLocal(prev => {
      const base = prev ?? effective;
      return { ...base, agentPerms: { ...base.agentPerms, [key]: val } };
    });
  };

  if (isLoading) return <CardSkeleton />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Opportunity Sources */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Radio className="h-4 w-4 text-muted-foreground" />Opportunity Sources</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "linkedin",       label: "LinkedIn Jobs",    desc: "Scan LinkedIn for coaching and consulting roles" },
              { key: "indeed",         label: "Indeed",           desc: "Scan Indeed job board" },
              { key: "teamworkOnline", label: "TeamWork Online",  desc: "Sports and athletics job board" },
              { key: "higherEdJobs",   label: "HigherEdJobs",     desc: "Higher education performance roles" },
              { key: "ncaaCareers",    label: "NCAA Careers",     desc: "NCAA member institution listings" },
              { key: "directReferrals",label: "Direct Referrals", desc: "Manually added opportunities" },
            ].map(s => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-medium">{s.label}</p><p className="text-[11px] text-muted-foreground">{s.desc}</p></div>
                <Switch checked={!!effective.sources[s.key]} onCheckedChange={toggle("sources", s.key)} data-testid={`toggle-source-${s.key}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Opportunity Types Filter */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Filter className="h-4 w-4 text-muted-foreground" />Opportunity Types</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "remoteCoaching", label: "Remote Coaching",  desc: "Online athlete coaching engagements" },
              { key: "programming",    label: "Programming",      desc: "Program design and delivery roles" },
              { key: "wellness",       label: "Wellness",         desc: "Corporate and personal wellness" },
              { key: "consulting",     label: "Consulting",       desc: "Performance consulting contracts" },
              { key: "partnerships",   label: "Partnerships",     desc: "Platform and organization partnerships" },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-medium">{f.label}</p><p className="text-[11px] text-muted-foreground">{f.desc}</p></div>
                <Switch checked={!!effective.discoveryFilters[f.key]} onCheckedChange={toggle("discoveryFilters", f.key)} data-testid={`toggle-type-${f.key}`} />
              </div>
            ))}
            {/* Min score */}
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-medium">Minimum Discovery Score</p><p className="text-[11px] text-muted-foreground">Reject opportunities below this fit threshold</p></div>
                <span className="text-sm font-bold text-primary">{effective.discoveryFilters.minScore ?? 65}</span>
              </div>
              <Input
                type="number"
                min={0}
                max={100}
                className="h-8 text-xs w-24"
                value={String(effective.discoveryFilters.minScore ?? 65)}
                onChange={e => setNum("discoveryFilters", "minScore", Number(e.target.value))}
                data-testid="input-min-score"
              />
            </div>
          </CardContent>
        </Card>

        {/* Qualification Rules */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Star className="h-4 w-4 text-muted-foreground" />Qualification Rules</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              { key: "minFitScore70",   label: "Minimum Fit Score 70+",    desc: "Discard opportunities below threshold" },
              { key: "remoteOnly",      label: "Remote-Only Filter",       desc: "Only qualify remote opportunities" },
              { key: "revenueMin40k",   label: "Revenue Minimum $40K",     desc: "Skip low-value opportunities" },
              { key: "autoQualifyHigh", label: "Auto-Qualify High Scores", desc: "Auto-move 90+ scores to Outreach Ready" },
            ].map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-medium">{r.label}</p><p className="text-[11px] text-muted-foreground">{r.desc}</p></div>
                <Switch checked={!!effective.qualRules[r.key]} onCheckedChange={toggle("qualRules", r.key)} data-testid={`toggle-qual-${r.key}`} />
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
              { key: "requireHumanApproval", label: "Require Human Approval",    desc: "All outreach must be approved before send" },
              { key: "autoSendHighConf",     label: "Auto-Send High Confidence", desc: "Auto-send when fit score ≥ 95" },
              { key: "ccFounder",            label: "CC Founder on Outreach",    desc: "Add founder to every outreach email" },
            ].map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-medium">{r.label}</p><p className="text-[11px] text-muted-foreground">{r.desc}</p></div>
                <Switch checked={!!effective.outreachRules[r.key]} onCheckedChange={toggle("outreachRules", r.key)} data-testid={`toggle-outreach-${r.key}`} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Agent Permissions */}
        <Card className="border shadow-sm md:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Bot className="h-4 w-4 text-muted-foreground" />Agent Permissions</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "discovery",     label: "Discovery Agent" },
                { key: "qualification", label: "Qualification Agent" },
                { key: "outreach",      label: "Outreach Agent" },
                { key: "executive",     label: "Executive Agent" },
              ].map(a => (
                <div key={a.key} className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium">{a.label}</p>
                  <Select value={effective.agentPerms[a.key] ?? "disabled"} onValueChange={v => setPerm(a.key, v)}>
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
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="flex justify-end">
        <Button size="sm" className="text-xs gap-1.5" disabled={!local || saveSettings.isPending} onClick={() => saveSettings.mutate(effective)} data-testid="button-save-settings">
          {saveSettings.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Save Settings
        </Button>
      </div>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function AdminOpportunityAcquisitionPage() {
  const [activeTab, setActiveTab]                       = useState("discovery");
  const [showAddModal, setShowAddModal]                 = useState(false);
  const [editingDraft, setEditingDraft]                 = useState<OutreachDraft | null>(null);
  const [sendingDraft, setSendingDraft]                 = useState<OutreachDraft | null>(null);
  const [qualifyingId, setQualifyingId]                 = useState<string | null>(null);
  const [generatingOutreachId, setGeneratingOutreachId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId]         = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  function invalidateAll() {
    ["opportunities", "summary", "assessments", "events", "outreach-drafts", "outreach-executions"].forEach(k =>
      qc.invalidateQueries({ queryKey: [`/api/opportunity-acquisition/${k}`] })
    );
    qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/discovery/history"] });
    qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/discovery/stats"] });
    qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/cycles"] });
    qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/cycles/latest"] });
  }

  const summaryQ     = useQuery<Summary>({ queryKey: ["/api/opportunity-acquisition/summary"] });
  const oppsQ        = useQuery<Opportunity[]>({ queryKey: ["/api/opportunity-acquisition/opportunities"] });
  const eventsQ      = useQuery<AgentEvent[]>({ queryKey: ["/api/opportunity-acquisition/events"] });
  const settingsQ    = useQuery<OrgSettings | null>({ queryKey: ["/api/opportunity-acquisition/settings"] });
  const assessQ      = useQuery<Assessment[]>({ queryKey: ["/api/opportunity-acquisition/assessments"] });
  const draftsQ      = useQuery<OutreachDraft[]>({ queryKey: ["/api/opportunity-acquisition/outreach-drafts"] });
  const runsQ        = useQuery<DiscoveryRun[]>({ queryKey: ["/api/opportunity-acquisition/discovery/history"] });
  const statsQ       = useQuery<DiscoveryStats>({ queryKey: ["/api/opportunity-acquisition/discovery/stats"] });
  const cyclesQ      = useQuery<AcquisitionCycle[]>({ queryKey: ["/api/opportunity-acquisition/cycles"] });
  const latestCycleQ = useQuery<AcquisitionCycle | null>({ queryKey: ["/api/opportunity-acquisition/cycles/latest"] });
  const executionsQ  = useQuery<Execution[]>({ queryKey: ["/api/opportunity-acquisition/outreach-executions"] });

  const runCycle = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunity-acquisition/run-cycle", {}),
    onSuccess: (data: any) => {
      toast({
        title: `Cycle ${data?.status === "completed" ? "complete" : data?.status === "partial_failure" ? "completed with some errors" : "failed"}`,
        description: `${data?.discovered ?? 0} discovered · ${data?.qualified ?? 0} qualified · ${data?.draftsCreated ?? 0} drafts created`,
      });
      invalidateAll();
      setActiveTab("cycles");
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Unknown error";
      toast({ title: msg.includes("already running") ? "Cycle already running" : "Cycle failed", description: msg, variant: "destructive" });
    },
  });

  const runDiscovery = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunity-acquisition/discovery/run", {}),
    onSuccess: (data: any) => {
      const created = data?.created ?? 0;
      toast({ title: `Discovery complete`, description: `Found ${created} new opportunit${created === 1 ? "y" : "ies"}.` });
      invalidateAll();
      setActiveTab("discovery-runs");
    },
    onError: () => toast({ title: "Discovery failed", variant: "destructive" }),
  });

  const qualifyOne = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/opportunity-acquisition/opportunities/${id}/qualify`, {}),
    onMutate: id => setQualifyingId(id),
    onSuccess: () => {
      toast({ title: "Qualification complete", description: "Fit score updated." });
      setQualifyingId(null);
      invalidateAll();
      setActiveTab("qualification");
    },
    onError: () => { setQualifyingId(null); toast({ title: "Qualification failed", variant: "destructive" }); },
  });

  const qualifyAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunity-acquisition/qualify-all", {}),
    onSuccess: (data: any) => {
      toast({ title: `Qualified ${data?.qualified ?? 0} opportunities` });
      invalidateAll();
    },
    onError: () => toast({ title: "Qualify All failed", variant: "destructive" }),
  });

  const generateOutreach = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/opportunity-acquisition/opportunities/${id}/generate-outreach`, {}),
    onMutate: id => setGeneratingOutreachId(id),
    onSuccess: () => {
      toast({ title: "Outreach draft generated", description: "Review it in the Outreach tab." });
      setGeneratingOutreachId(null);
      invalidateAll();
      setActiveTab("outreach");
    },
    onError: (e: any) => {
      setGeneratingOutreachId(null);
      toast({ title: "Draft generation failed", description: e?.message ?? "Try again", variant: "destructive" });
    },
  });

  const changeDraftStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DraftStatus }) =>
      apiRequest("PATCH", `/api/opportunity-acquisition/outreach-drafts/${id}`, { status }),
    onMutate: ({ id }) => setStatusChangingId(id),
    onSuccess: (_data, { status }) => {
      setStatusChangingId(null);
      toast({ title: status === "approved" ? "Draft approved" : "Draft rejected" });
      qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/outreach-drafts"] });
      qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/events"] });
    },
    onError: () => { setStatusChangingId(null); toast({ title: "Failed to update draft", variant: "destructive" }); },
  });

  const opportunities: Opportunity[]  = oppsQ.data ?? [];
  const events: AgentEvent[]          = eventsQ.data ?? [];
  const assessments: Assessment[]     = assessQ.data ?? [];
  const drafts: OutreachDraft[]       = draftsQ.data ?? [];
  const runs: DiscoveryRun[]          = runsQ.data ?? [];
  const executions: Execution[]       = executionsQ.data ?? [];
  const pendingDrafts                 = drafts.filter(d => d.status === "draft").length;
  const sentCount                     = executions.filter(e => e.status === "sent" || e.status === "delivered" || e.status === "replied").length;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {showAddModal && <AddOpportunityModal onClose={() => setShowAddModal(false)} onSaved={invalidateAll} />}
      {editingDraft && (
        <EditDraftModal
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/outreach-drafts"] });
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/events"] });
          }}
        />
      )}
      {sendingDraft && (
        <SendConfirmDialog
          draft={sendingDraft}
          onClose={() => setSendingDraft(null)}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/outreach-drafts"] });
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/outreach-executions"] });
            qc.invalidateQueries({ queryKey: ["/api/opportunity-acquisition/events"] });
            setActiveTab("executions");
          }}
        />
      )}

      <div className="flex-1 container max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-0.5" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-bold">Opportunity Acquisition OS</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">AI agents discover, qualify, and draft outreach for real revenue opportunities.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowAddModal(true)} data-testid="button-add-opportunity">
              <Plus className="h-3.5 w-3.5" />Add Manually
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled={runDiscovery.isPending} onClick={() => runDiscovery.mutate()} data-testid="button-run-discovery">
              {runDiscovery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Discovery Only
            </Button>
            <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90" disabled={runCycle.isPending || runDiscovery.isPending} onClick={() => runCycle.mutate()} data-testid="button-run-full-cycle">
              {runCycle.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run Full Acquisition Cycle
            </Button>
          </div>
        </div>

        <SummaryCards data={summaryQ.data} isLoading={summaryQ.isLoading} />

        <LastCycleCard cycle={latestCycleQ.data} isLoading={latestCycleQ.isLoading} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full sm:w-auto flex overflow-x-auto" data-testid="tabs-main">
            <TabsTrigger value="discovery"       className="text-xs gap-1" data-testid="tab-discovery"><Search className="h-3 w-3" />Discovery</TabsTrigger>
            <TabsTrigger value="discovery-runs"  className="text-xs gap-1" data-testid="tab-discovery-runs">
              <Database className="h-3 w-3" />Discovery Runs
              {(statsQ.data?.totalRuns ?? 0) > 0 && <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-blue-500 text-white">{statsQ.data?.totalRuns}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="qualification"   className="text-xs gap-1" data-testid="tab-qualification"><Brain className="h-3 w-3" />Qualification</TabsTrigger>
            <TabsTrigger value="outreach"        className="text-xs gap-1" data-testid="tab-outreach">
              <Mail className="h-3 w-3" />Outreach
              {pendingDrafts > 0 && <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-amber-500 text-white">{pendingDrafts}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="pipeline"        className="text-xs gap-1" data-testid="tab-pipeline"><TrendingUp className="h-3 w-3" />Pipeline</TabsTrigger>
            <TabsTrigger value="cycles"          className="text-xs gap-1" data-testid="tab-cycles">
              <Zap className="h-3 w-3" />Cycles
              {(cyclesQ.data?.length ?? 0) > 0 && <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-violet-500 text-white">{cyclesQ.data!.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="executions"      className="text-xs gap-1" data-testid="tab-executions">
              <Mail className="h-3 w-3" />Executions
              {sentCount > 0 && <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-teal-500 text-white">{sentCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="agent-activity"  className="text-xs gap-1" data-testid="tab-agent-activity"><Activity className="h-3 w-3" />Agent Activity</TabsTrigger>
            <TabsTrigger value="settings"        className="text-xs gap-1" data-testid="tab-settings"><Settings className="h-3 w-3" />Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="discovery" className="mt-4">
            <DiscoveryTab
              opportunities={opportunities} assessments={assessments} drafts={drafts}
              isLoading={oppsQ.isLoading}
              onQualify={id => qualifyOne.mutate(id)} qualifyingId={qualifyingId}
              onGenerateOutreach={id => generateOutreach.mutate(id)} generatingOutreachId={generatingOutreachId}
            />
          </TabsContent>

          <TabsContent value="discovery-runs" className="mt-4">
            <DiscoveryRunsTab
              runs={runs} stats={statsQ.data}
              runsLoading={runsQ.isLoading} statsLoading={statsQ.isLoading}
              onRunDiscovery={() => runDiscovery.mutate()} isRunning={runDiscovery.isPending}
            />
          </TabsContent>

          <TabsContent value="qualification" className="mt-4">
            <QualificationTab
              assessments={assessments} isLoading={assessQ.isLoading}
              onQualifyAll={() => qualifyAll.mutate()} qualifyAllPending={qualifyAll.isPending}
            />
          </TabsContent>

          <TabsContent value="outreach" className="mt-4">
            <OutreachTab
              drafts={drafts} isLoading={draftsQ.isLoading}
              onStatusChange={(id, status) => changeDraftStatus.mutate({ id, status })}
              statusChangingId={statusChangingId}
              onEdit={draft => setEditingDraft(draft)}
              onSend={draft => setSendingDraft(draft)}
            />
          </TabsContent>

          <TabsContent value="pipeline" className="mt-4">
            <PipelineTab opportunities={opportunities} />
          </TabsContent>

          <TabsContent value="cycles" className="mt-4">
            <CyclesTab
              cycles={cyclesQ.data ?? []} isLoading={cyclesQ.isLoading}
              onRunCycle={() => runCycle.mutate()} isRunning={runCycle.isPending}
            />
          </TabsContent>

          <TabsContent value="executions" className="mt-4">
            <ExecutionsTab executions={executions} isLoading={executionsQ.isLoading} />
          </TabsContent>

          <TabsContent value="agent-activity" className="mt-4">
            <AgentActivityTab events={events} isLoading={eventsQ.isLoading} />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <SettingsTab settings={settingsQ.data} isLoading={settingsQ.isLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
