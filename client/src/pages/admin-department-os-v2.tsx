import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2, Layers, GitBranch, BookOpen, Brain,
  BarChart3, Zap, Shield, TrendingUp, Code2, Package, AlertCircle,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ExtractionReport {
  sprintName:    string;
  completedAt:   string;
  duplications:  Duplication[];
  frameworkModules: FrameworkModule[];
  migrations:    Migration[];
  estimates:     Estimates;
  v2Audit:       V2Audit;
}

interface Duplication {
  id:          string;
  pattern:     string;
  occurrences: number;
  files:       readonly string[];
  extracted:   boolean;
  framework:   string;
  category:    string;
}

interface FrameworkModule {
  path:        string;
  files:       number;
  purpose:     string;
  lines:       number;
  keyExports:  readonly string[];
}

interface Migration {
  department:   string;
  file:         string;
  change:       string;
  linesRemoved: number;
  linesAdded:   number;
}

interface Estimates {
  frameworkFilesCreated:   number;
  frameworkLinesAdded:     number;
  departmentLinesRemoved:  number;
  reuseableLinesTotal:     number;
  futureDepartmentEstimates: Record<string, {
    withoutFramework: number;
    withFramework:    number;
    savingPct:        number;
    whatRemains?:     string[];
  }>;
  reuseByFramework: Record<string, {
    extractedLines: number;
    reusePerDept:   number;
    pct:            number;
  }>;
  overallFrameworkReusePercent: number;
}

