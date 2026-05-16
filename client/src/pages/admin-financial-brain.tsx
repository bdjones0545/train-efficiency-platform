import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, TrendingUp, TrendingDown, Minus, AlertTriangle,
  Users, Activity, RefreshCw, ChevronDown, ChevronRight,
  Send, Sparkles, Shield, Clock, DollarSign, UserCheck
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Anomaly { key: string; severity: "info" | "warning" | "critical"; label: string; detail: string; changePercent?: number }
interface ClientRisk { clientId: string; clientName: string; riskType: string; severity: "info" | "warning" | "critical"; description: string; sessionsRemaining?: number; daysSinceLastSession?: number; recommendedAction: string }
interface CoachInsight { coachId: string; coachName: string; sessionsCompleted: number; revenueGeneratedCents: number; accruedCents: number; paidCents: number; pendingCents: number; payoutRatioPct: number; weekOverWeekChange?: number; flags: string[] }
interface Forecast { label: string; currentCents: number; projectedMonthEndCents: number; weeklyRateCents: number; trend: "up" | "down" | "flat"; confidencePct: number }
interface Recommendation { key: string; severity: "info" | "warning" | "critical"; label: string; detail: string; estimatedImpact?: string; relatedEntities?: string[]; suggestedAction: string }

interface Digest {
  generatedAt: string;
  period: { label: string; start: string; end: string };
  revenueSummary: { collectedCents: number; recognizedCents: number; deferredLiabilityCents: number; wowCollectedChange?: number; wowRecognizedChange?: number };
  coachPayoutSummary: { totalAccruedCents: number; totalPaidCents: number; totalPendingCents: number; coachCount: number };
  failures: { pending: number; failed: number; stale: number };
  anomalies: Anomaly[];
  clientRisks: ClientRisk[];
  coachInsights: CoachInsight[];
  forecasts: Forecast[];
  recommendations: Recommendation[];
  narrative: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (c: number | null | undefined) => c == null ? "$0.00" : `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtPct = (n: number | undefined) => n == null ? "" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

const SEV_STYLE = {
  critical: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
  warning: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  info: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
};
const SEV_DOT = { critical: "bg-red-500", warning: "bg-amber-400", info: "bg-blue-400" };

function TrendIcon({ val }: { val?: number }) {
  if (val == null) return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  if (val > 2) return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
  if (val < -2) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

function ForecastIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (trend === "down") return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function Section({ title, icon: Icon, children, defaultOpen = true }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="flex items-center gap-2 w-full text-left mb-3 group"
        onClick={() => setOpen(v => !v)}
        data-testid={`section-toggle-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">{title}</span>
      </button>
      {open && children}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminFinancialBrainPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<{ answer: string; isAiGenerated: boolean; dataContext?: any } | null>(null);
  const [showContext, setShowContext] = useState(false);

  const { data: digest, isLoading, refetch, isFetching } = useQuery<Digest>({
    queryKey: ["/api/admin/financial-brain/digest"],
    staleTime: 5 * 60 * 1000,
  });

