import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  AlertTriangle, AlertCircle, Lightbulb, Info, Bell, BellRing,
  RefreshCw, X, CheckCheck, Clock, ArrowRight, ChevronDown,
  RotateCcw, Inbox, Filter, Zap, Brain, GitBranch, BadgeCheck,
  TrendingUp, Activity, Plug, SlidersHorizontal, Sun, Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LEVEL_CONFIG = {
  critical: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/20",
    border: "border-l-red-500",
    badgeCls: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
    label: "Critical",
    tabColor: "text-red-600 dark:text-red-400",
  },
  escalated: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/20",
    border: "border-l-red-500",
    badgeCls: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
    label: "Escalated",
    tabColor: "text-red-600 dark:text-red-400",
  },
  important: {
    icon: AlertCircle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/10",
    border: "border-l-amber-500",
    badgeCls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    label: "Important",
    tabColor: "text-amber-600 dark:text-amber-400",
  },
  suggested: {
    icon: Lightbulb,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/10",
    border: "border-l-violet-500",
    badgeCls: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800",
    label: "Suggested",
    tabColor: "text-violet-600 dark:text-violet-400",
  },
  informational: {
    icon: Info,
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-900/30",
    border: "border-l-slate-400",
    badgeCls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
    label: "Info",
    tabColor: "text-slate-500",
  },
} as const;

