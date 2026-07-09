import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  BarChart3, TrendingUp, TrendingDown, CheckCircle2, XCircle,
  RefreshCw, Brain, BookOpen, AlertTriangle, ChevronRight,
  MessageSquare, Zap, Target, Clock, Edit3, Activity,
  ArrowUpRight, ArrowDownRight, Minus, Info, Link2,
  Users, CalendarCheck, TrendingUp as TrendUp, DollarSign,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Leads", parent_lead: "Parent Leads", evaluation_scheduling: "Eval Scheduling",
  onboarding: "Onboarding", retention: "Retention", payment_recovery: "Payment Recovery",
  program_assignment: "Program Assignment", win_back: "Win Back", team_training: "Team Training",
  school_partnership: "School Partnerships", athletic_director: "Athletic Directors",
  coach_outreach: "Coach Outreach", organization_outreach: "Org Outreach",
  business_outreach: "Business Outreach", employment_opportunity: "Employment",
  corporate_wellness: "Corporate Wellness", facility_partnership: "Facility Partners",
  gym_owner: "Gym Owners",
};

const DOMAIN_BADGE: Record<string, string> = {
  athlete_lead: "bg-blue-100 text-blue-800",
  parent_lead: "bg-purple-100 text-purple-800",
  onboarding: "bg-green-100 text-green-800",
  retention: "bg-amber-100 text-amber-800",
  payment_recovery: "bg-red-100 text-red-800",
  team_training: "bg-cyan-100 text-cyan-800",
  general: "bg-gray-100 text-gray-800",
};

function domainLabel(d: string) {
  return DOMAIN_LABELS[d] ?? d;
}

function pctColor(val: number | null, invertBad = false) {
  if (val == null) return "text-gray-500";
  const high = val >= 70;
  const low = val <= 30;
  if (invertBad) return high ? "text-red-600" : low ? "text-green-600" : "text-yellow-600";
  return high ? "text-green-600" : low ? "text-red-600" : "text-yellow-600";
}

function DeltaBadge({ value, invertBad = false }: { value: number | null; invertBad?: boolean }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const isPositive = invertBad ? value < 0 : value > 0;
  const isNeutral = value === 0;
  if (isNeutral) return <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="w-3 h-3" />0%</span>;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-semibold ${isPositive ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {value > 0 ? "+" : ""}{value}%
    </span>
  );
}

// ─── Summary Tab ─────────────────────────────────────────────────────────────

