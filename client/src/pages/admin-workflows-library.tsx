/**
 * Workflows Library — Phase 6
 *
 * Lists all workflow graphs for the org with status, risk, complexity,
 * version history, and quick actions (edit, live view, duplicate, delete).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiResponse } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GitBranch, Plus, Search, Eye, MoreVertical, Copy, Trash2,
  CheckCircle, AlertTriangle, ShieldAlert, Play, Layers,
  Clock, Activity, Flame,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Risk + status helpers ────────────────────────────────────────────────────

const RISK_BADGE: Record<string, string> = {
  low:      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  medium:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  high:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  critical: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
};

const RISK_ICON: Record<string, typeof AlertTriangle> = {
  low: CheckCircle, medium: AlertTriangle, high: AlertTriangle, critical: ShieldAlert,
};

const CATEGORY_COLORS: Record<string, string> = {
  onboarding: "bg-blue-500", retention: "bg-emerald-500", outreach: "bg-amber-500",
  scheduling: "bg-violet-500", research: "bg-pink-500", executive: "bg-slate-500", custom: "bg-gray-400",
};

// ─── Workflow Card ────────────────────────────────────────────────────────────

function WorkflowCard({ graph, onDelete, onDuplicate }: {
  graph: any;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const RiskIcon = RISK_ICON[graph.riskLevel] ?? AlertTriangle;
  const nodeCount = (graph.graphDefinition?.nodes ?? []).length;
  const edgeCount = (graph.graphDefinition?.edges ?? []).length;

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`workflow-card-${graph.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Category dot */}
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${CATEGORY_COLORS[graph.category] ?? "bg-gray-400"}`}>
            <GitBranch className="h-4 w-4 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{graph.name}</p>
                {graph.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{graph.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {graph.published && (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-[10px] h-5">
                    <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                    Published
                  </Badge>
                )}
                {graph.isTemplate && (
                  <Badge variant="secondary" className="text-[10px] h-5">Template</Badge>
                )}
              </div>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${RISK_BADGE[graph.riskLevel] ?? RISK_BADGE.low}`}>
                <RiskIcon className="h-2.5 w-2.5" />
                {graph.riskLevel}
              </span>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{graph.category}</Badge>
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Layers className="h-3 w-3" />{nodeCount} nodes
              </span>
              <span className="text-[10px] text-muted-foreground">complexity {graph.estimatedComplexity ?? 0}</span>
              {graph.requiresApproval && (
                <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                  <ShieldAlert className="h-2.5 w-2.5" />approval req.
                </span>
              )}
            </div>

            {/* Governance warnings */}
            {((graph.governanceWarnings ?? []) as string[]).length > 0 && (
              <div className="mt-1.5 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-600 line-clamp-1">
                  {(graph.governanceWarnings as string[]).length} governance warning(s)
                </p>
              </div>
            )}

            {/* Footer row */}
            <div className="flex items-center justify-between mt-3">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {graph.updatedAt ? formatDistanceToNow(new Date(graph.updatedAt), { addSuffix: true }) : "never"}
              </span>
              <div className="flex items-center gap-1">
                <Link href={`/admin/workflow-builder?graphId=${graph.id}`}>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 gap-0.5" data-testid={`button-edit-${graph.id}`}>
                    Edit
                  </Button>
                </Link>
                <Link href={`/admin/workflows/${graph.id}/live`}>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 gap-0.5" data-testid={`button-live-${graph.id}`}>
                    <Activity className="h-2.5 w-2.5" />
                    Live
                  </Button>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" data-testid={`button-menu-${graph.id}`}>
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDuplicate(graph.id)} className="text-xs">
                      <Copy className="h-3.5 w-3.5 mr-2" />Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(graph.id)}
                      className="text-xs text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminWorkflowsLibraryPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: graphs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    select: (data: any) => Array.isArray(data) ? data : [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/workflow-graphs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/workflow-graphs/${id}/duplicate`).then(r => parseApiResponse<any>(r)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      toast({ title: "Workflow duplicated", description: data.name });
    },
    onError: () => toast({ title: "Failed to duplicate", variant: "destructive" }),
  });

  const filtered = graphs.filter(g => {
    const matchesSearch = !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCat = categoryFilter === "all" || g.category === categoryFilter;
    const matchesRisk = riskFilter === "all" || g.riskLevel === riskFilter;
    return matchesSearch && matchesCat && matchesRisk;
  });

  const categories = [...new Set(graphs.map(g => g.category))].filter((c): c is string => !!c && c.trim() !== "");

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-workflows-library">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            Workflow Library
          </h1>
          <p className="text-sm text-muted-foreground">
            {graphs.length} workflow{graphs.length !== 1 ? "s" : ""} · {graphs.filter(g => g.published).length} published
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/workflow-heatmap">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="button-heatmap">
              <Flame className="h-3.5 w-3.5 text-red-500" />
              Heatmap
            </Button>
          </Link>
          <Link href="/admin/workflow-builder">
            <Button size="sm" className="h-8 text-xs gap-1.5" data-testid="button-new-workflow">
              <Plus className="h-3.5 w-3.5" />
              New Workflow
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search workflows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-search-workflows"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="h-8 text-xs w-32">
            <SelectValue placeholder="Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All risks</SelectItem>
            {["low","medium","high","critical"].map(r => <SelectItem key={r} value={r} className="text-xs capitalize">{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl">
          <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          {graphs.length === 0 ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">No workflows yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Build your first AI workflow</p>
              <Link href="/admin/workflow-builder">
                <Button size="sm" className="mt-4 gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  Open Workflow Builder
                </Button>
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No workflows match your filters</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(g => (
            <WorkflowCard
              key={g.id}
              graph={g}
              onDelete={setDeleteId}
              onDuplicate={id => duplicateMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This workflow will be deactivated. Published versions already running will continue until complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
