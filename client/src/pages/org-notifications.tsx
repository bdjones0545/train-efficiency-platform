import { TrainLogo } from "@/components/train-logo";
import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import {
  Bell, BellOff, CheckCheck, Trophy, Calendar,
  MessageSquare, Megaphone, AlertTriangle, ArrowLeft, Zap,
  Heart, Loader2, Activity, ChevronRight, Sparkles, TrendingUp,
  Eye, User,
} from "lucide-react";

// ─── Types & Config ────────────────────────────────────────────────────────────

interface NotifMeta {
  icon: any;
  color: string;
  bg: string;
  border: string;
  label: string;
  severity: "celebration" | "alert" | "warning" | "info" | "default";
}

const NOTIF_CONFIG: Record<string, NotifMeta> = {
  workout_assigned:    { icon: TrainLogo, color: "text-primary",        bg: "bg-primary/10",       border: "border-primary/20",    label: "Workout Assigned",    severity: "info" },
  workout_completed:   { icon: CheckCheck,     color: "text-emerald-400",    bg: "bg-emerald-400/10",   border: "border-emerald-400/20", label: "Completed",           severity: "info" },
  workout_reminder:    { icon: Calendar,       color: "text-amber-400",      bg: "bg-amber-400/10",     border: "border-amber-400/20",  label: "Reminder",            severity: "warning" },
  missed_workout:      { icon: AlertTriangle,  color: "text-red-400",        bg: "bg-red-400/10",       border: "border-red-400/20",    label: "Missed Workout",      severity: "alert" },
  readiness_followup:  { icon: Heart,          color: "text-rose-400",       bg: "bg-rose-400/10",      border: "border-rose-400/20",   label: "Readiness",           severity: "warning" },
  pr_celebration:      { icon: Trophy,         color: "text-amber-400",      bg: "bg-amber-400/10",     border: "border-amber-400/20",  label: "PR",                  severity: "celebration" },
  coach_message:       { icon: MessageSquare,  color: "text-blue-400",       bg: "bg-blue-400/10",      border: "border-blue-400/20",   label: "Coach Message",       severity: "info" },
  team_announcement:   { icon: Megaphone,      color: "text-violet-400",     bg: "bg-violet-400/10",    border: "border-violet-400/20", label: "Announcement",        severity: "info" },
  coach_alert:         { icon: Zap,            color: "text-orange-400",     bg: "bg-orange-400/10",    border: "border-orange-400/20", label: "Coach Alert",         severity: "alert" },
};

const DEFAULT_CFG: NotifMeta = {
  icon: Bell, color: "text-muted-foreground", bg: "bg-muted",
  border: "border-border", label: "Notification", severity: "default",
};

