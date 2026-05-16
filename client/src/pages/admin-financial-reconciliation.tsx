import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, XCircle, Download, Lock, Unlock,
  RefreshCw, ChevronDown, ChevronRight, Info, DollarSign,
  Users, Clock, FileText, Shield
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReconciliationSummary {
  collectedCents: number;
  recognizedCents: number;
  deferredLiabilityCents: number;
  coachAccruedCents: number;
  coachPaidCents: number;
  coachPendingCents: number;
  refundedCents: number;
  manualAdjCents: number;
  pendingFailures: number;
  failedFailures: number;
  staleFailures: number;
  creditDebitsCount: number;
  sessionsDebited: number;
  totalLedgerEvents: number;
}

interface Mismatch {
  key: string;
  severity: "critical" | "warning" | "info";
  label: string;
  count: number;
  rows?: any[];
}

interface CoachPayout {
  coachId: string;
  coachName: string;
  accruedCents: number;
  paidCents: number;
  pendingCents: number;
  sessionsRedeemed: number;
}

interface LedgerEvent {
  id: string;
  eventType: string;
  amountCents: number | null;
  coachId: string | null;
  clientId: string | null;
  bookingId: string | null;
  redemptionId: string | null;
  sourceAction: string | null;
  idempotencyKey: string | null;
  reason: string | null;
  createdAt: string | null;
}

interface ReconciliationData {
  period: { start: string; end: string };
  summary: ReconciliationSummary;
  eventStream: LedgerEvent[];
  mismatches: Mismatch[];
  criticalCount: number;
  coachPayouts: CoachPayout[];
}

interface FinancialCloseout {
  id: string;
  orgId: string;
  periodType: "weekly" | "monthly" | "custom";
  periodStart: string;
  periodEnd: string;
  status: "draft" | "open" | "closed" | "reopened";
  closedBy: string | null;
  closedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  notes: string | null;
  totalsSnapshot: any;
  unresolvedIssueCount: number;
  acknowledgedWarnings: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number | null | undefined) {
  if (cents == null) return "$0.00";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function getDefaultRange(preset: string) {
  const now = new Date();
  if (preset === "today") {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  }
  if (preset === "week") {
    const day = now.getDay();
    const s = new Date(now); s.setDate(now.getDate() - day);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  }
  // month (default)
  const s = new Date(now.getFullYear(), now.getMonth(), 1);
  const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

const SEVERITY_CONFIG = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800", icon: XCircle },
  warning: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800", icon: AlertTriangle },
  info: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800", icon: Info },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  payment_received: "Payment Received",
  revenue_recognized: "Revenue Recognized",
  deferred_revenue_created: "Deferred Created",
  deferred_revenue_released: "Deferred Released",
  coach_compensation_accrued: "Coach Accrual",
  coach_compensation_paid: "Coach Paid",
  refund_issued: "Refund",
  cancellation_reversal: "Cancellation Reversal",
  manual_adjustment: "Manual Adjustment",
};

const EVENT_TYPE_COLOR: Record<string, string> = {
  payment_received: "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30",
  revenue_recognized: "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30",
  deferred_revenue_created: "text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-900/30",
  deferred_revenue_released: "text-purple-700 bg-purple-100 dark:text-purple-300 dark:bg-purple-900/30",
  coach_compensation_accrued: "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30",
  coach_compensation_paid: "text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-900/30",
  refund_issued: "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30",
  cancellation_reversal: "text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900/30",
  manual_adjustment: "text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-gray-800",
};

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, critical, icon: Icon, testId,
}: { label: string; value: string; sub?: string; critical?: boolean; icon: any; testId: string }) {
  return (
    <Card className={`p-4 ${critical ? "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className={`text-xl font-bold mt-0.5 font-mono ${critical ? "text-red-600 dark:text-red-400" : "text-foreground"}`} data-testid={testId}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${critical ? "text-red-500" : "text-muted-foreground"}`} />
      </div>
    </Card>
  );
}

// ── Closeout Status Badge ──────────────────────────────────────────────────────

