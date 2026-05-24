import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Bot, User, Settings, AlertTriangle, CheckCircle, Clock, XCircle, SkipForward } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type LogEntry = {
  id: string;
  orgId: string;
  actorType: string;
  actorName: string | null;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  workflowRunId: string | null;
  toolName: string | null;
  status: string;
  confidenceScore: number | null;
  riskLevel: string | null;
  reasoningSummary: string | null;
  errorMessage: string | null;
  rollbackAvailable: boolean | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  completed: { label: "Completed", icon: CheckCircle, color: "text-green-500" },
  started: { label: "Started", icon: Clock, color: "text-blue-500" },
  failed: { label: "Failed", icon: XCircle, color: "text-red-500" },
  skipped: { label: "Skipped", icon: SkipForward, color: "text-gray-400" },
  requires_approval: { label: "Needs Approval", icon: AlertTriangle, color: "text-amber-500" },
};

const ACTOR_ICON: Record<string, typeof Bot> = {
  agent: Bot,
  system: Settings,
  admin: User,
  coach: User,
};

const RISK_BADGE: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function ActivityRow({ entry }: { entry: LogEntry }) {
  const statusCfg = STATUS_CONFIG[entry.status] ?? { label: entry.status, icon: Clock, color: "text-gray-400" };
  const StatusIcon = statusCfg.icon;
  const ActorIcon = ACTOR_ICON[entry.actorType] ?? Bot;

  return (
    <div
      className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0"
      data-testid={`activity-row-${entry.id}`}
    >
      <div className="mt-0.5 shrink-0">
        <ActorIcon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate">{entry.actionType}</span>
          {entry.toolName && (
            <span className="text-xs text-muted-foreground">via {entry.toolName}</span>
          )}
        </div>
        {entry.reasoningSummary && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{entry.reasoningSummary}</p>
        )}
        {entry.errorMessage && (
          <p className="text-xs text-red-500 mt-0.5 line-clamp-1">{entry.errorMessage}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {entry.actorName ?? entry.actorType} · {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </span>
          {entry.riskLevel && entry.riskLevel !== "low" && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${RISK_BADGE[entry.riskLevel] ?? ""}`}>
              {entry.riskLevel} risk
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 mt-0.5">
        <StatusIcon className={`h-3.5 w-3.5 ${statusCfg.color}`} />
      </div>
    </div>
  );
}

interface RecentAgentActivityProps {
  limit?: number;
  status?: string;
  actorType?: string;
  actionType?: string;
  title?: string;
  compact?: boolean;
}

export function RecentAgentActivity({
  limit = 10,
  status,
  actorType,
  actionType,
  title = "Recent Agent Activity",
  compact = false,
}: RecentAgentActivityProps) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (status) params.set("status", status);
  if (actorType) params.set("actorType", actorType);
  if (actionType) params.set("actionType", actionType);

  const { data, isLoading } = useQuery<LogEntry[]>({
    queryKey: ["/api/unified-action-log", { limit, status, actorType, actionType }],
    queryFn: async () => {
      const res = await fetch(`/api/unified-action-log?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <Card data-testid="card-recent-agent-activity">
      <CardHeader className={compact ? "py-3 px-4" : undefined}>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-primary" />
          {title}
          {data && data.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">{data.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className={compact ? "px-4 pb-3" : undefined}>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No agent activity yet
          </div>
        ) : (
          <ScrollArea className={compact ? "h-[200px]" : "h-[320px]"}>
            <div>
              {data.map(entry => <ActivityRow key={entry.id} entry={entry} />)}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
