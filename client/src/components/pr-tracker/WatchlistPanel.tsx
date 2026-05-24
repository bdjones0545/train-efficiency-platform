import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/authToken";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  BellOff,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Zap,
  BarChart3,
  Play,
  Calendar,
  RefreshCw,
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
  Info,
  Flame,
  AlertTriangle,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Watchlist {
  id: string;
  isActive: boolean;
  monitorPublicProfiles: boolean;
  monitorStats: boolean;
  monitorMedia: boolean;
  monitorPrProgress: boolean;
  monitorAttendance: boolean;
  monitorBookingInactivity: boolean;
  monitorTrainingConsistency: boolean;
  frequency: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
}

interface IntelAlert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  summary: string | null;
  isRead: boolean;
  sourceUrl: string | null;
  createdAt: string;
}

interface Props {
  athleteUserId: string;
  orgToken: string | null;
  athleteName: string;
  orgSlug: string;
}

function buildHeaders(orgToken: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
  return headers;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(d: string | null) {
  if (!d) return "—";
  try { return formatDistanceToNow(parseISO(d), { addSuffix: true }); } catch { return d; }
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <Flame className="h-3.5 w-3.5 text-rose-500" />;
  if (severity === "important") return <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />;
  if (severity === "moderate") return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-blue-400" />;
}

function AlertSeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") return <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px]">Critical</Badge>;
  if (severity === "important") return <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30 text-[10px]">Important</Badge>;
  if (severity === "moderate") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">Moderate</Badge>;
  return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">Info</Badge>;
}

