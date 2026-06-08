import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Factory, CheckCircle2, Circle, AlertTriangle, ChevronRight,
  BookOpen, Layers, Wrench, Zap, Code2, ClipboardList,
  Building2, Target, TrendingUp, Copy, Check, Info,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast }   from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeptOverview {
  id: string; name: string; description: string; version: string;
  enabled: boolean; registeredAt: string; maturityLevel: number;
  maturityBadge: string; maturityName: string;
  capabilities: Record<string, boolean>;
  checklistPercent: number; allRequiredDone: boolean;
}

interface FactoryStats {
  registeredDepts: number; frameworkLines: number; avgDeptLines: number;
  totalCustomLines: number; estimatedSavedLines: number; reusePercent: number;
  builderFiles: number; maturityLevels: number; apiGotchasDocumented: number;
  checklistItems: number;
}

interface MaturityLevel {
  level: number; name: string; description: string;
  required: string[]; optional: string[]; badge: string;
}

interface ComponentSpec {
  name: string; filename: string; required: boolean; description: string; maturityMin: number;
}

interface GuideEntry {
  name: string; category: string; file: string; description: string;
  frameworkAPIs: string[]; notes: string[];
}

interface ApiGotcha {
  id: string; function: string; problem: string; correct: string; discoveredIn: string;
}

interface ChecklistItem {
  id: string; label: string; category: string; required: boolean;
  description: string; completed: boolean; autoChecked: boolean;
}

interface ScaffoldFile {
  filename: string; path: string; content: string; description: string;
}

interface Skeleton {
  departmentId: string; departmentName: string; files: ScaffoldFile[];
}

// ─── Maturity badge color ──────────────────────────────────────────────────────

function maturityColor(level: number) {
  return [
    "", "bg-slate-100 text-slate-700", "bg-blue-100 text-blue-700",
    "bg-green-100 text-green-700", "bg-purple-100 text-purple-700",
    "bg-orange-100 text-orange-700",
  ][level] ?? "bg-slate-100 text-slate-600";
}

