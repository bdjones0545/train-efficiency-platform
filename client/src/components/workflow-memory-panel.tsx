import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Brain, Shield, History, MessageSquare, Lightbulb,
  Building2, ChevronDown, ChevronRight, Clock, Star,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemoryEntry = {
  id: string;
  entityType: string;
  entityId: string;
  contextType: string;
  summary: string;
  structuredContext: any;
  lastOutcome: string | null;
  memoryImportanceScore: number | null;
  createdBy: string;
  sourceWorkflowId: string | null;
  neverDelete: boolean | null;
  compressed: boolean | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryStats = {
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  operatorOverrides: number;
  highImportanceMemories: number;
  compressedMemories: number;
  byType: Record<string, number>;
  recentMemories: MemoryEntry[];
};

type WorkflowOutcome = {
  id: string;
  workflowRunId: string;
  workflowType: string;
  entityType: string | null;
  entityId: string | null;
  outcomeType: string;
  outcomeScore: number | null;
  revenueImpact: number | null;
  operatorModified: boolean | null;
  aiRecommendationUsed: boolean | null;
  outcomeSummary: string | null;
  createdAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_TYPE_CONFIG: Record<string, { icon: typeof Brain; label: string; color: string }> = {
  operator_override: { icon: Shield, label: "Operator Override", color: "text-purple-600 dark:text-purple-400" },
  workflow_memory: { icon: History, label: "Workflow Memory", color: "text-blue-600 dark:text-blue-400" },
  communication_memory: { icon: MessageSquare, label: "Communication", color: "text-green-600 dark:text-green-400" },
  interaction_history: { icon: Clock, label: "Interaction", color: "text-gray-600 dark:text-gray-400" },
  ai_reasoning_memory: { icon: Brain, label: "AI Reasoning", color: "text-orange-600 dark:text-orange-400" },
  business_memory: { icon: Building2, label: "Business Pattern", color: "text-indigo-600 dark:text-indigo-400" },
};

const OUTCOME_COLORS: Record<string, string> = {
  converted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  retained: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  booked: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  recovered: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  ignored: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  escalated: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

// ─── Memory Entry Card ─────────────────────────────────────────────────────────

function MemoryCard({ memory }: { memory: MemoryEntry }) {
  const [open, setOpen] = useState(false);
  const cfg = CONTEXT_TYPE_CONFIG[memory.contextType] ?? { icon: Lightbulb, label: memory.contextType, color: "text-gray-600" };
  const Icon = cfg.icon;
  const score = memory.memoryImportanceScore ?? 0;
  const importanceColor = score >= 0.7 ? "text-green-600" : score >= 0.4 ? "text-amber-600" : "text-gray-400";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left" data-testid={`memory-card-${memory.id}`}>
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors">
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground">{cfg.label}</span>
              {memory.neverDelete && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-400 text-purple-600">permanent</Badge>
              )}
              {memory.lastOutcome && (
                <Badge className={`text-[10px] px-1.5 py-0 ${OUTCOME_COLORS[memory.lastOutcome] ?? ""}`}>
                  {memory.lastOutcome}
                </Badge>
              )}
            </div>
            <p className="text-sm mt-0.5 line-clamp-2">{memory.summary}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(memory.updatedAt), { addSuffix: true })}
              </span>
              <span className="text-[10px] text-muted-foreground">by {memory.createdBy}</span>
              <span className={`text-[10px] font-medium ${importanceColor}`}>
                ★ {(score * 100).toFixed(0)}
              </span>
            </div>
          </div>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />}
        </div>
      </CollapsibleTrigger>

      {memory.structuredContext && (
        <CollapsibleContent>
          <div className="mx-3 mb-2 p-3 rounded-lg bg-muted/50 border border-border text-xs font-mono overflow-auto max-h-40">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(memory.structuredContext, null, 2)}
            </pre>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

// ─── Entity Memory Panel ───────────────────────────────────────────────────────
// Shows memory for a specific entity (e.g., a lead or athlete). Used on workflow detail pages.

export function EntityMemoryPanel({
  entityType,
  entityId,
  entityName,
}: {
  entityType: string;
  entityId: string;
  entityName?: string;
}) {
  const [open, setOpen] = useState(false);

  const { data: memories, isLoading } = useQuery<MemoryEntry[]>({
    queryKey: ["/api/workflow-context", entityType, entityId],
    queryFn: () => fetchJson(`/api/workflow-context?entityType=${entityType}&entityId=${entityId}`),
    enabled: open,
  });

  if (!entityId) return null;

  return (
    <Card data-testid="entity-memory-panel">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger className="w-full">
            <CardTitle className="flex items-center justify-between text-sm font-medium cursor-pointer">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-500" />
                <span>Context Used For This Decision</span>
                {memories && memories.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{memories.length} memories</Badge>
                )}
              </div>
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </CardTitle>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {!open ? null : isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : !memories || memories.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No memory found for {entityName ?? `${entityType} ${entityId}`}.</p>
                <p className="text-xs mt-1">Memory builds as workflows run and operators interact.</p>
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-3">
                  {memories.map(m => <MemoryCard key={m.id} memory={m} />)}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ─── Org Memory Feed ───────────────────────────────────────────────────────────
// Shows recent memory activity across the whole org. Used on the AI Ops dashboard.

export function OrgMemoryFeed({ limit = 15 }: { limit?: number }) {
  const { data: stats, isLoading } = useQuery<MemoryStats>({
    queryKey: ["/api/workflow-context/stats"],
  });

  return (
    <Card data-testid="org-memory-feed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4 text-purple-500" />
          Memory Activity
          {stats && (
            <Badge variant="secondary" className="text-[10px]">{stats.activeMemories} active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : !stats || stats.activeMemories === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No memories yet.</p>
            <p className="text-xs mt-1">Run workflows to build organizational memory.</p>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="text-center p-2 rounded-lg bg-muted/40">
                <p className="text-lg font-bold">{stats.activeMemories}</p>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{stats.operatorOverrides}</p>
                <p className="text-[10px] text-muted-foreground">Overrides</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-900/20">
                <p className="text-lg font-bold text-green-600 dark:text-green-400">{stats.highImportanceMemories}</p>
                <p className="text-[10px] text-muted-foreground">High Priority</p>
              </div>
            </div>

            {/* By type breakdown */}
            {Object.entries(stats.byType).length > 0 && (
              <div className="mb-4 space-y-1">
                {Object.entries(stats.byType).map(([type, count]) => {
                  const cfg = CONTEXT_TYPE_CONFIG[type];
                  if (!cfg) return null;
                  const Icon = cfg.icon;
                  return (
                    <div key={type} className="flex items-center justify-between text-xs" data-testid={`memory-type-${type}`}>
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3 w-3 ${cfg.color}`} />
                        <span className="text-muted-foreground">{cfg.label}</span>
                      </div>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent memories list */}
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5 pr-2">
                {stats.recentMemories.slice(0, limit).map(m => (
                  <div key={m.id} className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/40 transition-colors" data-testid={`memory-feed-${m.id}`}>
                    {(() => {
                      const cfg = CONTEXT_TYPE_CONFIG[m.contextType];
                      if (!cfg) return <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />;
                      const Icon = cfg.icon;
                      return <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.color}`} />;
                    })()}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs line-clamp-2">{m.summary}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {m.entityType} · {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true })}
                      </p>
                    </div>
                    {m.neverDelete && <Star className="h-3 w-3 text-purple-400 shrink-0 mt-0.5" />}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Outcome Analytics Panel ───────────────────────────────────────────────────

type OutcomeAnalytics = {
  totalOutcomes: number;
  successCount: number;
  successRate: number;
  operatorModifiedCount: number;
  modificationRate: number;
  totalRevenueImpact: number;
  byType: Record<string, number>;
  byWorkflowType: Record<string, { count: number; operatorModified: number; aiUsed: number }>;
  recentOutcomes: WorkflowOutcome[];
};

export function OutcomeAnalyticsPanel() {
  const { data, isLoading } = useQuery<OutcomeAnalytics>({
    queryKey: ["/api/workflow-outcomes/analytics"],
  });

  return (
    <Card data-testid="outcome-analytics-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Star className="h-4 w-4 text-amber-500" />
          Workflow Outcome Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : !data || data.totalOutcomes === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Star className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No outcome data yet.</p>
            <p className="text-xs mt-1">Outcomes are recorded as workflows complete.</p>
          </div>
        ) : (
          <>
            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{data.successRate}%</p>
                <p className="text-xs text-muted-foreground">Success Rate</p>
                <p className="text-[10px] text-muted-foreground">{data.successCount} / {data.totalOutcomes}</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20">
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{data.modificationRate}%</p>
                <p className="text-xs text-muted-foreground">Operator Modified</p>
                <p className="text-[10px] text-muted-foreground">{data.operatorModifiedCount} edits</p>
              </div>
            </div>

            {/* Outcome breakdown */}
            {Object.entries(data.byType).length > 0 && (
              <div className="space-y-1 mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">By Outcome Type</p>
                {Object.entries(data.byType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between" data-testid={`outcome-type-${type}`}>
                      <Badge className={`text-[10px] ${OUTCOME_COLORS[type] ?? "bg-gray-100 text-gray-800"}`}>{type}</Badge>
                      <span className="text-xs font-medium">{count}</span>
                    </div>
                  ))}
              </div>
            )}

            {/* Top workflow types */}
            {Object.entries(data.byWorkflowType).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Most Active Workflows</p>
                {Object.entries(data.byWorkflowType)
                  .sort(([, a], [, b]) => b.count - a.count)
                  .slice(0, 4)
                  .map(([wfType, stats]) => (
                    <div key={wfType} className="flex items-center justify-between gap-2" data-testid={`workflow-type-${wfType}`}>
                      <span className="text-xs text-muted-foreground truncate">{wfType.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-orange-600">{stats.operatorModified} edits</span>
                        <span className="text-xs font-medium">{stats.count}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