function alertTypeIcon(type: string) {
  switch (type) {
    case "pr_spike": return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
    case "inactivity": return <EyeOff className="h-3.5 w-3.5 text-amber-500" />;
    case "attendance_drop": return <Activity className="h-3.5 w-3.5 text-orange-500" />;
    case "trend_warning": return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case "new_media": return <Play className="h-3.5 w-3.5 text-violet-500" />;
    case "stat_update": return <BarChart3 className="h-3.5 w-3.5 text-blue-500" />;
    case "research_due": return <RefreshCw className="h-3.5 w-3.5 text-blue-400" />;
    default: return <Bell className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function alertTypeLabel(type: string) {
  switch (type) {
    case "pr_spike": return "PR Spike";
    case "inactivity": return "Inactivity";
    case "attendance_drop": return "Attendance Drop";
    case "trend_warning": return "Trend Warning";
    case "new_media": return "New Media";
    case "stat_update": return "Stat Update";
    case "research_due": return "Research Due";
    case "missed_booking": return "Missed Booking";
    default: return type.replace(/_/g, " ");
  }
}

// ─── Monitor toggle row ───────────────────────────────────────────────────────

function MonitorToggle({
  label,
  icon,
  enabled,
  onChange,
  description,
}: {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
        enabled
          ? "bg-violet-500/10 border-violet-500/30"
          : "bg-muted/20 border-muted/30 opacity-60"
      }`}
    >
      <span className={`flex-shrink-0 ${enabled ? "text-violet-500" : "text-muted-foreground"}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{label}</p>
        {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
      </div>
      <div className={`h-4 w-7 rounded-full flex items-center transition-all flex-shrink-0 ${enabled ? "bg-violet-500 justify-end" : "bg-muted justify-start"}`}>
        <div className="h-3 w-3 rounded-full bg-white mx-0.5 shadow-sm" />
      </div>
    </button>
  );
}

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  athleteUserId,
  orgToken,
  onRead,
}: {
  alert: IntelAlert;
  athleteUserId: string;
  orgToken: string;
  onRead: () => void;
}) {
  const { toast } = useToast();

  const readMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/alerts/${alert.id}/read`, {
        method: "PATCH",
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: onRead,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
        alert.isRead ? "opacity-60 bg-muted/10" : "bg-background border-l-[3px]"
      } ${
        !alert.isRead && alert.severity === "critical" ? "border-l-rose-500" :
        !alert.isRead && alert.severity === "important" ? "border-l-orange-500" :
        !alert.isRead && alert.severity === "moderate" ? "border-l-amber-500" :
        !alert.isRead ? "border-l-blue-400" : "border-muted"
      }`}
      data-testid={`alert-card-${alert.id}`}
    >
      <div className="flex-shrink-0 mt-0.5">{alertTypeIcon(alert.alertType)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <p className="text-xs font-semibold flex-1">{alert.title}</p>
          <AlertSeverityBadge severity={alert.severity} />
        </div>
        {alert.summary && (
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{alert.summary}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />{timeAgo(alert.createdAt)}
          </span>
          <Badge variant="outline" className="text-[10px] capitalize px-1.5">{alertTypeLabel(alert.alertType)}</Badge>
          {alert.sourceUrl && (
            <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary flex items-center gap-0.5 hover:underline">
              <ExternalLink className="h-2.5 w-2.5" /> View
            </a>
          )}
        </div>
      </div>
      {!alert.isRead && (
        <button
          onClick={() => readMutation.mutate()}
          disabled={readMutation.isPending}
          className="flex-shrink-0 p-1 rounded hover:bg-muted/40 transition-colors"
          title="Mark as read"
          data-testid={`button-read-alert-${alert.id}`}
        >
          {readMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
      )}
    </div>
  );
}

// ─── Main WatchlistPanel ──────────────────────────────────────────────────────

export default function WatchlistPanel({ athleteUserId, orgToken, athleteName, orgSlug }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<Partial<Watchlist>>({});
  const [frequency, setFrequency] = useState<string>("weekly");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/intelligence/watchlists", athleteUserId] });
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/intelligence/alerts", athleteUserId] });
  };

  // Fetch watchlist entry for this athlete
  const watchlistQ = useQuery<{ watchlists: Watchlist[] }>({
    queryKey: ["/api/org/coach/intelligence/watchlists", athleteUserId],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/watchlists?athleteUserId=${athleteUserId}`, {
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  // Fetch recent alerts for this athlete
  const alertsQ = useQuery<{ alerts: IntelAlert[] }>({
    queryKey: ["/api/org/coach/intelligence/alerts", athleteUserId],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/alerts?athleteUserId=${athleteUserId}&limit=8`, {
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const watchlist = watchlistQ.data?.watchlists?.[0] || null;
  const isWatching = !!watchlist;
  const alerts = alertsQ.data?.alerts || [];
  const unreadCount = alerts.filter((a) => !a.isRead).length;

  // When settings open, sync local state with current watchlist
  const openSettings = () => {
    if (watchlist) {
      setLocalSettings({
        monitorPublicProfiles: watchlist.monitorPublicProfiles,
        monitorStats: watchlist.monitorStats,
        monitorMedia: watchlist.monitorMedia,
        monitorPrProgress: watchlist.monitorPrProgress,
        monitorAttendance: watchlist.monitorAttendance,
        monitorTrainingConsistency: watchlist.monitorTrainingConsistency,
      });
      setFrequency(watchlist.frequency);
    } else {
      setLocalSettings({
        monitorPublicProfiles: true,
        monitorStats: true,
        monitorMedia: true,
        monitorPrProgress: true,
        monitorAttendance: true,
        monitorTrainingConsistency: true,
      });
      setFrequency("weekly");
    }
    setSettingsOpen(true);
  };

  const watchMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/org/coach/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders(orgToken) }, credentials: "include",
        body: JSON.stringify({ athleteUserId, ...localSettings, frequency }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: `${athleteName} added to watchlist` });
      setSettingsOpen(false);
      invalidateAll();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!watchlist) return;
      const r = await fetch(`/api/org/coach/watchlists/${watchlist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...buildHeaders(orgToken) }, credentials: "include",
        body: JSON.stringify({ ...localSettings, frequency }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Monitoring settings updated" });
      setSettingsOpen(false);
      invalidateAll();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unwatchMutation = useMutation({
    mutationFn: async () => {
      if (!watchlist) return;
      const r = await fetch(`/api/org/coach/watchlists/${watchlist.id}`, {
        method: "DELETE",
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: `${athleteName} removed from watchlist` });
      setSettingsOpen(false);
      invalidateAll();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runCheckMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/run-check/${athleteUserId}`, {
        method: "POST",
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Check started", description: "Alerts will appear shortly if anything notable is found." });
      setTimeout(() => invalidateAll(), 3000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/alerts/read-all?athleteUserId=${athleteUserId}`, {
        method: "PATCH",
        headers: buildHeaders(orgToken), credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => invalidateAll(),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const monitorOptions = [
    { key: "monitorPrProgress", label: "PR Progress", icon: <TrendingUp className="h-3.5 w-3.5" />, description: "Detect spikes and improvements" },
    { key: "monitorTrainingConsistency", label: "Training Consistency", icon: <Activity className="h-3.5 w-3.5" />, description: "Catch drops in training frequency" },
    { key: "monitorPublicProfiles", label: "Public Profiles", icon: <BookOpen className="h-3.5 w-3.5" />, description: "Monitor for profile changes" },
    { key: "monitorStats", label: "Stats & Roster", icon: <BarChart3 className="h-3.5 w-3.5" />, description: "Track MaxPreps / stat updates" },
    { key: "monitorMedia", label: "Highlight Media", icon: <Play className="h-3.5 w-3.5" />, description: "Detect new Hudl / YouTube clips" },
    { key: "monitorAttendance", label: "Attendance", icon: <Calendar className="h-3.5 w-3.5" />, description: "Monitor session attendance" },
  ];

  return (
    <section data-testid="section-watchlist">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-cyan-500" /> Athlete Monitoring
        </h2>
        <div className="flex items-center gap-2">
          {isWatching && unreadCount > 0 && (
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
              {unreadCount} alert{unreadCount > 1 ? "s" : ""}
            </Badge>
          )}
          {isWatching ? (
            <Badge className="bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30 text-xs flex items-center gap-1">
              <Eye className="h-2.5 w-2.5" /> Watching
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">Not Watching</Badge>
          )}
        </div>
      </div>

      {/* Watch card */}
      {watchlistQ.isLoading ? (
        <Card className="p-4 h-16 animate-pulse bg-muted/20" />
      ) : !isWatching ? (
        <Card className="p-4 border-dashed">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
              <Bell className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Watch {athleteName}</p>
              <p className="text-xs text-muted-foreground">Receive alerts for PR spikes, inactivity, and profile changes.</p>
            </div>
            <Button size="sm" onClick={openSettings} data-testid="button-watch-athlete">
              <Bell className="h-3.5 w-3.5 mr-1.5" /> Watch
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Eye className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">Monitoring active</p>
                <Badge variant="outline" className="text-[10px] capitalize">{watchlist.frequency.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {watchlist.lastCheckedAt ? `Checked ${timeAgo(watchlist.lastCheckedAt)}` : "Not checked yet"}
                </span>
                {watchlist.nextCheckAt && (
                  <span className="text-xs text-muted-foreground">· Next {timeAgo(watchlist.nextCheckAt)}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => runCheckMutation.mutate()}
                disabled={runCheckMutation.isPending}
                className="text-xs h-7 px-2"
                data-testid="button-run-check"
              >
                {runCheckMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openSettings}
                className="text-xs h-7 px-2"
                data-testid="button-monitoring-settings"
              >
                <Zap className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Active monitor indicators */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {watchlist.monitorPrProgress && <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">PR</span>}
            {watchlist.monitorTrainingConsistency && <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">Training</span>}
            {watchlist.monitorStats && <span className="text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full border border-violet-500/20">Stats</span>}
            {watchlist.monitorMedia && <span className="text-[10px] bg-orange-500/10 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full border border-orange-500/20">Media</span>}
            {watchlist.monitorPublicProfiles && <span className="text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2 py-0.5 rounded-full border border-cyan-500/20">Profiles</span>}
          </div>
        </Card>
      )}

      {/* Settings panel (inline expandable) */}
      {settingsOpen && (
        <Card className="mt-2 p-4 space-y-3 border-violet-500/20">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Monitoring Settings</p>
            <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground">
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            {monitorOptions.map(({ key, label, icon, description }) => (
              <MonitorToggle
                key={key}
                label={label}
                icon={icon}
                enabled={!!(localSettings as any)[key]}
                onChange={(v) => setLocalSettings((s) => ({ ...s, [key]: v }))}
                description={description}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Check Frequency</label>
            <div className="flex items-center gap-2">
              {[
                { v: "daily", label: "Daily" },
                { v: "every_3_days", label: "Every 3 days" },
                { v: "weekly", label: "Weekly" },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setFrequency(v)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                    frequency === v ? "bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300 font-medium" : "bg-muted/20 border-muted/30 text-muted-foreground hover:border-muted"
                  }`}
                  data-testid={`button-freq-${v}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => isWatching ? updateMutation.mutate() : watchMutation.mutate()}
              disabled={watchMutation.isPending || updateMutation.isPending}
              data-testid="button-save-watchlist"
            >
              {(watchMutation.isPending || updateMutation.isPending) ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1.5" />
              )}
              {isWatching ? "Save Settings" : "Start Watching"}
            </Button>
            {isWatching && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => unwatchMutation.mutate()}
                disabled={unwatchMutation.isPending}
                className="border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                data-testid="button-unwatch"
              >
                {unwatchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5 mr-1.5" />}
                Stop Watching
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Recent alerts section */}
      {isWatching && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recent Alerts {unreadCount > 0 && <span className="text-amber-500">· {unreadCount} unread</span>}
            </p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  data-testid="button-mark-all-read"
                >
                  Mark all read
                </button>
              )}
              <a
                href={`/org/${orgSlug}/coach/intelligence`}
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                data-testid="link-intelligence-center"
              >
                <ExternalLink className="h-2.5 w-2.5" /> View all
              </a>
            </div>
          </div>

          {alertsQ.isLoading ? (
            <Card className="h-12 animate-pulse bg-muted/20" />
          ) : alerts.length === 0 ? (
            <Card className="p-3 text-center border-dashed">
              <p className="text-xs text-muted-foreground">No alerts yet. Checks run automatically based on your selected frequency.</p>
            </Card>
          ) : (
            <Card className="divide-y overflow-hidden">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="p-0">
                  <AlertCard
                    alert={alert}
                    athleteUserId={athleteUserId}
                    orgToken={orgToken}
                    onRead={invalidateAll}
                  />
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
