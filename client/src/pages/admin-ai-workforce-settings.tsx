import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Settings, ArrowLeft, RefreshCw, Save, CheckCircle, Clock,
  ShieldCheck, Users, Plug, GitBranch, Target, Building2,
  ChevronDown, AlertTriangle, History, Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

const DEPARTMENTS = [
  { id: "executive", label: "Executive Intelligence", desc: "Daily briefings, performance summaries, business KPIs", agent: "Atlas" },
  { id: "retention", label: "Client Success", desc: "Churn prevention, re-engagement, satisfaction monitoring", agent: "Pulse" },
  { id: "revenue", label: "Revenue Operations", desc: "Lead conversion, deal pipeline, revenue recovery", agent: "Apex" },
  { id: "operations", label: "Operations", desc: "Session scheduling, capacity management, logistics", agent: "Tempo" },
  { id: "finance", label: "Finance", desc: "Payment tracking, revenue reporting, billing automation", agent: "Ledger" },
  { id: "communications", label: "Client Communications", desc: "Email outreach, follow-ups, campaign execution", agent: "Relay" },
  { id: "intelligence", label: "Intelligence", desc: "Lead enrichment, web research, data quality", agent: "Vector" },
];

const GOVERNANCE_MODES = [
  {
    id: "supervised",
    label: "Conservative (Supervised)",
    desc: "Every AI action requires human approval before execution.",
    color: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20",
    badge: "text-blue-700 bg-blue-100",
  },
  {
    id: "collaborative",
    label: "Balanced (Collaborative)",
    desc: "Low-risk actions run automatically; medium and high-risk require approval.",
    color: "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-900/20",
    badge: "text-teal-700 bg-teal-100",
  },
  {
    id: "autonomous",
    label: "Advanced (Autonomous)",
    desc: "Agents operate independently. Finance always requires approval.",
    color: "border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20",
    badge: "text-purple-700 bg-purple-100",
  },
];

const GOAL_OPTIONS = [
  { id: "revenue_growth", label: "Revenue Growth" },
  { id: "client_retention", label: "Client Retention" },
  { id: "operational_efficiency", label: "Operational Efficiency" },
  { id: "lead_conversion", label: "Lead Conversion" },
  { id: "team_coordination", label: "Team Coordination" },
  { id: "data_quality", label: "Data & Reporting Quality" },
];

const PRESET_OPTIONS = [
  "Sports Performance Facility",
  "Team Training Organization",
  "Personal Training Studio",
  "Strength & Conditioning Gym",
  "Athletic Development Center",
  "Corporate Wellness",
  "Other",
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  wizard_completed: "Wizard Completed",
  governance_changed: "Governance Mode Changed",
  departments_changed: "Departments Updated",
  templates_changed: "Workflow Templates Changed",
  integrations_changed: "Integrations Updated",
  settings_updated: "Settings Updated",
};

const EVENT_TYPE_ICONS: Record<string, typeof ShieldCheck> = {
  wizard_completed: CheckCircle,
  governance_changed: ShieldCheck,
  departments_changed: Users,
  templates_changed: GitBranch,
  integrations_changed: Plug,
  settings_updated: Settings,
};

