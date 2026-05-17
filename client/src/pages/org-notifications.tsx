import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Bell, BellOff, Check, CheckCheck, Dumbbell, Trophy, Calendar,
  MessageSquare, Megaphone, Users, AlertTriangle, ChevronRight,
  ArrowLeft, Zap, Heart, Star, Loader2, X, Activity,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
const NOTIF_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  workout_assigned:   { icon: Dumbbell,      color: "text-primary bg-primary/10",          label: "Workout Assigned" },
  workout_reminder:   { icon: Calendar,      color: "text-amber-400 bg-amber-400/10",       label: "Workout Reminder" },
  missed_workout:     { icon: AlertTriangle, color: "text-red-400 bg-red-400/10",           label: "Missed Workout" },
  readiness_followup: { icon: Heart,         color: "text-rose-400 bg-rose-400/10",         label: "Readiness Check" },
  pr_celebration:     { icon: Trophy,        color: "text-amber-400 bg-amber-400/10",       label: "PR Celebration" },
  coach_message:      { icon: MessageSquare, color: "text-blue-400 bg-blue-400/10",         label: "Coach Message" },
  team_announcement:  { icon: Megaphone,     color: "text-violet-400 bg-violet-400/10",     label: "Team Announcement" },
  coach_alert:        { icon: Zap,           color: "text-orange-400 bg-orange-400/10",     label: "Coach Alert" },
};