function maturityIcon(level: number) {
  return [null, <Circle className="h-3 w-3" />, <Layers className="h-3 w-3" />,
    <Zap className="h-3 w-3" />, <Target className="h-3 w-3" />, <TrendingUp className="h-3 w-3" />][level];
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// ─── Department card ───────────────────────────────────────────────────────────

function DeptCard({ dept }: { dept: DeptOverview }) {
  const caps = Object.entries(dept.capabilities).filter(([, v]) => v).map(([k]) => k);
  return (
    <Card data-testid={`card-dept-${dept.id}`} className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{dept.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">v{dept.version}</p>
          </div>
          <Badge className={`text-xs shrink-0 flex items-center gap-1 ${maturityColor(dept.maturityLevel)}`}>
            {maturityIcon(dept.maturityLevel)}
            {dept.maturityBadge}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Checklist</span>
            <span className="font-medium">{dept.checklistPercent}%</span>
          </div>
          <Progress value={dept.checklistPercent} className="h-1.5" data-testid={`progress-${dept.id}`} />
        </div>
        <div className="flex flex-wrap gap-1">
          {caps.map(c => (
            <Badge key={c} variant="outline" className="text-xs px-1.5 py-0 capitalize">{c}</Badge>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {dept.enabled
            ? <CheckCircle2 className="h-3 w-3 text-green-500" />
            : <Circle className="h-3 w-3 text-muted-foreground" />}
          <span className={dept.enabled ? "text-green-600" : "text-muted-foreground"}>
            {dept.enabled ? "Live in CEO Heartbeat" : "Disabled"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ departments, stats }: { departments: DeptOverview[]; stats: FactoryStats }) {
  const statCards = [
    { label: "Departments Built",    value: stats.registeredDepts,        icon: <Building2 className="h-4 w-4" /> },
    { label: "Framework Reuse",      value: `${stats.reusePercent}%`,     icon: <Layers className="h-4 w-4" /> },
    { label: "Avg Dept Size",        value: `~${stats.avgDeptLines} ln`,  icon: <Code2 className="h-4 w-4" /> },
    { label: "Lines Saved",          value: `~${stats.estimatedSavedLines.toLocaleString()}`, icon: <TrendingUp className="h-4 w-4" /> },
    { label: "API Gotchas Logged",   value: stats.apiGotchasDocumented,   icon: <AlertTriangle className="h-4 w-4" /> },
    { label: "Checklist Items",      value: stats.checklistItems,         icon: <ClipboardList className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(s => (
          <Card key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
              <p className="text-xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-3">Registered Departments</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map(d => <DeptCard key={d.id} dept={d} />)}
        </div>
        {departments.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No departments registered yet. Use the Scaffold Generator to build one.
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border bg-muted/30">
        <CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">
            <strong>Department Factory pipeline:</strong>{" "}
            Choose Name → Run Scaffold → Implement Domain Logic → Register Coordinator → Department Live
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Scaffold tab ──────────────────────────────────────────────────────────────

function ScaffoldTab() {
  const [name, setName]           = useState("");
  const [skeleton, setSkeleton]   = useState<Skeleton | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const { toast } = useToast();

  const scaffoldMut = useMutation({
    mutationFn: (n: string) => apiRequest("POST", "/api/department-factory/scaffold", { name: n }),
    onSuccess: async (res) => {
      const data = await res.json();
      setSkeleton(data);
      setActiveFile(0);
    },
    onError: () => toast({ title: "Error", description: "Scaffold generation failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Department Scaffold Generator</CardTitle>
          <CardDescription>Enter a department name to generate boilerplate TypeScript for all 6 required files.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              data-testid="input-scaffold-name"
              placeholder="e.g. content-marketing or Client Success"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && name.trim().length >= 2 && scaffoldMut.mutate(name)}
              className="max-w-sm"
            />
            <Button
              data-testid="button-generate-scaffold"
              disabled={name.trim().length < 2 || scaffoldMut.isPending}
              onClick={() => scaffoldMut.mutate(name)}
            >
              {scaffoldMut.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {skeleton && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Generated: <span className="text-primary">{skeleton.departmentName}</span>
              <Badge variant="outline" className="ml-2 text-xs">{skeleton.departmentId}</Badge>
            </CardTitle>
            <CardDescription>{skeleton.files.length} files generated — ready to drop into the codebase</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {skeleton.files.map((f, i) => (
                <Button
                  key={i}
                  data-testid={`tab-file-${i}`}
                  size="sm" variant={i === activeFile ? "default" : "outline"}
                  onClick={() => setActiveFile(i)}
                  className="text-xs"
                >
                  {f.filename}
                </Button>
              ))}
            </div>
            {skeleton.files[activeFile] && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{skeleton.files[activeFile].filename}</p>
                    <p className="text-xs text-muted-foreground">{skeleton.files[activeFile].path}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{skeleton.files[activeFile].description}</p>
                  </div>
                  <CopyButton text={skeleton.files[activeFile].content} />
                </div>
                <pre
                  data-testid={`code-file-${activeFile}`}
                  className="bg-muted rounded-md p-4 text-xs overflow-x-auto max-h-96 leading-relaxed whitespace-pre-wrap"
                >
                  {skeleton.files[activeFile].content}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Guide tab ────────────────────────────────────────────────────────────────

function GuideTab({ guide }: { guide: typeof import("@/lib/queryClient") extends never ? any : any }) {
  const [showGotchas, setShowGotchas] = useState(false);

  if (!guide) return <p className="text-sm text-muted-foreground">Loading guide…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" /> Required Components
        </h3>
        <div className="space-y-3">
          {guide.requiredComponents?.map((c: GuideEntry) => (
            <Card key={c.name} data-testid={`guide-required-${c.name}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{c.file}</p>
                  </div>
                  <Badge className="shrink-0 bg-green-100 text-green-700 text-xs">Required</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{c.description}</p>
                {c.frameworkAPIs?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium mb-1">Framework APIs:</p>
                    <div className="space-y-0.5">
                      {c.frameworkAPIs.map((api: string) => (
                        <code key={api} className="text-xs bg-muted px-1.5 py-0.5 rounded block text-muted-foreground">{api}</code>
                      ))}
                    </div>
                  </div>
                )}
                {c.notes?.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {c.notes.map((n: string) => (
                      <p key={n} className="text-xs flex items-start gap-1.5 text-amber-700">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{n}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Circle className="h-4 w-4 text-muted-foreground" /> Optional Components
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {guide.optionalComponents?.map((c: GuideEntry) => (
            <Card key={c.name} data-testid={`guide-optional-${c.name}`} className="border-dashed">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  <Badge variant="outline" className="text-xs">Optional</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <Button
          data-testid="button-toggle-gotchas"
          variant="outline" size="sm"
          className="mb-3"
          onClick={() => setShowGotchas(v => !v)}
        >
          <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
          API Gotcha Registry ({guide.apiGotchas?.length ?? 0})
          <ChevronRight className={`h-3.5 w-3.5 ml-1 transition-transform ${showGotchas ? "rotate-90" : ""}`} />
        </Button>
        {showGotchas && (
          <div className="space-y-2">
            {guide.apiGotchas?.map((g: ApiGotcha) => (
              <Card key={g.id} data-testid={`gotcha-${g.id}`} className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <code className="text-xs font-semibold text-amber-800 dark:text-amber-300">{g.function}</code>
                    <Badge variant="outline" className="text-xs text-muted-foreground">{g.discoveredIn}</Badge>
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-400 mb-1">✗ {g.problem}</p>
                  <p className="text-xs text-green-700 dark:text-green-400">✓ {g.correct}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Maturity tab ─────────────────────────────────────────────────────────────

function MaturityTab({ levels, components }: { levels: MaturityLevel[]; components: ComponentSpec[] }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {levels.map(lvl => (
          <Card key={lvl.level} data-testid={`maturity-level-${lvl.level}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${maturityColor(lvl.level)}`}>
                      Level {lvl.level}
                    </span>
                    {lvl.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{lvl.description}</p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">{lvl.badge}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3">
                <div>
                  <p className="text-xs font-medium mb-1">Required:</p>
                  {lvl.required.map(r => (
                    <p key={r} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />{r}
                    </p>
                  ))}
                </div>
                {lvl.optional.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">Optional:</p>
                    {lvl.optional.map(o => (
                      <p key={o} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Circle className="h-3 w-3 text-muted-foreground shrink-0" />{o}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-semibold mb-3">Component → Maturity Mapping</h3>
        <div className="space-y-2">
          {components.map(c => (
            <div key={c.name} data-testid={`component-${c.name}`}
              className="flex items-start gap-3 p-3 border rounded-md">
              <Badge className={`shrink-0 text-xs ${c.required ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                {c.required ? "Required" : "Optional"}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.description}</p>
                <code className="text-xs text-muted-foreground">{c.filename}</code>
              </div>
              <Badge variant="outline" className={`shrink-0 text-xs ${maturityColor(c.maturityMin)}`}>
                L{c.maturityMin}+
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Checklist tab ────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["infrastructure", "intelligence", "operations", "integration", "verification"];
const CATEGORY_LABELS: Record<string, string> = {
  infrastructure: "Infrastructure",
  intelligence:   "Intelligence",
  operations:     "Operations",
  integration:    "Integration",
  verification:   "Verification",
};

function ChecklistTab({ departments }: { departments: DeptOverview[] }) {
  const [selected, setSelected] = useState(departments[0]?.id ?? "");

  const { data: checklist } = useQuery<any>({
    queryKey: ["/api/department-factory/checklist", selected],
    queryFn:  () => fetch(`/api/department-factory/checklist/${selected}`).then(r => r.json()),
    enabled:  !!selected,
  });

  const byCategory = CATEGORY_ORDER.reduce((acc: Record<string, ChecklistItem[]>, cat) => {
    acc[cat] = (checklist?.items ?? []).filter((i: ChecklistItem) => i.category === cat);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {departments.map(d => (
          <Button
            key={d.id}
            data-testid={`btn-dept-${d.id}`}
            size="sm"
            variant={selected === d.id ? "default" : "outline"}
            onClick={() => setSelected(d.id)}
          >
            {d.name}
          </Button>
        ))}
      </div>

      {checklist && (
        <>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">{checklist.departmentName}</p>
                <Badge className={checklist.allRequiredDone ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}>
                  {checklist.completedCount}/{checklist.totalCount} complete
                </Badge>
              </div>
              <Progress value={checklist.percentComplete} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1.5">{checklist.percentComplete}% complete</p>
            </CardContent>
          </Card>

          {CATEGORY_ORDER.map(cat => {
            const items = byCategory[cat];
            if (!items?.length) return null;
            return (
              <div key={cat}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <div className="space-y-1.5">
                  {items.map((item: ChecklistItem) => (
                    <div key={item.id} data-testid={`checklist-${item.id}`}
                      className={`flex items-start gap-3 p-3 rounded-md border ${item.completed ? "bg-green-50/50 border-green-100 dark:bg-green-950/10" : "border-muted"}`}>
                      {item.completed
                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        : <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm">{item.label}</p>
                          {item.required && <Badge variant="outline" className="text-xs px-1.5 py-0">Required</Badge>}
                          {item.autoChecked && <Badge className="text-xs px-1.5 py-0 bg-blue-100 text-blue-700">Auto-detected</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {!selected && (
        <p className="text-sm text-muted-foreground">Select a department to see its checklist.</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDepartmentFactoryPage() {
  const { data: overview, isLoading } = useQuery<{ departments: DeptOverview[]; stats: FactoryStats }>({
    queryKey:  ["/api/department-factory/overview"],
    staleTime: 30_000,
  });

  const { data: maturityData } = useQuery<{ levels: MaturityLevel[]; components: ComponentSpec[] }>({
    queryKey:  ["/api/department-factory/maturity"],
    staleTime: 60_000,
  });

  const { data: guide } = useQuery<any>({
    queryKey:  ["/api/department-factory/guide"],
    staleTime: 60_000,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Factory className="h-6 w-6 text-primary" /> Department Factory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Department OS v2 manufacturing system — build new departments consistently, rapidly, and with minimal custom code.
          </p>
        </div>
        {overview && (
          <Badge className="shrink-0 bg-primary/10 text-primary border-primary/20">
            {overview.stats.registeredDepts} Departments Built
          </Badge>
        )}
      </div>

      {/* Pipeline strip */}
      <Card className="border bg-muted/20">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            {[
              "Choose Name", "Run Scaffold", "Implement Domain Logic",
              "Register Coordinator", "Department Live",
            ].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <span className="font-medium text-foreground">{step}</span>
                {i < arr.length - 1 && <ChevronRight className="h-3 w-3" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList data-testid="tabs-department-factory" className="flex-wrap h-auto">
          <TabsTrigger value="overview"   data-testid="tab-overview"><Building2 className="h-3.5 w-3.5 mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="scaffold"   data-testid="tab-scaffold"><Wrench className="h-3.5 w-3.5 mr-1.5" />Scaffold</TabsTrigger>
          <TabsTrigger value="guide"      data-testid="tab-guide"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Builder Guide</TabsTrigger>
          <TabsTrigger value="maturity"   data-testid="tab-maturity"><Layers className="h-3.5 w-3.5 mr-1.5" />Maturity Model</TabsTrigger>
          <TabsTrigger value="checklist"  data-testid="tab-checklist"><ClipboardList className="h-3.5 w-3.5 mr-1.5" />Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="h-20 animate-pulse bg-muted" />
              ))}
            </div>
          ) : overview ? (
            <OverviewTab departments={overview.departments} stats={overview.stats} />
          ) : null}
        </TabsContent>

        <TabsContent value="scaffold" className="mt-4">
          <ScaffoldTab />
        </TabsContent>

        <TabsContent value="guide" className="mt-4">
          <GuideTab guide={guide} />
        </TabsContent>

        <TabsContent value="maturity" className="mt-4">
          {maturityData ? (
            <MaturityTab levels={maturityData.levels} components={maturityData.components} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <ChecklistTab departments={overview?.departments ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
