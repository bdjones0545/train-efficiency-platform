import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Bell, BellRing, AlertTriangle, AlertCircle, Lightbulb, Info, ArrowRight, X, CheckCheck, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@shared/schema";

// ── Level config ──────────────────────────────────────────────────────────────

const LEVEL_CONFIG = {
  critical: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    label: "Critical",
  },
  escalated: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    label: "Escalated",
  },
  important: {
    icon: AlertCircle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
    border: "border-amber-200 dark:border-amber-800",
    badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "Important",
  },
  suggested: {
    icon: Lightbulb,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/20",
    border: "border-violet-200 dark:border-violet-800",
    badge: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
    dot: "bg-violet-400",
    label: "Suggested",
  },
  informational: {
    icon: Info,
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-900/40",
    border: "border-slate-200 dark:border-slate-700",
    badge: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
    dot: "bg-slate-400",
    label: "Info",
  },
} as const;

function getLevelConfig(level: string) {
  return LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.informational;
}

// ── Types ────────────────────────────────────────────────────────────────────

type AttentionItem = {
  id: string;
  level: string;
  category: string;
  title: string;
  body?: string | null;
  status: string;
  source: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  score: number;
  createdAt: string;
};

// ── Bell Component ────────────────────────────────────────────────────────────

export function AttentionBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role;
  const isCoachOrAdmin = role === "COACH" || role === "ADMIN";

  const { data: items = [] } = useQuery<AttentionItem[]>({
    queryKey: ["/api/attention"],
    enabled: isCoachOrAdmin && isAuthenticated,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/attention/${id}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/attention"] }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/attention/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/attention"] }),
  });

  if (!isCoachOrAdmin) return null;

  const activeItems = items.filter((i) => i.status === "active" || i.status === "escalated");
  const criticalCount = activeItems.filter((i) => i.level === "critical" || i.status === "escalated").length;
  const importantCount = activeItems.filter((i) => i.level === "important").length;
  const badgeCount = criticalCount + importantCount;
  const topItems = activeItems.slice(0, 5);

  const hasCritical = criticalCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="button-attention-bell"
          aria-label={`Attention inbox — ${badgeCount} items need action`}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            hasCritical && "text-red-600 dark:text-red-400"
          )}
        >
          {hasCritical ? (
            <BellRing className={cn("h-4 w-4", hasCritical && "animate-[wiggle_1s_ease-in-out_infinite]")} />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {badgeCount > 0 && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white leading-none",
                hasCritical ? "bg-red-500" : "bg-amber-500"
              )}
              data-testid="text-attention-count"
            >
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 shadow-lg"
        data-testid="popover-attention"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Attention Inbox</span>
            {badgeCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                {badgeCount}
              </Badge>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
          {topItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <CheckCheck className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">All clear — nothing needs attention right now.</p>
            </div>
          ) : (
            topItems.map((item) => {
              const cfg = getLevelConfig(item.status === "escalated" ? "escalated" : item.level);
              const Icon = cfg.icon;
              return (
                <div
                  key={item.id}
                  className={cn("flex gap-3 px-4 py-3 hover:bg-muted/30 transition-colors", cfg.bg)}
                  data-testid={`attention-item-${item.id}`}
                >
                  <div className={cn("flex-shrink-0 mt-0.5", cfg.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                      <p className="text-xs font-medium leading-snug flex-1 truncate">{item.title}</p>
                      <span className={cn("flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide", cfg.badge)}>
                        {cfg.label}
                      </span>
                    </div>
                    {item.body && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.body}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {item.actionUrl && (
                        <button
                          className={cn("text-[10px] font-medium flex items-center gap-0.5", cfg.color)}
                          onClick={() => { setOpen(false); navigate(item.actionUrl!); }}
                        >
                          {item.actionLabel || "View"} <ArrowRight className="h-2.5 w-2.5" />
                        </button>
                      )}
                      <button
                        className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
                        onClick={() => dismissMutation.mutate(item.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2.5">
          <button
            onClick={() => { setOpen(false); navigate("/admin/attention"); }}
            className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-attention-view-all"
          >
            <span>View all {activeItems.length} item{activeItems.length !== 1 ? "s" : ""} in Attention Inbox</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
