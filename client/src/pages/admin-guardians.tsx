import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Search,
  RefreshCw,
  UserCheck,
  UserX,
  ShieldAlert,
  ChevronRight,
  Flame,
  MessageSquare,
  Send,
  Settings,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuardianAlert {
  key: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
  guardianEmail: string;
  athleteUserId: string;
  linkId: string;
  ageHours: number;
  actionLabel: string;
  actionUrl: string;
}

interface LinkedAthlete {
  athleteUserId: string;
  athleteName: string;
  status: string;
  createdAt: string | null;
  activatedAt: string | null;
  linkId: string;
}

interface GuardianRecord {
  guardianUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  lastSignInAt: string | null;
  inviteStatus: "no_invite" | "pending" | "active" | "revoked";
  athleteCount: number;
  linkedAthletes: LinkedAthlete[];
  lastCommunicationAt: string | null;
  alertCount: number;
  alerts: GuardianAlert[];
  preferences?: any;
}

interface GuardianMetrics {
  totalGuardians: number;
  pendingInvites: number;
  activeGuardians: number;
  neverContacted: number;
  incompletePreferences: number;
  familiesMultipleAthletes: number;
  acceptanceRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function guardianName(g: GuardianRecord): string {
  return `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() || g.email;
}

const inviteStatusConfig = {
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400", icon: CheckCircle },
  pending: { label: "Invite Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400", icon: Clock },
  no_invite: { label: "No Invite Sent", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", icon: UserX },
  revoked: { label: "Revoked", color: "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400", icon: UserX },
};

const severityColors = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-blue-600 dark:text-blue-400",
};

// ─── Summary Tile ─────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  color: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border bg-card p-4 flex items-center gap-3 text-left w-full transition-colors ${onClick ? "cursor-pointer hover:border-primary/50" : "cursor-default"} ${active ? "border-primary/60 ring-1 ring-primary/20" : ""}`}
      data-testid={`tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`rounded-lg p-2 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </button>
  );
}

// ─── Guardian Card ────────────────────────────────────────────────────────────

