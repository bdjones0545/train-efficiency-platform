import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Bell,
  Eye,
  TrendingUp,
  Activity,
  AlertTriangle,
  AlertCircle,
  Info,
  Flame,
  CheckCircle2,
  Clock,
  RefreshCw,
  ExternalLink,
  BarChart3,
  Play,
  Loader2,
  ArrowLeft,
  EyeOff,
  BookOpen,
  Target,
  Zap,
  Users,
  ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  summary: string | null;
  isRead: boolean;
  sourceUrl: string | null;
  createdAt: string;
  athleteUserId: string;
  athleteName: string;
}

interface Watchlist {
  id: string;
  athleteUserId: string;
  athleteName: string;
  frequency: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  unreadAlerts: number;
  monitorPrProgress: boolean;
  monitorTrainingConsistency: boolean;
  monitorStats: boolean;
  monitorMedia: boolean;
  monitorPublicProfiles: boolean;
}

interface Summary {
  totalWatched: number;
  unreadAlerts: number;
  importantAlerts: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(d: string | null) {
  if (!d) return "—";
  try { return formatDistanceToNow(parseISO(d), { addSuffix: true }); } catch { return d; }
}

function safeFmt(d: string | null, fmt = "MMM d, h:mm a") {
  if (!d) return "—";
  try { return format(parseISO(d), fmt); } catch { return d; }
}

function severityColor(s: string) {
  if (s === "critical") return "border-l-rose-500 bg-rose-500/3";
  if (s === "important") return "border-l-orange-500 bg-orange-500/3";
  if (s === "moderate") return "border-l-amber-500 bg-amber-500/3";
  return "border-l-blue-400 bg-blue-500/3";
}

function SeverityBadge({ s }: { s: string }) {
  if (s === "critical") return <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px]">Critical</Badge>;
  if (s === "important") return <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30 text-[10px]">Important</Badge>;
  if (s === "moderate") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">Moderate</Badge>;
  return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">Info</Badge>;
}

