import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, CheckCircle2, XCircle, Eye, RotateCcw, ShieldAlert } from "lucide-react";

interface FinancialEventFailure {
  id: string;
  orgId: string | null;
  clientId: string | null;
  coachId: string | null;
  bookingId: string | null;
  redemptionId: string | null;
  sourceType: string;
  eventType: string;
  payload: Record<string, any>;
  idempotencyKey: string | null;
  failureMessage: string | null;
  attempts: number;
  maxAttempts: number;
  status: "pending" | "retrying" | "resolved" | "ignored" | "failed";
  lastAttemptAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  ignoreReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const STATUS_CONFIG = {
  pending: { label: "Pending", variant: "secondary" as const, icon: AlertTriangle, color: "text-amber-600" },
  retrying: { label: "Retrying", variant: "secondary" as const, icon: RefreshCw, color: "text-blue-600" },
  resolved: { label: "Resolved", variant: "secondary" as const, icon: CheckCircle2, color: "text-green-600" },
  ignored: { label: "Ignored", variant: "secondary" as const, icon: XCircle, color: "text-gray-400" },
  failed: { label: "Failed", variant: "destructive" as const, icon: ShieldAlert, color: "text-red-600" },
};

function StatusBadge({ status }: { status: FinancialEventFailure["status"] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function fmtCents(cents: number | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AdminFinancialFailuresPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [detailRow, setDetailRow] = useState<FinancialEventFailure | null>(null);
  const [ignoreRow, setIgnoreRow] = useState<FinancialEventFailure | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");

  const apiStatus = statusFilter === "active" ? "pending,retrying,failed" : statusFilter === "all" ? undefined : statusFilter;

  const { data: failures = [], isLoading, refetch } = useQuery<FinancialEventFailure[]>({
    queryKey: ["/api/admin/financial-event-failures", statusFilter],
    queryFn: () => {
      const url = apiStatus
        ? `/api/admin/financial-event-failures?status=${encodeURIComponent(apiStatus)}`
        : `/api/admin/financial-event-failures`;
      return fetchJson(url);
    },
    refetchInterval: 30000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/financial-event-failures/${id}/retry`),
    onSuccess: () => {
      toast({ title: "Retry complete", description: "Ledger write replayed." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-event-failures"] });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/financial-event-failures/reconcile"),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      toast({ title: "Reconciliation complete", description: `Resolved: ${data.resolved ?? 0}  Still failing: ${data.stillFailed ?? 0}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-event-failures"] });
    },
    onError: (e: any) => toast({ title: "Reconciliation failed", description: e.message, variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("PATCH", `/api/admin/financial-event-failures/${id}/ignore`, { reason }),
    onSuccess: () => {
      toast({ title: "Marked ignored", description: "Failure recorded and will not be retried." });
      setIgnoreRow(null);
      setIgnoreReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-event-failures"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pendingCount = failures.filter(f => f.status === "pending" || f.status === "retrying").length;
  const failedCount = failures.filter(f => f.status === "failed").length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-financial-failures">Financial Event Failure Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">Durable queue of failed revenue and credit ledger writes. Retry, reconcile, or dismiss each entry.</p>
        </div>
        <Button
          onClick={() => reconcileMutation.mutate()}
          disabled={reconcileMutation.isPending}
          variant="outline"
          data-testid="button-reconcile-all"
          className="gap-2"
        >
          <RotateCcw className={`w-4 h-4 ${reconcileMutation.isPending ? "animate-spin" : ""}`} />
          Reconcile All Pending
        </Button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "All Failures", val: failures.length, color: "text-foreground" },
          { label: "Pending / Retrying", val: pendingCount, color: "text-amber-600" },
          { label: "Failed (max attempts)", val: failedCount, color: "text-red-600" },
          { label: "Resolved / Ignored", val: failures.filter(f => f.status === "resolved" || f.status === "ignored").length, color: "text-green-600" },
        ].map(({ label, val, color }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`} data-testid={`count-${label.replace(/\s+/g, "-").toLowerCase()}`}>{val}</p>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "active", label: "Active (Pending + Failed)" },
          { key: "all", label: "All" },
          { key: "resolved", label: "Resolved" },
          { key: "ignored", label: "Ignored" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            data-testid={`filter-${key}`}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              statusFilter === key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Failure Log</CardTitle>
          <CardDescription>{isLoading ? "Loading…" : `${failures.length} entries`}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading failures…</div>
          ) : failures.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No failures in this view — financial events are healthy.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Status", "Source", "Event Type", "Amount", "Attempts", "Created", "Last Attempt", "Message", "Actions"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {failures.map(f => {
                    const payload = f.payload as Record<string, any>;
                    const amountCents = payload?.amountCents as number | undefined;
                    return (
                      <tr key={f.id} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-failure-${f.id}`}>
                        <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={f.status} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${f.sourceType === "revenue_ledger" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}>
                            {f.sourceType === "revenue_ledger" ? "revenue" : "credit"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground">{f.eventType}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{fmtCents(amountCents)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`font-medium ${f.attempts >= (f.maxAttempts ?? 5) ? "text-red-600" : ""}`}>
                            {f.attempts}/{f.maxAttempts ?? 5}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(f.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(f.lastAttemptAt)}</td>
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="text-xs text-muted-foreground truncate" title={f.failureMessage ?? ""}>{f.failureMessage ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {(f.status === "pending" || f.status === "retrying" || f.status === "failed") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => retryMutation.mutate(f.id)}
                                disabled={retryMutation.isPending}
                                data-testid={`button-retry-${f.id}`}
                                className="h-7 text-xs gap-1"
                              >
                                <RefreshCw className="w-3 h-3" /> Retry
                              </Button>
                            )}
                            {(f.status === "pending" || f.status === "failed") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setIgnoreRow(f); setIgnoreReason(""); }}
                                data-testid={`button-ignore-${f.id}`}
                                className="h-7 text-xs gap-1 text-muted-foreground"
                              >
                                <XCircle className="w-3 h-3" /> Ignore
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDetailRow(f)}
                              data-testid={`button-view-${f.id}`}
                              className="h-7 text-xs gap-1 text-muted-foreground"
                            >
                              <Eye className="w-3 h-3" /> Details
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detailRow} onOpenChange={() => setDetailRow(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Failure Details</DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["ID", detailRow.id],
                  ["Status", detailRow.status],
                  ["Source Type", detailRow.sourceType],
                  ["Event Type", detailRow.eventType],
                  ["Client ID", detailRow.clientId ?? "—"],
                  ["Coach ID", detailRow.coachId ?? "—"],
                  ["Booking ID", detailRow.bookingId ?? "—"],
                  ["Redemption ID", detailRow.redemptionId ?? "—"],
                  ["Idempotency Key", detailRow.idempotencyKey ?? "—"],
                  ["Attempts", `${detailRow.attempts} / ${detailRow.maxAttempts}`],
                  ["Created", fmtDate(detailRow.createdAt)],
                  ["Last Attempt", fmtDate(detailRow.lastAttemptAt)],
                  ["Resolved At", fmtDate(detailRow.resolvedAt)],
                  ["Resolved By", detailRow.resolvedBy ?? "—"],
                  ["Ignore Reason", detailRow.ignoreReason ?? "—"],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="text-xs text-muted-foreground font-medium">{label}</p>
                    <p className="font-mono text-xs break-all">{String(value)}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1">Failure Message</p>
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">{detailRow.failureMessage ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1">Payload (JSON)</p>
                <pre data-testid="detail-payload" className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">{JSON.stringify(detailRow.payload, null, 2)}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={!!ignoreRow} onOpenChange={() => { setIgnoreRow(null); setIgnoreReason(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Ignored</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This failure will be permanently skipped from automatic retry. A reason is required for the audit record. The payload is preserved forever.
            </p>
            <Textarea
              placeholder="Enter reason for ignoring this failure…"
              value={ignoreReason}
              onChange={e => setIgnoreReason(e.target.value)}
              data-testid="input-ignore-reason"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIgnoreRow(null); setIgnoreReason(""); }} data-testid="button-cancel-ignore">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => ignoreRow && ignoreMutation.mutate({ id: ignoreRow.id, reason: ignoreReason })}
              disabled={!ignoreReason.trim() || ignoreMutation.isPending}
              data-testid="button-confirm-ignore"
            >
              {ignoreMutation.isPending ? "Saving…" : "Confirm Ignore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