interface V2Audit {
  whatWasExtracted:              string[];
  whatRemainesDepartmentSpecific: string[];
  expectedFutureReduction:       string;
  frameworkMature:               boolean;
  readyForDepartment3:           boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function categoryColor(cat: string): string {
  const map: Record<string, string> = {
    utility:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
    infrastructure: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    type:           "bg-amber-500/15 text-amber-400 border-amber-500/30",
    logic:          "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return map[cat] ?? "bg-zinc-700/30 text-zinc-400 border-zinc-600/30";
}

function modulePillColor(idx: number): string {
  const cols = [
    "text-blue-400 bg-blue-500/10 border-blue-500/20",
    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    "text-purple-400 bg-purple-500/10 border-purple-500/20",
    "text-amber-400 bg-amber-500/10 border-amber-500/20",
    "text-rose-400 bg-rose-500/10 border-rose-500/20",
  ];
  return cols[idx % cols.length];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MetricBig({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-3xl font-bold text-white">{value}</span>
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

function FrameworkCard({ mod, idx }: { mod: FrameworkModule; idx: number }) {
  const pill = modulePillColor(idx);
  return (
    <Card className="bg-zinc-900 border-zinc-700/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-mono text-zinc-200">{mod.path}</CardTitle>
            <p className="text-xs text-zinc-400 mt-1">{mod.purpose}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${pill}`}>{mod.files} files</span>
            <span className="text-xs text-zinc-500">~{mod.lines} lines</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(mod.keyExports as unknown as string[]).slice(0, 6).map(e => (
            <span key={e} className="text-[10px] font-mono bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700/60">{e}</span>
          ))}
          {(mod.keyExports as unknown as string[]).length > 6 && (
            <span className="text-[10px] text-zinc-500 px-1.5 py-0.5">+{(mod.keyExports as unknown as string[]).length - 6} more</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DuplicationRow({ dup }: { dup: Duplication }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-800/60 last:border-0">
      <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-zinc-200">{dup.pattern}</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${categoryColor(dup.category)}`}>{dup.category}</span>
          <span className="text-xs text-zinc-500">{dup.occurrences}× duplicated</span>
        </div>
        <p className="text-xs text-zinc-400 mt-0.5">→ {dup.framework}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {(dup.files as unknown as string[]).map(f => (
            <span key={f} className="text-[10px] font-mono text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminDepartmentOsV2Page() {
  const { data: reportData, isLoading } = useQuery<{ ok: boolean; report: ExtractionReport }>({
    queryKey: ["/api/department-os/v2/extraction-report"],
  });

  const { data: statusData } = useQuery<{
    ok: boolean; version: string;
    modules: Array<{ path: string; files: number; purpose: string; lines: number; exports: number; status: string }>;
    totalFrameworkFiles: number; totalFrameworkLines: number; overallReusePercent: number;
  }>({
    queryKey: ["/api/department-os/v2/framework-status"],
  });

  if (isLoading) {
    return (
      <div className="p-8 text-zinc-400 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-zinc-600 border-t-emerald-500 rounded-full animate-spin" />
        Loading extraction report…
      </div>
    );
  }

  const r = reportData?.report;
  if (!r) return <div className="p-8 text-zinc-500">No data.</div>;

  const est = r.estimates;
  const audit = r.v2Audit;
  const dept3 = est.futureDepartmentEstimates.department3;
  const reuseEntries = Object.entries(est.reuseByFramework);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Layers className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Department OS v2</h1>
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border text-xs">Extraction Complete</Badge>
        </div>
        <p className="text-zinc-400 text-sm">
          Duplication audit + shared framework extraction across Opportunity Acquisition and Hiring Department.
        </p>
        <p className="text-xs text-zinc-600 mt-1">Sprint completed · {new Date(r.completedAt).toLocaleDateString()}</p>
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-zinc-900 border-zinc-700/50 p-4">
          <MetricBig label="Patterns Extracted" value={r.duplications.length} sub="from 2 departments" />
        </Card>
        <Card className="bg-zinc-900 border-zinc-700/50 p-4">
          <MetricBig label="Framework Files" value={est.frameworkFilesCreated} sub="~1,050 reusable lines" />
        </Card>
        <Card className="bg-zinc-900 border-zinc-700/50 p-4">
          <MetricBig label="Dept #3 Savings" value={`${dept3.savingPct}%`} sub={`${dept3.withoutFramework} → ${dept3.withFramework} lines`} />
        </Card>
        <Card className="bg-zinc-900 border-zinc-700/50 p-4">
          <MetricBig label="Overall Reuse" value={`${est.overallFrameworkReusePercent}%`} sub="framework coverage" />
        </Card>
      </div>

      <Tabs defaultValue="scorecard" className="space-y-4" data-testid="dept-os-v2-tabs">

        {/* ── Tab list ── */}
        <TabsList className="bg-zinc-900 border border-zinc-700/50 flex-wrap h-auto gap-1 p-1">
          {[
            ["scorecard",   "Extraction Scorecard"],
            ["frameworks",  "Framework Modules"],
            ["duplications","Duplication Audit"],
            ["migrations",  "Migrations"],
            ["futures",     "Future Estimates"],
            ["audit",       "v2 Audit Report"],
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className="text-xs" data-testid={`tab-${v}`}>{l}</TabsTrigger>
          ))}
        </TabsList>

        {/* ── Extraction Scorecard ── */}
        <TabsContent value="scorecard">
          <div className="grid gap-4">
            <Card className="bg-zinc-900 border-zinc-700/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                  Framework Reuse by Module
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {reuseEntries.map(([key, val]) => (
                  <div key={key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-zinc-200 capitalize">{key} Framework</span>
                      <span className="text-zinc-400">{val.pct}% reuse · {val.extractedLines} lines extracted</span>
                    </div>
                    <Progress value={val.pct} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-zinc-900 border-zinc-700/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-blue-400" />
                    Lines Extracted
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-white">~{est.frameworkLinesAdded}</p>
                  <p className="text-xs text-zinc-400 mt-1">Across 5 framework modules</p>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900 border-zinc-700/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Lines Removed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-white">~{est.departmentLinesRemoved}</p>
                  <p className="text-xs text-zinc-400 mt-1">Duplicate code eliminated</p>
                </CardContent>
              </Card>
              <Card className="bg-zinc-900 border-zinc-700/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Future Saving (Dept #3)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-white">{dept3.savingPct}%</p>
                  <p className="text-xs text-zinc-400 mt-1">{dept3.withFramework} lines vs {dept3.withoutFramework}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Framework Modules ── */}
        <TabsContent value="frameworks">
          <div className="grid gap-3 md:grid-cols-2">
            {r.frameworkModules.map((mod, i) => (
              <FrameworkCard key={mod.path} mod={mod} idx={i} />
            ))}
            {/* Dashboard framework */}
            <Card className="bg-zinc-900 border-zinc-700/50">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-mono text-zinc-200">shared/dashboard-framework.ts</CardTitle>
                    <p className="text-xs text-zinc-400 mt-1">Frontend UI types for all future department dashboards</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${modulePillColor(5)}`}>1 file</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {["DepartmentMetric","DepartmentAlert","DepartmentSummaryCard","DepartmentDashboardCard","PipelineStageCard","LearningInsightCard","RecommendationCard"].map(e => (
                    <span key={e} className="text-[10px] font-mono bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700/60">{e}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Duplication Audit ── */}
        <TabsContent value="duplications">
          <Card className="bg-zinc-900 border-zinc-700/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white text-sm">
                <Code2 className="w-4 h-4 text-purple-400" />
                {r.duplications.length} Duplicate Patterns Found &amp; Extracted
              </CardTitle>
            </CardHeader>
            <CardContent>
              {r.duplications.map(d => (
                <DuplicationRow key={d.id} dup={d} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Migrations ── */}
        <TabsContent value="migrations">
          <div className="grid gap-3">
            {r.migrations.map((m, i) => (
              <Card key={i} className="bg-zinc-900 border-zinc-700/50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 border text-xs">{m.department}</Badge>
                        <span className="text-xs font-mono text-zinc-400">{m.file.replace("server/services/", "")}</span>
                      </div>
                      <p className="text-sm text-zinc-200">{m.change}</p>
                      <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                        <span className="text-red-400">−{m.linesRemoved} lines removed</span>
                        <span className="text-emerald-400">+{m.linesAdded} lines added</span>
                        <span className="text-zinc-400">net: {m.linesAdded - m.linesRemoved > 0 ? "+" : ""}{m.linesAdded - m.linesRemoved}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Card className="bg-zinc-800/40 border-zinc-700/30">
              <CardContent className="pt-4 text-xs text-zinc-500">
                <p className="font-medium text-zinc-400 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  No-op migrations (framework available, preserved for backward compat)
                </p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>opportunity-executive-coordinator.ts — OpportunityHealthCheck preserved (has source-ID deduplication not in framework)</li>
                  <li>opportunity-learning-agent.ts — LearningMetrics preserved (AI-enhanced, uses OpenAI)</li>
                  <li>hiring-executive-agent.ts — BestAction already imported from framework v1</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Future Estimates ── */}
        <TabsContent value="futures">
          <div className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(est.futureDepartmentEstimates).map(([key, val]) => (
                <Card key={key} className="bg-zinc-900 border-zinc-700/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-zinc-300 capitalize">
                      {key.replace("department", "Department #")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-2xl font-bold text-emerald-400">{val.savingPct}%</span>
                      <span className="text-xs text-zinc-500">saved</span>
                    </div>
                    <Progress value={val.savingPct} className="h-2 mb-2" />
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Without: ~{val.withoutFramework} lines</span>
                      <span>With: ~{val.withFramework} lines</span>
                    </div>
                    {val.whatRemains && (
                      <div className="mt-3">
                        <p className="text-xs text-zinc-400 font-medium mb-1">Still needed:</p>
                        <ul className="space-y-0.5">
                          {val.whatRemains.map((w, i) => (
                            <li key={i} className="text-xs text-zinc-500 flex items-start gap-1">
                              <span className="text-zinc-600 mt-0.5">•</span> {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-zinc-900 border-zinc-700/50">
              <CardHeader>
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  What "Department #3 requires ~250 lines" means
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dept3.whatRemains?.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-600 mt-0.5 shrink-0" />
                    <span className="text-zinc-300">{w}</span>
                  </div>
                ))}
                <p className="text-xs text-zinc-500 pt-2 border-t border-zinc-800">
                  Everything else — pipeline engine, assessment scoring, learning rates, executive brief builder, health engine, attention inbox, coordinator registry — <span className="text-emerald-400">already exists in the framework</span>.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── v2 Audit Report ── */}
        <TabsContent value="audit">
          <div className="grid gap-4">
            <Card className="bg-zinc-900 border-zinc-700/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white text-sm">
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  What Was Extracted
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {audit.whatWasExtracted.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-zinc-300">{w}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-700/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white text-sm">
                  <Brain className="w-4 h-4 text-amber-400" />
                  What Remains Department-Specific
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {audit.whatRemainesDepartmentSpecific.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5">→</span>
                    <span className="text-zinc-300">{w}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-emerald-500/10 border-emerald-500/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-300 mb-1">Expected Future Reduction</p>
                    <p className="text-sm text-emerald-200/80">{audit.expectedFutureReduction}</p>
                    <div className="flex gap-4 mt-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${audit.frameworkMature ? "bg-emerald-400" : "bg-amber-400"}`} />
                        <span className="text-zinc-400">Framework: {audit.frameworkMature ? "Mature" : "In Progress"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${audit.readyForDepartment3 ? "bg-emerald-400" : "bg-red-400"}`} />
                        <span className="text-zinc-400">Ready for Dept #3: {audit.readyForDepartment3 ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