const FILTER_TYPES = [
  { key: "all",              label: "All" },
  { key: "coach_message",    label: "Messages" },
  { key: "team_announcement",label: "Announcements" },
  { key: "workout_assigned", label: "Workouts" },
  { key: "pr_celebration",   label: "PRs" },
  { key: "coach_alert",      label: "Alerts" },
  { key: "readiness_followup",label: "Readiness" },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Quick Action Button ───────────────────────────────────────────────────────

function QuickAction({ label, icon: Icon, href }: { label: string; icon: any; href?: string }) {
  return (
    <a href={href ?? "#"}>
      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground px-2">
        <Icon className="h-3 w-3" /> {label}
      </Button>
    </a>
  );
}

function getQuickActions(n: any, slug: string) {
  const meta = (n.metadata as any) ?? {};
  const actions: Array<{ label: string; icon: any; href?: string }> = [];

  if (n.type === "workout_assigned" || n.type === "missed_workout" || n.type === "readiness_followup") {
    actions.push({ label: "View Workout", icon: TrainLogo, href: `/org/${slug}/portal` });
  }
  if (n.type === "pr_celebration") {
    actions.push({ label: "View PRs", icon: Trophy, href: `/org/${slug}/portal` });
  }
  if (n.type === "coach_message" || n.type === "team_announcement") {
    actions.push({ label: "Open Message", icon: MessageSquare, href: `/org/${slug}/notifications` });
  }
  if (n.type === "coach_alert") {
    if (meta.athleteUserId) actions.push({ label: "View Athlete", icon: User, href: `/org/${slug}/portal` });
    actions.push({ label: "Review", icon: Eye, href: `/org/${slug}/portal` });
  }
  if (n.type === "readiness_followup" && n.title?.includes("adapted")) {
    actions.push({ label: "Review Recommendation", icon: Activity, href: `/org/${slug}/portal` });
  }
  return actions.slice(0, 2);
}

// ─── Notification Card ─────────────────────────────────────────────────────────

function NotifCard({ n, slug, onRead }: { n: any; slug: string; onRead: (id: string) => void }) {
  const cfg = NOTIF_CONFIG[n.type] ?? DEFAULT_CFG;
  const Icon = cfg.icon;
  const isCelebration = cfg.severity === "celebration";
  const isAlert = cfg.severity === "alert";
  const actions = getQuickActions(n, slug);
  const meta = (n.metadata as any) ?? {};

  return (
    <Card
      className={`p-4 flex gap-3 transition-all duration-150 cursor-pointer
        ${!n.isRead ? `${cfg.border} border` : "border-border opacity-60"}
        ${isCelebration && !n.isRead ? "bg-amber-400/[0.03] shadow-sm shadow-amber-400/5" : ""}
        ${isAlert && !n.isRead ? "bg-red-400/[0.03]" : ""}
        ${!isCelebration && !isAlert && !n.isRead ? "bg-primary/[0.02]" : ""}
        hover:border-primary/30
      `}
      onClick={() => { if (!n.isRead) onRead(n.id); }}
      data-testid={`card-notification-${n.id}`}
    >
      {/* Icon */}
      <div className={`relative h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
        <Icon className={`h-4 w-4 ${cfg.color}`} />
        {isCelebration && !n.isRead && (
          <span className="absolute -top-1 -right-1">
            <Sparkles className="h-3 w-3 text-amber-400" />
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold leading-snug ${!n.isRead ? "text-foreground" : "text-muted-foreground"}`}>
            {n.title}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(n.createdAt)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{n.message}</p>

        {/* Tags + actions row */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 h-4 ${cfg.color} border-current/30`}
            >
              {cfg.label}
            </Badge>
            {isAlert && meta.severity === "high" && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">High</Badge>
            )}
            {meta.severity === "positive" && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> Spike
              </Badge>
            )}
          </div>
          {actions.length > 0 && !n.isRead && (
            <div className="flex items-center gap-0.5">
              {actions.map((a) => (
                <QuickAction key={a.label} label={a.label} icon={a.icon} href={a.href} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Message Inbox ─────────────────────────────────────────────────────────────

function MessageInbox({ orgToken, slug }: { orgToken: string | null; slug: string }) {
  function buildH(): Record<string, string> {
    const h: Record<string, string> = { ...getAuthHeaders() };
    if (orgToken) h["X-Org-Auth-Token"] = orgToken;
    return h;
  }

  const { data: messages = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/org/messages"],
    queryFn: () => fetchJson("/api/org/messages", { headers: buildH() }),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/org/messages/${id}/read`, { method: "PATCH", headers: buildH(), credentials: "include" }),
    onSuccess: () => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/org/messages"] }); },
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );

  if (messages.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm font-medium">No messages yet</p>
        <p className="text-xs text-muted-foreground">Messages from your coach will appear here.</p>
      </div>
    );
  }

  const unread = messages.filter((m: any) => !m.isRead).length;

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <p className="text-xs text-muted-foreground px-1">{unread} unread message{unread !== 1 ? "s" : ""}</p>
      )}
      {messages.map((msg: any) => {
        const isAnnouncement = msg.messageType === "team_announcement";
        return (
          <Card
            key={msg.id}
            className={`p-4 space-y-2.5 cursor-pointer transition-colors
              ${!msg.isRead ? "border-primary/20 bg-primary/[0.02] hover:border-primary/30" : "opacity-60 hover:opacity-80"}
            `}
            onClick={() => { if (!msg.isRead) readMutation.mutate(msg.id); }}
            data-testid={`card-message-${msg.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0
                  ${isAnnouncement ? "bg-violet-500/15 text-violet-400" : "bg-blue-500/15 text-blue-400"}
                `}>
                  {isAnnouncement ? <Megaphone className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                </div>
                <div>
                  <p className={`text-sm font-semibold leading-tight ${!msg.isRead ? "text-foreground" : "text-muted-foreground"}`}>
                    {msg.subject ?? (isAnnouncement ? "Team Announcement" : "Message from Coach")}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {msg.sender
                      ? `${msg.sender.firstName ?? ""} ${msg.sender.lastName ?? ""}`.trim() || "Coach"
                      : "Coach"} · {timeAgo(msg.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!msg.isRead && <div className="h-2 w-2 rounded-full bg-primary" />}
                <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                  {isAnnouncement ? "Team" : "Direct"}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{msg.body}</p>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Grouped Notification List ────────────────────────────────────────────────

function groupNotifications(notifications: any[]) {
  const groups: { label: string; items: any[] }[] = [];
  const now = new Date();
  const today: any[] = [];
  const yesterday: any[] = [];
  const older: any[] = [];

  for (const n of notifications) {
    const diff = now.getTime() - new Date(n.createdAt).getTime();
    const hrs = diff / 3600000;
    if (hrs < 24) today.push(n);
    else if (hrs < 48) yesterday.push(n);
    else older.push(n);
  }

  if (today.length)     groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (older.length)     groups.push({ label: "Earlier", items: older });

  return groups;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OrgNotificationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"notifications" | "messages">("notifications");

  const { hasAccess } = usePermissions(slug ?? "");

  const orgToken = (() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("orgToken_")) return localStorage.getItem(key) ?? null;
    }
    return null;
  })();

  function buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { ...getAuthHeaders() };
    if (orgToken) h["X-Org-Auth-Token"] = orgToken;
    return h;
  }

  const canLoad = !!orgToken || hasAccess;

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/notifications", activeFilter],
    queryFn: () => {
      const params = activeFilter !== "all" ? `?type=${activeFilter}` : "";
      return fetchJson(`/api/org/notifications${params}`, { headers: buildHeaders() });
    },
    enabled: canLoad,
    refetchInterval: 30000,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/org/notifications/${id}/read`, { method: "PATCH", headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    onSuccess: () => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/org/notifications"] }); },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () =>
      fetch("/api/org/notifications/mark-all-read", { method: "POST", headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "All notifications marked as read" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/org/notifications"] });
    },
  });

  const notifications: any[] = data?.notifications ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;
  const groups = groupNotifications(notifications);

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Sticky nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/portal`} data-testid="link-back-to-portal">
            <Button size="sm" variant="ghost" className="gap-1.5 -ml-2">
              <ArrowLeft className="h-4 w-4" /> Portal
            </Button>
          </a>
          <div className="flex-1 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <Badge className="text-xs h-5 px-1.5 bg-primary text-primary-foreground">{unreadCount}</Badge>
            )}
          </div>
          {activeTab === "notifications" && unreadCount > 0 && (
            <Button
              size="sm" variant="ghost"
              className="text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5" /> All read
            </Button>
          )}
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 space-y-4 pt-4">

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {[
            { key: "notifications", label: "Notifications", icon: Bell },
            { key: "messages",      label: "Messages",      icon: MessageSquare },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${activeTab === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-${key}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Filter pills — notifications tab only */}
        {activeTab === "notifications" && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {FILTER_TYPES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border flex-shrink-0 transition-colors
                  ${activeFilter === key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                data-testid={`filter-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Notifications content */}
        {activeTab === "notifications" && (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoading && notifications.length === 0 && (
              <div className="text-center py-14 space-y-3">
                <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                  <BellOff className="h-7 w-7 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-semibold">You're all caught up</p>
                <p className="text-xs text-muted-foreground">
                  {activeFilter === "all"
                    ? "Notifications appear here as you train, log PRs, and receive messages."
                    : "No notifications for this filter yet."}
                </p>
              </div>
            )}

            {!isLoading && notifications.length > 0 && (
              <div className="space-y-5">
                {groups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
                      {group.label}
                    </p>
                    <div className="space-y-2">
                      {group.items.map((n) => (
                        <NotifCard
                          key={n.id}
                          n={n}
                          slug={slug ?? ""}
                          onRead={(id) => readMutation.mutate(id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Messages tab */}
        {activeTab === "messages" && (
          <MessageInbox orgToken={orgToken} slug={slug ?? ""} />
        )}
      </div>
    </div>
  );
}