function CloseoutStatusBadge({ status }: { status: FinancialCloseout["status"] }) {
  const cfg = {
    draft: { label: "Draft", cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    open: { label: "Open", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
    closed: { label: "Closed", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
    reopened: { label: "Reopened", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  }[status] ?? { label: status, cls: "" };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminFinancialReconciliationPage() {
  const { toast } = useToast();

  // Date range
  const [preset, setPreset] = useState("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const range = preset === "custom"
    ? { start: customStart, end: customEnd }
    : getDefaultRange(preset);

  // Closeout state
  const [selectedCloseoutId, setSelectedCloseoutId] = useState<string | null>(null);
  const [showCreateCloseout, setShowCreateCloseout] = useState(false);
  const [newCloseoutNotes, setNewCloseoutNotes] = useState("");
  const [newCloseoutType, setNewCloseoutType] = useState("monthly");
  const [reopenReason, setReopenReason] = useState("");
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [closeoutNotes, setCloseoutNotes] = useState("");
  const [showEventStream, setShowEventStream] = useState(false);

  const startParam = range.start ? `${range.start}T00:00:00.000Z` : "";
  const endParam = range.end ? `${range.end}T23:59:59.999Z` : "";

  // Queries
  const { data: recon, isLoading, refetch } = useQuery<ReconciliationData>({
    queryKey: ["/api/admin/financial-reconciliation", startParam, endParam],
    queryFn: () => fetch(
      `/api/admin/financial-reconciliation?start=${encodeURIComponent(startParam)}&end=${encodeURIComponent(endParam)}`,
      { credentials: "include" }
    ).then(r => r.json()),
    enabled: !!(startParam && endParam),
  });

  const { data: closeouts = [] } = useQuery<FinancialCloseout[]>({
    queryKey: ["/api/admin/financial-closeouts"],
  });

  const selectedCloseout = closeouts.find(c => c.id === selectedCloseoutId) ?? null;

  // Mutations
  const createCloseoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/financial-closeouts", {
      periodStart: startParam,
      periodEnd: endParam,
      periodType: newCloseoutType,
      notes: newCloseoutNotes || null,
    }),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      toast({ title: "Period created", description: `Draft period created (ID: ${data.id?.slice(0, 8)}…)` });
      setShowCreateCloseout(false);
      setNewCloseoutNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-closeouts"] });
      setSelectedCloseoutId(data.id);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const ackWarningsMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/financial-closeouts/${id}/acknowledge-warnings`, { reason: "Warnings reviewed and acknowledged" }),
    onSuccess: () => {
      toast({ title: "Warnings acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-closeouts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closePeriodMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/financial-closeouts/${id}/close`, { notes: closeoutNotes }),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      if (data?.blocked) {
        toast({ title: "Period cannot be closed", description: `${data.criticalIssues?.length ?? 0} critical issue(s) must be resolved first.`, variant: "destructive" });
        return;
      }
      if (data?.requiresAcknowledgment) {
        toast({ title: "Acknowledge warnings first", description: "Non-critical warnings require acknowledgment before closing.", variant: "destructive" });
        return;
      }
      toast({ title: "Period closed", description: "Accounting period has been closed and totals snapshotted." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-closeouts"] });
    },
    onError: async (e: any) => {
      // Extract structured errors from 422 responses
      try {
        const body = typeof e.message === "string" ? JSON.parse(e.message) : e;
        if (body?.blocked) {
          toast({ title: "Cannot close — critical issues", description: body.criticalIssues?.map((i: any) => i.label).join("; "), variant: "destructive" });
          return;
        }
      } catch {}
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("POST", `/api/admin/financial-closeouts/${id}/reopen`, { reason }),
    onSuccess: () => {
      toast({ title: "Period reopened" });
      setShowReopenDialog(false);
      setReopenReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-closeouts"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleExport = (type: string) => {
    const url = `/api/admin/financial-reconciliation/export?start=${encodeURIComponent(startParam)}&end=${encodeURIComponent(endParam)}&type=${type}`;
    window.open(url, "_blank");
  };

  const summary = recon?.summary;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-reconciliation">
            Financial Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operational accounting console — period aggregation, mismatch detection, and closeout workflow.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => handleExport("events")} className="gap-1.5" data-testid="button-export-events">
            <Download className="w-3.5 h-3.5" /> Events CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("coach_payouts")} className="gap-1.5" data-testid="button-export-payouts">
            <Download className="w-3.5 h-3.5" /> Payouts CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("issues")} className="gap-1.5" data-testid="button-export-issues">
            <Download className="w-3.5 h-3.5" /> Issues CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" data-testid="button-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Time range filter */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Period</p>
            <div className="flex gap-1.5">
              {[{ key: "today", label: "Today" }, { key: "week", label: "This Week" }, { key: "month", label: "This Month" }, { key: "custom", label: "Custom" }].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPreset(key)}
                  data-testid={`filter-period-${key}`}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                    preset === key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Start</Label>
                <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-sm w-36" data-testid="input-custom-start" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">End</Label>
                <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-sm w-36" data-testid="input-custom-end" />
              </div>
            </div>
          )}
          {range.start && (
            <p className="text-xs text-muted-foreground self-end pb-1">
              {range.start} → {range.end}
            </p>
          )}
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading reconciliation data…</p>}

      {recon && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Collected Revenue" value={fmt(summary?.collectedCents)} sub="Total payments received" icon={DollarSign} testId="card-collected" />
            <SummaryCard label="Recognized Revenue" value={fmt(summary?.recognizedCents)} sub="Earned on session delivery" icon={CheckCircle2} testId="card-recognized" />
            <SummaryCard label="Deferred Liability" value={fmt(summary?.deferredLiabilityCents)} sub="Owed as future sessions" icon={Clock} testId="card-deferred" />
            <SummaryCard label="Coach Accrued" value={fmt(summary?.coachAccruedCents)} sub="Compensation earned" icon={Users} testId="card-coach-accrued" />
            <SummaryCard label="Coach Paid" value={fmt(summary?.coachPaidCents)} sub="Disbursed" icon={CheckCircle2} testId="card-coach-paid" />
            <SummaryCard label="Coach Pending" value={fmt(summary?.coachPendingCents)} sub="Outstanding liability" icon={Clock} testId="card-coach-pending" />
            <SummaryCard
              label="Financial Failures"
              value={String((summary?.pendingFailures ?? 0) + (summary?.failedFailures ?? 0))}
              sub={`${summary?.failedFailures ?? 0} failed, ${summary?.pendingFailures ?? 0} pending`}
              icon={AlertTriangle}
              critical={(summary?.failedFailures ?? 0) > 0}
              testId="card-failures"
            />
            <SummaryCard
              label="Integrity Issues"
              value={String(recon.criticalCount)}
              sub={`${recon.mismatches.length} total mismatches`}
              icon={Shield}
              critical={recon.criticalCount > 0}
              testId="card-integrity"
            />
          </div>

          {/* Mismatches section */}
          {recon.mismatches.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-foreground mb-3">Reconciliation Issues</h2>
              <div className="space-y-2">
                {(["critical", "warning", "info"] as const).map(sev => {
                  const items = recon.mismatches.filter(m => m.severity === sev);
                  if (items.length === 0) return null;
                  const cfg = SEVERITY_CONFIG[sev];
                  const Icon = cfg.icon;
                  return (
                    <div key={sev}>
                      {items.map(m => (
                        <div key={m.key} className={`flex items-start gap-3 p-3 rounded-lg border mb-2 ${cfg.bg}`} data-testid={`issue-${m.key}`}>
                          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${cfg.color}`}>{m.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {m.count} occurrence{m.count !== 1 ? "s" : ""} · Severity: {sev}
                            </p>
                          </div>
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cfg.color}`}>{m.count}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {recon.criticalCount === 0 && recon.mismatches.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">No critical issues — period may be closed after acknowledging the above warnings.</p>
              )}
            </div>
          )}

          {recon.mismatches.length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">No reconciliation issues — this period is clean.</p>
            </div>
          )}

          {/* Coach payout reconciliation */}
          {recon.coachPayouts.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-foreground mb-3">Coach Payout Reconciliation</h2>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {["Coach", "Sessions", "Accrued", "Paid", "Pending"].map(h => (
                          <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recon.coachPayouts.map(c => (
                        <tr key={c.coachId} className="border-b hover:bg-muted/30" data-testid={`coach-row-${c.coachId}`}>
                          <td className="px-4 py-3 font-medium">{c.coachName}</td>
                          <td className="px-4 py-3 text-muted-foreground">{c.sessionsRedeemed}</td>
                          <td className="px-4 py-3 font-mono">{fmt(c.accruedCents)}</td>
                          <td className="px-4 py-3 font-mono text-green-600">{fmt(c.paidCents)}</td>
                          <td className="px-4 py-3 font-mono">
                            <span className={c.pendingCents > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
                              {fmt(c.pendingCents)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-3 text-xs text-muted-foreground uppercase">Total</td>
                        <td className="px-4 py-3">{recon.coachPayouts.reduce((a, c) => a + c.sessionsRedeemed, 0)}</td>
                        <td className="px-4 py-3 font-mono">{fmt(recon.coachPayouts.reduce((a, c) => a + c.accruedCents, 0))}</td>
                        <td className="px-4 py-3 font-mono text-green-600">{fmt(recon.coachPayouts.reduce((a, c) => a + c.paidCents, 0))}</td>
                        <td className="px-4 py-3 font-mono text-amber-600">{fmt(recon.coachPayouts.reduce((a, c) => a + c.pendingCents, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Event stream (collapsible) */}
          <div>
            <button
              className="flex items-center gap-2 text-base font-semibold text-foreground mb-3 hover:text-primary transition-colors"
              onClick={() => setShowEventStream(v => !v)}
              data-testid="toggle-event-stream"
            >
              {showEventStream ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Event Stream Timeline
              <span className="text-xs font-normal text-muted-foreground">({recon.eventStream.length} events)</span>
            </button>
            {showEventStream && (
              <Card>
                <CardContent className="p-0">
                  {recon.eventStream.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-6 text-center">No events in this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            {["Timestamp", "Event Type", "Amount", "Coach", "Client", "Source", "Idempotency"].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {recon.eventStream.map(e => (
                            <tr key={e.id} className="border-b hover:bg-muted/30" data-testid={`event-row-${e.id}`}>
                              <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${EVENT_TYPE_COLOR[e.eventType] ?? "bg-gray-100 text-gray-700"}`}>
                                  {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
                                </span>
                              </td>
                              <td className="px-4 py-2 font-mono text-xs">{fmt(e.amountCents)}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{e.coachId ? e.coachId.slice(0, 8) + "…" : "—"}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{e.clientId ? e.clientId.slice(0, 8) + "…" : "—"}</td>
                              <td className="px-4 py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={e.sourceAction ?? ""}>{e.sourceAction ?? "—"}</td>
                              <td className="px-4 py-2 text-xs font-mono text-muted-foreground max-w-[100px] truncate" title={e.idempotencyKey ?? ""}>{e.idempotencyKey ? e.idempotencyKey.slice(0, 12) + "…" : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Closeout panel */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Accounting Period Closeout</h2>
          <Button size="sm" variant="outline" onClick={() => setShowCreateCloseout(true)} data-testid="button-create-closeout" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Create Period
          </Button>
        </div>

        {closeouts.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No accounting periods created yet. Create one to start the closeout workflow.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {closeouts.map(c => (
              <Card
                key={c.id}
                className={`cursor-pointer transition-colors ${selectedCloseoutId === c.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                onClick={() => setSelectedCloseoutId(selectedCloseoutId === c.id ? null : c.id)}
                data-testid={`closeout-row-${c.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <CloseoutStatusBadge status={c.status} />
                      <span className="text-sm font-medium capitalize">{c.periodType} Period</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.periodStart).toLocaleDateString()} — {new Date(c.periodEnd).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {c.unresolvedIssueCount > 0 && (
                        <span className="text-amber-600 font-medium">{c.unresolvedIssueCount} issue{c.unresolvedIssueCount !== 1 ? "s" : ""}</span>
                      )}
                      <span>Created {fmtDate(c.createdAt)}</span>
                    </div>
                  </div>

                  {selectedCloseoutId === c.id && (
                    <div className="mt-4 space-y-4" onClick={e => e.stopPropagation()}>
                      <Separator />

                      {c.totalsSnapshot && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Closed Snapshot</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            {[
                              ["Collected", fmt((c.totalsSnapshot as any).collectedCents)],
                              ["Recognized", fmt((c.totalsSnapshot as any).recognizedCents)],
                              ["Deferred Liability", fmt((c.totalsSnapshot as any).deferredLiabilityCents)],
                              ["Coach Accrued", fmt((c.totalsSnapshot as any).coachAccruedCents)],
                              ["Coach Paid", fmt((c.totalsSnapshot as any).coachPaidCents)],
                              ["Coach Pending", fmt((c.totalsSnapshot as any).coachPendingCents)],
                            ].map(([l, v]) => (
                              <div key={String(l)} className="bg-muted/50 p-2 rounded">
                                <p className="text-muted-foreground">{l}</p>
                                <p className="font-mono font-semibold mt-0.5">{v}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {c.notes && (
                        <p className="text-xs text-muted-foreground"><span className="font-medium">Notes:</span> {c.notes}</p>
                      )}
                      {c.closedAt && (
                        <p className="text-xs text-muted-foreground">Closed {fmtDate(c.closedAt)} by {c.closedBy?.slice(0, 8)}…</p>
                      )}
                      {c.reopenReason && (
                        <p className="text-xs text-amber-600">Reopened: {c.reopenReason}</p>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {(c.status === "draft" || c.status === "open" || c.status === "reopened") && (
                          <>
                            {!c.acknowledgedWarnings && recon && recon.mismatches.filter(m => m.severity !== "critical").length > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => ackWarningsMutation.mutate(c.id)}
                                disabled={ackWarningsMutation.isPending}
                                data-testid={`button-acknowledge-${c.id}`}
                                className="gap-1.5 text-amber-700 border-amber-300"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" /> Acknowledge Warnings
                              </Button>
                            )}
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder="Closing notes (optional)…"
                                value={closeoutNotes}
                                onChange={e => setCloseoutNotes(e.target.value)}
                                className="h-8 text-xs w-48"
                                data-testid="input-closeout-notes"
                              />
                              <Button
                                size="sm"
                                onClick={() => closePeriodMutation.mutate(c.id)}
                                disabled={closePeriodMutation.isPending}
                                data-testid={`button-close-${c.id}`}
                                className="gap-1.5"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                {closePeriodMutation.isPending ? "Closing…" : "Close Period"}
                              </Button>
                            </div>
                          </>
                        )}
                        {c.status === "closed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setShowReopenDialog(true); setReopenReason(""); }}
                            data-testid={`button-reopen-${c.id}`}
                            className="gap-1.5 text-amber-700 border-amber-300"
                          >
                            <Unlock className="w-3.5 h-3.5" /> Reopen Period
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create closeout dialog */}
      <Dialog open={showCreateCloseout} onOpenChange={setShowCreateCloseout}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Accounting Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Period Type</Label>
              <Select value={newCloseoutType} onValueChange={setNewCloseoutType}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-period-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Period will cover: <strong>{range.start}</strong> → <strong>{range.end}</strong> (from current time filter)
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Textarea
                placeholder="Any notes about this accounting period…"
                value={newCloseoutNotes}
                onChange={e => setNewCloseoutNotes(e.target.value)}
                rows={2}
                data-testid="input-new-closeout-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateCloseout(false)}>Cancel</Button>
            <Button
              onClick={() => createCloseoutMutation.mutate()}
              disabled={createCloseoutMutation.isPending}
              data-testid="button-confirm-create-closeout"
            >
              {createCloseoutMutation.isPending ? "Creating…" : "Create Period"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen Accounting Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will reopen the closed period. A reason is required for the audit record.
            </p>
            <Textarea
              placeholder="Reason for reopening…"
              value={reopenReason}
              onChange={e => setReopenReason(e.target.value)}
              data-testid="input-reopen-reason"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowReopenDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => selectedCloseout && reopenMutation.mutate({ id: selectedCloseout.id, reason: reopenReason })}
              disabled={!reopenReason.trim() || reopenMutation.isPending}
              data-testid="button-confirm-reopen"
            >
              {reopenMutation.isPending ? "Reopening…" : "Confirm Reopen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