  const queryMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/admin/financial-brain/query", { question: q }),
    onSuccess: async (res: any) => {
      const data = await res.json?.() ?? res;
      setQueryResult(data);
    },
    onError: (e: any) => toast({ title: "Query failed", description: e.message, variant: "destructive" }),
  });

  const handleQuery = () => {
    if (!query.trim()) return;
    queryMutation.mutate(query.trim());
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-center">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">Analyzing financial data…</p>
        </div>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">No financial data available.</p>
      </div>
    );
  }

  const criticalCount = digest.anomalies.filter(a => a.severity === "critical").length;
  const criticalRecs = digest.recommendations.filter(r => r.severity === "critical").length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-brain">AI Financial Operations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Operational intelligence layer — anomaly detection, payout analysis, utilization risks, and forecasting.
          </p>
          {digest.generatedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Digest generated {new Date(digest.generatedAt).toLocaleString()} · {digest.period.label}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5" data-testid="button-refresh-digest">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Critical alert bar */}
      {(criticalCount > 0 || criticalRecs > 0) && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" data-testid="alert-critical">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            {criticalCount} critical anomal{criticalCount !== 1 ? "ies" : "y"} detected.
            {criticalRecs > 0 && ` ${criticalRecs} action${criticalRecs !== 1 ? "s" : ""} require immediate attention.`}
          </p>
        </div>
      )}

      {/* Revenue summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Collected", val: digest.revenueSummary.collectedCents, wow: digest.revenueSummary.wowCollectedChange, icon: DollarSign, testId: "card-collected" },
          { label: "Recognized", val: digest.revenueSummary.recognizedCents, wow: digest.revenueSummary.wowRecognizedChange, icon: Activity, testId: "card-recognized" },
          { label: "Deferred Liability", val: digest.revenueSummary.deferredLiabilityCents, icon: Clock, testId: "card-deferred" },
          { label: "Coach Pending", val: digest.coachPayoutSummary.totalPendingCents, icon: UserCheck, testId: "card-pending" },
        ].map(({ label, val, wow, icon: Icon, testId }) => (
          <Card key={label} className="p-4">
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{label}</p>
                <p className="text-xl font-bold mt-0.5 font-mono text-foreground" data-testid={testId}>{fmt(val)}</p>
                {wow != null && (
                  <div className="flex items-center gap-1 mt-1">
                    <TrendIcon val={wow} />
                    <span className={`text-xs font-medium ${wow > 0 ? "text-green-600" : wow < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {fmtPct(wow)} WoW
                    </span>
                  </div>
                )}
              </div>
              <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            </div>
          </Card>
        ))}
      </div>

      {/* AI Narrative Digest */}
      {digest.narrative && (
        <Section title="Daily Financial Digest" icon={Sparkles}>
          <Card className="p-5">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> AI-generated narrative · {digest.period.label}
            </p>
            <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap" data-testid="digest-narrative">
              {digest.narrative}
            </div>
          </Card>
        </Section>
      )}

      {/* Financial Risks / Anomalies */}
      <Section title="Financial Risks" icon={AlertTriangle}>
        {digest.anomalies.length === 0 ? (
          <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/20 border-green-200 text-sm text-green-700 dark:text-green-400">
            No anomalies detected — financial data looks healthy.
          </div>
        ) : (
          <div className="space-y-2">
            {digest.anomalies.map(a => (
              <div key={a.key} className={`flex items-start gap-3 p-3 rounded-lg border ${SEV_STYLE[a.severity]}`} data-testid={`anomaly-${a.key}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[a.severity]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{a.label}</p>
                    {a.changePercent != null && (
                      <span className={`text-xs font-mono ${a.changePercent < 0 ? "text-red-600" : "text-green-600"}`}>
                        {fmtPct(a.changePercent)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 opacity-80">{a.detail}</p>
                </div>
                <span className="text-xs font-medium capitalize opacity-70 flex-shrink-0">{a.severity}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* AI Recommendations */}
      <Section title="Recommended Actions" icon={Shield}>
        {digest.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendations at this time.</p>
        ) : (
          <div className="space-y-3">
            {digest.recommendations.map(r => (
              <Card key={r.key} className={`border ${r.severity === "critical" ? "border-red-200 dark:border-red-800" : r.severity === "warning" ? "border-amber-200 dark:border-amber-800" : "border-border"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[r.severity]}`} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground" data-testid={`rec-${r.key}`}>{r.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{r.detail}</p>
                      {r.estimatedImpact && (
                        <p className="text-xs mt-1.5 font-medium text-amber-700 dark:text-amber-400">Impact: {r.estimatedImpact}</p>
                      )}
                      <div className="mt-2 p-2 bg-muted rounded text-xs text-muted-foreground">
                        <span className="font-medium">Action: </span>{r.suggestedAction}
                      </div>
                      {r.relatedEntities && r.relatedEntities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.relatedEntities.map(e => (
                            <span key={e} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{e}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Coach Insights */}
      {digest.coachInsights.length > 0 && (
        <Section title="Coach Insights" icon={Users}>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Coach", "Sessions", "Revenue", "Accrued", "Pending", "Payout %", "MoM", "Flags"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {digest.coachInsights.map(c => (
                    <tr key={c.coachId} className="border-b hover:bg-muted/30" data-testid={`coach-row-${c.coachId}`}>
                      <td className="px-4 py-3 font-medium">{c.coachName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.sessionsCompleted}</td>
                      <td className="px-4 py-3 font-mono">{fmt(c.revenueGeneratedCents)}</td>
                      <td className="px-4 py-3 font-mono">{fmt(c.accruedCents)}</td>
                      <td className="px-4 py-3 font-mono">
                        <span className={c.pendingCents > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>{fmt(c.pendingCents)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">{c.payoutRatioPct}%</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <TrendIcon val={c.weekOverWeekChange} />
                          {c.weekOverWeekChange != null && (
                            <span className={`text-xs ${c.weekOverWeekChange > 0 ? "text-green-600" : c.weekOverWeekChange < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {fmtPct(c.weekOverWeekChange)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {c.flags.map(f => (
                            <span key={f} className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded">{f}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* Client Utilization Risks */}
      {digest.clientRisks.length > 0 && (
        <Section title="Client Utilization Risks" icon={UserCheck}>
          <div className="space-y-2">
            {digest.clientRisks.slice(0, 15).map(r => (
              <div key={r.clientId} className={`flex items-start gap-3 p-3 rounded-lg border ${SEV_STYLE[r.severity]}`} data-testid={`client-risk-${r.clientId}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEV_DOT[r.severity]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.clientName}</p>
                  <p className="text-xs mt-0.5 opacity-80">{r.description}</p>
                  <p className="text-xs mt-1 font-medium opacity-70">→ {r.recommendedAction}</p>
                </div>
                <span className="text-xs opacity-60 flex-shrink-0 capitalize">{r.riskType.replace(/_/g, " ")}</span>
              </div>
            ))}
            {digest.clientRisks.length > 15 && (
              <p className="text-xs text-muted-foreground text-center">+{digest.clientRisks.length - 15} more risks</p>
            )}
          </div>
        </Section>
      )}

      {/* Forecasts */}
      {digest.forecasts.length > 0 && (
        <Section title="Forecasts" icon={TrendingUp} defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {digest.forecasts.map(f => (
              <Card key={f.label} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-foreground">{f.label}</p>
                  <ForecastIcon trend={f.trend} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Month-to-date</p>
                    <p className="font-mono font-semibold mt-0.5" data-testid={`forecast-current-${f.label.slice(0, 8)}`}>{fmt(f.currentCents)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Projected month-end</p>
                    <p className="font-mono font-semibold mt-0.5 text-primary" data-testid={`forecast-projected-${f.label.slice(0, 8)}`}>{fmt(f.projectedMonthEndCents)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Weekly rate</p>
                    <p className="font-mono mt-0.5">{fmt(f.weeklyRateCents)}/wk</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Confidence</p>
                    <p className="font-semibold mt-0.5">{f.confidencePct}%</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Forecasts use rolling weekly averages. For trend guidance only — not guarantees.</p>
        </Section>
      )}

      {/* AI Financial Query Assistant */}
      <Section title="Financial Query Assistant" icon={Brain} defaultOpen={false}>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Ask a finance question in plain language. Responses are grounded in real data — no hallucinated figures.
          </p>
          <div className="flex gap-2">
            <Textarea
              placeholder="e.g. Which coaches have pending payouts? / Why is deferred revenue high? / Which clients have unused credits?"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="text-sm min-h-[70px] resize-none"
              data-testid="input-financial-query"
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleQuery(); }}
            />
            <Button
              onClick={handleQuery}
              disabled={!query.trim() || queryMutation.isPending}
              className="self-end gap-1.5"
              data-testid="button-submit-query"
            >
              <Send className="w-3.5 h-3.5" />
              {queryMutation.isPending ? "Thinking…" : "Ask"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[
              "Which coaches have pending payouts?",
              "Which clients have unused credits?",
              "Why is deferred revenue high?",
              "Show me recognition events this month",
            ].map(suggestion => (
              <button
                key={suggestion}
                onClick={() => setQuery(suggestion)}
                className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {queryResult && (
            <div className="mt-4 space-y-3">
              <div className="p-3 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-2 mb-2">
                  {queryResult.isAiGenerated ? (
                    <span className="flex items-center gap-1 text-xs text-primary font-medium"><Sparkles className="w-3 h-3" /> AI Response</span>
                  ) : (
                    <span className="text-xs text-muted-foreground font-medium">Structured Response</span>
                  )}
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap" data-testid="query-answer">{queryResult.answer}</p>
              </div>
              <button
                onClick={() => setShowContext(v => !v)}
                className="text-xs text-muted-foreground underline"
                data-testid="toggle-data-context"
              >
                {showContext ? "Hide" : "Show"} raw data context
              </button>
              {showContext && (
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-64" data-testid="raw-context">
                  {JSON.stringify(queryResult.dataContext, null, 2)}
                </pre>
              )}
            </div>
          )}
        </Card>
      </Section>

      {/* Safety notice */}
      <div className="p-3 rounded-lg border bg-muted/30 text-xs text-muted-foreground flex items-start gap-2">
        <Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>All AI outputs are advisory. This system never mutates accounting data, auto-closes periods, adjusts payouts, or reconciles silently. Every financial action requires explicit admin confirmation.</span>
      </div>
    </div>
  );
}
