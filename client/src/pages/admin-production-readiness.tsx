import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Shield, CheckCircle2, XCircle, AlertTriangle, Play,
  Clock, RefreshCw, Target, Lock, Activity, DollarSign,
  BarChart3, Eye, Zap, Database, Users, Code2, Globe,
  ChevronRight, FileText, TrendingUp,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";

const SCORE_LABELS: Record<string, string> = {
  endToEndLifecycle:    "End-to-End Lifecycle",
  dataIsolation:        "Data Isolation",
  security:             "Security",
  governanceEnforcement: "Governance Enforcement",
  billingAccuracy:      "Billing Accuracy",
  marketplaceTrust:     "Marketplace Trust",
  telemetryAccuracy:    "Telemetry Accuracy",
  attributionAccuracy:  "Attribution Accuracy",
  performance:          "Performance",
  uxTruthfulness:       "UX Truthfulness",
  errorHandling:        "Error Handling",
  productionReadiness:  "Production Readiness",
};

const SCORE_ICONS: Record<string, any> = {
  endToEndLifecycle:    Activity,
  dataIsolation:        Lock,
  security:             Shield,
  governanceEnforcement: Eye,
  billingAccuracy:      DollarSign,
  marketplaceTrust:     Target,
  telemetryAccuracy:    BarChart3,
  attributionAccuracy:  TrendingUp,
  performance:          Zap,
  uxTruthfulness:       Eye,
  errorHandling:        AlertTriangle,
  productionReadiness:  CheckCircle2,
};

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : pct >= 40 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold w-6 text-right ${pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : pct >= 40 ? "text-orange-400" : "text-red-400"}`}>{score}/{max}</span>
    </div>
  );
}

function StepBadge({ status }: { status: "pass" | "fail" | "skip" }) {
  if (status === "pass") return <Badge className="bg-green-500/10 text-green-400 border-none text-xs flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />PASS</Badge>;
  if (status === "fail") return <Badge className="bg-red-500/10 text-red-400 border-none text-xs flex items-center gap-1"><XCircle className="h-3 w-3" />FAIL</Badge>;
  return <Badge className="bg-yellow-500/10 text-yellow-400 border-none text-xs flex items-center gap-1"><Clock className="h-3 w-3" />SKIP</Badge>;
}

export default function AdminProductionReadiness() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [e2eResult, setE2eResult] = useState<any>(null);

  const { data: report } = useQuery<any>({
    queryKey: ["/api/marketplace/production-readiness"],
    queryFn: () => fetchJson("/api/marketplace/production-readiness"),
  });

  const runE2E = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketplace/e2e-test", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      setE2eResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/production-readiness"] });
      toast({
        title: `E2E Test: ${data.verdict}`,
        description: `${data.summary.passed} passed · ${data.summary.skipped} skipped · ${data.summary.failed} failed`,
      });
    },
    onError: () => toast({ title: "E2E test failed to execute", variant: "destructive" }),
  });

  const totalScore = report?.totalScore ?? 0;
  const verdict = report?.verdict ?? "unknown";
  const verdictColor = verdict === "PASS" ? "text-green-400" : verdict === "CONDITIONAL_PASS" ? "text-yellow-400" : "text-red-400";
  const verdictBg = verdict === "PASS" ? "bg-green-500/10 border-green-500/30" : verdict === "CONDITIONAL_PASS" ? "bg-yellow-500/10 border-yellow-500/30" : "bg-red-500/10 border-red-500/30";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/ecosystem">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" />Ecosystem
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-indigo-400" />
              Production Readiness Report
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Phase 9 — End-to-end validation, security audit, and trust hardening</p>
          </div>
        </div>
        <Button onClick={() => runE2E.mutate()} disabled={runE2E.isPending}
          className="bg-indigo-600 hover:bg-indigo-700" size="sm"
          data-testid="button-run-e2e">
          <Play className={`h-4 w-4 mr-1.5 ${runE2E.isPending ? "animate-pulse" : ""}`} />
          {runE2E.isPending ? "Running E2E Test..." : "Run E2E Flow Test"}
        </Button>
      </div>

      {/* Overall score */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className={`bg-gray-900 border ${verdictBg}`}>
          <CardContent className="p-5 text-center">
            <p className={`text-4xl font-bold ${verdictColor}`}>{totalScore}</p>
            <p className="text-xs text-gray-400 mt-1">Production Readiness Score</p>
            <Badge className={`mt-2 border ${verdictBg} ${verdictColor}`}>{verdict.replace(/_/g, " ")}</Badge>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-5 text-center">
            <p className="text-4xl font-bold text-green-400">{report?.fixedIssues ?? 0}</p>
            <p className="text-xs text-gray-400 mt-1">Issues Fixed This Phase</p>
            <p className="text-xs text-gray-600 mt-0.5">Cross-org · Race condition · RBAC · Copy</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-5 text-center">
            <p className="text-4xl font-bold text-orange-400">{report?.openIssues ?? 0}</p>
            <p className="text-xs text-gray-400 mt-1">Open Issues Remaining</p>
            <p className="text-xs text-gray-600 mt-0.5">Revenue events · RBAC gaps · Pagination</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score breakdown */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />Production Readiness Scores (0–5)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? Object.entries(report.scores).map(([key, value]: [string, any]) => {
              const Icon = SCORE_ICONS[key] ?? Activity;
              return (
                <div key={key} className="flex items-center gap-3">
                  <Icon className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-400 w-44 flex-shrink-0">{SCORE_LABELS[key]}</span>
                  <ScoreBar score={value} />
                </div>
              );
            }) : (
              <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />
            )}
          </CardContent>
        </Card>

        {/* Issues list */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400" />Audit Findings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {report?.criticalIssues?.map((issue: any, i: number) => (
              <div key={i} className={`p-2.5 rounded-lg border ${issue.severity === "fixed" ? "border-green-800/40 bg-green-900/10" : "border-orange-800/40 bg-orange-900/10"}`}
                data-testid={`issue-${i}`}>
                <div className="flex items-start gap-2">
                  {issue.severity === "fixed"
                    ? <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                    : <AlertTriangle className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${issue.severity === "fixed" ? "text-green-300" : "text-orange-300"}`}>{issue.area}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{issue.description}</p>
                    <p className="text-xs text-gray-600 mt-0.5 italic">{issue.fix}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* E2E Test Results */}
      {e2eResult && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Play className="h-4 w-4 text-indigo-400" />E2E Flow Test Results
              </CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-green-400">{e2eResult.summary.passed} passed</span>
                {e2eResult.summary.skipped > 0 && <span className="text-xs text-yellow-400">{e2eResult.summary.skipped} skipped</span>}
                {e2eResult.summary.failed > 0 && <span className="text-xs text-red-400">{e2eResult.summary.failed} failed</span>}
                <Badge className={`text-xs border-none ${
                  e2eResult.verdict === "PASS" ? "bg-green-500/10 text-green-400" :
                  e2eResult.verdict === "CONDITIONAL_PASS" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-red-500/10 text-red-400"
                }`}>{e2eResult.verdict}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {e2eResult.steps.map((step: any) => (
                <div key={step.step} className="flex items-center gap-3 py-1 border-b border-gray-800/50 last:border-0"
                  data-testid={`e2e-step-${step.step}`}>
                  <span className="text-xs text-gray-600 w-5 text-right flex-shrink-0">{step.step}</span>
                  <StepBadge status={step.status} />
                  <span className="text-xs text-gray-300 flex-1">{step.name}</span>
                  <span className="text-xs text-gray-600 hidden sm:block truncate max-w-xs">{step.detail}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-gray-800/40 rounded-lg">
              <p className="text-xs font-medium text-gray-400 mb-2">Lifecycle Chain</p>
              <div className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
                {["Dev Account", "Validate", "Submit", "Approve", "Publish", "Trial", "Install", "Runtime", "Permissions", "Plan", "Governance", "Execute", "Telemetry", "Review", "Reputation", "Benchmark", "Royalty", "Statement", "Ecosystem", "Isolation", "Dedup", "Gov-Check", "Copy", "Empty States"].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className={e2eResult.steps[i]?.status === "pass" ? "text-green-400" : e2eResult.steps[i]?.status === "fail" ? "text-red-400" : "text-gray-600"}>{s}</span>
                    {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-gray-700" />}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data coverage */}
      {report?.tables && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-400" />Database Coverage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(report.tables).map(([key, value]: [string, any]) => (
                <div key={key} className="text-center p-2 bg-gray-800 rounded-lg">
                  <p className="text-lg font-bold text-white">{value}</p>
                  <p className="text-xs text-gray-500 capitalize">{key}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended fix order */}
      <Card className="bg-gray-800/40 border-gray-700/40">
        <CardContent className="p-5 space-y-3">
          <p className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-400" />Recommended Fix Order — Remaining Open Issues
          </p>
          <div className="space-y-2">
            {[
              { priority: 1, label: "Revenue event creation", detail: "Connect Stripe webhooks to insert into agentRevenueEvents — required for royalty pipeline to have real data", color: "text-red-400" },
              { priority: 2, label: "Workforce route RBAC", detail: "Add requireRole('ADMIN','COACH') middleware to POST /api/workforce/executions, PATCH /api/workforce/executions/:id", color: "text-orange-400" },
              { priority: 3, label: "Zod input validation", detail: "Add zod schemas to install, review submission, execution creation, and clone endpoints", color: "text-yellow-400" },
              { priority: 4, label: "Pagination", detail: "Add limit/offset to /api/marketplace/reviews, /lifecycle, /runtimes, /case-studies endpoints", color: "text-blue-400" },
              { priority: 5, label: "Benchmark seeding", detail: "Run /api/marketplace/benchmarks/refresh once per org to generate real benchmark data for the test agent", color: "text-gray-400" },
            ].map(fix => (
              <div key={fix.priority} className="flex items-start gap-3 text-xs">
                <span className={`font-bold ${fix.color} w-4 flex-shrink-0`}>{fix.priority}.</span>
                <div>
                  <span className="text-gray-300 font-medium">{fix.label}</span>
                  <span className="text-gray-500 ml-1">— {fix.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/ecosystem">
          <Button variant="outline" size="sm" className="border-purple-700 text-purple-400">
            <Globe className="h-4 w-4 mr-1.5" />Ecosystem Dashboard
          </Button>
        </Link>
        <Link href="/admin/agent-marketplace">
          <Button variant="outline" size="sm" className="border-indigo-700 text-indigo-400">
            <Code2 className="h-4 w-4 mr-1.5" />Marketplace
          </Button>
        </Link>
        <Link href="/developer">
          <Button variant="outline" size="sm" className="border-emerald-700 text-emerald-400">
            <Users className="h-4 w-4 mr-1.5" />Developer Portal
          </Button>
        </Link>
      </div>
    </div>
  );
}
