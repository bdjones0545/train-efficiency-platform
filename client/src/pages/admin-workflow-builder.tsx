import { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Panel,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Save, Play, Upload, Zap, GitBranch, User, CheckCircle, AlertTriangle,
  RefreshCw, Layers, PanelRight, X, Plus, Info, ShieldAlert, Clock,
  ChevronRight, BookTemplate, Eye, Cpu, Search, Sparkles, Lock,
  Copy, Library, ToggleLeft, ToggleRight, TrendingUp, Calendar,
  Activity, Star, Settings, Trash2, ChevronDown, ChevronUp,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { NLWorkflowGenerator } from "@/components/nl-workflow-generator";

// ─── Workflow Registry Types ──────────────────────────────────────────────────

interface RegistryWorkflow {
  id: string;
  orgId: string;
  workflowKey: string;
  name: string;
  description?: string;
  workflowType: string;
  source: "system" | "template" | "org_custom";
  protected: boolean;
  editable: boolean;
  enabled: boolean;
  systemManaged: boolean;
  version: string;
  clonedFromWorkflowId?: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  estimatedRevenueInfluenced: number;
  estimatedBookingsCreated: number;
  estimatedLeadsConverted: number;
  workflowDefinition: any;
  tags: string[];
  triggerTypes: string[];
  actionTypes: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface ConflictInfo {
  workflowId: string;
  name: string;
  conflictType: string;
  details: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKFLOW_TYPE_COLORS: Record<string, string> = {
  lead_pipeline:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  outreach:       "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  scheduling:     "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  recovery:       "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  retention:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  automation:     "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  governance:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  custom:         "bg-muted text-muted-foreground",
};

function successRate(wf: RegistryWorkflow): number {
  if (wf.executionCount === 0) return 0;
  return Math.round((wf.successCount / wf.executionCount) * 100);
}

function relativeTime(iso?: string): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

// ─── Conflict Modal ───────────────────────────────────────────────────────────

function ConflictModal({
  conflicts, open, onClose, onContinue,
}: {
  conflicts: ConflictInfo[];
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Workflow Conflict Detected
          </DialogTitle>
          <DialogDescription>
            One or more active workflows already handle overlapping triggers or actions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {conflicts.map((c, i) => (
            <div key={i} className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.details}</p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                  {c.conflictType.replace("_", " ")}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" onClick={onClose}>Review Existing</Button>
          <Button variant="default" size="sm" onClick={onContinue} data-testid="btn-continue-anyway">
            Continue Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workflow Registry Card ───────────────────────────────────────────────────

function RegistryCard({
  wf, onClone, onToggle, onLoadInBuilder, onDelete,
}: {
  wf: RegistryWorkflow;
  onClone?: (wf: RegistryWorkflow) => void;
  onToggle?: (wf: RegistryWorkflow, enabled: boolean) => void;
  onLoadInBuilder?: (wf: RegistryWorkflow) => void;
  onDelete?: (wf: RegistryWorkflow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rate = successRate(wf);
  const isSystem = wf.source === "system";
  const isTemplate = wf.source === "template";

  return (
    <div
      className={`border rounded-xl bg-background transition-shadow hover:shadow-md ${wf.enabled ? "border-border" : "border-dashed border-muted-foreground/30"}`}
      data-testid={`registry-card-${wf.workflowKey}`}
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Lock or status indicator */}
          <div className={`flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${
            isSystem ? "bg-slate-100 dark:bg-slate-800" :
            isTemplate ? "bg-violet-50 dark:bg-violet-900/20" :
            "bg-emerald-50 dark:bg-emerald-900/20"
          }`}>
            {isSystem ? <Lock className="h-4 w-4 text-slate-500 dark:text-slate-400" /> :
             isTemplate ? <Star className="h-4 w-4 text-violet-500" /> :
             <Settings className="h-4 w-4 text-emerald-600" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate">{wf.name}</p>
                  {isSystem && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Managed by TrainEfficiency
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{wf.description}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${WORKFLOW_TYPE_COLORS[wf.workflowType] || WORKFLOW_TYPE_COLORS.custom}`}>
                  {wf.workflowType.replace("_", " ")}
                </span>
                {/* Active/inactive badge */}
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${wf.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                  {wf.enabled ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            {/* Analytics strip */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>{wf.executionCount} runs</span>
              </div>
              {wf.executionCount > 0 && (
                <div className={`flex items-center gap-1 text-xs font-medium ${
                  rate >= 80 ? "text-emerald-600" : rate >= 50 ? "text-amber-600" : "text-red-600"
                }`}>
                  <TrendingUp className="h-3 w-3" />
                  <span>{rate}% success</span>
                </div>
              )}
              {wf.failureCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{wf.failureCount} failed</span>
                </div>
              )}
              {wf.blockedCount > 0 && (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <ShieldAlert className="h-3 w-3" />
                  <span>{wf.blockedCount} blocked</span>
                </div>
              )}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Last run: {relativeTime(wf.lastRunAt)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {!isTemplate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setExpanded(e => !e)}
                  data-testid={`btn-inspect-${wf.workflowKey}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Inspect
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              )}
              {(isSystem || isTemplate) && onClone && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => onClone(wf)}
                  data-testid={`btn-clone-${wf.workflowKey}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate &amp; Customize
                </Button>
              )}
              {!isSystem && onLoadInBuilder && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => onLoadInBuilder(wf)}
                  data-testid={`btn-edit-${wf.workflowKey}`}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Edit in Builder
                </Button>
              )}
              {!isSystem && !isTemplate && onToggle && (
                <Button
                  variant={wf.enabled ? "outline" : "default"}
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => onToggle(wf, !wf.enabled)}
                  data-testid={`btn-toggle-${wf.workflowKey}`}
                >
                  {wf.enabled ? <ToggleRight className="h-3.5 w-3.5 text-emerald-600" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                  {wf.enabled ? "Disable" : "Enable"}
                </Button>
              )}
              {!isSystem && !isTemplate && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => onDelete(wf)}
                  data-testid={`btn-delete-${wf.workflowKey}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded node graph preview */}
      {expanded && wf.workflowDefinition && (
        <div className="border-t px-4 py-3 bg-muted/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Node Graph</p>
          <div className="flex flex-wrap gap-1.5">
            {((wf.workflowDefinition as any)?.nodes ?? []).map((node: any, i: number) => (
              <span
                key={node.id ?? i}
                className="inline-flex items-center gap-1 text-[10px] bg-background border rounded px-1.5 py-0.5"
              >
                <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  node.data?.riskLevel === "high" || node.data?.riskLevel === "critical" ? "bg-red-500" :
                  node.data?.riskLevel === "medium" ? "bg-amber-500" : "bg-green-500"
                }`} />
                {node.data?.label ?? node.data?.nodeType}
              </span>
            ))}
          </div>
          {wf.triggerTypes.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground">Triggers:</span>
              {wf.triggerTypes.map(t => (
                <span key={t} className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">{t.replace("_trigger","")}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Workflow Registry View ────────────────────────────────────────────────────

function WorkflowRegistryView({
  onLoadInBuilder,
  onCreateCustom,
}: {
  onLoadInBuilder: (wf: RegistryWorkflow) => void;
  onCreateCustom: () => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"active" | "templates" | "custom">("active");
  const [search, setSearch] = useState("");
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [conflictPendingToggle, setConflictPendingToggle] = useState<{ wf: RegistryWorkflow; enabled: boolean } | null>(null);

  const { data: registry, isLoading, refetch } = useQuery<{
    system: RegistryWorkflow[];
    templates: RegistryWorkflow[];
    orgCustom: RegistryWorkflow[];
    total: number;
  }>({
    queryKey: ["/api/admin/workflow-registry"],
    queryFn: async () => {
      const r = await fetch("/api/admin/workflow-registry", { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/admin/workflow-registry/${id}/clone`, {});
      return r.json();
    },
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflow-registry"] });
      toast({ title: "Workflow cloned", description: `"${cloned.name}" is ready in Organization Workflows.` });
      setActiveTab("org");
    },
    onError: (e: any) => toast({ title: "Clone failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await apiRequest("POST", `/api/admin/workflow-registry/${id}/toggle`, { enabled });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflow-registry"] });
      setConflictPendingToggle(null);
      toast({ title: "Workflow updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("PATCH", `/api/admin/workflow-registry/${id}`, { enabled: false });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workflow-registry"] });
      toast({ title: "Workflow disabled" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleToggle = async (wf: RegistryWorkflow, enabled: boolean) => {
    if (enabled) {
      // Check conflicts before enabling
      try {
        const r = await fetch("/api/admin/workflow-registry/conflicts/check", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId: wf.id, triggerTypes: wf.triggerTypes, actionTypes: wf.actionTypes }),
        });
        const data = await r.json();
        if (data.hasConflicts) {
          setConflicts(data.conflicts);
          setConflictPendingToggle({ wf, enabled });
          return;
        }
      } catch {}
    }
    toggleMutation.mutate({ id: wf.id, enabled });
  };

  const handleConflictContinue = () => {
    if (conflictPendingToggle) {
      toggleMutation.mutate({ id: conflictPendingToggle.wf.id, enabled: conflictPendingToggle.enabled });
    }
    setConflicts([]);
  };

  const filterWorkflows = (list: RegistryWorkflow[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(w =>
      w.name.toLowerCase().includes(q) ||
      w.description?.toLowerCase().includes(q) ||
      w.workflowType.includes(q) ||
      w.tags.some(t => t.toLowerCase().includes(q))
    );
  };

  const systemList = filterWorkflows(registry?.system ?? []);
  const orgList = filterWorkflows(registry?.orgCustom ?? []);
  const templateList = filterWorkflows(registry?.templates ?? []);

  // "Active" = all system workflows + enabled org workflows
  const activeList = [
    ...systemList,
    ...orgList.filter(w => w.enabled),
  ];
  const activeCount = (registry?.system?.length ?? 0) + (registry?.orgCustom ?? []).filter(w => w.enabled).length;

  const TABS = [
    { key: "active" as const, label: "Active Workflows", count: activeCount, icon: Activity },
    { key: "templates" as const, label: "Templates", count: templateList.length, icon: Star },
    { key: "custom" as const, label: "Custom Builder", count: orgList.filter(w => !w.enabled || w.source === "org_custom").length, icon: GitBranch },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="workflow-registry-view">
      {/* Registry header */}
      <div className="border-b bg-background px-5 py-4 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3 max-w-5xl mx-auto">
          <div>
            <div className="flex items-center gap-2">
              <Library className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">Workflow Registry</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {registry?.total ?? 0} workflows · {(registry?.system ?? []).filter(w => w.enabled).length + (registry?.orgCustom ?? []).filter(w => w.enabled).length} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search workflows…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs w-48"
                data-testid="input-registry-search"
              />
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} data-testid="btn-registry-refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-3 max-w-5xl mx-auto overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${activeTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                data-testid={`registry-tab-${t.key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${activeTab === t.key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-5 max-w-5xl mx-auto space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground" data-testid="registry-loading">
              Loading workflow registry…
            </div>

          ) : activeTab === "active" ? (
            <>
              {/* Summary banner */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 mb-4">
                <Activity className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {activeList.length} workflow{activeList.length !== 1 ? "s" : ""} currently active
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your automation stack is running. System-managed workflows are maintained by TrainEfficiency. Organization workflows were deployed by your team. All can be inspected and cloned.
                  </p>
                </div>
              </div>

              {/* System workflows sub-section */}
              {systemList.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-1 pb-0.5">
                    <Lock className="h-3.5 w-3.5 text-slate-500" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      System-Managed · {systemList.length} workflows
                    </p>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded px-1.5 py-0.5">
                      Managed by TrainEfficiency
                    </span>
                  </div>
                  {systemList.map(wf => (
                    <RegistryCard
                      key={wf.id}
                      wf={wf}
                      onClone={wf => cloneMutation.mutate(wf.id)}
                    />
                  ))}
                </>
              )}

              {/* Enabled org workflows sub-section */}
              {orgList.filter(w => w.enabled).length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-3 pb-0.5">
                    <Settings className="h-3.5 w-3.5 text-emerald-600" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Organization Workflows · {orgList.filter(w => w.enabled).length} active
                    </p>
                  </div>
                  {orgList.filter(w => w.enabled).map(wf => (
                    <RegistryCard
                      key={wf.id}
                      wf={wf}
                      onClone={wf => cloneMutation.mutate(wf.id)}
                      onToggle={handleToggle}
                      onLoadInBuilder={onLoadInBuilder}
                      onDelete={wf => deleteMutation.mutate(wf.id)}
                    />
                  ))}
                </>
              )}

              {activeList.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground" data-testid="active-empty">
                  No active workflows found.
                </div>
              )}

              {/* Inactive org custom workflows */}
              {orgList.filter(w => !w.enabled).length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-3 pb-0.5">
                    <Settings className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wide">
                      Inactive Organization Workflows · {orgList.filter(w => !w.enabled).length}
                    </p>
                  </div>
                  {orgList.filter(w => !w.enabled).map(wf => (
                    <RegistryCard
                      key={wf.id}
                      wf={wf}
                      onClone={wf => cloneMutation.mutate(wf.id)}
                      onToggle={handleToggle}
                      onLoadInBuilder={onLoadInBuilder}
                      onDelete={wf => deleteMutation.mutate(wf.id)}
                    />
                  ))}
                </>
              )}
            </>

          ) : activeTab === "templates" ? (
            <>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 mb-4">
                <Star className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-violet-700 dark:text-violet-300">Proven workflow templates</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pre-built templates for common business scenarios. Click <strong>Duplicate &amp; Customize</strong> to create your own editable copy, or <strong>Edit in Builder</strong> to load it directly into the canvas.
                  </p>
                </div>
              </div>
              {templateList.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground" data-testid="templates-empty">No templates found.</div>
              ) : templateList.map(wf => (
                <RegistryCard
                  key={wf.id}
                  wf={wf}
                  onClone={wf => cloneMutation.mutate(wf.id)}
                  onLoadInBuilder={onLoadInBuilder}
                />
              ))}
            </>

          ) : (
            /* Custom Builder tab */
            <div className="space-y-6" data-testid="custom-builder-section">
              {/* Hero CTA */}
              <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
                <GitBranch className="h-10 w-10 text-primary/40 mx-auto mb-3" />
                <h3 className="text-base font-semibold mb-1">Build a Custom Workflow</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                  Use the visual canvas to design bespoke automations using triggers, agent actions, logic gates, approval flows, and outcomes — all governed by the policy engine.
                </p>
                <Button
                  size="default"
                  className="gap-2"
                  onClick={onCreateCustom}
                  data-testid="btn-create-custom-workflow"
                >
                  <Plus className="h-4 w-4" />
                  Create Custom Workflow
                </Button>
              </div>

              {/* NL generator hint */}
              <div className="flex items-start gap-3 p-4 rounded-lg bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800">
                <Sparkles className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">AI Workflow Generator</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Describe what you want in plain English and the AI will build the node graph for you. Click <strong>Create Custom Workflow</strong> above, then use the <em>Describe</em> button in the top bar.
                  </p>
                </div>
              </div>

              {/* Existing org custom drafts */}
              {orgList.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-1 pb-0.5">
                    <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Your Custom Workflows · {orgList.length}
                    </p>
                  </div>
                  {orgList.map(wf => (
                    <RegistryCard
                      key={wf.id}
                      wf={wf}
                      onClone={wf => cloneMutation.mutate(wf.id)}
                      onToggle={handleToggle}
                      onLoadInBuilder={onLoadInBuilder}
                      onDelete={wf => deleteMutation.mutate(wf.id)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Conflict modal */}
      <ConflictModal
        conflicts={conflicts}
        open={conflicts.length > 0}
        onClose={() => { setConflicts([]); setConflictPendingToggle(null); }}
        onContinue={handleConflictContinue}
      />
    </div>
  );
}

// ─── Node palette definition ──────────────────────────────────────────────────

type NodeCategoryDef = {
  label: string;
  icon: typeof Zap;
  color: string;
  nodes: Array<{
    type: string;
    label: string;
    icon: typeof Zap;
    riskLevel: "low" | "medium" | "high" | "critical";
    agentType?: string;
  }>;
};

const NODE_PALETTE: NodeCategoryDef[] = [
  {
    label: "Triggers",
    icon: Zap,
    color: "text-green-600",
    nodes: [
      { type: "schedule_trigger", label: "Schedule", icon: Clock, riskLevel: "low" },
      { type: "webhook_trigger", label: "Webhook", icon: Zap, riskLevel: "low" },
      { type: "gmail_reply_trigger", label: "Gmail Reply", icon: Cpu, riskLevel: "low" },
      { type: "meta_lead_trigger", label: "Meta Lead", icon: Zap, riskLevel: "low" },
      { type: "payment_failed_trigger", label: "Payment Failed", icon: AlertTriangle, riskLevel: "low" },
      { type: "booking_cancelled_trigger", label: "Booking Cancelled", icon: AlertTriangle, riskLevel: "low" },
      { type: "manual_trigger", label: "Manual", icon: Play, riskLevel: "low" },
    ],
  },
  {
    label: "Agent Actions",
    icon: Cpu,
    color: "text-blue-600",
    nodes: [
      { type: "send_email", label: "Send Email", icon: Cpu, riskLevel: "high", agentType: "communication_agent" },
      { type: "post_slack_alert", label: "Slack Alert", icon: Cpu, riskLevel: "medium", agentType: "workflow_agent" },
      { type: "research_lead", label: "Research Lead", icon: Search, riskLevel: "high", agentType: "research_agent" },
      { type: "generate_report", label: "Generate Report", icon: Cpu, riskLevel: "low", agentType: "executive_agent" },
      { type: "classify_reply", label: "Classify Reply", icon: Cpu, riskLevel: "low", agentType: "communication_agent" },
      { type: "summarize_thread", label: "Summarize Thread", icon: Cpu, riskLevel: "low", agentType: "communication_agent" },
      { type: "create_booking", label: "Create Booking", icon: Cpu, riskLevel: "high", agentType: "scheduling_agent" },
      { type: "generate_recommendation", label: "AI Recommendation", icon: Cpu, riskLevel: "low", agentType: "system_agent" },
    ],
  },
  {
    label: "Logic",
    icon: GitBranch,
    color: "text-violet-600",
    nodes: [
      { type: "if_else", label: "IF / ELSE", icon: GitBranch, riskLevel: "low" },
      { type: "confidence_threshold", label: "Confidence Gate", icon: GitBranch, riskLevel: "low" },
      { type: "wait_delay", label: "Wait / Delay", icon: Clock, riskLevel: "low" },
      { type: "retry_policy", label: "Retry Policy", icon: RefreshCw, riskLevel: "low" },
      { type: "rate_limit_gate", label: "Rate Limit Gate", icon: ShieldAlert, riskLevel: "low" },
      { type: "branch_routing", label: "Branch Router", icon: GitBranch, riskLevel: "low" },
    ],
  },
  {
    label: "Human",
    icon: User,
    color: "text-amber-600",
    nodes: [
      { type: "approval_gate", label: "Approval Gate", icon: User, riskLevel: "medium" },
      { type: "manual_review", label: "Manual Review", icon: User, riskLevel: "medium" },
      { type: "escalate_admin", label: "Escalate to Admin", icon: User, riskLevel: "high" },
    ],
  },
  {
    label: "Outcomes",
    icon: CheckCircle,
    color: "text-emerald-600",
    nodes: [
      { type: "workflow_completed", label: "Completed ✓", icon: CheckCircle, riskLevel: "low" },
      { type: "workflow_failed", label: "Failed ✗", icon: AlertTriangle, riskLevel: "low" },
      { type: "workflow_escalated", label: "Escalated", icon: ShieldAlert, riskLevel: "low" },
      { type: "client_retained", label: "Client Retained", icon: CheckCircle, riskLevel: "low" },
      { type: "client_converted", label: "Client Converted", icon: CheckCircle, riskLevel: "low" },
      { type: "session_booked", label: "Session Booked", icon: CheckCircle, riskLevel: "low" },
    ],
  },
];

// ─── Risk colors / governance visual helpers ──────────────────────────────────

const RISK_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  low:      { border: "#22c55e", bg: "#f0fdf4", badge: "bg-green-100 text-green-700" },
  medium:   { border: "#f59e0b", bg: "#fffbeb", badge: "bg-amber-100 text-amber-700" },
  high:     { border: "#ef4444", bg: "#fef2f2", badge: "bg-red-100 text-red-700" },
  critical: { border: "#7c3aed", bg: "#f5f3ff", badge: "bg-violet-100 text-violet-700" },
};

const CATEGORY_HEADER_COLORS: Record<string, string> = {
  trigger:      "#16a34a",
  agent_action: "#2563eb",
  logic:        "#7c3aed",
  human:        "#d97706",
  outcome:      "#0d9488",
};

function getCategoryForType(t: string): string {
  const cats: Record<string, string> = {
    schedule_trigger: "trigger", webhook_trigger: "trigger", gmail_reply_trigger: "trigger",
    meta_lead_trigger: "trigger", payment_failed_trigger: "trigger", booking_cancelled_trigger: "trigger",
    manual_trigger: "trigger", workflow_completed_trigger: "trigger",
    send_email: "agent_action", post_slack_alert: "agent_action", research_lead: "agent_action",
    generate_report: "agent_action", classify_reply: "agent_action", summarize_thread: "agent_action",
    create_booking: "agent_action", generate_recommendation: "agent_action",
    if_else: "logic", confidence_threshold: "logic", wait_delay: "logic",
    retry_policy: "logic", rate_limit_gate: "logic", branch_routing: "logic",
    approval_gate: "human", manual_review: "human", assign_operator: "human", escalate_admin: "human",
    workflow_completed: "outcome", workflow_failed: "outcome", workflow_escalated: "outcome",
    client_retained: "outcome", client_converted: "outcome", session_booked: "outcome",
  };
  return cats[t] ?? "agent_action";
}

// ─── Custom WorkflowNode component ───────────────────────────────────────────

function WorkflowNode({ data, selected }: { data: any; selected: boolean }) {
  const category = getCategoryForType(data.nodeType);
  const risk = RISK_COLORS[data.riskLevel ?? "low"];
  const headerColor = CATEGORY_HEADER_COLORS[category] ?? "#6b7280";

  const execState = data.executionState ?? "idle";
  const stateStyles: Record<string, string> = {
    idle: "",
    running: "ring-2 ring-blue-400 ring-offset-1",
    completed: "ring-2 ring-green-400 ring-offset-1",
    failed: "ring-2 ring-red-400 ring-offset-1",
    waiting_approval: "ring-2 ring-amber-400 ring-offset-1",
    blocked: "ring-2 ring-red-600 ring-offset-1",
    retrying: "ring-2 ring-violet-400 ring-offset-1",
  };

  return (
    <div
      className={`rounded-lg border-2 shadow-sm min-w-[160px] max-w-[200px] bg-white dark:bg-slate-900 text-left ${stateStyles[execState]} ${selected ? "shadow-md" : ""}`}
      style={{ borderColor: risk.border }}
    >
      {/* Header bar */}
      <div
        className="px-2.5 py-1.5 rounded-t-md flex items-center gap-1.5"
        style={{ backgroundColor: headerColor }}
      >
        <span className="text-white text-[10px] font-semibold uppercase tracking-wider truncate">
          {category.replace("_", " ")}
        </span>
        {data.requiresApproval && (
          <ShieldAlert className="h-3 w-3 text-white/80 shrink-0" aria-label="Requires approval" />
        )}
      </div>
      {/* Body */}
      <div className="px-2.5 py-2">
        <p className="text-xs font-semibold text-foreground leading-tight">{data.label}</p>
        {data.agentType && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{data.agentType.replace("_agent", "")}</p>
        )}
        {data.governanceNote && (
          <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" />
            {data.governanceNote.slice(0, 40)}
          </p>
        )}
        {/* Execution state indicator */}
        {execState !== "idle" && (
          <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            execState === "running" ? "bg-blue-100 text-blue-700" :
            execState === "completed" ? "bg-green-100 text-green-700" :
            execState === "failed" ? "bg-red-100 text-red-700" :
            execState === "waiting_approval" ? "bg-amber-100 text-amber-700" :
            execState === "blocked" ? "bg-red-100 text-red-700" :
            "bg-violet-100 text-violet-700"
          }`}>
            {execState === "running" && <span className="animate-pulse">●</span>}
            {execState.replace("_", " ")}
          </div>
        )}
      </div>
      {/* Risk badge */}
      <div className="px-2.5 pb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${risk.badge}`}>
          {data.riskLevel ?? "low"} risk
        </span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { workflowNode: WorkflowNode as any };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createNewNode(nodeType: string, label: string, riskLevel: string, position: { x: number; y: number }, agentType?: string): Node {
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "workflowNode",
    position,
    data: {
      label,
      nodeType,
      category: getCategoryForType(nodeType),
      config: {},
      riskLevel,
      requiresApproval: riskLevel === "high" || riskLevel === "critical",
      agentType,
    },
  };
}

// ─── Node Config Panel ────────────────────────────────────────────────────────

function NodeConfigPanel({ node, onClose, onUpdate }: {
  node: Node;
  onClose: () => void;
  onUpdate: (id: string, data: any) => void;
}) {
  const [label, setLabel] = useState(node.data.label as string);
  const [riskLevel, setRiskLevel] = useState((node.data.riskLevel as string) ?? "low");
  const [requiresApproval, setRequiresApproval] = useState(!!(node.data.requiresApproval));
  const [governanceNote, setGovernanceNote] = useState((node.data.governanceNote as string) ?? "");

  const handleSave = () => {
    onUpdate(node.id, { ...node.data, label, riskLevel, requiresApproval, governanceNote });
    onClose();
  };

  const riskColors = RISK_COLORS[riskLevel];
  const UNGOVERNED_WARNING = "⚠ This action currently bypasses the governed runtime. Emergency pause may not stop this action. Route through integration-runtime before production use.";
  const govWarnings = {
    send_email: "This node sends email via SendGrid. Emergency pause is now enforced. Ensure governance allows outbound communication.",
    send_sms: UNGOVERNED_WARNING,
    post_slack_alert: "This node sends Slack alerts. Routes through integration-runtime — governance enforced.",
    research_lead: "Research Agent requires web access. Confirm governance allows external browsing.",
    create_booking: "This node creates calendar events — execution lock required.",
    approval_gate: "Execution pauses until a human approves. Configure timeout to avoid deadlocks.",
    meta_capi_event: "Meta CAPI events are now governed and idempotent. Duplicate events are prevented automatically.",
    stripe_charge: UNGOVERNED_WARNING,
    direct_ai_call: UNGOVERNED_WARNING,
  }[node.data.nodeType as string];

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle className="text-sm">Configure Node</SheetTitle>
          <SheetDescription className="text-xs">{node.data.nodeType as string}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Label</label>
            <Input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 h-8 text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Risk Level</label>
            <Select value={riskLevel} onValueChange={v => {
              setRiskLevel(v);
              if (v === "high" || v === "critical") setRequiresApproval(true);
            }}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low"><span className="text-green-600">Low</span></SelectItem>
                <SelectItem value="medium"><span className="text-amber-600">Medium</span></SelectItem>
                <SelectItem value="high"><span className="text-red-600">High</span></SelectItem>
                <SelectItem value="critical"><span className="text-violet-600">Critical</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requires-approval"
              checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="requires-approval" className="text-sm">Requires operator approval</label>
          </div>

          {govWarnings && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">{govWarnings}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Governance Note (optional)</label>
            <Textarea
              value={governanceNote}
              onChange={e => setGovernanceNote(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
              placeholder="Explain why this node is needed..."
            />
          </div>

          {/* Current risk indicator */}
          <div
            className="p-3 rounded-lg border-2"
            style={{ borderColor: riskColors.border, backgroundColor: riskColors.bg }}
          >
            <p className="text-xs font-medium" style={{ color: riskColors.border }}>
              {riskLevel === "low" && "✓ Autonomous execution allowed"}
              {riskLevel === "medium" && "⚠ Supervised execution — confidence checks apply"}
              {riskLevel === "high" && "⚠ Requires approval before execution"}
              {riskLevel === "critical" && "🛑 Blocked — escalation required"}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" className="flex-1" onClick={handleSave}>Save Node</Button>
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Templates Panel ──────────────────────────────────────────────────────────

function TemplatesPanel({ onLoad }: { onLoad: (graph: any) => void }) {
  const { data: templates } = useQuery<any>({
    queryKey: ["/api/workflow-graphs/templates"],
  });

  const builtIn = templates?.builtIn ?? [];
  const orgTemplates = templates?.orgTemplates ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Built-in Templates</p>
      <div className="space-y-2">
        {builtIn.map((tpl: any) => (
          <div key={tpl.id} className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => onLoad(tpl.graphDefinition)} data-testid={`template-${tpl.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
              </div>
              <Badge variant="secondary" className="text-[9px] shrink-0">{tpl.category}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${
                tpl.riskLevel === "low" ? "bg-green-100 text-green-700" :
                tpl.riskLevel === "medium" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-700"
              }`}>{tpl.riskLevel} risk</span>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2 ml-auto" onClick={e => { e.stopPropagation(); onLoad(tpl.graphDefinition); }}>
                <ChevronRight className="h-3 w-3" />
                Use
              </Button>
            </div>
          </div>
        ))}
      </div>
      {orgTemplates.length > 0 && (
        <>
          <Separator />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Templates</p>
          <div className="space-y-2">
            {orgTemplates.map((tpl: any) => (
              <div key={tpl.id} className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => onLoad(tpl.graphDefinition)}>
                <p className="text-xs font-semibold">{tpl.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.description}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Simulation Result Panel ──────────────────────────────────────────────────

function SimulationPanel({ result, onClose }: { result: any; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-[440px] sm:w-[480px]" side="right">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <Play className="h-4 w-4 text-blue-500" />
            Simulation Results
          </SheetTitle>
          <SheetDescription className="text-xs">No real actions executed — simulation only</SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100vh-180px)]">
          <div className="space-y-4 pr-2">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-3 text-center">
                <p className="text-xl font-bold">{result.totalSteps}</p>
                <p className="text-[10px] text-muted-foreground">Steps</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{result.approvalCount}</p>
                <p className="text-[10px] text-muted-foreground">Approvals</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{Math.round(result.estimatedDurationMs / 60000)}m</p>
                <p className="text-[10px] text-muted-foreground">Est. Duration</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-xl font-bold">${(result.estimatedCostCents / 100).toFixed(3)}</p>
                <p className="text-[10px] text-muted-foreground">Est. Cost</p>
              </Card>
            </div>

            {/* Risk level */}
            <div className={`p-3 rounded-lg border-l-4 ${
              result.riskLevel === "low" ? "border-green-500 bg-green-50 dark:bg-green-900/20" :
              result.riskLevel === "medium" ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20" :
              "border-red-500 bg-red-50 dark:bg-red-900/20"
            }`}>
              <p className="text-xs font-semibold">Risk Level: {result.riskLevel}</p>
            </div>

            {/* Governance warnings */}
            {result.governanceWarnings?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-amber-600">Governance Warnings</p>
                {result.governanceWarnings.map((w: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Potential deadlocks */}
            {result.potentialDeadlocks?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-red-600">Potential Deadlocks</p>
                {result.potentialDeadlocks.map((d: string, i: number) => (
                  <div key={i} className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded p-2">{d}</div>
                ))}
              </div>
            )}

            {/* API usage */}
            {Object.keys(result.apiCallEstimates ?? {}).length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1.5">Expected API Usage</p>
                <div className="space-y-1">
                  {Object.entries(result.apiCallEstimates).map(([api, count]: [string, any]) => (
                    <div key={api} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{api}</span>
                      <span className="font-medium">{count} calls</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step path */}
            <div>
              <p className="text-xs font-semibold mb-2">Expected Execution Path</p>
              <div className="space-y-2">
                {result.expectedPath?.map((step: any, i: number) => (
                  <div key={step.stepId} className="flex items-start gap-2.5">
                    <div className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      step.governanceDecision === "blocked" ? "bg-red-500" :
                      step.governanceDecision === "approval_required" ? "bg-amber-500" :
                      "bg-green-500"
                    }`}>{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{step.action}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] px-1 rounded font-medium ${
                          step.governanceDecision === "blocked" ? "bg-red-100 text-red-700" :
                          step.governanceDecision === "approval_required" ? "bg-amber-100 text-amber-700" :
                          "bg-green-100 text-green-700"
                        }`}>{step.governanceDecision}</span>
                        {step.agentType && <span className="text-[9px] text-muted-foreground">{step.agentType?.replace("_agent","")}</span>}
                        <span className="text-[9px] text-muted-foreground">{Math.round(step.estimatedDurationMs / 1000)}s</span>
                      </div>
                      {step.governanceReason && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{step.governanceReason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Workflow Builder Page ───────────────────────────────────────────────

export default function AdminWorkflowBuilderPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Registry / builder view toggle — default to registry so users see their automation stack first
  const [viewMode, setViewMode] = useState<"builder" | "registry">("registry");

  // UI state
  const [graphName, setGraphName] = useState("New Workflow");
  const [graphDesc, setGraphDesc] = useState("");
  const [graphCategory, setGraphCategory] = useState("custom");
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [currentGraphId, setCurrentGraphId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showNLGenerator, setShowNLGenerator] = useState(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Connect edges
  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
      animated: false,
    }, eds));
    setIsDirty(true);
  }, [setEdges]);

  // Drop new node from palette
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData("application/node-type");
    const nodeLabel = event.dataTransfer.getData("application/node-label");
    const nodeRisk = event.dataTransfer.getData("application/node-risk");
    const nodeAgent = event.dataTransfer.getData("application/node-agent");

    if (!nodeType || !reactFlowWrapper.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left - 80,
      y: event.clientY - bounds.top - 40,
    };

    const newNode = createNewNode(nodeType, nodeLabel, nodeRisk, position, nodeAgent || undefined);
    setNodes(nds => nds.concat(newNode));
    setIsDirty(true);
  }, [setNodes]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // Node click → open config
  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Node change → mark dirty
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes);
    const nonSelect = changes.filter((c: any) => c.type !== "select");
    if (nonSelect.length > 0) setIsDirty(true);
  }, [onNodesChange]);

  // Update node data from config panel
  const handleNodeUpdate = useCallback((id: string, newData: any) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: newData } : n));
    setSelectedNode(null);
    setIsDirty(true);
  }, [setNodes]);

  // Build graph definition
  const buildGraphDefinition = () => ({
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  // Load template
  const handleLoadTemplate = (graph: any) => {
    setNodes(graph.nodes ?? []);
    setEdges(graph.edges ?? []);
    setShowTemplates(false);
    setIsDirty(true);
    toast({ title: "Template loaded", description: "Edit the workflow to match your needs." });
  };

  // Load registry workflow into builder canvas
  const handleLoadRegistryWorkflow = (wf: RegistryWorkflow) => {
    const def = wf.workflowDefinition as any;
    if (def?.nodes) {
      setNodes(def.nodes ?? []);
      setEdges(def.edges ?? []);
      setGraphName(wf.name);
      setGraphCategory(wf.workflowType === "custom" ? "custom" : wf.workflowType);
      setIsDirty(true);
      setViewMode("builder");
      toast({ title: "Workflow loaded", description: `"${wf.name}" is now in the canvas. Edit and save as a new version.` });
    } else {
      toast({ title: "No graph definition", description: "This workflow has no visual canvas definition yet.", variant: "destructive" });
    }
  };

  // Validate
  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workflow-graphs/validate", { graphDefinition: buildGraphDefinition() });
      return res.json();
    },
    onSuccess: (data) => {
      setValidationResult(data);
      if (data.valid) {
        toast({ title: "Validation passed", description: `${data.warnings?.length ?? 0} warnings` });
      } else {
        toast({ title: `${data.errors?.length} validation error(s)`, variant: "destructive" });
      }
    },
  });

  // Simulate
  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workflow-graphs/simulate", { graphDefinition: buildGraphDefinition() });
      return res.json();
    },
    onSuccess: (data) => {
      setSimulationResult(data);
    },
    onError: () => toast({ title: "Simulation failed", variant: "destructive" }),
  });

  // Save
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: graphName,
        description: graphDesc,
        category: graphCategory,
        graphDefinition: buildGraphDefinition(),
      };
      const url = currentGraphId ? `/api/workflow-graphs/${currentGraphId}` : "/api/workflow-graphs";
      const method = currentGraphId ? "PUT" : "POST";
      const res = await apiRequest(method, url, body);
      return res.json();
    },
    onSuccess: (data) => {
      setCurrentGraphId(data.id);
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  // Publish
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!currentGraphId) throw new Error("Save workflow before publishing");
      const res = await apiRequest("POST", `/api/workflow-graphs/${currentGraphId}/publish`, { changeNotes: "" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow published", description: "A new version has been created." });
    },
    onError: (err: any) => toast({ title: err.message ?? "Failed to publish", variant: "destructive" }),
  });

  const hasErrors = validationResult && !validationResult.valid;
  const hasWarnings = validationResult?.warnings?.length > 0;

  return (
    <div className="h-screen flex flex-col bg-background" data-testid="page-workflow-builder">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm shrink-0">
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setViewMode("builder")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === "builder" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="view-toggle-builder"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Builder</span>
          </button>
          <button
            onClick={() => setViewMode("registry")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === "registry" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="view-toggle-registry"
          >
            <Library className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Registry</span>
          </button>
        </div>

        {viewMode === "builder" && (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <Input
                value={graphName}
                onChange={e => { setGraphName(e.target.value); setIsDirty(true); }}
                className="h-7 text-sm font-semibold border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:border-b focus-visible:border-primary rounded-none w-48"
                data-testid="input-graph-name"
              />
              {isDirty && <span className="text-[10px] text-muted-foreground italic">unsaved</span>}
            </div>

            <Select value={graphCategory} onValueChange={v => { setGraphCategory(v); setIsDirty(true); }}>
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["custom","onboarding","retention","outreach","scheduling","research","executive"].map(c => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          {viewMode === "builder" && (
            <>
              {/* Validation status */}
              {validationResult && (
                <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${hasErrors ? "bg-red-100 text-red-700" : hasWarnings ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                  {hasErrors ? <AlertTriangle className="h-3 w-3" /> : hasWarnings ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                  {hasErrors ? `${validationResult.errors.length} errors` : hasWarnings ? `${validationResult.warnings.length} warnings` : "Valid"}
                </div>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20" onClick={() => setShowNLGenerator(true)} data-testid="button-describe-workflow">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Describe</span>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowTemplates(true)} data-testid="button-templates">
                <BookTemplate className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Templates</span>
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending} data-testid="button-validate">
                <CheckCircle className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Validate</span>
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => simulateMutation.mutate()} disabled={simulateMutation.isPending} data-testid="button-simulate">
                <Play className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{simulateMutation.isPending ? "Simulating…" : "Simulate"}</span>
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-graph">
                <Save className="h-3.5 w-3.5" />
                {saveMutation.isPending ? "…" : <span className="hidden sm:inline">Save</span>}
              </Button>
              <Button variant="default" size="sm" className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending || !currentGraphId} data-testid="button-publish-graph">
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Publish</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Registry View ── */}
      {viewMode === "registry" && (
        <WorkflowRegistryView
          onLoadInBuilder={handleLoadRegistryWorkflow}
          onCreateCustom={() => {
            setNodes([]);
            setEdges([]);
            setGraphName("New Workflow");
            setViewMode("builder");
          }}
        />
      )}

      {/* ── Main canvas area ── */}
      {viewMode === "builder" && <div className="flex flex-1 min-h-0">
        {/* Palette sidebar */}
        {showPalette && (
          <div className="w-56 border-r bg-card flex flex-col shrink-0" data-testid="palette-panel">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Node Palette</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowPalette(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-3">
                {NODE_PALETTE.map(category => (
                  <div key={category.label}>
                    <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 ${category.color}`}>{category.label}</p>
                    <div className="space-y-1">
                      {category.nodes.map(n => (
                        <div
                          key={n.type}
                          draggable
                          onDragStart={e => {
                            e.dataTransfer.setData("application/node-type", n.type);
                            e.dataTransfer.setData("application/node-label", n.label);
                            e.dataTransfer.setData("application/node-risk", n.riskLevel);
                            e.dataTransfer.setData("application/node-agent", n.agentType ?? "");
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className="flex items-center gap-2 p-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-muted/60 transition-colors text-xs"
                          data-testid={`palette-node-${n.type}`}
                        >
                          <n.icon className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{n.label}</span>
                          <span className={`ml-auto inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                            n.riskLevel === "low" ? "bg-green-500" :
                            n.riskLevel === "medium" ? "bg-amber-500" : "bg-red-500"
                          }`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Governance legend */}
            <div className="border-t p-2 space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Governance Legend</p>
              {[["green","✓ Autonomous"],["amber","⚠ Supervised"],["red","⚠ Approval req."],["violet","🛑 Blocked"]].map(([c, l]) => (
                <div key={c} className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span className={`inline-block h-2 w-2 rounded-full bg-${c}-500`} style={{ backgroundColor: c === "violet" ? "#7c3aed" : undefined }} />
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ReactFlow Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          {!showPalette && (
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 left-2 z-10 h-7 text-xs gap-1"
              onClick={() => setShowPalette(true)}
              data-testid="button-show-palette"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          )}

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center space-y-2">
                <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm font-medium text-muted-foreground/60">Drag nodes from the palette to start building</p>
                <p className="text-xs text-muted-foreground/40">or load a template to get started quickly</p>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={changes => { onEdgesChange(changes); setIsDirty(true); }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            className="bg-dots"
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { strokeWidth: 1.5, stroke: "#94a3b8" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
            <Controls />
            <MiniMap nodeColor={n => {
              const risk = (n.data as any)?.riskLevel ?? "low";
              return RISK_COLORS[risk]?.border ?? "#94a3b8";
            }} className="rounded-lg" />

            {/* Stats panel */}
            <Panel position="bottom-center">
              <div className="flex items-center gap-3 bg-card/90 backdrop-blur border rounded-lg px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <span>{nodes.length} nodes</span>
                <span>·</span>
                <span>{edges.length} edges</span>
                {nodes.some(n => (n.data as any)?.requiresApproval) && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">{nodes.filter(n => (n.data as any)?.requiresApproval).length} approval gate(s)</span>
                  </>
                )}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Validation sidebar — errors/warnings */}
        {validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
          <div className="w-64 border-l bg-card shrink-0" data-testid="validation-panel">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-semibold">Validation</span>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setValidationResult(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {validationResult.errors.map((e: any, i: number) => (
                  <div key={i} className="p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    <p className="font-medium">{e.code}</p>
                    <p className="mt-0.5">{e.message}</p>
                  </div>
                ))}
                {validationResult.warnings.map((w: any, i: number) => (
                  <div key={i} className={`p-2 rounded border text-xs ${w.governanceNote ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"}`}>
                    {w.governanceNote && <span className="font-bold text-amber-600">⚠ GOVERNANCE </span>}
                    <p>{w.message}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>}

      {/* ── Panels ── */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onUpdate={handleNodeUpdate}
        />
      )}

      {showTemplates && (
        <Sheet open onOpenChange={open => !open && setShowTemplates(false)}>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle className="text-sm">Workflow Templates</SheetTitle>
              <SheetDescription className="text-xs">Start from a proven template</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <TemplatesPanel onLoad={handleLoadTemplate} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {simulationResult && (
        <SimulationPanel result={simulationResult} onClose={() => setSimulationResult(null)} />
      )}

      <NLWorkflowGenerator
        open={showNLGenerator}
        onClose={() => setShowNLGenerator(false)}
        onLoadDraft={(graph, name) => {
          setNodes(graph.nodes ?? []);
          setEdges(graph.edges ?? []);
          setGraphName(name);
          setIsDirty(true);
          toast({ title: "AI draft loaded", description: "Review the workflow before publishing. Nothing runs until you publish." });
        }}
      />
    </div>
  );
}
