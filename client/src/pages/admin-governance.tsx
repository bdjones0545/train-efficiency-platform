import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Shield, ChevronRight, Layers, RefreshCw, Plus,
  X, CheckCircle, AlertTriangle, BarChart3, TrendingUp,
  Clock, Star, Activity, Users, CheckSquare, XCircle,
  ChevronDown, ChevronUp, FileText, Gavel, Scale, Building2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Decision = {
  id: string; title: string; decisionType: string; status: string; proposedBy: string;
  reviewedBy: string | null; approvedBy: string | null; priority: string; riskLevel: string;
  expectedImpact: string; actualImpact: string | null; confidenceScore: number;
  roi: string | null; successScore: number | null; createdAt: string;
  implementedAt: string | null; closedAt: string | null; lessonsLearned: string | null;
};
type Overview = { totalDecisions: number; approvalQueue: number; activeDecisions: number; highRiskReviews: number; avgApprovalTimeDays: number; decisionSuccessRate: number; governanceComplianceScore: number; totalPolicies: number; generatedAt: string };
type Policy = { id: string; title: string; category: string; description: string; approvalRequired: string; riskThreshold: string; active: boolean; version: string };
type Review = { id: string; decisionId: string; reviewer: string; recommendation: string; rationale: string; riskScore: number; createdAt: string };
type RiskDecision = Decision & { reviews: Review[] };
type RiskData = { openDecisions: RiskDecision[]; byRisk: Record<string, number>; reviews: Review[]; generatedAt: string };
type AnalyticsData = { totalDecisions: number; byStatus: Record<string, number>; byType: Record<string, number>; byRisk: Record<string, number>; avgSuccessScore: number; governanceComplianceScore: number; avgApprovalTimeDays: number; topRoiDecisions: { id: string; title: string; roi: string; successScore: number | null; decisionType: string }[]; highImpactDecisions: { id: string; title: string; successScore: number | null; roi: string | null; decisionType: string }[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = { low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", high: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", critical: "bg-rose-200 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" };
const PRIORITY_COLORS: Record<string, string> = { low: "text-muted-foreground", medium: "text-blue-600 dark:text-blue-400", high: "text-amber-600 dark:text-amber-400", critical: "text-rose-500" };
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  proposed:     { label: "Proposed",      color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",          icon: <FileText  className="h-3 w-3" /> },
  under_review: { label: "Under Review",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",       icon: <Scale     className="h-3 w-3" /> },
  approved:     { label: "Approved",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",           icon: <CheckCircle className="h-3 w-3" /> },
  rejected:     { label: "Rejected",      color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",           icon: <XCircle   className="h-3 w-3" /> },
  implemented:  { label: "Implemented",   color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",   icon: <Activity  className="h-3 w-3" /> },
  measured:     { label: "Measured",      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",icon: <TrendingUp className="h-3 w-3" /> },
  closed:       { label: "Closed",        color: "bg-muted text-muted-foreground",                                              icon: <CheckSquare className="h-3 w-3" /> },
};
const TYPE_COLORS: Record<string, string> = { strategic: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", financial: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", workforce: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", operational: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", policy: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", platform: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" };

function StatusBadge({ s }: { s: string }) {
  const cfg = STATUS_CONFIG[s] ?? { label: s, color: "bg-muted text-muted-foreground", icon: null };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 flex items-center gap-0.5 ${cfg.color}`}>{cfg.icon}<span>{cfg.label}</span></Badge>;
}
function TypeBadge({ t }: { t: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${TYPE_COLORS[t] ?? "bg-muted text-muted-foreground"}`}>{t}</Badge>;
}
function RiskBadge({ r }: { r: string }) {
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 capitalize ${RISK_COLORS[r] ?? "bg-muted text-muted-foreground"}`}>{r} risk</Badge>;
}
function SuccessScore({ score }: { score: number }) {
  const color = score >= 90 ? "text-emerald-600 dark:text-emerald-400" : score >= 75 ? "text-primary" : score >= 60 ? "text-amber-600 dark:text-amber-400" : "text-rose-500";
  const label = score >= 90 ? "Exceeded" : score >= 75 ? "Met" : "Partial";
  return <span className={`font-bold text-[9px] ${color}`}>{score} — {label}</span>;
}
function AgentDot({ name }: { name: string }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Agent": "bg-emerald-500", "Email Agent": "bg-blue-500", "Research Agent": "bg-amber-500", "Scheduling Agent": "bg-teal-500", "Customer Success Agent": "bg-cyan-500", "CEO Heartbeat": "bg-primary", "Intelligence Engine": "bg-rose-500", "CEO": "bg-slate-700" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  return <div className={`h-5 w-5 ${color} rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0`}>{initials}</div>;
}

// ─── Decision Card ────────────────────────────────────────────────────────────

function DecisionCard({ decision, showActions = false, onApprove, onReject }: { decision: Decision; showActions?: boolean; onApprove?: (id: string) => void; onReject?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const closeMutation = useMutation({
    mutationFn: (data: { actualImpact: string; successScore: number; lessonsLearned: string }) =>
      apiRequest("POST", "/api/governance/close", { decisionId: decision.id, ...data }),
    onSuccess: () => { toast({ title: "Decision closed and archived" }); qc.invalidateQueries({ queryKey: ["/api/governance/decisions"] }); },
    onError: () => toast({ title: "Failed to close decision", variant: "destructive" }),
  });

  const isOpen = ["proposed", "under_review", "approved"].includes(decision.status);
  const isMeasurable = decision.status === "implemented";

  return (
    <div className="rounded-xl border bg-card overflow-hidden" data-testid={`decision-card-${decision.id}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
            <Gavel className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <p className="text-xs font-bold flex-1 truncate">{decision.title}</p>
              <StatusBadge s={decision.status} />
              <TypeBadge t={decision.decisionType} />
              <RiskBadge r={decision.riskLevel} />
            </div>
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground mb-2 flex-wrap">
              <div className="flex items-center gap-1">
                <AgentDot name={decision.proposedBy} />
                <span>by {decision.proposedBy}</span>
              </div>
              {decision.approvedBy && <><span>·</span><span>Approved by <span className="font-semibold text-foreground">{decision.approvedBy}</span></span></>}
              <span>·</span>
              <span className={PRIORITY_COLORS[decision.priority]}>{decision.priority} priority</span>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(decision.createdAt), { addSuffix: true })}</span>
              {decision.roi && <><span>·</span><span className="text-emerald-600 dark:text-emerald-400 font-bold">{decision.roi}</span></>}
              {decision.successScore != null && <><span>·</span><SuccessScore score={decision.successScore} /></>}
            </div>
            <p className="text-[9px] text-muted-foreground">{decision.expectedImpact}</p>
            {decision.actualImpact && (
              <p className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-1">✓ Actual: {decision.actualImpact}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {showActions && isOpen && (
              <>
                <Button size="sm" className="h-6 text-[9px] px-2 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onApprove?.(decision.id)} data-testid={`button-approve-${decision.id}`}>
                  <CheckCircle className="h-2.5 w-2.5" />Approve
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[9px] px-2 gap-1 text-rose-500 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950" onClick={() => onReject?.(decision.id)} data-testid={`button-reject-${decision.id}`}>
                  <XCircle className="h-2.5 w-2.5" />Reject
                </Button>
              </>
            )}
            {isMeasurable && (
              <Button size="sm" variant="outline" className="h-6 text-[9px] px-2 gap-1" onClick={() => closeMutation.mutate({ actualImpact: "Tracking in progress", successScore: decision.confidenceScore, lessonsLearned: "" })} disabled={closeMutation.isPending} data-testid={`button-close-${decision.id}`}>
                {closeMutation.isPending ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <CheckSquare className="h-2.5 w-2.5" />}Close
              </Button>
            )}
            <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors" data-testid={`toggle-decision-${decision.id}`}>
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
      {open && decision.lessonsLearned && (
        <div className="border-t px-4 py-3 bg-muted/10" data-testid={`decision-lessons-${decision.id}`}>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Lessons Learned</p>
          <p className="text-[10px]">{decision.lessonsLearned}</p>
        </div>
      )}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview",        icon: Shield     },
  { id: "decisions", label: "Decisions",       icon: Gavel      },
  { id: "approvals", label: "Approvals",       icon: CheckCircle},
  { id: "policies",  label: "Policies",        icon: FileText   },
  { id: "risk",      label: "Risk Review",     icon: AlertTriangle },
  { id: "impact",    label: "Impact Tracking", icon: TrendingUp },
  { id: "analytics", label: "Analytics",       icon: BarChart3  },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Propose Decision Modal ───────────────────────────────────────────────────

function ProposeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", decisionType: "operational", proposedBy: "Human Admin", priority: "medium", riskLevel: "low", expectedImpact: "", confidenceScore: 75 });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/governance/propose", form),
    onSuccess: () => { toast({ title: "Decision proposed and queued for review" }); onCreated(); onClose(); },
    onError: () => toast({ title: "Failed to propose decision", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="propose-modal">
      <div className="bg-background rounded-2xl border shadow-xl w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold flex items-center gap-2"><Gavel className="h-4 w-4 text-primary" />Propose a Decision</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-propose"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2.5">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Decision title…" className="w-full h-9 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-decision-title" />
          <textarea value={form.expectedImpact} onChange={e => setForm(p => ({ ...p, expectedImpact: e.target.value }))} placeholder="Expected impact — be specific (e.g. +12% revenue from partnership cohort within 90 days)…" className="w-full h-20 px-3 py-2 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none" data-testid="textarea-expected-impact" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Decision Type</p>
              <select value={form.decisionType} onChange={e => setForm(p => ({ ...p, decisionType: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-decision-type">
                {["strategic","financial","workforce","operational","policy","platform"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Risk Level</p>
              <select value={form.riskLevel} onChange={e => setForm(p => ({ ...p, riskLevel: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-risk-level">
                {["low","medium","high","critical"].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Priority</p>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className="w-full h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-priority">
                {["low","medium","high","critical"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground mb-1">Confidence ({form.confidenceScore}%)</p>
              <input type="range" min={0} max={100} value={form.confidenceScore} onChange={e => setForm(p => ({ ...p, confidenceScore: +e.target.value }))} className="w-full mt-1.5" data-testid="range-confidence-gov" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-propose">Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!form.title.trim() || mutation.isPending} data-testid="button-confirm-propose">
            {mutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Gavel className="h-3.5 w-3.5 mr-1.5" />}
            Propose Decision
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ setTab }: { setTab: (t: TabId) => void }) {
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/governance/overview"], staleTime: 60_000 });
  const { data: dec } = useQuery<{ decisions: Decision[] }>({ queryKey: ["/api/governance/decisions"], staleTime: 30_000 });

  const queue = (dec?.decisions ?? []).filter(d => ["proposed", "under_review"].includes(d.status));

  return (
    <div className="space-y-5" data-testid="tab-overview-gov">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Approval Queue",        value: data?.approvalQueue ?? "—",                                        color: (data?.approvalQueue ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
          { label: "Governance Compliance", value: data ? `${data.governanceComplianceScore}%` : "—",                 color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Decision Success Rate", value: data ? `${data.decisionSuccessRate}/100` : "—",                   color: "text-primary" },
          { label: "Active Decisions",      value: data?.activeDecisions ?? "—",                                     color: "text-blue-600 dark:text-blue-400" },
          { label: "High-Risk Reviews",     value: data?.highRiskReviews ?? "—",                                     color: (data?.highRiskReviews ?? 0) > 0 ? "text-rose-500" : "text-muted-foreground" },
          { label: "Avg Approval Time",     value: data ? `${data.avgApprovalTimeDays}d` : "—",                     color: "text-muted-foreground" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`gov-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Compliance bar */}
      {data && (
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Governance Health</p>
          {[
            { label: "Governance Compliance",    value: data.governanceComplianceScore,    color: "bg-emerald-500" },
            { label: "Decision Success Rate",     value: data.decisionSuccessRate,          color: "bg-primary" },
            { label: "Avg Approval Speed (×10)",  value: Math.min(100, Math.round((3 - data.avgApprovalTimeDays) / 3 * 100)), color: "bg-blue-500" },
          ].map(bar => (
            <div key={bar.label} className="mb-2.5">
              <div className="flex justify-between mb-1">
                <span className="text-[9px]">{bar.label}</span>
                <span className="text-[9px] font-bold">{bar.label.includes("Speed") ? `${data.avgApprovalTimeDays}d avg` : `${bar.value}%`}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${bar.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approval queue preview */}
      {queue.length > 0 && (
        <div className="p-4 rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] text-amber-700 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />Approval Queue ({queue.length})
            </p>
            <button onClick={() => setTab("approvals")} className="text-[9px] text-primary hover:underline" data-testid="link-view-approvals">View all →</button>
          </div>
          <div className="space-y-1.5">
            {queue.slice(0, 3).map(d => (
              <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-card" data-testid={`queue-item-${d.id}`}>
                <Gavel className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <p className="text-[9px] flex-1 truncate font-medium">{d.title}</p>
                <TypeBadge t={d.decisionType} />
                <RiskBadge r={d.riskLevel} />
                <StatusBadge s={d.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading && <Skeleton className="h-32 rounded-xl" />}
    </div>
  );
}

// ─── Tab: Decisions ───────────────────────────────────────────────────────────

function DecisionsTab() {
  const { data, isLoading } = useQuery<{ decisions: Decision[] }>({ queryKey: ["/api/governance/decisions"], staleTime: 30_000 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const decisions = data?.decisions ?? [];
  const types = [...new Set(decisions.map(d => d.decisionType))];
  const statuses = [...new Set(decisions.map(d => d.status))];
  const filtered = decisions.filter(d => (statusFilter === "all" || d.status === statusFilter) && (typeFilter === "all" || d.decisionType === typeFilter));
  const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4" data-testid="tab-decisions">
      <div className="flex flex-wrap gap-1.5">
        <div className="flex gap-1 flex-wrap">
          {["all", ...statuses].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-status-${s}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all", ...types].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} data-testid={`filter-type-gov-${t}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {sorted.map(d => <DecisionCard key={d.id} decision={d} />)}
          {sorted.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No decisions match the selected filters.</div>}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Approvals ───────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { data, isLoading } = useQuery<{ decisions: Decision[] }>({ queryKey: ["/api/governance/decisions"], staleTime: 30_000 });
  const { toast } = useToast();
  const qc = useQueryClient();

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/governance/approve", { decisionId: id, approvedBy: "CEO" }),
    onSuccess: () => { toast({ title: "Decision approved" }); qc.invalidateQueries({ queryKey: ["/api/governance/decisions"] }); qc.invalidateQueries({ queryKey: ["/api/governance/overview"] }); },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", "/api/governance/reject", { decisionId: id, rejectedBy: "CEO", reason: "Does not meet governance criteria at this time." }),
    onSuccess: () => { toast({ title: "Decision rejected" }); qc.invalidateQueries({ queryKey: ["/api/governance/decisions"] }); qc.invalidateQueries({ queryKey: ["/api/governance/overview"] }); },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const queue = (data?.decisions ?? []).filter(d => ["proposed", "under_review"].includes(d.status));
  const recent = (data?.decisions ?? []).filter(d => ["approved", "rejected"].includes(d.status));

  return (
    <div className="space-y-5" data-testid="tab-approvals">
      {/* Queue */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <p className="text-xs font-bold">Approval Queue ({queue.length})</p>
        </div>
        {isLoading ? <Skeleton className="h-48 rounded-xl" /> : queue.length === 0 ? (
          <div className="py-8 text-center rounded-xl border bg-card">
            <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No decisions awaiting approval</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map(d => (
              <DecisionCard key={d.id} decision={d} showActions onApprove={id => approveMutation.mutate(id)} onReject={id => rejectMutation.mutate(id)} />
            ))}
          </div>
        )}
      </div>

      {/* Recently decided */}
      {recent.length > 0 && (
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Recently Decided</p>
          <div className="space-y-2">
            {recent.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`recent-decided-${d.id}`}>
                <Gavel className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-[10px] flex-1 truncate font-medium">{d.title}</p>
                <StatusBadge s={d.status} />
                <TypeBadge t={d.decisionType} />
                {d.approvedBy && <span className="text-[9px] text-muted-foreground shrink-0">by {d.approvedBy}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Policies ────────────────────────────────────────────────────────────

function PoliciesTab() {
  const { data, isLoading } = useQuery<{ policies: Policy[]; total: number; activeCount: number }>({ queryKey: ["/api/governance/policies"], staleTime: 60_000 });
  const RISK_ICON: Record<string, React.ReactNode> = { critical: <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />, high: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, medium: <Shield className="h-3.5 w-3.5 text-blue-500" />, low: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> };

  return (
    <div className="space-y-4" data-testid="tab-policies-gov">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border bg-card text-center">
          <p className="text-xl font-extrabold text-primary">{data?.total ?? "—"}</p>
          <p className="text-[9px] text-muted-foreground">Total Policies</p>
        </div>
        <div className="p-3 rounded-xl border bg-card text-center">
          <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{data?.activeCount ?? "—"}</p>
          <p className="text-[9px] text-muted-foreground">Active</p>
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.policies ?? []).map(policy => (
            <div key={policy.id} className="p-4 rounded-xl border bg-card" data-testid={`policy-card-${policy.id}`}>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-muted shrink-0 mt-0.5">
                  {RISK_ICON[policy.riskThreshold] ?? <Shield className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold flex-1 truncate">{policy.title}</p>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{policy.category}</Badge>
                    <Badge className={`text-[8px] px-1.5 py-0 h-4 ${RISK_COLORS[policy.riskThreshold]}`}>{policy.riskThreshold} risk</Badge>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">v{policy.version}</Badge>
                    {policy.active && <Badge className="text-[8px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>}
                  </div>
                  <p className="text-[9px] text-muted-foreground mb-2 leading-relaxed">{policy.description}</p>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[8px] text-muted-foreground">Approval required: <span className="font-semibold text-foreground">{policy.approvalRequired}</span></span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Risk Review ─────────────────────────────────────────────────────────

function RiskTab() {
  const { data, isLoading } = useQuery<RiskData>({ queryKey: ["/api/governance/risk"], staleTime: 30_000 });

  const RISK_BAR_COLOR: Record<string, string> = { low: "bg-emerald-500", medium: "bg-amber-500", high: "bg-rose-500", critical: "bg-rose-700" };
  const REC_COLOR: Record<string, string> = { approve: "text-emerald-600 dark:text-emerald-400", reject: "text-rose-500", escalate: "text-amber-600 dark:text-amber-400", "needs_revision": "text-blue-600 dark:text-blue-400" };

  return (
    <div className="space-y-5" data-testid="tab-risk">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Critical Risk", value: data.byRisk.critical ?? 0, color: "text-rose-700 dark:text-rose-300" },
            { label: "High Risk",     value: data.byRisk.high     ?? 0, color: "text-rose-500" },
            { label: "Medium Risk",   value: data.byRisk.medium   ?? 0, color: "text-amber-600 dark:text-amber-400" },
            { label: "Low Risk",      value: data.byRisk.low      ?? 0, color: "text-emerald-600 dark:text-emerald-400" },
          ].map(k => (
            <div key={k.label} className="p-3.5 rounded-xl border bg-card text-center" data-testid={`risk-kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
              <p className="text-[9px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          {/* Open decisions with risk */}
          <div className="space-y-3">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Open Decisions — Risk Assessment</p>
            {(data?.openDecisions ?? []).map(d => {
              const decisionReviews = d.reviews ?? [];
              return (
                <div key={d.id} className="p-4 rounded-xl border bg-card" data-testid={`risk-decision-${d.id}`}>
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${d.riskLevel === "high" || d.riskLevel === "critical" ? "bg-rose-100 dark:bg-rose-900/30" : d.riskLevel === "medium" ? "bg-amber-100 dark:bg-amber-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}`}>
                      <AlertTriangle className={`h-3.5 w-3.5 ${d.riskLevel === "high" || d.riskLevel === "critical" ? "text-rose-500" : d.riskLevel === "medium" ? "text-amber-500" : "text-emerald-500"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <p className="text-[10px] font-bold flex-1 truncate">{d.title}</p>
                        <RiskBadge r={d.riskLevel} />
                        <TypeBadge t={d.decisionType} />
                        <StatusBadge s={d.status} />
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[9px] text-muted-foreground">Confidence: <span className="font-bold text-foreground">{d.confidenceScore}%</span></span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${RISK_BAR_COLOR[d.riskLevel] ?? "bg-primary"}`} style={{ width: `${d.confidenceScore}%` }} />
                        </div>
                      </div>
                      {decisionReviews.length > 0 && (
                        <div className="space-y-1.5 mt-2">
                          {decisionReviews.map(r => (
                            <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30" data-testid={`review-${r.id}`}>
                              <AgentDot name={r.reviewer} />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-[9px] font-semibold">{r.reviewer}</span>
                                  <span className={`text-[8px] font-bold capitalize ${REC_COLOR[r.recommendation] ?? "text-muted-foreground"}`}>{r.recommendation}</span>
                                  <span className="text-[8px] text-muted-foreground ml-auto">Risk score: {r.riskScore}/100</span>
                                </div>
                                <p className="text-[8px] text-muted-foreground leading-relaxed">{r.rationale}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {decisionReviews.length === 0 && (
                        <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-1">⚠ No reviews submitted yet — awaiting AI COO assessment</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {(data?.openDecisions ?? []).length === 0 && (
              <div className="py-10 text-center text-muted-foreground text-sm rounded-xl border bg-card">
                <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                No open decisions requiring risk review.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Impact Tracking ─────────────────────────────────────────────────────

function ImpactTab() {
  const { data, isLoading } = useQuery<{ decisions: Decision[] }>({ queryKey: ["/api/governance/decisions"], staleTime: 30_000 });

  const measured = (data?.decisions ?? []).filter(d => d.status === "measured" || (d.status === "implemented" && d.actualImpact));
  const inProgress = (data?.decisions ?? []).filter(d => d.status === "implemented" && !d.actualImpact);

  return (
    <div className="space-y-5" data-testid="tab-impact">
      {/* Summary */}
      {measured.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-primary">{measured.length}</p>
            <p className="text-[9px] text-muted-foreground">Measured</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400">{inProgress.length}</p>
            <p className="text-[9px] text-muted-foreground">In Progress</p>
          </div>
          <div className="p-3 rounded-xl border bg-card text-center">
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {measured.length > 0 ? Math.round(measured.reduce((s, d) => s + (d.successScore ?? 0), 0) / measured.length) : "—"}
            </p>
            <p className="text-[9px] text-muted-foreground">Avg Success</p>
          </div>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <>
          <div className="space-y-3">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Measured Decisions</p>
            {measured.map(d => (
              <div key={d.id} className="p-4 rounded-xl border bg-card" data-testid={`impact-card-${d.id}`}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 shrink-0">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <p className="text-xs font-bold flex-1 truncate">{d.title}</p>
                      <TypeBadge t={d.decisionType} />
                      {d.roi && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">{d.roi}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[9px]">
                      <div>
                        <p className="text-muted-foreground mb-0.5">Expected</p>
                        <p className="font-medium">{d.expectedImpact}</p>
                      </div>
                      <div>
                        <p className="text-emerald-600 dark:text-emerald-400 mb-0.5">Actual</p>
                        <p className="font-medium text-emerald-700 dark:text-emerald-300">{d.actualImpact}</p>
                      </div>
                    </div>
                    {d.successScore != null && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-muted-foreground">Success Score</span>
                          <SuccessScore score={d.successScore} />
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${d.successScore >= 90 ? "bg-emerald-500" : d.successScore >= 75 ? "bg-primary" : "bg-amber-500"}`} style={{ width: `${d.successScore}%` }} />
                        </div>
                      </div>
                    )}
                    {d.lessonsLearned && (
                      <div className="mt-2 p-2 rounded-lg bg-muted/20">
                        <p className="text-[8px] text-muted-foreground mb-0.5">Lesson</p>
                        <p className="text-[9px]">{d.lessonsLearned}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {measured.length === 0 && <div className="py-8 text-center text-muted-foreground text-sm rounded-xl border bg-card">No decisions measured yet.</div>}
          </div>

          {inProgress.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Implemented — Tracking in Progress</p>
              {inProgress.map(d => (
                <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card" data-testid={`tracking-${d.id}`}>
                  <Activity className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-medium truncate">{d.title}</p>
                    <p className="text-[9px] text-muted-foreground">{d.expectedImpact}</p>
                  </div>
                  <TypeBadge t={d.decisionType} />
                  <Badge className="text-[8px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Tracking</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({ queryKey: ["/api/governance/analytics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics-gov">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Decisions",       value: data?.totalDecisions ?? "—",                                  color: "text-primary" },
          { label: "Avg Success Score",     value: data ? `${data.avgSuccessScore}/100` : "—",                  color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Governance Compliance", value: data ? `${data.governanceComplianceScore}%` : "—",           color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Avg Approval Time",     value: data ? `${data.avgApprovalTimeDays}d` : "—",                 color: "text-muted-foreground" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`analytics-gov-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* By status */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">By Status</p>
              <div className="space-y-2">
                {Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <StatusBadge s={status} />
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / data.totalDecisions) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By type */}
            <div className="p-4 rounded-xl border bg-card">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">By Decision Type</p>
              <div className="space-y-2">
                {Object.entries(data.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span className="text-[9px] capitalize w-20 shrink-0">{type}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(count / data.totalDecisions) * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-bold w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top ROI decisions */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Top ROI Decisions</p>
            <div className="space-y-2.5">
              {data.topRoiDecisions.map((d, i) => (
                <div key={d.id} className="flex items-center gap-2" data-testid={`roi-decision-${i}`}>
                  <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                  <TypeBadge t={d.decisionType} />
                  <p className="text-[9px] flex-1 truncate">{d.title}</p>
                  {d.successScore != null && <span className="text-[9px] text-primary font-bold shrink-0">{d.successScore}</span>}
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">{d.roi}</span>
                </div>
              ))}
            </div>
          </div>

          {/* High impact decisions */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Highest Impact Decisions</p>
            <div className="space-y-2.5">
              {data.highImpactDecisions.map((d, i) => (
                <div key={d.id} className="flex items-center gap-3" data-testid={`impact-decision-${i}`}>
                  <span className="text-[9px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                  <TypeBadge t={d.decisionType} />
                  <p className="text-[9px] flex-1 truncate">{d.title}</p>
                  {d.roi && <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold shrink-0">{d.roi}</span>}
                  {d.successScore != null && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Star className="h-2.5 w-2.5 text-amber-500" />
                      <span className="text-[9px] font-bold">{d.successScore}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* By risk distribution */}
          <div className="p-4 rounded-xl border bg-card">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Risk Distribution</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Critical", key: "critical", color: "text-rose-700 dark:text-rose-300", bg: "bg-rose-100 dark:bg-rose-900/30" },
                { label: "High",     key: "high",     color: "text-rose-500",                   bg: "bg-rose-50 dark:bg-rose-950/30" },
                { label: "Medium",   key: "medium",   color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
                { label: "Low",      key: "low",      color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
              ].map(r => (
                <div key={r.key} className={`p-2.5 rounded-lg text-center ${r.bg}`} data-testid={`risk-dist-${r.key}`}>
                  <p className={`text-lg font-extrabold ${r.color}`}>{data.byRisk[r.key] ?? 0}</p>
                  <p className="text-[8px] text-muted-foreground">{r.label}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminGovernancePage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [showPropose, setShowPropose] = useState(false);
  const qc = useQueryClient();

  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/governance/overview"], staleTime: 60_000 });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-governance">
      {showPropose && <ProposeModal onClose={() => setShowPropose(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["/api/governance/decisions"] }); qc.invalidateQueries({ queryKey: ["/api/governance/overview"] }); }} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/procedures">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />SOP System
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Governance Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The organizational boardroom — decisions proposed, reviewed, approved, implemented, measured, and permanently archived.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overview && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              {[
                { label: "Queue",      value: overview.approvalQueue,           color: (overview.approvalQueue) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
                { label: "Compliance", value: `${overview.governanceComplianceScore}%`, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Success",    value: `${overview.decisionSuccessRate}/100`, color: "text-primary" },
              ].map((s, i) => (
                <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button className="gap-1.5 h-9" onClick={() => setShowPropose(true)} data-testid="button-propose-decision">
            <Plus className="h-4 w-4" />Propose Decision
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Org Memory", href: "/admin/organizational-memory" },
          { label: "SOP System", href: "/admin/procedures"           },
          { label: "Governance", href: null                          },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="governance-status-bar">
        {[
          { label: "Approval Queue",  value: overview?.approvalQueue  ?? "—", color: (overview?.approvalQueue  ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, tab: "approvals" as TabId },
          { label: "Compliance",      value: overview ? `${overview.governanceComplianceScore}%` : "—", color: "text-emerald-600 dark:text-emerald-400", icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />, tab: "analytics" as TabId },
          { label: "High Risk",       value: overview?.highRiskReviews ?? "—", color: (overview?.highRiskReviews ?? 0) > 0 ? "text-rose-500" : "text-muted-foreground", icon: <Shield className="h-3.5 w-3.5 text-rose-500" />, tab: "risk" as TabId },
          { label: "Success Rate",    value: overview ? `${overview.decisionSuccessRate}/100` : "—", color: "text-primary", icon: <TrendingUp className="h-3.5 w-3.5 text-primary" />, tab: "impact" as TabId },
        ].map(stat => (
          <button key={stat.label} onClick={() => setActiveTab(stat.tab)} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left" data-testid={`stat-${stat.tab}`}>
            <div className="p-1.5 rounded-lg bg-muted shrink-0">{stat.icon}</div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${stat.color}`}>{stat.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-gov">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-96">
        {activeTab === "overview"  && <OverviewTab setTab={setActiveTab} />}
        {activeTab === "decisions" && <DecisionsTab />}
        {activeTab === "approvals" && <ApprovalsTab />}
        {activeTab === "policies"  && <PoliciesTab />}
        {activeTab === "risk"      && <RiskTab />}
        {activeTab === "impact"    && <ImpactTab />}
        {activeTab === "analytics" && <AnalyticsTab />}
      </div>

      {/* Forward nav → Organization Center */}
      <Link href="/admin/organization">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-blue-500/5 hover:from-primary/10 hover:to-blue-500/10 transition-colors cursor-pointer group" data-testid="nav-organization">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Organizational Structure &amp; Department Operating System</p>
            <p className="text-xs text-muted-foreground mt-0.5">Departments, reporting structures, decision rights, responsibility matrix, and capacity planning — the formal architecture of the digital enterprise.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-rose-500/5" data-testid="architecture-complete-19-5">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Organizational Governance — Phase 19.5 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">Every decision that matters now has a formal lifecycle — proposed, reviewed, approved, implemented, measured, and permanently archived. Governance is the bridge between intelligence and accountability.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms","Task Marketplace","Org Memory","SOP System","Governance",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 22 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
                  {i + 1}. {layer}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