function SeverityIcon({ s }: { s: string }) {
  if (s === "critical") return <Flame className="h-4 w-4 text-rose-500" />;
  if (s === "important") return <AlertTriangle className="h-4 w-4 text-orange-500" />;
  if (s === "moderate") return <AlertCircle className="h-4 w-4 text-amber-500" />;
  return <Info className="h-4 w-4 text-blue-400" />;
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

type TabFilter = "all" | "unread" | "pr" | "inactivity" | "media" | "info";

// ─── Alert Card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  orgToken,
  slug,
  onRead,
}: {
  alert: Alert;
  orgToken: string;
  slug: string;
  onRead: () => void;
}) {
  const { toast } = useToast();

  const readMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/org/coach/intelligence/alerts/${alert.id}/read`, {
        method: "PATCH",
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: onRead,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className={`flex items-start gap-4 p-4 border-l-[3px] transition-all ${
        alert.isRead ? "opacity-50" : severityColor(alert.severity)
      }`}
      data-testid={`alert-row-${alert.id}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <SeverityIcon s={alert.severity} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <a
                href={`/org/${slug}/coach/athletes/${alert.athleteUserId}`}
                className="text-xs font-semibold text-primary hover:underline"
                data-testid={`link-athlete-${alert.id}`}
              >
                {alert.athleteName}
              </a>
              <span className="text-muted-foreground text-xs">·</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {alertTypeIcon(alert.alertType)}
                {alertTypeLabel(alert.alertType)}
              </span>
            </div>
            <p className="text-sm font-medium leading-snug">{alert.title}</p>
            {alert.summary && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{alert.summary}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />{timeAgo(alert.createdAt)}
              </span>
              <SeverityBadge s={alert.severity} />
              {alert.sourceUrl && (
                <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary flex items-center gap-0.5 hover:underline">
                  <ExternalLink className="h-2.5 w-2.5" /> Source
                </a>
              )}
            </div>
          </div>
          {!alert.isRead && (
            <button
              onClick={() => readMutation.mutate()}
              disabled={readMutation.isPending}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
              title="Mark as read"
              data-testid={`button-read-${alert.id}`}
            >
              {readMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist card ───────────────────────────────────────────────────────────

function WatchlistAthleteCard({ watchlist, slug }: { watchlist: Watchlist; slug: string }) {
  const monitorTags: string[] = [];
  if (watchlist.monitorPrProgress) monitorTags.push("PR");
  if (watchlist.monitorTrainingConsistency) monitorTags.push("Training");
  if (watchlist.monitorStats) monitorTags.push("Stats");
  if (watchlist.monitorMedia) monitorTags.push("Media");
  if (watchlist.monitorPublicProfiles) monitorTags.push("Profiles");

  return (
    <Card className="p-4 hover:bg-muted/20 transition-colors" data-testid={`watchlist-card-${watchlist.id}`}>
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0 text-violet-500 font-semibold text-sm">
          {watchlist.athleteName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={`/org/${slug}/coach/athletes/${watchlist.athleteUserId}`}
              className="text-sm font-semibold hover:underline text-foreground truncate"
            >
              {watchlist.athleteName}
            </a>
            {watchlist.unreadAlerts > 0 && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">
                {watchlist.unreadAlerts} alert{watchlist.unreadAlerts > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {watchlist.lastCheckedAt ? `Checked ${timeAgo(watchlist.lastCheckedAt)}` : "Not checked yet"}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">· {watchlist.frequency.replace(/_/g, " ")}</span>
          </div>
        </div>
        <a
          href={`/org/${slug}/coach/athletes/${watchlist.athleteUserId}`}
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted/40 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      </div>
      {monitorTags.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          {monitorTags.map((tag) => (
            <span key={tag} className="text-[10px] bg-muted/30 text-muted-foreground px-1.5 py-0.5 rounded border border-muted/40">
              {tag}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrgIntelligencePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  const { data: org } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const r = await fetch(`/api/organizations/${slug}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
  });

  const orgId = org?.id;

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setOrgToken(token))
      .catch(() => { localStorage.removeItem(`orgToken_${orgId}`); });
  }, [orgId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/intelligence/alerts-page"] });
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/intelligence/watchlists-page"] });
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/intelligence/summary-page"] });
  };

  const summaryQ = useQuery<Summary>({
    queryKey: ["/api/org/coach/intelligence/summary-page", orgToken],
    queryFn: async () => {
      const r = await fetch("/api/org/coach/intelligence/summary", { headers: { "X-Org-Auth-Token": orgToken! } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!orgToken,
    refetchInterval: 30_000,
  });

  const alertsQ = useQuery<{ alerts: Alert[] }>({
    queryKey: ["/api/org/coach/intelligence/alerts-page", orgToken, activeTab],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "80" });
      if (activeTab === "unread") params.set("isRead", "false");
      if (activeTab === "pr") params.set("alertType", "pr_spike");
      if (activeTab === "inactivity") { /* filter client-side */ }
      if (activeTab === "media") params.set("alertType", "new_media");
      if (activeTab === "info") params.set("alertType", "research_due");
      const r = await fetch(`/api/org/coach/intelligence/alerts?${params}`, {
        headers: { "X-Org-Auth-Token": orgToken! },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!orgToken,
  });

  const watchlistQ = useQuery<{ watchlists: Watchlist[] }>({
    queryKey: ["/api/org/coach/intelligence/watchlists-page", orgToken],
    queryFn: async () => {
      const r = await fetch("/api/org/coach/intelligence/watchlists", { headers: { "X-Org-Auth-Token": orgToken! } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!orgToken,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/org/coach/intelligence/alerts/read-all", {
        method: "PATCH",
        headers: { "X-Org-Auth-Token": orgToken! },
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => { toast({ title: "All alerts marked as read" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auth guard
  if (!orgToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="h-12 w-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
          <Brain className="h-6 w-6 text-violet-500" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold">Athlete Intelligence Center</h1>
          <p className="text-sm text-muted-foreground mt-1">Coach access required to view monitoring alerts</p>
        </div>
        <Button onClick={() => setShowAuth(true)} data-testid="button-coach-login">
          Coach Sign In
        </Button>
        {showAuth && org && (
          <OrgAuthModal
            orgId={org.id}
            orgName={org.name}
            onAuthenticated={(token) => {
              if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
              setOrgToken(token);
              setShowAuth(false);
            }}
            onClose={() => setShowAuth(false)}
          />
        )}
      </div>
    );
  }

  const summary = summaryQ.data;
  const allAlerts = alertsQ.data?.alerts || [];
  const watchlists = watchlistQ.data?.watchlists || [];
  const unreadCount = summary?.unreadAlerts || 0;

  // Client-side filter for inactivity tab
  const displayAlerts = activeTab === "inactivity"
    ? allAlerts.filter((a) => ["inactivity", "attendance_drop", "missed_booking"].includes(a.alertType))
    : allAlerts;

  const tabs: { id: TabFilter; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "all", label: "All Alerts", icon: <Bell className="h-3.5 w-3.5" />, count: allAlerts.length },
    { id: "unread", label: "Unread", icon: <AlertCircle className="h-3.5 w-3.5" />, count: unreadCount },
    { id: "pr", label: "PR Spikes", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { id: "inactivity", label: "Inactivity", icon: <EyeOff className="h-3.5 w-3.5" /> },
    { id: "media", label: "Media", icon: <Play className="h-3.5 w-3.5" /> },
    { id: "info", label: "Info", icon: <Info className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6 max-w-4xl" data-testid="page-intelligence">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation(`/org/${slug}/portal`)} className="h-8 px-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Brain className="h-5 w-5 text-violet-500" />
                Athlete Intelligence Center
              </h1>
              {unreadCount > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {org?.name} · Monitoring {summary?.totalWatched || 0} athlete{(summary?.totalWatched || 0) !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            {markAllReadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
            Mark all read
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Watched Athletes",
            value: summaryQ.isLoading ? "—" : summary?.totalWatched ?? 0,
            icon: <Eye className="h-4 w-4 text-cyan-500" />,
            color: "bg-cyan-500/10 border-cyan-500/20",
          },
          {
            label: "Unread Alerts",
            value: summaryQ.isLoading ? "—" : summary?.unreadAlerts ?? 0,
            icon: <Bell className="h-4 w-4 text-amber-500" />,
            color: (summary?.unreadAlerts ?? 0) > 0 ? "bg-amber-500/10 border-amber-500/20" : "bg-muted/20",
          },
          {
            label: "Important / Critical",
            value: summaryQ.isLoading ? "—" : summary?.importantAlerts ?? 0,
            icon: <Flame className="h-4 w-4 text-orange-500" />,
            color: (summary?.importantAlerts ?? 0) > 0 ? "bg-orange-500/10 border-orange-500/20" : "bg-muted/20",
          },
        ].map(({ label, value, icon, color }) => (
          <Card key={label} className={`p-4 ${color}`}>
            <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
            <p className="text-2xl font-bold">{value}</p>
          </Card>
        ))}
      </div>

      {/* Alert feed */}
      <div>
        {/* Tab bar */}
        <div className="flex items-stretch border rounded-xl overflow-hidden mb-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-intelligence-${tab.id}`}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <span className="h-4 w-4 flex items-center justify-center">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-amber-500 text-white text-[8px] flex items-center justify-center font-bold">
                  {tab.count > 9 ? "9+" : tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          {alertsQ.isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : displayAlerts.length === 0 ? (
            <div className="p-10 text-center">
              <div className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-20 flex items-center justify-center">
                {unreadCount === 0 && activeTab === "all" ? <ShieldCheck className="h-10 w-10" /> : <Bell className="h-10 w-10" />}
              </div>
              <p className="text-sm font-medium">
                {unreadCount === 0 && activeTab === "all" ? "All clear" : "No alerts in this category"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {activeTab === "all" && watchlists.length === 0
                  ? "Open an athlete profile and click Watch to start monitoring."
                  : activeTab === "all"
                  ? "No alerts yet. Monitoring will check for changes based on your watchlist frequency."
                  : "No alerts match this filter."}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {displayAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  orgToken={orgToken}
                  slug={slug}
                  onRead={invalidate}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Watchlist overview */}
      {watchlists.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-500" /> Watchlist
              <Badge variant="outline" className="text-xs">{watchlists.length}</Badge>
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {watchlists.map((w) => (
              <WatchlistAthleteCard key={w.id} watchlist={w} slug={slug} />
            ))}
          </div>
        </div>
      )}

      {watchlists.length === 0 && !watchlistQ.isLoading && (
        <Card className="p-6 text-center border-dashed">
          <Eye className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-30" />
          <p className="text-sm font-medium">No athletes on watchlist</p>
          <p className="text-xs text-muted-foreground mt-1">
            Open an athlete's profile and click "Watch" to start receiving monitoring alerts.
          </p>
        </Card>
      )}

      {/* Info footer */}
      <div className="flex items-start gap-2 p-3 rounded-xl border border-dashed text-xs text-muted-foreground">
        <Zap className="h-3.5 w-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
        <span>
          Monitoring checks run automatically at your configured frequency. Checks are lightweight, rate-limited, and only run on approved/public sources.
          All alerts require coach review — no data is automatically applied to athlete profiles.
        </span>
      </div>
    </div>
  );
}
