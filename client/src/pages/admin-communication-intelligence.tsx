import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, AlertTriangle, BarChart2, CheckCircle, Clock, Eye,
  Mail, MessageSquare, RefreshCw, Send, ShieldAlert, TrendingUp,
  Users, XCircle, Zap, Briefcase, HeartPulse, DollarSign,
  ArrowRight, Inbox, Flag, Radio, Search,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color = "text-primary", sub }: {
  label: string; value: string | number; icon: any; color?: string; sub?: string;
}) {
  return (
    <Card data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className={`h-5 w-5 ${color} opacity-70 mt-1`} />
        </div>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${map[severity] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
      {severity}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, string> = {
    high: "bg-red-100 text-red-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[urgency] ?? "bg-gray-100 text-gray-700"}`}>
      {urgency}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    gmail: { label: "Gmail", cls: "bg-red-50 text-red-700" },
    agentmail: { label: "AgentMail", cls: "bg-purple-50 text-purple-700" },
    sendgrid: { label: "SendGrid", cls: "bg-blue-50 text-blue-700" },
    email: { label: "Email", cls: "bg-indigo-50 text-indigo-700" },
    lead: { label: "Lead", cls: "bg-green-50 text-green-700" },
    follow_up: { label: "Follow-Up", cls: "bg-yellow-50 text-yellow-700" },
    applicant: { label: "Applicant", cls: "bg-pink-50 text-pink-700" },
    gmail_approval: { label: "Gmail Approval", cls: "bg-orange-50 text-orange-700" },
  };
  const m = map[channel] ?? { label: channel, cls: "bg-gray-50 text-gray-700" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function LoadingGrid({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-24" />)}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminCommunicationIntelligencePage() {
  const [tab, setTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  function makeQuery(path: string) {
    return {
      queryKey: [`/api/communication-intelligence/${path}`, refreshKey],
      refetchInterval: 60_000,
    };
  }

  const overview = useQuery<any>(makeQuery("overview"));
  const channels = useQuery<any>(makeQuery("channels"));
  const health = useQuery<any>(makeQuery("health"));
  const approvals = useQuery<any>(makeQuery("approvals"));
  const responses = useQuery<any>(makeQuery("responses"));
  const leads = useQuery<any>(makeQuery("revenue") /* alias */);
  const leadMetrics = useQuery<any>({ queryKey: ["/api/communication-intelligence/revenue", refreshKey] });
  const hiringQ = useQuery<any>(makeQuery("hiring"));
  const supportQ = useQuery<any>(makeQuery("support"));
  const recovery = useQuery<any>(makeQuery("recovery"));
  const risks = useQuery<any>(makeQuery("risks"));

  const ov = overview.data ?? {};
  const ch = channels.data ?? {};
  const hd = health.data ?? {};
  const ap = approvals.data ?? {};
  const rs = responses.data ?? {};
  const rv = leadMetrics.data ?? {};
  const hr = hiringQ.data ?? {};
  const sp = supportQ.data ?? {};
  const rc = recovery.data ?? {};
  const rk = risks.data ?? {};

  const totalPending = (ov.pendingApprovals ?? 0);
  const criticalRisks = rk.criticalRisks ?? 0;

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Communication Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Leadership-level visibility across every communication channel. Read-only — no sends or approvals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {criticalRisks > 0 && (
            <Badge variant="destructive" className="gap-1" data-testid="badge-critical-risks">
              <AlertTriangle className="h-3 w-3" /> {criticalRisks} Critical
            </Badge>
          )}
          {totalPending > 0 && (
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1" data-testid="badge-pending">
              <Clock className="h-3 w-3" /> {totalPending} Pending
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          {[
            { id: "overview",   label: "Overview",    icon: Activity },
            { id: "health",     label: "Health",      icon: HeartPulse },
            { id: "revenue",    label: "Revenue",     icon: DollarSign },
            { id: "hiring",     label: "Hiring",      icon: Briefcase },
            { id: "support",    label: "Support",     icon: HeartPulse },
            { id: "channels",   label: "Channels",    icon: BarChart2 },
            { id: "approvals",  label: "Approvals",   icon: CheckCircle },
            { id: "recovery",   label: "Recovery",    icon: Search },
            { id: "risks",      label: "Risks",       icon: ShieldAlert },
            { id: "audit",      label: "Audit",       icon: Eye },
          ].map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} data-testid={`tab-${id}`} className="flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Icon className="h-3.5 w-3.5" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── 1. EXECUTIVE OVERVIEW ──────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          {overview.isLoading ? <LoadingGrid n={9} /> : (
            <>
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Communication Health</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <KpiCard label="Outbound Today" value={ov.totalOutboundToday ?? 0} icon={Send} color="text-blue-600" />
                  <KpiCard label="Sent Today" value={ov.sentToday ?? 0} icon={CheckCircle} color="text-green-600" />
                  <KpiCard label="Blocked Today" value={ov.blockedToday ?? 0} icon={XCircle} color="text-orange-600" />
                  <KpiCard label="Failed Today" value={ov.failedToday ?? 0} icon={AlertTriangle} color="text-red-600" />
                  <KpiCard label="Drafts Created" value={ov.draftsCreatedToday ?? 0} icon={Mail} color="text-purple-600" />
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Pending Approvals</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <KpiCard label="Total Pending" value={ov.pendingApprovals ?? 0} icon={Clock} color={ov.pendingApprovals > 10 ? "text-red-600" : "text-amber-600"} />
                  <KpiCard label="Gmail Pending" value={ov.gmailPendingApprovals ?? 0} icon={Mail} color="text-red-500" />
                  <KpiCard label="AgentMail Pending" value={ov.agentmailPendingApprovals ?? 0} icon={MessageSquare} color="text-purple-500" />
                  <KpiCard label="Follow-Up Pending" value={ov.followupPendingApprovals ?? 0} icon={ArrowRight} color="text-blue-500" />
                  <KpiCard label="Attention Items" value={ov.activeAttentionItems ?? 0} icon={Flag} color="text-amber-600" />
                  <KpiCard label="Triggers Blocked 24h" value={ov.triggersBlockedLast24h ?? 0} icon={ShieldAlert} color="text-orange-500" />
                </div>
              </div>

              {/* Quick links */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Gmail Agent", href: "/admin/gmail-conversations" },
                  { label: "AgentMail Inbox", href: "/admin/agentmail" },
                  { label: "AI Approvals", href: "/admin/ai-approvals" },
                  { label: "Email Audit Log", href: "/admin/email-audit" },
                ].map(({ label, href }) => (
                  <a key={href} href={href} data-testid={`link-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Card className="hover:border-primary transition-colors cursor-pointer">
                      <CardContent className="pt-3 pb-3 flex items-center justify-between">
                        <span className="text-sm font-medium">{label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </a>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 2. COMMUNICATION HEALTH ─────────────────────────────────────── */}
        <TabsContent value="health" className="mt-4 space-y-6">
          {health.isLoading ? <LoadingGrid /> : (
            <>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${hd.healthScore >= 70 ? "text-green-600" : hd.healthScore >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                    {hd.healthScore ?? 0}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Health Score</div>
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <KpiCard label="Never Contacted" value={hd.prospectsNeverContacted ?? 0} icon={Users} color="text-red-600" />
                  <KpiCard label="Stale 7+ Days" value={hd.prospectsStale7d ?? 0} icon={Clock} color="text-orange-600" />
                  <KpiCard label="Stale 14+ Days" value={hd.prospectsStale14d ?? 0} icon={AlertTriangle} color="text-red-600" />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Prospect Status Distribution</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(hd.prospectsByStatus ?? {}).map(([status, count]) => (
                    <Card key={status} data-testid={`prospect-status-${status}`}>
                      <CardContent className="pt-3 pb-3 text-center">
                        <div className="text-xl font-bold">{String(count)}</div>
                        <div className="text-xs text-muted-foreground">{status}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Inbound Message Classification</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(hd.inboundByClassification ?? {}).map(([cls, count]) => (
                    <Card key={cls} data-testid={`inbound-class-${cls}`}>
                      <CardContent className="pt-3 pb-3 text-center">
                        <div className="text-xl font-bold">{String(count)}</div>
                        <div className="text-xs text-muted-foreground">{cls}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Outcome Pipeline</h3>
                <div className="space-y-2">
                  {(hd.outcomesByStatus ?? []).map((r: any) => (
                    <div key={`${r.status}-${r.domain}`} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`outcome-${r.status}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.status}</span>
                        <span className="text-muted-foreground text-xs">{r.domain}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span>{r.count} convos</span>
                        {r.avgHoursToReply > 0 && <span className="text-muted-foreground">{r.avgHoursToReply}h avg reply</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 3. REVENUE COMMUNICATIONS ───────────────────────────────────── */}
        <TabsContent value="revenue" className="mt-4 space-y-6">
          {leadMetrics.isLoading ? <LoadingGrid /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Open Deals" value={rv.openDeals ?? 0} icon={TrendingUp} color="text-blue-600" />
                <KpiCard label="Won Deals" value={rv.wonDeals ?? 0} icon={CheckCircle} color="text-green-600" />
                <KpiCard label="Pipeline Value" value={`$${((rv.pipelineValue ?? 0) / 100).toLocaleString()}`} icon={DollarSign} color="text-emerald-600" />
                <KpiCard label="AI Credited" value={`$${(rv.totalAiCreditedValue ?? 0).toLocaleString()}`} icon={Zap} color="text-purple-600" />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Revenue Outcome by Status</h3>
                <div className="space-y-2">
                  {(rv.byOutcomeStatus ?? []).map((r: any) => (
                    <div key={r.status} className="flex items-center justify-between p-3 rounded border" data-testid={`revenue-outcome-${r.status}`}>
                      <div>
                        <span className="font-medium capitalize">{r.status.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground text-xs ml-2">{r.count} conversations</span>
                      </div>
                      <span className="font-mono text-sm font-semibold">${((r.revenueCents ?? 0) / 100).toLocaleString()}</span>
                    </div>
                  ))}
                  {(!rv.byOutcomeStatus || rv.byOutcomeStatus.length === 0) && (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground text-sm">
                        No revenue attribution data yet. Revenue is tracked as deals progress.
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Deals by Stage</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(rv.dealsByStatus ?? {}).map(([status, d]: any) => (
                    <Card key={status} data-testid={`deal-stage-${status}`}>
                      <CardContent className="pt-3 pb-3 text-center">
                        <div className="text-xl font-bold">{d.count}</div>
                        <div className="text-xs text-muted-foreground">{status}</div>
                        <div className="text-xs font-mono mt-0.5 text-green-700">${((d.value ?? 0) / 100).toLocaleString()}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 4. HIRING COMMUNICATIONS ─────────────────────────────────────── */}
        <TabsContent value="hiring" className="mt-4 space-y-6">
          {hiringQ.isLoading ? <LoadingGrid /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Applicants" value={hr.totalApplicants ?? 0} icon={Users} color="text-blue-600" />
                <KpiCard label="Active" value={hr.activeApplicants ?? 0} icon={Activity} color="text-green-600" />
                <KpiCard label="Interviewing" value={hr.interviewing ?? 0} icon={MessageSquare} color="text-purple-600" />
                <KpiCard label="Hired" value={hr.hired ?? 0} icon={CheckCircle} color="text-emerald-600" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <KpiCard label="Waiting on Candidate" value={hr.waitingOnCandidate ?? 0} icon={Clock} color="text-amber-600" />
                <KpiCard label="Under Internal Review" value={hr.waitingOnInternal ?? 0} icon={Eye} color="text-blue-500" />
                <KpiCard label="Response Rate" value={`${hr.candidateResponseRate ?? 0}%`} icon={TrendingUp} color="text-green-600" />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Applicants by Status</h3>
                <div className="space-y-2">
                  {Object.entries(hr.byStatus ?? {}).map(([status, d]: any) => (
                    <div key={status} className="flex items-center justify-between p-3 rounded border" data-testid={`applicant-status-${status}`}>
                      <span className="font-medium capitalize">{status.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-4 text-sm">
                        <span>{d.count} applicants</span>
                        {d.avgAgeDays > 0 && <span className="text-muted-foreground">{d.avgAgeDays}d avg</span>}
                      </div>
                    </div>
                  ))}
                  {(!hr.byStatus || Object.keys(hr.byStatus).length === 0) && (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground text-sm">No applicants yet.</CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 5. SUPPORT COMMUNICATIONS ────────────────────────────────────── */}
        <TabsContent value="support" className="mt-4 space-y-6">
          {supportQ.isLoading ? <LoadingGrid /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <KpiCard label="Open Issues" value={sp.openIssues ?? 0} icon={AlertTriangle} color={sp.openIssues > 0 ? "text-red-600" : "text-green-600"} />
                <KpiCard label="Escalated" value={sp.escalated ?? 0} icon={Flag} color={sp.escalated > 0 ? "text-red-600" : "text-green-600"} />
                <KpiCard label="Categories" value={Object.keys(sp.byCategory ?? {}).length} icon={BarChart2} color="text-blue-600" />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Issues by Category</h3>
                <div className="space-y-2">
                  {Object.entries(sp.byCategory ?? {}).map(([cat, d]: any) => (
                    <div key={cat} className="flex items-center justify-between p-3 rounded border" data-testid={`support-cat-${cat}`}>
                      <div>
                        <span className="font-medium capitalize">{cat.replace(/_/g, " ")}</span>
                        <span className="text-xs text-muted-foreground ml-2">{d.open} open / {d.total} total</span>
                      </div>
                      {d.avgAgeHours > 0 && <span className="text-xs text-muted-foreground">{d.avgAgeHours}h avg age</span>}
                    </div>
                  ))}
                  {(!sp.byCategory || Object.keys(sp.byCategory).length === 0) && (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground text-sm">No open support issues.</CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 6. CHANNEL PERFORMANCE ───────────────────────────────────────── */}
        <TabsContent value="channels" className="mt-4 space-y-6">
          {channels.isLoading ? <LoadingGrid /> : (
            <>
              {/* AgentMail */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-purple-600" /> AgentMail (7 days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold">{ch.agentmail?.inbound7d ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Inbound</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-amber-600">{ch.agentmail?.replyQueuePending ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Pending Approval</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-green-600">{ch.agentmail?.replyQueueApproved ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Approved</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-red-600">{ch.agentmail?.replyQueueRejected ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Rejected</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Gmail */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4 text-red-600" /> Gmail Agent (7 days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold">{ch.gmail?.actionsTotal ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Total Actions</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-amber-600">{ch.gmail?.actionsProposed ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Awaiting Approval</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-green-600">{ch.gmail?.actionsExecuted ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Executed</div>
                    </div>
                    <div className="text-center p-2 rounded bg-muted/40">
                      <div className="text-xl font-bold text-red-600">{ch.gmail?.actionsRejected ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Rejected</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Outbound audit by channel */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Outbound by Channel (7 days)</h3>
                <div className="space-y-3">
                  {Object.values(ch.byChannel ?? {}).map((c: any) => (
                    <Card key={c.channel} data-testid={`channel-card-${c.channel}`}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between mb-3">
                          <ChannelBadge channel={c.channel} />
                          <span className="text-sm text-muted-foreground">{c.outbound} total</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center text-sm">
                          <div><div className="font-semibold text-green-600">{c.sent}</div><div className="text-xs text-muted-foreground">Sent</div></div>
                          <div><div className="font-semibold text-orange-600">{c.blocked}</div><div className="text-xs text-muted-foreground">Blocked</div></div>
                          <div><div className="font-semibold text-red-600">{c.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
                          <div><div className="font-semibold text-purple-600">{c.drafts}</div><div className="text-xs text-muted-foreground">Drafts</div></div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-muted-foreground justify-end">
                          <span>Block rate: {c.blockRate}%</span>
                          <span>Fail rate: {c.failRate}%</span>
                          {c.approvalRequired > 0 && <span>Approval rate: {c.approvalRate}%</span>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {Object.keys(ch.byChannel ?? {}).length === 0 && (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground text-sm">
                        No outbound channel data yet. Data populates as emails flow through the audit log.
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 7. APPROVAL INTELLIGENCE ─────────────────────────────────────── */}
        <TabsContent value="approvals" className="mt-4 space-y-6">
          {approvals.isLoading ? <LoadingGrid /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Pending" value={ap.totalPending ?? 0} icon={Clock} color={ap.totalPending > 10 ? "text-red-600" : "text-amber-600"} />
                <KpiCard label="Gmail Pending" value={ap.gmailPending ?? 0} icon={Mail} color="text-red-500" />
                <KpiCard label="AgentMail Pending" value={ap.agentmailPending ?? 0} icon={MessageSquare} color="text-purple-500" />
                <KpiCard label="Overdue Follow-Ups" value={ap.followupOverdue ?? 0} icon={AlertTriangle} color="text-orange-600" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Approval Rate 30d" value={`${ap.approvalRate30d ?? 0}%`} icon={TrendingUp} color="text-green-600" />
                <KpiCard label="Approved 30d" value={ap.approvedLast30d ?? 0} icon={CheckCircle} color="text-green-600" />
                <KpiCard label="Rejected 30d" value={ap.rejectedLast30d ?? 0} icon={XCircle} color="text-red-600" />
                <KpiCard label="Avg Quality Score" value={ap.avgQualityScore ?? 0} icon={Zap} color="text-blue-600" />
              </div>

              {/* Bottleneck risk */}
              <Card className={
                ap.bottleneckRisk === "high" ? "border-red-300 bg-red-50/50" :
                ap.bottleneckRisk === "medium" ? "border-amber-300 bg-amber-50/50" : ""
              }>
                <CardContent className="pt-4 pb-4 flex items-center gap-3">
                  <ShieldAlert className={`h-5 w-5 ${ap.bottleneckRisk === "high" ? "text-red-600" : ap.bottleneckRisk === "medium" ? "text-amber-600" : "text-green-600"}`} />
                  <div>
                    <p className="font-semibold">Approval Bottleneck Risk: <span className="capitalize">{ap.bottleneckRisk ?? "low"}</span></p>
                    <p className="text-sm text-muted-foreground">
                      {ap.totalPending > 0
                        ? `${ap.totalPending} approvals waiting. Gmail avg: ${ap.avgGmailApprovalHours}h. AgentMail avg age: ${ap.avgAgentmailAgeHours}h.`
                        : "No approval backlog detected."}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* By domain */}
              {Object.keys(ap.gmailByDomain ?? {}).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Gmail Approvals by Domain</h3>
                  <div className="space-y-2">
                    {Object.entries(ap.gmailByDomain ?? {}).map(([domain, d]: any) => (
                      <div key={domain} className="flex items-center justify-between p-3 rounded border" data-testid={`approval-domain-${domain}`}>
                        <span className="font-medium capitalize">{domain.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-amber-600">{d.pending} pending</span>
                          <span className="text-green-600">{d.executed} executed</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── 8. RECOVERY QUEUE ────────────────────────────────────────────── */}
        <TabsContent value="recovery" className="mt-4 space-y-6">
          {recovery.isLoading ? <LoadingGrid n={4} /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Stalled" value={rc.totalStalled ?? 0} icon={AlertTriangle} color="text-red-600" />
                <KpiCard label="Stalled Leads" value={rc.stalledLeads ?? 0} icon={Users} color="text-orange-600" />
                <KpiCard label="Overdue Follow-Ups" value={rc.overdueFollowups ?? 0} icon={Clock} color="text-amber-600" />
                <KpiCard label="Stalled Approvals" value={rc.stalledGmailApprovals ?? 0} icon={Mail} color="text-purple-600" />
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Communication Recovery Queue</h3>
                {(rc.recoveryQueue ?? []).length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No stalled conversations. All caught up.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {(rc.recoveryQueue ?? []).map((item: any) => (
                      <Card key={item.id} data-testid={`recovery-item-${item.id}`} className={item.urgency === "high" ? "border-red-200" : ""}>
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm truncate">{item.contact}</span>
                                <ChannelBadge channel={item.type} />
                                <UrgencyBadge urgency={item.urgency} />
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{item.email}</div>
                              <div className="text-xs mt-1">
                                <span className="text-muted-foreground">Status:</span>{" "}
                                <span>{item.status}</span>
                                {item.daysStale > 0 && <span className="ml-2 text-orange-600">{item.daysStale}d stale</span>}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs text-muted-foreground">{item.suggestedAction}</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 9. COMMUNICATION RISKS ───────────────────────────────────────── */}
        <TabsContent value="risks" className="mt-4 space-y-6">
          {risks.isLoading ? <LoadingGrid n={4} /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Risks" value={rk.totalRisks ?? 0} icon={ShieldAlert} color={rk.totalRisks > 0 ? "text-orange-600" : "text-green-600"} />
                <KpiCard label="Critical" value={rk.criticalRisks ?? 0} icon={AlertTriangle} color={rk.criticalRisks > 0 ? "text-red-600" : "text-green-600"} />
                <KpiCard label="High" value={rk.highRisks ?? 0} icon={Flag} color={rk.highRisks > 0 ? "text-orange-600" : "text-green-600"} />
                <KpiCard label="Duplicate Attempts" value={(rk.duplicateAttempts ?? []).length} icon={Radio} color={(rk.duplicateAttempts ?? []).length > 0 ? "text-red-600" : "text-green-600"} />
              </div>

              {(rk.risks ?? []).length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No communication risks detected in the last 24 hours.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {(rk.risks ?? []).map((r: any) => (
                    <Card key={r.id} data-testid={`risk-${r.id}`}
                      className={r.severity === "critical" ? "border-red-300 bg-red-50/50" : r.severity === "high" ? "border-orange-300 bg-orange-50/50" : ""}>
                      <CardContent className="pt-4 pb-4 flex items-start gap-3">
                        <ShieldAlert className={`h-5 w-5 shrink-0 mt-0.5 ${r.severity === "critical" ? "text-red-600" : r.severity === "high" ? "text-orange-500" : "text-yellow-500"}`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{r.title}</span>
                            <SeverityBadge severity={r.severity} />
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">{r.description}</p>
                        </div>
                        <span className="text-lg font-bold shrink-0">{r.count}</span>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {(rk.topBlockReasons ?? []).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Top Block Reasons (24h)</h3>
                  <div className="space-y-2">
                    {(rk.topBlockReasons ?? []).map((r: any) => (
                      <div key={r.block_reason} className="flex items-center justify-between p-3 rounded border" data-testid={`block-reason-${r.block_reason}`}>
                        <span className="font-mono text-sm">{r.block_reason}</span>
                        <Badge variant="outline">{r.cnt} triggers</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(rk.duplicateAttempts ?? []).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-red-700">Duplicate Communication Attempts (24h)</h3>
                  <div className="space-y-2">
                    {(rk.duplicateAttempts ?? []).map((r: any) => (
                      <div key={r.recipient_email} className="flex items-center justify-between p-3 rounded border border-red-200 bg-red-50/30" data-testid={`dup-${r.recipient_email}`}>
                        <span className="text-sm">{r.recipient_email}</span>
                        <Badge variant="destructive">{r.attempts} attempts</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── 10. AUDIT EXPLORER ──────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <Card>
            <CardContent className="pt-6 pb-6 text-center space-y-4">
              <Eye className="h-10 w-10 text-primary mx-auto opacity-60" />
              <div>
                <h3 className="font-semibold">Unified Email Audit Log</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                  Full paginated audit log of every automated email attempt (sent, blocked, draft, failed) across all channels.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <a href="/admin/email-audit" data-testid="link-audit-log">
                  <Button className="gap-2">
                    <Eye className="h-4 w-4" /> Open Audit Log
                  </Button>
                </a>
                <a href="/admin/trigger-audit" data-testid="link-trigger-audit">
                  <Button variant="outline" className="gap-2">
                    <Activity className="h-4 w-4" /> Trigger Audit
                  </Button>
                </a>
                <a href="/admin/agentmail" data-testid="link-agentmail">
                  <Button variant="outline" className="gap-2">
                    <MessageSquare className="h-4 w-4" /> AgentMail
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: "Gmail Conversations", href: "/admin/gmail-conversations", desc: "View Gmail threads, intent classification, and agent actions" },
              { label: "AI Approvals Inbox", href: "/admin/ai-approvals", desc: "Review and approve AI-drafted messages" },
              { label: "Attention Inbox", href: "/admin/attention-inbox", desc: "High-priority items requiring immediate action" },
              { label: "CEO Heartbeat", href: "/admin/ceo-heartbeat", desc: "Agent operating timeline and coordination log" },
            ].map(({ label, href, desc }) => (
              <a key={href} href={href} data-testid={`audit-link-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