function AuditEntry({ entry }: { entry: any }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = EVENT_TYPE_ICONS[entry.eventType] ?? History;
  return (
    <div className="flex gap-3 py-2.5 border-b last:border-0" data-testid={`audit-entry-${entry.id}`}>
      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold">{EVENT_TYPE_LABELS[entry.eventType] ?? entry.eventType}</span>
          <span className="text-[10px] text-muted-foreground">
            {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) : ""}
          </span>
        </div>
        {entry.changedBy && (
          <p className="text-[10px] text-muted-foreground">by {entry.changedBy}</p>
        )}
        {(entry.oldValue || entry.newValue) && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-primary hover:underline mt-0.5">
            {expanded ? "Hide changes" : "Show changes"}
          </button>
        )}
        {expanded && (
          <div className="mt-1.5 space-y-1">
            {entry.oldValue && (
              <div className="text-[10px] font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-2 py-1 rounded">
                − {JSON.stringify(entry.oldValue)}
              </div>
            )}
            {entry.newValue && (
              <div className="text-[10px] font-mono bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-1 rounded">
                + {JSON.stringify(entry.newValue)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminAiWorkforceSettingsPage() {
  const { toast } = useToast();

  const { data: settings, isLoading: settingsLoading } = useQuery<any>({
    queryKey: ["/api/workforce/settings"],
    queryFn: async () => {
      const res = await fetch("/api/workforce/settings");
      return res.json();
    },
  });

  const { data: auditLog, isLoading: auditLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/audit-log"],
    queryFn: async () => {
      const res = await fetch("/api/workforce/audit-log");
      return res.json();
    },
  });

  const { data: recommendations } = useQuery<any>({
    queryKey: ["/api/workforce/recommendations"],
    queryFn: async () => {
      const res = await fetch("/api/workforce/recommendations");
      return res.json();
    },
  });

  // Local edit state (initialised from loaded settings)
  const [depts, setDepts] = useState<string[]>([]);
  const [govMode, setGovMode] = useState<string>("");
  const [goals, setGoals] = useState<string[]>([]);
  const [orgPreset, setOrgPreset] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  if (settings && !initialized) {
    setDepts(Array.isArray(settings.enabledDepartments) ? settings.enabledDepartments : []);
    setGovMode(settings.governanceMode ?? "collaborative");
    setGoals(Array.isArray(settings.goals) ? settings.goals : []);
    setOrgPreset(settings.orgPreset ?? "");
    setInitialized(true);
  }

  const toggleDept = (id: string) =>
    setDepts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);

  const toggleGoal = (id: string) =>
    setGoals(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/workforce/settings", {
        enabledDepartments: depts,
        governanceMode: govMode,
        goals,
        orgPreset,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/capabilities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      const changed = data.changes?.length ?? 0;
      toast({
        title: changed > 0 ? "Settings saved." : "No changes to save.",
        description: changed > 0
          ? `${changed} setting${changed > 1 ? "s" : ""} updated. ${data.changes?.includes("governanceMode") ? "Governance policies reseeded." : ""}`
          : undefined,
      });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const isLoading = settingsLoading;

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto" data-testid="page-workforce-settings">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/ai-workforce">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2">
                <ArrowLeft className="h-3.5 w-3.5" /> AI Workforce
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Workforce Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update departments, governance mode, and intelligence preferences. Changes apply immediately.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
          data-testid="button-save-settings"
        >
          {saveMutation.isPending ? (
            <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Saving…</>
          ) : (
            <><Save className="h-4 w-4 mr-1.5" />Save Changes</>
          )}
        </Button>
      </div>

      {/* Recommendations banner */}
      {recommendations?.recommendations?.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <Lightbulb className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Recommendations based on your goals</p>
            <div className="mt-1.5 space-y-1">
              {recommendations.recommendations.slice(0, 3).map((r: any) => (
                <p key={r.id} className="text-xs text-amber-700 dark:text-amber-300">
                  · <span className="font-medium">{r.title}</span> — {r.reason}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      ) : (
        <>
          {/* Org Preset */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Organization Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PRESET_OPTIONS.map(preset => (
                  <button
                    key={preset}
                    onClick={() => setOrgPreset(prev => prev === preset ? "" : preset)}
                    data-testid={`preset-${preset.replace(/\s/g, "-").toLowerCase()}`}
                    className={`text-left px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                      orgPreset === preset
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Business Goals */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Business Goals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {GOAL_OPTIONS.map(goal => (
                  <button
                    key={goal.id}
                    onClick={() => toggleGoal(goal.id)}
                    data-testid={`goal-${goal.id}`}
                    className={`text-left px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                      goals.includes(goal.id)
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    }`}
                  >
                    {goals.includes(goal.id) && <CheckCircle className="h-3 w-3 inline mr-1.5 text-primary" />}
                    {goal.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Active Departments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Active Departments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Only agents from enabled departments will respond to requests and appear in operations. Changes apply immediately after saving.
              </p>
              {DEPARTMENTS.map(dept => (
                <div
                  key={dept.id}
                  onClick={() => toggleDept(dept.id)}
                  data-testid={`dept-toggle-${dept.id}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    depts.includes(dept.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30 opacity-70"
                  }`}
                >
                  <div className={`h-4 w-4 rounded border mt-0.5 shrink-0 flex items-center justify-center ${
                    depts.includes(dept.id) ? "bg-primary border-primary" : "border-muted-foreground"
                  }`}>
                    {depts.includes(dept.id) && <CheckCircle className="h-3 w-3 text-white" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{dept.label}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{dept.agent}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Governance Mode */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Governance Mode
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Changing governance mode immediately reseeds all agent capability policies. Finance always requires approval regardless of mode.
              </p>
              {GOVERNANCE_MODES.map(mode => (
                <div
                  key={mode.id}
                  onClick={() => setGovMode(mode.id)}
                  data-testid={`gov-mode-${mode.id}`}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    govMode === mode.id ? mode.color + " border-2" : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className={`h-4 w-4 rounded-full border-2 mt-0.5 shrink-0 ${
                    govMode === mode.id ? "border-primary bg-primary" : "border-muted-foreground"
                  }`} />
                  <div>
                    <span className="text-sm font-semibold">{mode.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{mode.desc}</p>
                  </div>
                </div>
              ))}
              <div className="flex justify-end">
                <Link href="/admin/ai-governance">
                  <Button variant="outline" size="sm" className="text-xs">
                    View Full Governance Controls →
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Separator />

      {/* Audit Trail */}
      <div data-testid="section-audit-trail">
        <div className="flex items-center gap-2 mb-4">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Settings Change History</h2>
          <Badge variant="secondary" className="text-[10px]">{auditLog?.length ?? 0} events</Badge>
        </div>
        {auditLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
          </div>
        ) : !auditLog?.length ? (
          <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-lg" data-testid="text-no-audit">
            <History className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
            No configuration changes recorded yet.
          </div>
        ) : (
          <Card>
            <CardContent className="pt-4 divide-y">
              {auditLog.map(entry => <AuditEntry key={entry.id} entry={entry} />)}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