function GuardianCard({
  guardian,
  onQueueDraft,
  draftLoading,
}: {
  guardian: GuardianRecord;
  onQueueDraft: (guardianUserId: string) => void;
  draftLoading: boolean;
}) {
  const [, setLocation] = useLocation();
  const statusCfg = inviteStatusConfig[guardian.inviteStatus];
  const StatusIcon = statusCfg.icon;
  const topAlert = guardian.alerts[0];

  const borderClass = guardian.alertCount > 0
    ? (topAlert?.severity === "high" || topAlert?.severity === "critical")
      ? "border-orange-300 dark:border-orange-800"
      : "border-amber-200 dark:border-amber-800"
    : "";

  return (
    <Card className={`border ${borderClass} hover:border-primary/40 transition-colors`}
      data-testid={`card-guardian-${guardian.guardianUserId}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm" data-testid={`text-guardian-name-${guardian.guardianUserId}`}>
                {guardianName(guardian)}
              </h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${statusCfg.color}`}
                data-testid={`badge-invite-status-${guardian.guardianUserId}`}>
                <StatusIcon className="h-2.5 w-2.5" />
                {statusCfg.label}
              </span>
              {guardian.alertCount > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                  {guardian.alertCount} alert{guardian.alertCount !== 1 ? "s" : ""}
                </span>
              )}
              {guardian.athleteCount > 1 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400">
                  {guardian.athleteCount} athletes
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{guardian.email}</p>
            {guardian.phone && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">{guardian.phone}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground">
              {guardian.lastSignInAt ? `Signed in ${timeAgo(guardian.lastSignInAt)}` : "Never signed in"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Last comm: {timeAgo(guardian.lastCommunicationAt)}
            </p>
          </div>
        </div>

        {/* Linked athletes */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {guardian.linkedAthletes.slice(0, 4).map(a => (
            <span key={a.athleteUserId} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              {a.athleteName}
            </span>
          ))}
          {guardian.linkedAthletes.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{guardian.linkedAthletes.length - 4} more</span>
          )}
        </div>

        {/* Preferences indicator */}
        {guardian.preferences ? (
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1.5 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" /> Preferences configured · {guardian.preferences.preferredContactMethod}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
            <Settings className="h-3 w-3" /> No preferences set
          </p>
        )}
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {/* Top alert */}
        {topAlert && (
          <div className={`rounded-md border px-3 py-2 ${
            topAlert.severity === "high" || topAlert.severity === "critical"
              ? "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800"
              : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
          }`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${severityColors[topAlert.severity]}`} />
              <p className="text-xs text-foreground">{topAlert.message}</p>
            </div>
          </div>
        )}

        {/* Status indicators */}
        <div className="flex flex-wrap gap-2">
          <span className={`text-[10px] flex items-center gap-1 ${guardian.lastCommunicationAt ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50"}`}>
            <MessageSquare className="h-3 w-3" />
            {guardian.lastCommunicationAt ? "Contacted" : "Not yet contacted"}
          </span>
          <span className={`text-[10px] flex items-center gap-1 ${guardian.preferences ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50"}`}>
            <Settings className="h-3 w-3" />
            {guardian.preferences ? "Prefs set" : "No prefs"}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="default" className="h-7 text-xs gap-1"
            onClick={() => setLocation(`/admin/guardian/${guardian.guardianUserId}`)}
            data-testid={`button-view-guardian-${guardian.guardianUserId}`}>
            View Profile <ChevronRight className="h-3 w-3" />
          </Button>

          {!guardian.lastCommunicationAt && guardian.inviteStatus !== "no_invite" && (
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              disabled={draftLoading}
              onClick={() => onQueueDraft(guardian.guardianUserId)}
              data-testid={`button-queue-draft-${guardian.guardianUserId}`}>
              <Send className="h-3 w-3" /> Queue Welcome Draft
            </Button>
          )}

          {guardian.inviteStatus === "pending" && (
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              onClick={() => setLocation(`/admin/guardian/${guardian.guardianUserId}`)}
              data-testid={`button-resend-${guardian.guardianUserId}`}>
              <Mail className="h-3 w-3" /> Resend Invite
            </Button>
          )}

          <Link href="/admin/athlete-onboarding">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
              data-testid={`button-onboarding-${guardian.guardianUserId}`}>
              <ExternalLink className="h-3 w-3" /> Onboarding
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminGuardiansPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [inviteFilter, setInviteFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<{
    guardians: GuardianRecord[];
    metrics: GuardianMetrics;
  }>({
    queryKey: ["/api/admin/guardians", statusFilter, inviteFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (inviteFilter !== "all") params.set("inviteStatus", inviteFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const res = await fetch(`/api/admin/guardians?${params}`);
      if (!res.ok) throw new Error("Failed to fetch guardians");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const draftMutation = useMutation({
    mutationFn: async (guardianUserId: string) =>
      apiRequest("POST", `/api/admin/guardians/${guardianUserId}/queue-welcome-draft`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/guardians"] });
      toast({
        title: data?.ok ? "Draft queued" : "Already exists",
        description: data?.message ?? "Guardian welcome draft has been queued for approval.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const guardians = data?.guardians ?? [];
  const metrics = data?.metrics ?? {
    totalGuardians: 0, pendingInvites: 0, activeGuardians: 0,
    neverContacted: 0, incompletePreferences: 0, familiesMultipleAthletes: 0, acceptanceRate: 0,
  };

  const hasFilters = statusFilter !== "all" || inviteFilter !== "all" || !!searchQuery;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Parent & Guardian Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage parent relationships, communication, and onboarding coordination for youth athletes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5"
          data-testid="button-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Total Guardians" value={metrics.totalGuardians}
          icon={Users} color="bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" />
        <SummaryTile label="Active" value={metrics.activeGuardians}
          icon={UserCheck} color="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"
          active={inviteFilter === "active"} onClick={() => setInviteFilter(inviteFilter === "active" ? "all" : "active")} />
        <SummaryTile label="Invite Pending" value={metrics.pendingInvites}
          icon={Clock} color="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
          active={inviteFilter === "pending"} onClick={() => setInviteFilter(inviteFilter === "pending" ? "all" : "pending")} />
        <SummaryTile label="Acceptance Rate" value={`${metrics.acceptanceRate}%`}
          icon={CheckCircle} color="bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400" />
      </div>

      {/* Secondary tiles */}
      {metrics.totalGuardians > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryTile label="Never Contacted" value={metrics.neverContacted}
            icon={MessageSquare} color="bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400" />
          <SummaryTile label="No Preferences Set" value={metrics.incompletePreferences}
            icon={Settings} color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" />
          <SummaryTile label="Multi-Athlete Families" value={metrics.familiesMultipleAthletes}
            icon={Users} color="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "active", "pending", "revoked"] as const).map(s => (
            <button key={s} onClick={() => setInviteFilter(s)}
              data-testid={`filter-invite-${s}`}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                inviteFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
              }`}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search name or email…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs" data-testid="input-search" />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => { setStatusFilter("all"); setInviteFilter("all"); setSearchQuery(""); }}
            data-testid="button-clear-filters">
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-44 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="font-medium text-destructive">Failed to load guardians</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
        </div>
      )}

      {!isLoading && !isError && guardians.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">No guardians found</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {hasFilters
              ? "Try adjusting your filters."
              : "Guardians are linked when athletes with parent emails are onboarded."}
          </p>
          {hasFilters ? (
            <Button variant="outline" size="sm" className="mt-4"
              onClick={() => { setStatusFilter("all"); setInviteFilter("all"); setSearchQuery(""); }}>
              Clear filters
            </Button>
          ) : (
            <Link href="/admin/athlete-onboarding">
              <Button size="sm" className="mt-4 gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Go to Athlete Onboarding
              </Button>
            </Link>
          )}
        </div>
      )}

      {!isLoading && !isError && guardians.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {guardians.length} guardian{guardians.length !== 1 ? "s" : ""} shown
          </p>
          {guardians.map(g => (
            <GuardianCard
              key={g.guardianUserId}
              guardian={g}
              onQueueDraft={id => draftMutation.mutate(id)}
              draftLoading={draftMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