const FILTER_TYPES = [
  { key: "all", label: "All" },
  { key: "coach_message", label: "Messages" },
  { key: "team_announcement", label: "Announcements" },
  { key: "workout_assigned", label: "Workouts" },
  { key: "pr_celebration", label: "PRs" },
  { key: "coach_alert", label: "Alerts" },
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

function NotifCard({ n, onRead }: { n: any; onRead: (id: string) => void }) {
  const cfg = NOTIF_CONFIG[n.type] ?? { icon: Bell, color: "text-muted-foreground bg-muted", label: n.type };
  const Icon = cfg.icon;
  return (
    <Card
      className={`p-4 flex gap-3 cursor-pointer hover:border-primary/20 transition-colors ${!n.isRead ? "border-primary/20 bg-primary/[0.02]" : "opacity-70"}`}
      onClick={() => { if (!n.isRead) onRead(n.id); if (n.actionUrl) window.location.href = n.actionUrl; }}
      data-testid={`card-notification-${n.id}`}
    >
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium leading-snug ${!n.isRead ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary" />}
            <span className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{n.message}</p>
        <Badge variant="outline" className="text-[10px] mt-1">{cfg.label}</Badge>
      </div>
    </Card>
  );
}

// ─── Message Inbox ─────────────────────────────────────────────────────────────
function MessageInbox({ orgToken }: { orgToken: string }) {
  const { toast } = useToast();

  const { data: messages = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/org/messages"],
    queryFn: () =>
      fetch("/api/org/messages", { headers: { "X-Org-Auth-Token": orgToken } })
        .then((r) => r.json()),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/org/messages/${id}/read`, { method: "PATCH", headers: { "X-Org-Auth-Token": orgToken } }),
    onSuccess: () => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/org/messages"] }); },
  });

  if (isLoading) return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (messages.length === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">No messages yet</p>
        <p className="text-xs text-muted-foreground">Messages from your coach will appear here.</p>
      </div>
    );
  }

  const unread = messages.filter((m: any) => !m.isRead).length;

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <p className="text-xs text-muted-foreground">{unread} unread message{unread !== 1 ? "s" : ""}</p>
      )}
      {messages.map((msg: any) => (
        <Card
          key={msg.id}
          className={`p-4 space-y-2 cursor-pointer hover:border-primary/20 transition-colors ${!msg.isRead ? "border-primary/20 bg-primary/[0.02]" : "opacity-70"}`}
          onClick={() => { if (!msg.isRead) readMutation.mutate(msg.id); }}
          data-testid={`card-message-${msg.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${msg.messageType === "team_announcement" ? "bg-violet-500/20 text-violet-400" : "bg-blue-500/20 text-blue-400"}`}>
                {msg.messageType === "team_announcement" ? <Megaphone className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
              </div>
              <div>
                <p className={`text-sm font-medium ${!msg.isRead ? "text-foreground" : "text-muted-foreground"}`}>
                  {msg.subject ?? (msg.messageType === "team_announcement" ? "Team Announcement" : "Message from Coach")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {msg.sender ? `${msg.sender.firstName ?? ""} ${msg.sender.lastName ?? ""}`.trim() : "Coach"} · {timeAgo(msg.createdAt)}
                </p>
              </div>
            </div>
            {!msg.isRead && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-3 pl-9">{msg.body}</p>
          <div className="pl-9">
            <Badge variant="outline" className="text-[10px]">
              {msg.messageType === "team_announcement" ? "Team Announcement" : msg.messageType === "system" ? "System" : "Direct Message"}
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Notifications Page ───────────────────────────────────────────────────
export default function OrgNotificationsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"notifications" | "messages">("notifications");

  // Get org token from localStorage
  const orgToken = (() => {
    // Try to get any orgToken stored
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("orgToken_")) return localStorage.getItem(key) ?? "";
    }
    return "";
  })();

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/notifications", activeFilter],
    queryFn: () => {
      const params = activeFilter !== "all" ? `?type=${activeFilter}` : "";
      return fetch(`/api/org/notifications${params}`, { headers: { "X-Org-Auth-Token": orgToken } }).then((r) => r.json());
    },
    enabled: !!orgToken,
    refetchInterval: 30000,
  });

  const readMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/org/notifications/${id}/read`, { method: "PATCH", headers: { "X-Org-Auth-Token": orgToken } }).then((r) => r.json()),
    onSuccess: () => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/org/notifications"] }); },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () =>
      fetch("/api/org/notifications/mark-all-read", { method: "POST", headers: { "X-Org-Auth-Token": orgToken } }).then((r) => r.json()),
    onSuccess: () => { toast({ title: "All notifications marked as read" }); refetch(); queryClient.invalidateQueries({ queryKey: ["/api/org/notifications"] }); },
  });

  const notifications: any[] = data?.notifications ?? [];
  const unreadCount: number = data?.unreadCount ?? 0;

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href={`/org/${slug}/portal`} data-testid="link-back-to-portal">
            <Button size="sm" variant="ghost" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Portal
            </Button>
          </a>
          <div className="flex-1">
            <h1 className="text-sm font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" /> Notifications
              {unreadCount > 0 && <Badge className="text-xs bg-primary text-primary-foreground">{unreadCount}</Badge>}
            </h1>
          </div>
          {activeTab === "notifications" && unreadCount > 0 && (
            <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending} data-testid="button-mark-all-read">
              <CheckCheck className="h-3.5 w-3.5" /> All read
            </Button>
          )}
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 space-y-4 pt-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {[
            { key: "notifications", label: "Notifications", icon: Bell },
            { key: "messages", label: "Messages", icon: MessageSquare },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-${key}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Notification filters */}
        {activeTab === "notifications" && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {FILTER_TYPES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border flex-shrink-0 transition-colors ${activeFilter === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/30"}`}
                data-testid={`filter-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {activeTab === "notifications" && (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
            )}
            {!isLoading && notifications.length === 0 && (
              <div className="text-center py-12 space-y-3">
                <BellOff className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs text-muted-foreground">You're all caught up. Notifications appear here as activity happens.</p>
              </div>
            )}
            {!isLoading && notifications.length > 0 && (
              <div className="space-y-2">
                {notifications.map((n: any) => (
                  <NotifCard key={n.id} n={n} onRead={(id) => readMutation.mutate(id)} />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "messages" && <MessageInbox orgToken={orgToken} />}
      </div>
    </div>
  );
}