function getLevelConfig(level: string, status?: string) {
  const key = status === "escalated" ? "escalated" : level;
  return LEVEL_CONFIG[key as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.informational;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  workflow: GitBranch,
  approval: BadgeCheck,
  payment: TrendingUp,
  connector: Plug,
  deal: TrendingUp,
  churn: AlertTriangle,
  growth: TrendingUp,
  insight: Brain,
  ops: Activity,
  brain: Brain,
  trigger: Zap,
  manual: Bell,
};

const SNOOZE_OPTIONS = [
  { label: "1 hour", hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "24 hours", hours: 24 },
  { label: "1 week", hours: 168 },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type AttentionItem = {
  id: string;
  level: string;
  category: string;
  title: string;
  body?: string | null;
  status: string;
  source: string;
  sourceId?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  score: number;
  severity: number;
  urgency: number;
  businessImpact: number;
  confidence: number;
  snoozedUntil?: string | null;
  escalatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type DigestData = {
  type: string;
  generatedAt: string;
  criticalCount: number;
  importantCount: number;
  suggestedCount: number;
  informationalCount: number;
  totalActive: number;
  topItems: AttentionItem[];
  recentlyResolved: number;
  summary: string;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AttentionCard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AttentionCard({
  item,
  onSnooze,
  onDismiss,
  onComplete,
}: {
  item: AttentionItem;
  onSnooze: (id: string, hours: number) => void;
  onDismiss: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const [, navigate] = useLocation();
  const cfg = getLevelConfig(item.level, item.status);
  const Icon = cfg.icon;
  const CategoryIcon = CATEGORY_ICONS[item.category] ?? Bell;
  const isSnoozed = item.status === "snoozed";
  const isEscalated = item.status === "escalated";

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card border-border border-l-4 transition-all",
        cfg.border,
        isSnoozed && "opacity-60"
      )}
      data-testid={`attention-card-${item.id}`}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className={cn("flex-shrink-0 mt-0.5 p-1.5 rounded-md", cfg.bg)}>
            <Icon className={cn("h-4 w-4", cfg.color)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <span className="text-sm font-semibold leading-snug flex-1 min-w-0">
                {item.title}
                {isEscalated && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-red-500">
                    ↑ Escalated
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wide",
                  cfg.badgeCls
                )}>
                  {cfg.label}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {item.category}
                </span>
              </div>
            </div>

            {item.body && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {item.body}
              </p>
            )}

            {/* Score + Meta row */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
              </span>
              <span className="text-[10px] text-muted-foreground">
                Score: <span className="font-mono font-medium text-foreground">{item.score}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                from <span className="font-medium">{item.source}</span>
              </span>
              {isSnoozed && item.snoozedUntil && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Snoozed until {new Date(item.snoozedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {/* Score breakdown */}
            <div className="flex items-center gap-2 mt-2">
              {[
                { label: "Sev", value: item.severity },
                { label: "Urg", value: item.urgency },
                { label: "Impact", value: item.businessImpact },
                { label: "Conf", value: Math.round(item.confidence * 100) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
                  <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", cfg.color.replace("text-", "bg-"))}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/60">
          {item.actionUrl && (
            <Button
              size="sm"
              variant="outline"
              className={cn("h-7 text-xs gap-1", cfg.color)}
              onClick={() => navigate(item.actionUrl!)}
              data-testid={`button-attention-open-${item.id}`}
            >
              {item.actionLabel || "View"} <ArrowRight className="h-3 w-3" />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-muted-foreground"
                data-testid={`button-attention-snooze-${item.id}`}
              >
                <Clock className="h-3 w-3" /> Snooze
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-xs">
              {SNOOZE_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.hours}
                  onClick={() => onSnooze(item.id, opt.hours)}
                  data-testid={`snooze-option-${opt.hours}h`}
                >
                  <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground"
            onClick={() => onComplete(item.id)}
            data-testid={`button-attention-complete-${item.id}`}
          >
            <CheckCheck className="h-3 w-3" /> Done
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground ml-auto"
            onClick={() => onDismiss(item.id)}
            data-testid={`button-attention-dismiss-${item.id}`}
          >
            <X className="h-3 w-3" /> Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Digest Panel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function DigestPanel({ digest }: { digest: DigestData }) {
  const stats = [
    { label: "Critical", count: digest.criticalCount, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/20" },
    { label: "Important", count: digest.importantCount, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/10" },
    { label: "Suggested", count: digest.suggestedCount, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/10" },
    { label: "Info", count: digest.informationalCount, color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-800" },
  ];

  return (
    <div className="rounded-xl border bg-gradient-to-br from-background to-muted/30 p-5 mb-6">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Sun className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold">Attention Digest</h2>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">Morning</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{digest.summary}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-4">
        {stats.map((s) => (
          <div key={s.label} className={cn("rounded-lg p-2.5 text-center", s.bg)}>
            <div className={cn("text-xl font-bold leading-none", s.color)}>{s.count}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {digest.recentlyResolved > 0 && (
        <p className="text-[11px] text-muted-foreground mt-3 text-center">
          ✓ {digest.recentlyResolved} item{digest.recentlyResolved !== 1 ? "s" : ""} resolved in the last 24 hours
        </p>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TabValue = "all" | "critical" | "important" | "suggested" | "informational";

export default function AttentionInboxPage() {
  const [tab, setTab] = useState<TabValue>("all");
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<AttentionItem[]>({
    queryKey: ["/api/attention"],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: digest } = useQuery<DigestData>({
    queryKey: ["/api/attention/digest"],
  });

  const snoozeMutation = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) =>
      apiRequest("PATCH", `/api/attention/${id}/snooze`, { hours }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/attention"] });
      toast({ title: "Item snoozed", description: "We'll surface it again after the snooze period." });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/attention/${id}/dismiss`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/attention"] });
      toast({ title: "Dismissed", description: "Item removed from your inbox." });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/attention/${id}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/attention"] });
      toast({ title: "Marked as done", description: "Great work! Item marked complete." });
    },
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiRequest("POST", "/api/attention/sync");
      await qc.invalidateQueries({ queryKey: ["/api/attention"] });
      await qc.invalidateQueries({ queryKey: ["/api/attention/digest"] });
      toast({ title: "Inbox refreshed", description: "Latest data from all sources pulled in." });
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = items.filter((item) => {
    if (tab === "all") return true;
    if (tab === "critical") return item.level === "critical" || item.status === "escalated";
    return item.level === tab;
  });

  const counts = {
    all: items.length,
    critical: items.filter((i) => i.level === "critical" || i.status === "escalated").length,
    important: items.filter((i) => i.level === "important" && i.status !== "escalated").length,
    suggested: items.filter((i) => i.level === "suggested").length,
    informational: items.filter((i) => i.level === "informational").length,
  };

  const hasCritical = counts.critical > 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            {hasCritical ? (
              <BellRing className="h-6 w-6 text-red-500" />
            ) : (
              <Inbox className="h-6 w-6 text-muted-foreground" />
            )}
            <h1 className="text-2xl font-bold tracking-tight">Attention Inbox</h1>
            {hasCritical && (
              <Badge variant="destructive" className="text-xs px-2">
                {counts.critical} critical
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Unified view of all alerts, approvals, AI recommendations, and operational priorities — ranked by impact.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="gap-2"
          data-testid="button-attention-sync"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
      </div>

      {/* Digest */}
      {digest && <DigestPanel digest={digest} />}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList className="h-9 gap-1 bg-muted/50">
          {(["all", "critical", "important", "suggested", "informational"] as TabValue[]).map((t) => {
            const count = counts[t];
            const cfg = t === "all" ? null : getLevelConfig(t);
            return (
              <TabsTrigger
                key={t}
                value={t}
                className={cn(
                  "text-xs px-3 capitalize gap-1.5",
                  tab === t && cfg ? cfg.color : ""
                )}
                data-testid={`tab-attention-${t}`}
              >
                {t === "all" ? "All" : cfg?.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1 rounded-full",
                      tab === t && t === "critical" ? "bg-red-500 text-white" :
                      tab === t && t === "important" ? "bg-amber-500 text-white" :
                      "bg-muted-foreground/20 text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Content */}
        <div className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCheck className="h-12 w-12 text-muted-foreground/20 mb-3" />
              <h3 className="text-sm font-semibold text-muted-foreground">
                {tab === "all" ? "All clear — inbox is empty" : `No ${tab} items`}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                {tab === "all"
                  ? "Nothing requires your attention right now. Systems are operating normally."
                  : `No ${tab} attention items in your inbox right now.`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSync}
                className="mt-4 gap-2 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Check for new items
              </Button>
            </div>
          ) : (
            filtered.map((item) => (
              <AttentionCard
                key={item.id}
                item={item}
                onSnooze={(id, hours) => snoozeMutation.mutate({ id, hours })}
                onDismiss={(id) => dismissMutation.mutate(id)}
                onComplete={(id) => completeMutation.mutate(id)}
              />
            ))
          )}
        </div>
      </Tabs>

      {/* Legend */}
      {items.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Priority Model</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { level: "critical", desc: "Immediate action required. Failed workflows, stuck approvals, payment failures." },
              { level: "important", desc: "Should be addressed soon. Stalled deals, follow-ups due, churn risks." },
              { level: "suggested", desc: "Growth opportunities, AI recommendations, workflow suggestions." },
              { level: "informational", desc: "Passive insights, completed syncs, status updates." },
            ].map(({ level, desc }) => {
              const cfg = getLevelConfig(level);
              const Icon = cfg.icon;
              return (
                <div key={level} className={cn("rounded-md p-2.5 border", cfg.bg)}>
                  <div className={cn("flex items-center gap-1.5 mb-1", cfg.color)}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-xs font-semibold">{cfg.label}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            Score formula: (Severity×0.30) + (Urgency×0.40) + (Business Impact×0.20) + (Confidence×0.10). Items ignored for 24h+ are auto-escalated.
          </p>
        </div>
      )}
    </div>
  );
}