function SummaryTab({ range, domain }: { range: string; domain: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-analytics/summary", range, domain],
    queryFn: () => {
      const params = new URLSearchParams({ range });
      if (domain !== "all") params.set("domain", domain);
      return fetch(`/api/admin/agentmail-analytics/summary?${params}`, { credentials: "include" }).then((r) => r.json());
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const t = data?.totals ?? {};

  const cards = [
    { label: "Drafts Generated", value: t.draftsGenerated ?? 0, icon: Zap, color: "text-blue-600", sub: `${range} window` },
    { label: "Approval Rate", value: t.approvalRate != null ? `${t.approvalRate}%` : "—", icon: CheckCircle2, color: pctColor(t.approvalRate), sub: `${t.approved ?? 0} approved` },
    { label: "Edit Rate", value: t.editRate != null ? `${t.editRate}%` : "—", icon: Edit3, color: pctColor(t.editRate, true), sub: `${t.edited ?? 0} edited` },
    { label: "Rejection Rate", value: t.rejectionRate != null ? `${t.rejectionRate}%` : "—", icon: XCircle, color: pctColor(t.rejectionRate, true), sub: `${t.rejected ?? 0} rejected` },
    { label: "Avg Time to Approval", value: t.avgTimeToApprovalHours != null ? `${t.avgTimeToApprovalHours}h` : "—", icon: Clock, color: "text-muted-foreground", sub: "hours" },
    { label: "Saved for Review", value: t.savedForReview ?? 0, icon: BookOpen, color: (t.savedForReview ?? 0) >= 5 ? "text-amber-600" : "text-gray-500", sub: "awaiting action" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={`w-4 h-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className="text-2xl font-bold" data-testid={`card-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
          </Card>
        ))}
      </div>

      {/* Trends comparison */}
      {data?.trends && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Period-over-Period Comparison
              <span className="text-xs text-muted-foreground font-normal">vs previous {range}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Approval Rate", delta: data.trends.deltaApprovalRate, current: data.trends.currentPeriod?.approvalRate },
                { label: "Edit Rate", delta: data.trends.deltaEditRate, current: data.trends.currentPeriod?.editRate, invert: true },
                { label: "Rejection Rate", delta: data.trends.deltaRejectionRate, current: data.trends.currentPeriod?.rejectionRate, invert: true },
                { label: "Time to Approval", delta: data.trends.deltaAvgTimeToApproval, current: data.trends.currentPeriod?.avgTimeToApprovalHours, invert: true },
              ].map((m) => (
                <div key={m.label} className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-base font-bold">
                    {m.current != null ? (m.label.includes("Time") ? `${m.current}h` : `${m.current}%`) : "—"}
                  </p>
                  <DeltaBadge value={m.delta} invertBad={m.invert} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top feedback tags */}
      {(t.topFeedbackTags?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Top Feedback Chips ({range})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {t.topFeedbackTags.map((t: any) => (
                <div key={t.tag} className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full text-xs">
                  <span className="font-medium">{t.tag}</span>
                  <span className="text-muted-foreground">{t.count}×</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Domain Performance Tab ───────────────────────────────────────────────────

function DomainPerformanceTab({ range }: { range: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-analytics/summary", range, "all-domain-tab"],
    queryFn: () =>
      fetch(`/api/admin/agentmail-analytics/summary?range=${range}`, { credentials: "include" }).then((r) => r.json()),
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const byDomain = (data?.byDomain ?? []).filter((d: any) => d.totalReviewed > 0 || d.draftsGenerated > 0);

  if (byDomain.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No domain data yet for this period.</p>
        <p className="text-xs mt-1">Domain analytics appear after drafts are generated and reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground mb-2">{byDomain.length} active domain{byDomain.length !== 1 ? "s" : ""} in this period</div>
      {byDomain
        .sort((a: any, b: any) => b.totalReviewed - a.totalReviewed)
        .map((d: any) => (
          <Card key={d.domain} className="p-4" data-testid={`card-domain-${d.domain}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[d.domain] ?? DOMAIN_BADGE.general}`}>
                    {d.label}
                  </span>
                  {(d.rejectionRate ?? 0) >= 50 && (
                    <Badge variant="destructive" className="text-xs">High Rejection</Badge>
                  )}
                  {(d.editRate ?? 0) >= 60 && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">High Edit Rate</Badge>
                  )}
                </div>
                {(d.topFeedbackTags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {d.topFeedbackTags.slice(0, 4).map((t: any) => (
                      <span key={t.tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">{t.tag} ({t.count})</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3 text-center shrink-0">
                {[
                  { label: "Drafts", value: d.draftsGenerated },
                  { label: "Approval", value: d.approvalRate != null ? `${d.approvalRate}%` : "—", color: pctColor(d.approvalRate) },
                  { label: "Edit", value: d.editRate != null ? `${d.editRate}%` : "—", color: pctColor(d.editRate, true) },
                  { label: "Reject", value: d.rejectionRate != null ? `${d.rejectionRate}%` : "—", color: pctColor(d.rejectionRate, true) },
                ].map((m) => (
                  <div key={m.label} className="min-w-[48px]">
                    <p className={`text-base font-bold ${(m as any).color ?? ""}`}>{m.value}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </div>
                ))}
              </div>
            </div>
            {d.avgTimeToApprovalHours != null && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Avg approval time: {d.avgTimeToApprovalHours}h
              </p>
            )}
          </Card>
        ))}
    </div>
  );
}

// ─── Feedback Insights Tab ────────────────────────────────────────────────────

function FeedbackInsightsTab({ range }: { range: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-analytics/feedback", range],
    queryFn: () =>
      fetch(`/api/admin/agentmail-analytics/feedback?range=${range}`, { credentials: "include" }).then((r) => r.json()),
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{data?.totalFeedbackRecords ?? 0} feedback records in {range}</span>
        {data?.coachingCommentCount > 0 && <span>{data.coachingCommentCount} coaching comments</span>}
      </div>

      {/* Top global tags */}
      {(data?.topFeedbackTags?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Most Common Feedback Chips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topFeedbackTags.map((t: any, i: number) => (
                <div key={t.tag} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.round((t.count / (data.topFeedbackTags[0]?.count ?? 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium min-w-[120px]">{t.tag}</span>
                  <span className="text-xs text-muted-foreground w-8 text-right">{t.count}×</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* High correction domains */}
      {(data?.highCorrectionDomains?.length ?? 0) > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" /> Domains with Highest Correction Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.highCorrectionDomains.map((d: any) => (
                <div key={d.domain} className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[d.domain] ?? DOMAIN_BADGE.general}`}>
                    {d.label}
                  </span>
                  <div className="flex-1" />
                  <span className={`text-sm font-bold ${pctColor(d.correctionRate, true)}`}>{d.correctionRate}%</span>
                  <span className="text-xs text-muted-foreground">correction rate</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <Info className="w-3 h-3" />
              Add standing instructions for high-correction domains to reduce editing.{" "}
              <a href="/admin/agentmail-learning" className="text-primary hover:underline">Open Learning Center →</a>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Daily timeline */}
      {(data?.dailyTimeline?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" /> Daily Activity ({range})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.dailyTimeline.slice(-14).map((day: any) => {
                const total = day.approved + day.edited + day.rejected;
                return (
                  <div key={day.date} className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground w-20 shrink-0">{new Date(day.date).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                    <div className="flex-1 flex gap-0.5 h-4 rounded overflow-hidden bg-muted">
                      {day.approved > 0 && <div className="bg-green-500 h-full" style={{ width: `${(day.approved / total) * 100}%` }} title={`Approved: ${day.approved}`} />}
                      {day.edited > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(day.edited / total) * 100}%` }} title={`Edited: ${day.edited}`} />}
                      {day.rejected > 0 && <div className="bg-red-400 h-full" style={{ width: `${(day.rejected / total) * 100}%` }} title={`Rejected: ${day.rejected}`} />}
                    </div>
                    <span className="text-muted-foreground w-6 text-right">{total}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 mt-2 pt-2 border-t text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-500 inline-block" />Approved</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-400 inline-block" />Edited</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-400 inline-block" />Rejected</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.totalFeedbackRecords === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No feedback records yet for this period.</p>
        </div>
      )}
    </div>
  );
}

// ─── Confidence badge helper ──────────────────────────────────────────────────

function ConfidenceBadge({ level, count }: { level: string; count: number }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    high:   { label: "High confidence", cls: "bg-green-100 text-green-700 border border-green-200" },
    medium: { label: "Medium confidence", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
    low:    { label: "Low confidence", cls: "bg-gray-100 text-gray-600 border border-gray-200" },
    none:   { label: "No data yet", cls: "bg-muted text-muted-foreground border" },
  };
  const { label, cls } = cfg[level] ?? cfg.none;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cls}`} title={`${count} application${count !== 1 ? "s" : ""} recorded`}>
      {level === "none" ? label : `${label} (${count}×)`}
    </span>
  );
}

// ─── Rule row component ───────────────────────────────────────────────────────

const PERF_LABEL_MAP: Record<string, string> = {
  high_performing:   "bg-green-100 text-green-800 border-green-200",
  stable:            "bg-blue-100 text-blue-800 border-blue-200",
  needs_review:      "bg-amber-100 text-amber-800 border-amber-200",
  insufficient_data: "bg-gray-100 text-gray-600 border-gray-200",
};
const PERF_LABEL_MAP_LABEL: Record<string, string> = {
  high_performing:   "High Performing",
  stable:            "Stable",
  needs_review:      "Needs Review",
  insufficient_data: "Insufficient Data",
};

function RuleRow({ r, typeClass, trackingAvailable }: { r: any; typeClass: string; trackingAvailable: boolean }) {
  const hasOutcome = r.approvalRateAfterApplied != null || r.rejectionRateAfterApplied != null;
  return (
    <div
      className={`border rounded-lg p-3 space-y-2 ${!r.isActive ? "opacity-50" : ""}`}
      data-testid={`row-rule-${r.ruleId}`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${typeClass}`}>{r.ruleType}</span>
        <span className="flex-1 text-sm leading-snug">{r.ruleText}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${DOMAIN_BADGE[r.domain] ?? DOMAIN_BADGE.general}`}>
          {domainLabel(r.domain)}
        </span>
        {!r.isActive && <Badge variant="outline" className="text-xs shrink-0">Disabled</Badge>}
      </div>

      {/* Performance label + outcome rates */}
      {r.performanceLabel && (
        <div className="flex items-center gap-2 flex-wrap pl-0.5">
          {r.performanceLabel !== "insufficient_data" && (
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${PERF_LABEL_MAP[r.performanceLabel] ?? ""}`} data-testid={`perf-label-${r.ruleId}`}>
              {PERF_LABEL_MAP_LABEL[r.performanceLabel] ?? r.performanceLabel}
            </span>
          )}
          {r.outcomeRates?.totalOutcomes > 0 && (
            <span className="text-xs text-green-600 flex items-center gap-0.5">
              <Link2 className="w-3 h-3" />{r.outcomeRates.totalOutcomes} associated outcome{r.outcomeRates.totalOutcomes === 1 ? "" : "s"}
            </span>
          )}
          {r.outcomeRates?.replyCount > 0 && (
            <span className="text-xs text-muted-foreground">{r.outcomeRates.replyCount} reply</span>
          )}
          {r.outcomeRates?.evalCount > 0 && (
            <span className="text-xs text-muted-foreground">{r.outcomeRates.evalCount} eval</span>
          )}
          {r.outcomeRates?.conversionCount > 0 && (
            <span className="text-xs text-emerald-600 font-medium">{r.outcomeRates.conversionCount} conversion{r.outcomeRates.conversionCount === 1 ? "" : "s"}</span>
          )}
        </div>
      )}

      {/* Tracking stats row */}
      <div className="flex items-center gap-3 flex-wrap pl-0.5">
        {trackingAvailable ? (
          <>
            <ConfidenceBadge level={r.outcomeConfidence ?? "none"} count={r.timesApplied ?? 0} />
            {hasOutcome ? (
              <>
                {r.approvalRateAfterApplied != null && (
                  <span className={`text-xs flex items-center gap-0.5 ${pctColor(r.approvalRateAfterApplied)}`}>
                    <CheckCircle2 className="w-3 h-3" />{r.approvalRateAfterApplied}% approval
                  </span>
                )}
                {r.editRateAfterApplied != null && (
                  <span className={`text-xs flex items-center gap-0.5 ${pctColor(r.editRateAfterApplied, true)}`}>
                    <Edit3 className="w-3 h-3" />{r.editRateAfterApplied}% edit
                  </span>
                )}
                {r.rejectionRateAfterApplied != null && (
                  <span className={`text-xs flex items-center gap-0.5 ${pctColor(r.rejectionRateAfterApplied, true)}`}>
                    <XCircle className="w-3 h-3" />{r.rejectionRateAfterApplied}% reject
                  </span>
                )}
              </>
            ) : (
              r.timesApplied > 0 && (
                <span className="text-xs text-muted-foreground">Applied {r.timesApplied}× — outcomes pending review</span>
              )
            )}
            {r.lastAppliedAt && (
              <span className="text-xs text-muted-foreground ml-auto">
                Last used {new Date(r.lastAppliedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground italic">Application tracking not yet active for this rule</span>
        )}
      </div>
    </div>
  );
}

// ─── Rule Performance Tab ─────────────────────────────────────────────────────

function RulePerformanceTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-analytics/rules"],
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const RULE_TYPE_BADGE: Record<string, string> = {
    do: "bg-green-50 text-green-700 border border-green-200",
    avoid: "bg-red-50 text-red-700 border border-red-200",
    tone: "bg-purple-50 text-purple-700 border border-purple-200",
    instruction: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    cta: "bg-blue-50 text-blue-700 border border-blue-200",
    length: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  };

  const s = data?.summary ?? {};
  const highRejection = data?.highRejectionDomains ?? [];
  const trackingAvailable = data?.trackingAvailable ?? false;

  const PERF_LABEL: Record<string, { label: string; cls: string }> = {
    high_performing:   { label: "High Performing",   cls: "bg-green-100 text-green-800 border-green-200" },
    stable:            { label: "Stable",             cls: "bg-blue-100 text-blue-800 border-blue-200" },
    needs_review:      { label: "Needs Review",       cls: "bg-amber-100 text-amber-800 border-amber-200" },
    insufficient_data: { label: "Insufficient Data",  cls: "bg-gray-100 text-gray-600 border-gray-200" },
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Learned Rules", value: s.activeLearnedRules ?? 0, total: s.totalLearnedRules ?? 0 },
          { label: "High Performing", value: s.highPerformingCount ?? 0, highlight: (s.highPerformingCount ?? 0) > 0, color: "text-green-600" },
          { label: "Needs Review", value: s.needsReviewCount ?? 0, highlight: (s.needsReviewCount ?? 0) > 0, color: "text-amber-600" },
          { label: "Applications Recorded", value: s.totalApplicationsRecorded ?? 0, highlight: (s.totalApplicationsRecorded ?? 0) > 0 },
        ].map((c: any) => (
          <Card key={c.label} className="p-3">
            <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.color ?? (c.highlight ? "text-green-600" : "")}`}>{c.value}</p>
            {c.total !== undefined && c.total !== c.value && (
              <p className="text-xs text-muted-foreground">of {c.total} total</p>
            )}
          </Card>
        ))}
      </div>

      {/* Tracking status banner */}
      {trackingAvailable ? (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-4">
          <p className="text-sm text-green-800 dark:text-green-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Rule application tracking is active.</strong> {s.totalApplicationsRecorded ?? 0} rule applications recorded so far. Approval/rejection rates will appear as more drafts are reviewed. Confidence: <strong>High</strong> ≥10, <strong>Medium</strong> 5–9, <strong>Low</strong> 1–4.
            </span>
          </p>
        </Card>
      ) : (
        <Card className="border-blue-100 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Rule tracking instrumented — waiting for first drafts.</strong> The next draft generated with active learning rules will record which rules were applied. Per-rule outcome rates appear here once data accumulates.
            </span>
          </p>
        </Card>
      )}

      {/* High rejection domains */}
      {highRejection.length > 0 && (
        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" /> Domains Needing Rule Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {highRejection.map((d: any) => (
                <div key={d.domain} className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[d.domain] ?? DOMAIN_BADGE.general}`}>{d.label}</span>
                  <span className="text-xs text-muted-foreground">{d.totalReviewed} reviewed</span>
                  <div className="flex-1" />
                  <span className="text-sm font-bold text-red-600">{d.rejectionRate}% rejected</span>
                  <a href="/admin/agentmail-learning" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                    Fix rules <ChevronRight className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standing instructions */}
      {(data?.standingInstructions?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Standing Instructions ({data.standingInstructions.filter((r: any) => r.isActive).length} active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.standingInstructions.slice(0, 10).map((r: any) => (
                <RuleRow
                  key={r.ruleId}
                  r={r}
                  typeClass={RULE_TYPE_BADGE[r.ruleType] ?? RULE_TYPE_BADGE.instruction}
                  trackingAvailable={trackingAvailable}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Learned rules */}
      {(data?.learnedRules?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-purple-600" />
              Learned Rules ({data.learnedRules.filter((r: any) => r.isActive).length} active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.learnedRules.slice(0, 15).map((r: any) => (
                <RuleRow
                  key={r.ruleId}
                  r={r}
                  typeClass={RULE_TYPE_BADGE[r.ruleType] ?? RULE_TYPE_BADGE.instruction}
                  trackingAvailable={trackingAvailable}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {s.totalLearnedRules === 0 && s.totalStandingInstructions === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No rules yet. Rules are extracted automatically when you provide feedback on drafts.</p>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/admin/agentmail-learning">
          <Button variant="outline" size="sm" data-testid="link-manage-rules">
            <BookOpen className="w-3.5 h-3.5 mr-1.5" /> Manage Learning Rules →
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Lead Context Tab ─────────────────────────────────────────────────────────

const CONFIDENCE_BADGE: Record<string, string> = {
  none:   "bg-gray-100 text-gray-500 border-gray-200",
  low:    "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  high:   "bg-green-50 text-green-700 border-green-200",
};

function RateCompareCell({ withVal, withoutVal }: { withVal: number | null; withoutVal: number | null }) {
  if (withVal === null && withoutVal === null) return <span className="text-xs text-muted-foreground">—</span>;
  const diff = withVal !== null && withoutVal !== null ? withVal - withoutVal : null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-medium">{withVal !== null ? `${withVal}%` : "—"}</span>
      <span className="text-muted-foreground">vs {withoutVal !== null ? `${withoutVal}%` : "—"}</span>
      {diff !== null && Math.abs(diff) >= 3 && (
        <span className={diff > 0 ? "text-green-600 font-semibold" : "text-red-500 font-semibold"}>
          ({diff > 0 ? "+" : ""}{diff}pp)
        </span>
      )}
    </div>
  );
}

function LeadContextTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-learning/prior-context-analytics"],
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const d = data ?? {};
  const totals = d.totals ?? {};
  const byDomain: any[] = d.byDomain ?? [];
  const recentExamples: any[] = d.recentExamples ?? [];
  const repeatedNR: { domain: string; count: number }[] = d.repeatedNoReplyDomains ?? [];
  const withCtx = totals.draftsWithPriorContext ?? 0;
  const withoutCtx = totals.draftsWithoutPriorContext ?? 0;
  const hasData = withCtx > 0;

  return (
    <div className="space-y-5">
      <Card className="border-blue-100 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-3">
        <p className="text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>AgentMail tracks <strong>individual relationship history</strong> per lead. Drafts where prior contact context was injected are labelled "with prior context." Metrics show <em>associated</em> rates — not causal.</span>
        </p>
      </Card>

      {!hasData ? (
        <Card className="p-8 text-center" data-testid="lead-context-empty-state">
          <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Prior contact tracking is now active</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Metrics will appear as new drafts are generated. All new domain outreach, intake, and workflow email drafts now record whether prior contact context was used.
          </p>
        </Card>
      ) : (
        <>
          {/* ── Comparison KPI bar ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              {
                label: "Drafts",
                withVal: withCtx,
                withoutVal: withoutCtx,
                icon: <Brain className="w-3.5 h-3.5 text-blue-500" />,
                raw: true,
              },
              {
                label: "Associated reply rate",
                withVal: totals.replyRateWithContext,
                withoutVal: totals.replyRateWithoutContext,
                icon: <MessageSquare className="w-3.5 h-3.5 text-green-500" />,
              },
              {
                label: "Associated conversion rate",
                withVal: totals.conversionRateWithContext,
                withoutVal: totals.conversionRateWithoutContext,
                icon: <Target className="w-3.5 h-3.5 text-orange-500" />,
              },
              {
                label: "Evaluation rate",
                withVal: totals.evaluationRateWithContext,
                withoutVal: totals.evaluationRateWithoutContext,
                icon: <CalendarCheck className="w-3.5 h-3.5 text-purple-500" />,
              },
              {
                label: "First session rate",
                withVal: totals.firstSessionRateWithContext,
                withoutVal: totals.firstSessionRateWithoutContext,
                icon: <Users className="w-3.5 h-3.5 text-cyan-500" />,
              },
            ].map((k) => (
              <Card key={k.label} className="p-3" data-testid={`kpi-prior-ctx-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-1.5 mb-1">{k.icon}<p className="text-xs text-muted-foreground leading-tight">{k.label}</p></div>
                {k.raw ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-bold text-base text-blue-700">{k.withVal}</span>
                      <span className="text-muted-foreground">with context</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{k.withoutVal} without context</div>
                  </div>
                ) : (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center gap-1 text-xs">
                      <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      <span className="text-muted-foreground">With context:</span>
                      <span className="font-semibold">{k.withVal != null ? `${k.withVal}%` : "—"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                      <span className="text-muted-foreground">Without:</span>
                      <span className="font-semibold">{k.withoutVal != null ? `${k.withoutVal}%` : "—"}</span>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* ── Domain comparison table ─────────────────────────────────── */}
          {byDomain.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-500" /> By Communication Domain
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b bg-muted/30">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Domain</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Drafts (with / without)</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Reply rate</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Conversion rate</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Confidence</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">Interpretation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byDomain.map((row: any) => (
                        <tr key={row.domain} className="border-b last:border-0 hover:bg-muted/20" data-testid={`row-domain-ctx-${row.domain}`}>
                          <td className="px-3 py-2 font-medium capitalize">{row.domain.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className="text-blue-700">{row.withContextCount}</span>
                            <span className="text-muted-foreground"> / {row.withoutContextCount}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <RateCompareCell withVal={row.replyRateWithContext} withoutVal={row.replyRateWithoutContext} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <RateCompareCell withVal={row.conversionRateWithContext} withoutVal={row.conversionRateWithoutContext} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Badge variant="outline" className={`text-xs ${CONFIDENCE_BADGE[row.dataConfidence] ?? CONFIDENCE_BADGE.none}`}>
                              {row.dataConfidence}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[200px] leading-tight">{row.interpretation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Recent examples ─────────────────────────────────────────── */}
          {recentExamples.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" /> Recent Prior-Context Drafts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentExamples.slice(0, 5).map((ex: any) => (
                    <div key={ex.actionId} className="bg-muted/30 rounded-lg p-3 text-xs space-y-1" data-testid={`example-prior-ctx-${ex.actionId}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="font-medium">{ex.recipientEmail}</div>
                          <div className="text-muted-foreground capitalize">{(ex.domain ?? "").replace(/_/g, " ")}</div>
                        </div>
                        <div className="text-muted-foreground shrink-0">
                          {ex.createdAt ? new Date(ex.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" }) : "—"}
                        </div>
                      </div>
                      {ex.priorContactSummary && (
                        <div className="text-muted-foreground">
                          {ex.priorContactSummary.sentCount} prior email{ex.priorContactSummary.sentCount === 1 ? "" : "s"} sent
                          {ex.priorContactSummary.replyCount > 0 ? `, ${ex.priorContactSummary.replyCount} repl${ex.priorContactSummary.replyCount === 1 ? "y" : "ies"}` : ", no replies yet"}
                          {ex.priorContactSummary.converted ? " · Converted" : ""}
                          {ex.priorContactSummary.evaluationScheduled ? " · Eval scheduled" : ""}
                        </div>
                      )}
                      {ex.outcomes.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {ex.outcomes.map((o: string) => (
                            <Badge key={o} variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                              {o.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Repeated no-reply domains ─────────────────────────────────── */}
      {repeatedNR.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Domains with Repeated No-Reply Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {repeatedNR.map((r) => (
                <div key={r.domain} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0" data-testid={`row-noreply-domain-${r.domain}`}>
                  <span className="capitalize text-muted-foreground">{r.domain.replace(/_/g, " ")}</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{r.count} lead{r.count === 1 ? "" : "s"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(d.leadsContactedWithoutReply ?? 0) > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span><strong>{d.leadsContactedWithoutReply}</strong> recipient{d.leadsContactedWithoutReply === 1 ? " has" : "s have"} received 3+ emails without any reply — consider pausing outreach or adjusting the follow-up strategy.</span>
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── Outcomes Tab ─────────────────────────────────────────────────────────────

const OUTCOME_ICONS: Record<string, React.ReactNode> = {
  reply_received:         <MessageSquare className="w-3.5 h-3.5" />,
  evaluation_scheduled:   <CalendarCheck className="w-3.5 h-3.5" />,
  evaluation_completed:   <CheckCircle2 className="w-3.5 h-3.5" />,
  lead_converted:         <Users className="w-3.5 h-3.5" />,
  first_session_scheduled:<Target className="w-3.5 h-3.5" />,
  program_assigned:       <BookOpen className="w-3.5 h-3.5" />,
  payment_recovered:      <DollarSign className="w-3.5 h-3.5" />,
  booking_created:        <Clock className="w-3.5 h-3.5" />,
};

const OUTCOME_LABELS: Record<string, string> = {
  reply_received: "Reply Received", evaluation_scheduled: "Evaluation Scheduled",
  evaluation_completed: "Evaluation Completed", lead_converted: "Lead Converted",
  first_session_scheduled: "First Session Scheduled", program_assigned: "Program Assigned",
  payment_recovered: "Payment Recovered", booking_created: "Booking Created",
};

function OutcomesTab({ range, domain }: { range: string; domain: string }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-outcomes/summary", range, domain],
    queryFn: () => fetch(`/api/admin/agentmail-outcomes/summary?range=${range}&domain=${domain}`, { credentials: "include" }).then((r) => r.json()),
  });

  const recomputeMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/agentmail-outcomes/recompute"),
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ["/api/admin/agentmail-outcomes/summary"] }); },
  });

  if (isLoading) return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const t = data?.totals ?? {};
  const sent = t.sentMessages ?? 0;
  const hasData = data?.dataAvailable ?? false;

  const kpiCards = [
    { label: "Emails Sent", value: sent, icon: <MessageSquare className="w-4 h-4 text-blue-500" /> },
    { label: "Associated Replies", value: t.replies ?? 0, pct: sent, icon: <MessageSquare className="w-4 h-4 text-green-500" /> },
    { label: "Evaluations Scheduled", value: t.evaluationsScheduled ?? 0, pct: sent, icon: <CalendarCheck className="w-4 h-4 text-purple-500" /> },
    { label: "Lead Conversions", value: t.conversions ?? 0, pct: sent, icon: <Users className="w-4 h-4 text-orange-500" /> },
    { label: "First Sessions", value: t.firstSessionsScheduled ?? 0, pct: sent, icon: <Target className="w-4 h-4 text-cyan-500" /> },
    { label: "Programs Assigned", value: t.programsAssigned ?? 0, pct: sent, icon: <BookOpen className="w-4 h-4 text-indigo-500" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Disclaimer */}
      <Card className="border-amber-100 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3">
        <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>These are <strong>associated outcomes</strong> — platform events that occurred after an email was sent to the same lead. They do not imply causation. Use as directional signal only.</span>
        </p>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpiCards.map((c) => (
          <Card key={c.label} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {c.icon}
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
            <p className="text-2xl font-bold">{c.value}</p>
            {c.pct != null && c.pct > 0 && (
              <p className="text-xs text-muted-foreground">{Math.round((c.value / c.pct) * 100)}% rate</p>
            )}
          </Card>
        ))}
      </div>

      {/* Outcome breakdown */}
      {(data?.byOutcomeType?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" /> Outcome Breakdown (after {range})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.byOutcomeType.filter((o: any) => o.count > 0).map((o: any) => (
                <div key={o.outcomeType} className="flex items-center gap-3" data-testid={`outcome-row-${o.outcomeType}`}>
                  <span className="text-muted-foreground shrink-0">{OUTCOME_ICONS[o.outcomeType]}</span>
                  <span className="text-sm flex-1">{o.label}</span>
                  <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, o.rate * 5)}%` }} />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{o.count}</span>
                  <span className="text-xs text-muted-foreground w-12 text-right">{o.rate}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Domain breakdown */}
      {(data?.byDomain?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" /> Outcomes by Domain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left pb-1.5 font-medium">Domain</th>
                    <th className="text-right pb-1.5 font-medium">Sent</th>
                    <th className="text-right pb-1.5 font-medium">Replies</th>
                    <th className="text-right pb-1.5 font-medium">Evals</th>
                    <th className="text-right pb-1.5 font-medium">Conversions</th>
                    <th className="text-right pb-1.5 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDomain.map((d: any) => (
                    <tr key={d.domain} className="border-b last:border-0" data-testid={`domain-outcome-${d.domain}`}>
                      <td className="py-1.5">
                        <span className={`px-1.5 py-0.5 rounded-full text-xs ${DOMAIN_BADGE[d.domain] ?? DOMAIN_BADGE.general}`}>{d.label}</span>
                      </td>
                      <td className="text-right py-1.5">{d.sentCount}</td>
                      <td className="text-right py-1.5">{d.counts?.reply_received ?? 0}</td>
                      <td className="text-right py-1.5">{d.counts?.evaluation_scheduled ?? 0}</td>
                      <td className="text-right py-1.5">{d.counts?.lead_converted ?? 0}</td>
                      <td className="text-right py-1.5">{d.counts?.first_session_scheduled ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rule-associated outcomes */}
      {(data?.byRule?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-purple-600" /> Rule-Associated Outcomes
            </CardTitle>
            <p className="text-xs text-muted-foreground">Outcomes observed in emails where each rule was applied. Not causal.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.byRule.filter((r: any) => r.timesApplied > 0).slice(0, 12).map((r: any) => (
                <div key={r.ruleId} className="flex items-start gap-2 text-sm border rounded-lg p-2" data-testid={`rule-outcome-${r.ruleId}`}>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${r.ruleSource === "standing_instruction" ? "bg-indigo-50 text-indigo-700 border border-indigo-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>
                    {r.ruleSource === "standing_instruction" ? "instruction" : "learned"}
                  </span>
                  <span className="flex-1 leading-snug text-xs">{r.ruleText}</span>
                  <div className="text-right shrink-0 text-xs space-y-0.5">
                    <p className="text-muted-foreground">{r.timesApplied}× applied</p>
                    <p className={r.associatedOutcomes > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>
                      {r.associatedOutcomes} outcomes
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent events */}
      {(data?.recentEvents?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent Correlated Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.recentEvents.slice(0, 10).map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs" data-testid={`recent-event-${i}`}>
                  <span className="text-muted-foreground shrink-0">{OUTCOME_ICONS[e.outcomeType]}</span>
                  <span className="font-medium shrink-0">{OUTCOME_LABELS[e.outcomeType] ?? e.outcomeType}</span>
                  <span className={`px-1.5 py-0.5 rounded-full shrink-0 ${DOMAIN_BADGE[e.communicationDomain] ?? DOMAIN_BADGE.general}`}>{domainLabel(e.communicationDomain)}</span>
                  {e.recipientEmail && <span className="text-muted-foreground truncate">{e.recipientEmail}</span>}
                  <span className="ml-auto text-muted-foreground shrink-0">
                    {e.detectedAt ? new Date(e.detectedAt).toLocaleDateString("en", { month: "short", day: "numeric" }) : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!hasData && (
        <div className="text-center py-12 text-muted-foreground">
          <Link2 className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">No outcome data yet</p>
          <p className="text-xs mb-4">Run recompute to correlate sent emails with platform events.</p>
          <Button size="sm" onClick={() => recomputeMut.mutate()} disabled={recomputeMut.isPending} data-testid="btn-recompute-empty">
            {recomputeMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Recompute Outcomes
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {data?.lastRecomputedAt
            ? `Last correlated: ${new Date(data.lastRecomputedAt).toLocaleString()}`
            : "Not yet correlated"}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => recomputeMut.mutate()}
          disabled={recomputeMut.isPending}
          data-testid="btn-recompute-outcomes"
        >
          {recomputeMut.isPending
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Correlating…</>
            : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Recompute Outcomes</>}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentmailAnalyticsPage() {
  const [range, setRange] = useState("7d");
  const [domain, setDomain] = useState("all");

  const DOMAINS = [
    { value: "all", label: "All Domains" },
    { value: "athlete_lead", label: "Athlete Leads" },
    { value: "parent_lead", label: "Parent Leads" },
    { value: "evaluation_scheduling", label: "Evaluation Scheduling" },
    { value: "onboarding", label: "Onboarding" },
    { value: "retention", label: "Retention" },
    { value: "payment_recovery", label: "Payment Recovery" },
    { value: "team_training", label: "Team Training" },
    { value: "win_back", label: "Win Back" },
  ];

  return (
    <div className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            AgentMail Performance Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track draft quality, feedback trends, and learning rule effectiveness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/agentmail-learning">
            <Button variant="outline" size="sm" data-testid="link-learning-center">
              <Brain className="w-3.5 h-3.5 mr-1.5" />Learning Center
            </Button>
          </Link>
          <Link href="/admin/ai-approvals">
            <Button variant="outline" size="sm" data-testid="link-ai-approvals">
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />AI Approvals
            </Button>
          </Link>
        </div>
      </div>

      {/* Global filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="w-48 h-8 text-xs" data-testid="select-domain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOMAINS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Filters apply to Summary tab</span>
      </div>

      <Tabs defaultValue="summary">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="summary" className="text-xs" data-testid="tab-summary">Summary</TabsTrigger>
          <TabsTrigger value="domains" className="text-xs" data-testid="tab-domains">Domain Performance</TabsTrigger>
          <TabsTrigger value="feedback" className="text-xs" data-testid="tab-feedback">Feedback Insights</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs" data-testid="tab-rules">Rule Performance</TabsTrigger>
          <TabsTrigger value="outcomes" className="text-xs" data-testid="tab-outcomes">Outcomes</TabsTrigger>
          <TabsTrigger value="lead-context" className="text-xs" data-testid="tab-lead-context">Lead Context</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryTab range={range} domain={domain} />
        </TabsContent>

        <TabsContent value="domains" className="mt-4">
          <DomainPerformanceTab range={range} />
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <FeedbackInsightsTab range={range} />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulePerformanceTab />
        </TabsContent>

        <TabsContent value="outcomes" className="mt-4">
          <OutcomesTab range={range} domain={domain} />
        </TabsContent>

        <TabsContent value="lead-context" className="mt-4">
          <LeadContextTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
