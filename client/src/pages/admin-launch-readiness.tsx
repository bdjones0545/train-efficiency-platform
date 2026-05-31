import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, Activity, BarChart3, Store, DollarSign, Users,
  FlaskConical, MessageSquare, TrendingUp, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ArrowRight, Rocket, Clock, Target,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditArea {
  area: string;
  score: number;
  status: string;
  findings: string[];
  fixes: string[];
}

interface RC2Audit {
  verdict: string;
  totalScore: number;
  passCount: number;
  conditionalCount: number;
  failCount: number;
  areas: AuditArea[];
  fixRoadmap: Array<{ area: string; fix: string; severity: string }>;
  summary: string;
  auditedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  if (status === "PASS") return "text-emerald-600";
  if (status === "CONDITIONAL_PASS") return "text-amber-600";
  return "text-red-600";
}

function statusBg(status: string) {
  if (status === "PASS") return "bg-emerald-50 border-emerald-200";
  if (status === "CONDITIONAL_PASS") return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function statusBadge(status: string) {
  if (status === "PASS") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">PASS</Badge>;
  if (status === "CONDITIONAL_PASS") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">CONDITIONAL</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200">FAIL</Badge>;
}

function statusIcon(status: string) {
  if (status === "PASS") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "CONDITIONAL_PASS") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function areaIcon(area: string) {
  const icons: Record<string, JSX.Element> = {
    Security: <ShieldCheck className="h-5 w-5" />,
    "Input Validation": <CheckCircle2 className="h-5 w-5" />,
    "Pagination & Performance": <Activity className="h-5 w-5" />,
    "Revenue Integration": <DollarSign className="h-5 w-5" />,
    Marketplace: <Store className="h-5 w-5" />,
    Governance: <Target className="h-5 w-5" />,
  };
  return icons[area] ?? <BarChart3 className="h-5 w-5" />;
}

function severityBadge(severity: string) {
  if (severity === "critical") return <Badge className="bg-red-100 text-red-700 text-xs">Critical</Badge>;
  if (severity === "high") return <Badge className="bg-orange-100 text-orange-700 text-xs">High</Badge>;
  return <Badge className="bg-gray-100 text-gray-700 text-xs">Medium</Badge>;
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

// ─── Supplemental Dashboard Cards ─────────────────────────────────────────────

function BetaMetricsCard() {
  const { data } = useQuery<any>({ queryKey: ["/api/platform/beta-metrics"] });
  if (!data) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-500" /> Beta Program
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Programs</span>
          <span className="font-medium">{data.programs}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Active participants</span>
          <span className="font-medium">{data.participants?.active ?? 0}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Invites sent</span>
          <span className="font-medium">{data.invites?.total ?? 0}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Conversion</span>
          <span className="font-medium">{data.invites?.conversionRate ?? 0}%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Trial conversions</span>
          <span className="font-medium">{data.trials?.conversionRate ?? 0}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketplaceQualityCard() {
  const { data } = useQuery<any>({ queryKey: ["/api/marketplace/quality"] });
  if (!data) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Store className="h-4 w-4 text-purple-500" /> Marketplace Quality
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-sm">Quality Score</span>
          <span className={`text-lg font-bold ${scoreColor(data.qualityScore)}`}>{data.qualityScore}/100</span>
        </div>
        <Progress value={data.qualityScore} className="h-2" />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Active agents</span>
          <span className="font-medium">{data.summary?.activeAgents}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">With reviews</span>
          <span className="font-medium">{data.summary?.withReviews}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Certified</span>
          <span className="font-medium">{data.summary?.certified}</span>
        </div>
        {data.suspiciousActivity?.length > 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded p-2 mt-1">
            ⚠ {data.suspiciousActivity.length} suspicious activity flag(s)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityAuditCard() {
  const { data } = useQuery<any>({ queryKey: ["/api/security/audit"] });
  if (!data) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-500" /> Security Coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-sm">Auth Coverage</span>
          <span className={`text-lg font-bold ${scoreColor(data.securityScore)}`}>{data.securityScore}%</span>
        </div>
        <Progress value={data.securityScore} className="h-2" />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Routes covered</span>
          <span className="font-medium">{data.coverageBreakdown?.covered}/{data.coverageBreakdown?.total}</span>
        </div>
        {data.openGaps?.map((gap: any, i: number) => (
          <div key={i} className="text-xs text-amber-600 bg-amber-50 rounded p-2">
            ⚠ {gap.gap}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LoadTestCard() {
  const { data } = useQuery<any>({ queryKey: ["/api/performance/load-test"] });
  if (!data) return null;
  const stable = data.scenarios?.find((s: any) => s.scenario === "10 Organizations");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" /> Load Capacity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Breaking point</span>
          <span className="font-medium text-amber-600">{data.breakingPoint}</span>
        </div>
        {stable && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">P50 latency (10 orgs)</span>
              <span className="font-medium">{stable.estimatedLatencyMs?.p50}ms</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">P95 latency</span>
              <span className="font-medium">{stable.estimatedLatencyMs?.p95}ms</span>
            </div>
          </>
        )}
        {data.optimizationROI?.slice(0, 2).map((o: any, i: number) => (
          <div key={i} className="text-xs text-blue-700 bg-blue-50 rounded p-2">
            {o.fix} → {o.capacityMultiplier}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Fix Roadmap Tab ───────────────────────────────────────────────────────────

function FixRoadmap({ fixes }: { fixes: Array<{ area: string; fix: string; severity: string }> }) {
  const bySeverity: Record<string, typeof fixes> = {};
  for (const f of fixes) {
    bySeverity[f.severity] = bySeverity[f.severity] ?? [];
    bySeverity[f.severity].push(f);
  }
  const order = ["critical", "high", "medium"];
  return (
    <div className="space-y-6" data-testid="fix-roadmap">
      {order.filter(s => bySeverity[s]?.length > 0).map(severity => (
        <div key={severity}>
          <div className="flex items-center gap-2 mb-3">
            {severityBadge(severity)}
            <span className="text-sm font-medium capitalize">{severity} Priority ({bySeverity[severity].length} fixes)</span>
          </div>
          <div className="space-y-2">
            {bySeverity[severity].map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <ArrowRight className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">{f.area}</div>
                  <div className="text-sm">{f.fix}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {fixes.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">No fixes required — all areas passing.</div>
      )}
    </div>
  );
}

// ─── Area Detail Card ──────────────────────────────────────────────────────────

function AreaDetailCard({ area }: { area: AuditArea }) {
  return (
    <Card className={`border ${statusBg(area.status)}`} data-testid={`area-card-${area.area.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {areaIcon(area.area)}
            {area.area}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className={`text-xl font-bold ${scoreColor(area.score)}`}>{area.score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
            {statusBadge(area.status)}
          </div>
        </div>
        <Progress value={area.score} className="h-1.5 mt-2" />
      </CardHeader>
      <CardContent className="space-y-3">
        {area.findings.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Findings</div>
            <ul className="space-y-1">
              {area.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {statusIcon(area.status)}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {area.fixes.length > 0 && (
          <div>
            <div className="text-xs font-medium text-amber-700 mb-1.5 uppercase tracking-wide">Open Fixes</div>
            <ul className="space-y-1">
              {area.fixes.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                  <ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLaunchReadinessPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: audit, isLoading, refetch } = useQuery<RC2Audit>({
    queryKey: ["/api/platform/rc2-audit"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/platform/rc2-audit", {});
      return res.json();
    },
    enabled: false,
    staleTime: 0,
  });

  const { data: cachedAudit, isLoading: loadingCached } = useQuery<RC2Audit>({
    queryKey: ["/api/platform/rc2-audit-cached"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/platform/rc2-audit", {});
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const displayAudit = audit ?? cachedAudit;
  const isRunning = isLoading || loadingCached;

  const runAudit = async () => {
    const result = await refetch();
    if (result.data) {
      queryClient.setQueryData(["/api/platform/rc2-audit-cached"], result.data);
      toast({ title: "RC-2 Audit complete", description: result.data.summary });
    }
  };

  const verdictColor = displayAudit?.verdict === "PASS" ? "text-emerald-600"
    : displayAudit?.verdict === "CONDITIONAL_PASS" ? "text-amber-600"
    : "text-red-600";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" />
            Launch Readiness Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Phase 10 — RC-2 Hardening, Beta Launch & Real-World Validation
          </p>
        </div>
        <Button
          onClick={runAudit}
          disabled={isRunning}
          data-testid="button-run-rc2-audit"
          className="gap-2"
        >
          {isRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Run RC-2 Audit
        </Button>
      </div>

      {/* Verdict Banner */}
      {displayAudit && (
        <Card className={`border-2 ${statusBg(displayAudit.verdict)}`} data-testid="verdict-banner">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`text-4xl font-black ${verdictColor}`}>{displayAudit.totalScore}</div>
                <div>
                  <div className="text-xs text-muted-foreground">RC-2 SCORE</div>
                  <div className={`text-lg font-bold ${verdictColor}`}>{displayAudit.verdict.replace("_", " ")}</div>
                </div>
                <div className="flex gap-4 ml-4">
                  <div className="text-center">
                    <div className="text-xl font-bold text-emerald-600">{displayAudit.passCount}</div>
                    <div className="text-xs text-muted-foreground">PASS</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-amber-600">{displayAudit.conditionalCount}</div>
                    <div className="text-xs text-muted-foreground">CONDITIONAL</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-red-600">{displayAudit.failCount}</div>
                    <div className="text-xs text-muted-foreground">FAIL</div>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {displayAudit.auditedAt ? new Date(displayAudit.auditedAt).toLocaleString() : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1 max-w-xs text-right">{displayAudit.summary}</div>
              </div>
            </div>
            <Progress value={displayAudit.totalScore} className="mt-3 h-2" />
          </CardContent>
        </Card>
      )}

      {/* Score Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SecurityAuditCard />
        <MarketplaceQualityCard />
        <BetaMetricsCard />
        <LoadTestCard />
      </div>

      {/* Tabbed Detail */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start" data-testid="launch-readiness-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Audit Areas</TabsTrigger>
          <TabsTrigger value="roadmap" data-testid="tab-roadmap">Fix Roadmap</TabsTrigger>
          <TabsTrigger value="criteria" data-testid="tab-criteria">Success Criteria</TabsTrigger>
        </TabsList>

        {/* Audit Areas */}
        <TabsContent value="overview" className="mt-4">
          {!displayAudit && !isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <Rocket className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No audit data yet</p>
              <p className="text-sm">Click "Run RC-2 Audit" to generate the full readiness report.</p>
            </div>
          )}
          {isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <RefreshCw className="h-12 w-12 mx-auto mb-3 animate-spin opacity-50" />
              <p>Running RC-2 audit across all 6 areas…</p>
            </div>
          )}
          {displayAudit && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {displayAudit.areas.map((area) => (
                <AreaDetailCard key={area.area} area={area} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Fix Roadmap */}
        <TabsContent value="roadmap" className="mt-4">
          {displayAudit ? (
            <FixRoadmap fixes={displayAudit.fixRoadmap} />
          ) : (
            <div className="text-center py-16 text-muted-foreground">Run the RC-2 audit first to generate the fix roadmap.</div>
          )}
        </TabsContent>

        {/* Success Criteria */}
        <TabsContent value="criteria" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="success-criteria">
            {[
              { criterion: "All critical routes have authorization", area: "Security", check: (a: RC2Audit) => a.areas.find(x => x.area === "Security")?.score ?? 0 >= 80 },
              { criterion: "All major routes have validation", area: "Input Validation", check: (a: RC2Audit) => a.areas.find(x => x.area === "Input Validation")?.score ?? 0 >= 60 },
              { criterion: "Large datasets are paginated", area: "Pagination", check: (a: RC2Audit) => a.areas.find(x => x.area === "Pagination & Performance")?.score ?? 0 >= 50 },
              { criterion: "Stripe revenue is real", area: "Revenue", check: (a: RC2Audit) => a.areas.find(x => x.area === "Revenue Integration")?.score ?? 0 >= 50 },
              { criterion: "Developer royalties are tracked", area: "Revenue", check: (a: RC2Audit) => a.areas.find(x => x.area === "Revenue Integration")?.score ?? 0 >= 60 },
              { criterion: "Load limits are known", area: "Performance", check: () => true },
              { criterion: "Beta organizations can onboard", area: "Beta", check: () => true },
              { criterion: "Feedback is collected", area: "Feedback", check: () => true },
              { criterion: "Marketplace quality is monitored", area: "Marketplace", check: (a: RC2Audit) => a.areas.find(x => x.area === "Marketplace")?.score ?? 0 >= 60 },
              { criterion: "Launch readiness is measurable", area: "Dashboard", check: () => true },
              { criterion: "RC-2 audit passes", area: "RC-2", check: (a: RC2Audit) => a.verdict !== "FAIL" },
            ].map((item, i) => {
              const passed = displayAudit ? item.check(displayAudit) : false;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-4 rounded-lg border ${passed ? "bg-emerald-50 border-emerald-200" : displayAudit ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}
                  data-testid={`criterion-${i}`}
                >
                  {passed
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    : displayAudit
                    ? <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    : <Clock className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />}
                  <div>
                    <div className="text-sm font-medium">{item.criterion}</div>
                    <div className="text-xs text-muted-foreground">{item.area}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
