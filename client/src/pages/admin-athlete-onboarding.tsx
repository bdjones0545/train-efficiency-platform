import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  Users,
  Search,
  ExternalLink,
  Brain,
  Calendar,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Mail,
  UserCheck,
  Trophy,
  ShieldAlert,
  Flame,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OnboardingAlert {
  key: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
  athleteUserId: string;
  athleteName: string;
  checklistId: string;
  leadSubmissionId: string | null;
  ageHours: number;
  ageDays: number;
  actionLabel: string;
  actionUrl: string;
  createdAt: string | null;
}

interface OnboardingRecord {
  id: string;
  athleteUserId: string;
  leadSubmissionId: string | null;
  athleteName: string;
  email: string;
  phone: string | null;
  sport: string | null;
  school: string | null;
  grade: string | null;
  parentName: string | null;
  parentEmail: string | null;
  guardianEmail: string | null;
  guardianLinked: boolean;
  accountInviteSent: boolean;
  welcomeDraftQueued: boolean;
  welcomeDraftApproved: boolean;
  pailContextSeeded: boolean;
  firstSessionScheduled: boolean;
  programAssigned: boolean;
  paymentSetup: boolean;
  waiverCompleted: boolean;
  firstSessionCompleted: boolean;
  nextBestAction: string;
  status: "pending" | "in_progress" | "complete";
  createdAt: string | null;
  updatedAt: string | null;
  welcomeDraftId: string | null;
  welcomeDraftStatus: string | null;
  alerts: OnboardingAlert[];
  alertCount: number;
  highestSeverity: "critical" | "high" | "medium" | "low" | null;
  links: {
    lead: string | null;
    athleteIntelligence: string;
    aiApprovals: string;
    scheduling: string;
  };
}

interface SummaryStats {
  total: number;
  needsAction: number;
  pending: number;
  complete: number;
  alertsTotal: number;
  criticalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  stuckOnboardingCount: number;
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

function statusColors(status: string) {
  if (status === "complete") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400";
  if (status === "in_progress") return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
}

function statusLabel(status: string) {
  if (status === "complete") return "Complete";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

function severityConfig(severity: OnboardingAlert["severity"]) {
  switch (severity) {
    case "critical":
      return {
        bg: "bg-red-50 dark:bg-red-950/20",
        border: "border-red-200 dark:border-red-800",
        text: "text-red-700 dark:text-red-400",
        badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
        label: "Critical",
        icon: ShieldAlert,
      };
    case "high":
      return {
        bg: "bg-orange-50 dark:bg-orange-950/20",
        border: "border-orange-200 dark:border-orange-800",
        text: "text-orange-700 dark:text-orange-400",
        badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400",
        label: "High",
        icon: Flame,
      };
    case "medium":
      return {
        bg: "bg-amber-50 dark:bg-amber-950/20",
        border: "border-amber-200 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
        label: "Medium",
        icon: AlertTriangle,
      };
    default:
      return {
        bg: "bg-blue-50 dark:bg-blue-950/20",
        border: "border-blue-200 dark:border-blue-800",
        text: "text-blue-700 dark:text-blue-400",
        badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
        label: "Low",
        icon: AlertCircle,
      };
  }
}

function requiredCount(r: OnboardingRecord): number {
  return [r.accountInviteSent, r.welcomeDraftQueued, r.pailContextSeeded, r.firstSessionScheduled, r.programAssigned]
    .filter(Boolean).length;
}

// ─── Checklist Item ───────────────────────────────────────────────────────────

function ChecklistItem({ done, needsAction, label }: { done: boolean; needsAction: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {done
        ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
        : needsAction
          ? <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
          : <span className="h-3 w-3 shrink-0 text-center text-muted-foreground/30">–</span>
      }
      <span className={done ? "text-foreground" : needsAction ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/50"}>
        {label}
      </span>
    </div>
  );
}

// ─── Alert Item (in expanded card) ───────────────────────────────────────────

function AlertItem({ alert, onAction }: { alert: OnboardingAlert; onAction?: () => void }) {
  const cfg = severityConfig(alert.severity);
  const Icon = cfg.icon;
  return (
    <div className={`rounded-md border ${cfg.bg} ${cfg.border} px-3 py-2 flex items-start justify-between gap-2`}>
      <div className="flex items-start gap-2 min-w-0">
        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.text}`} />
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</p>
          <p className="text-xs text-foreground mt-0.5">{alert.message}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{alert.ageHours}h since onboarding started</p>
        </div>
      </div>
      {alert.actionUrl && (
        <Link href={alert.actionUrl}>
          <Button size="sm" variant="outline" className={`h-6 text-[10px] shrink-0 border ${cfg.border} ${cfg.text}`}>
            {alert.actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}

// ─── Onboarding Card ──────────────────────────────────────────────────────────

function OnboardingCard({
  record,
  onUpdate,
  loading,
}: {
  record: OnboardingRecord;
  onUpdate: (id: string, updates: Record<string, boolean>) => void;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const required = requiredCount(record);
  const progressPct = Math.round((required / 5) * 100);
  const hasParentContext = !!(record.parentName || record.parentEmail);
  const topAlert = record.alerts[0] ?? null;
  const cfg = topAlert ? severityConfig(topAlert.severity) : null;

  return (
    <Card
      className={`border ${record.highestSeverity === "critical" ? "border-red-300 dark:border-red-800" : record.highestSeverity === "high" ? "border-orange-300 dark:border-orange-800" : "border-border"}`}
      data-testid={`card-onboarding-${record.id}`}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-3">
          {/* Athlete info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate" data-testid={`text-athlete-name-${record.id}`}>
                {record.athleteName}
              </h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColors(record.status)}`} data-testid={`badge-status-${record.id}`}>
                {statusLabel(record.status)}
              </span>
              {/* Alert severity badge */}
              {record.highestSeverity && cfg && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}
                  data-testid={`badge-alert-severity-${record.id}`}
                >
                  {cfg.label}
                </span>
              )}
              {record.alertCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {record.alertCount} alert{record.alertCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{record.email}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {record.sport && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{record.sport}</Badge>}
              {record.grade && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{record.grade}</Badge>}
              {record.school && <span className="text-[11px] text-muted-foreground">{record.school}</span>}
            </div>
            {hasParentContext && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Parent: {record.parentName || "—"}
                {(record.parentEmail || record.guardianEmail) && (
                  <span className="ml-1 font-mono text-muted-foreground/60">
                    · {record.parentEmail || record.guardianEmail}
                  </span>
                )}
                {record.guardianLinked && (
                  <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">(linked ✓)</span>
                )}
              </p>
            )}
          </div>

          {/* Right: time + expand */}
          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground">Updated {timeAgo(record.updatedAt)}</p>
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto"
              data-testid={`button-expand-${record.id}`}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Less" : "Details"}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">{required} of 5 required steps complete</span>
            <span className="text-[10px] font-medium text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${record.status === "complete" ? "bg-emerald-500" : record.highestSeverity === "critical" ? "bg-red-500" : record.highestSeverity === "high" ? "bg-orange-500" : "bg-amber-400"}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        {/* Top alert (priority callout — shown even when collapsed) */}
        {topAlert && cfg && (
          <div className={`rounded-md border ${cfg.bg} ${cfg.border} px-3 py-2`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <cfg.icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.text}`} />
                <div>
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${cfg.text}`}>{cfg.label} Alert</p>
                  <p className="text-xs text-foreground mt-0.5" data-testid={`text-top-alert-${record.id}`}>{topAlert.message}</p>
                </div>
              </div>
              {topAlert.actionUrl && (
                <Link href={topAlert.actionUrl}>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-6 text-[10px] shrink-0 border ${cfg.border} ${cfg.text}`}
                    data-testid={`button-alert-action-${record.id}`}
                  >
                    {topAlert.actionLabel}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Generic next action (only if no alert) */}
        {!topAlert && record.status !== "complete" && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-3 py-2">
            <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-0.5">Next action</p>
            <p className="text-xs text-blue-800 dark:text-blue-300" data-testid={`text-next-action-${record.id}`}>{record.nextBestAction}</p>
          </div>
        )}

        {/* Completion banner */}
        {record.status === "complete" && record.alertCount === 0 && (
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-emerald-500" />
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">All required steps complete — athlete is fully onboarded!</p>
          </div>
        )}

        {/* Expanded: full alert list + checklist */}
        {expanded && (
          <div className="space-y-3 pt-1 border-t">
            {/* All alerts */}
            {record.alerts.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">All Alerts ({record.alertCount})</p>
                {record.alerts.map(alert => (
                  <AlertItem key={alert.key} alert={alert} />
                ))}
              </div>
            )}

            {/* Checklist grid */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Checklist</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <ChecklistItem done={record.accountInviteSent} needsAction={!record.accountInviteSent} label="Account invite" />
                <ChecklistItem done={record.welcomeDraftQueued} needsAction={!record.welcomeDraftQueued} label="Welcome draft queued" />
                <ChecklistItem done={record.welcomeDraftApproved} needsAction={record.welcomeDraftQueued && !record.welcomeDraftApproved} label="Welcome draft approved" />
                <ChecklistItem done={record.pailContextSeeded} needsAction={!record.pailContextSeeded} label="PAIL context seeded" />
                <ChecklistItem done={record.guardianLinked} needsAction={hasParentContext && !record.guardianLinked} label="Guardian linked" />
                <ChecklistItem done={record.firstSessionScheduled} needsAction={!record.firstSessionScheduled} label="First session scheduled" />
                <ChecklistItem done={record.programAssigned} needsAction={!record.programAssigned} label="Program assigned" />
                <ChecklistItem done={record.paymentSetup} needsAction={false} label="Payment set up" />
                <ChecklistItem done={record.waiverCompleted} needsAction={false} label="Waiver completed" />
                <ChecklistItem done={record.firstSessionCompleted} needsAction={false} label="First session done" />
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {record.welcomeDraftQueued && !record.welcomeDraftApproved && (
            <Link href="/admin/ai-approvals">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400" data-testid={`button-review-draft-${record.id}`}>
                <Mail className="h-3 w-3" /> Review Draft
              </Button>
            </Link>
          )}
          <Link href="/admin/athlete-intelligence">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid={`button-intelligence-${record.id}`}>
              <Brain className="h-3 w-3" /> Intelligence
            </Button>
          </Link>
          {!record.firstSessionScheduled && (
            <Link href="/admin/scheduling-command-center">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid={`button-schedule-${record.id}`}>
                <Calendar className="h-3 w-3" /> Schedule Session
              </Button>
            </Link>
          )}
          {record.leadSubmissionId && (
            <Link href="/admin/athlete-leads">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" data-testid={`button-source-lead-${record.id}`}>
                <ExternalLink className="h-3 w-3" /> Source Lead
              </Button>
            </Link>
          )}
          {!record.programAssigned && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { programAssigned: true })} data-testid={`button-mark-program-${record.id}`}>
              <UserCheck className="h-3 w-3" /> Mark Program Assigned
            </Button>
          )}
          {!record.firstSessionScheduled && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { firstSessionScheduled: true })} data-testid={`button-mark-session-scheduled-${record.id}`}>
              <Calendar className="h-3 w-3" /> Mark Scheduled
            </Button>
          )}
          {record.welcomeDraftQueued && !record.welcomeDraftApproved && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { welcomeDraftApproved: true })} data-testid={`button-mark-draft-approved-${record.id}`}>
              <CheckCircle className="h-3 w-3" /> Mark Draft Approved
            </Button>
          )}
          {!record.paymentSetup && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { paymentSetup: true })} data-testid={`button-mark-payment-${record.id}`}>
              <CheckCircle className="h-3 w-3" /> Mark Payment Setup
            </Button>
          )}
          {!record.waiverCompleted && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { waiverCompleted: true })} data-testid={`button-mark-waiver-${record.id}`}>
              <CheckCircle className="h-3 w-3" /> Mark Waiver Complete
            </Button>
          )}
          {record.firstSessionScheduled && !record.firstSessionCompleted && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading} onClick={() => onUpdate(record.id, { firstSessionCompleted: true })} data-testid={`button-mark-first-session-${record.id}`}>
              <Trophy className="h-3 w-3" /> Mark First Session Done
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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
  value: number;
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
      data-testid={`stat-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`rounded-lg p-2 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAthleteOnboardingPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [needsFilter, setNeedsFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (needsFilter !== "all") params.set("needs", needsFilter);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (alertFilter !== "all") params.set("alertSeverity", alertFilter);
    return params.toString();
  };

  const { data, isLoading, isError, refetch } = useQuery<{ records: OnboardingRecord[]; summary: SummaryStats }>({
    queryKey: ["/api/admin/athlete-onboarding", statusFilter, needsFilter, searchQuery, alertFilter],
    queryFn: async () => {
      const q = buildQuery();
      const url = `/api/admin/athlete-onboarding${q ? `?${q}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch onboarding records");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, boolean> }) => {
      return apiRequest("PATCH", `/api/admin/athlete-onboarding/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-onboarding"] });
      toast({ title: "Updated", description: "Onboarding checklist updated successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message || "Could not update checklist.", variant: "destructive" });
    },
  });

  const handleUpdate = (id: string, updates: Record<string, boolean>) => {
    mutation.mutate({ id, updates });
  };

  const records = data?.records ?? [];
  const summary = data?.summary ?? {
    total: 0, needsAction: 0, pending: 0, complete: 0,
    alertsTotal: 0, criticalAlerts: 0, highAlerts: 0, mediumAlerts: 0, stuckOnboardingCount: 0,
  };

  const hasFilters = statusFilter !== "all" || needsFilter !== "all" || alertFilter !== "all" || searchQuery;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Athlete Onboarding
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track and complete onboarding — alerts surface blockers before athletes fall through.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" data-testid="button-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary tiles — top row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Total Athletes" value={summary.total} icon={Users} color="bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" />
        <SummaryTile label="In Progress" value={summary.needsAction} icon={Clock} color="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400" />
        <SummaryTile label="Pending" value={summary.pending} icon={AlertCircle} color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" />
        <SummaryTile label="Complete" value={summary.complete} icon={Trophy} color="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400" />
      </div>

      {/* Alert summary tiles — only show when there are alerts */}
      {summary.alertsTotal > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Alerts</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile
              label="Critical Alerts"
              value={summary.criticalAlerts}
              icon={ShieldAlert}
              color="bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
              active={alertFilter === "critical"}
              onClick={() => setAlertFilter(alertFilter === "critical" ? "all" : "critical")}
            />
            <SummaryTile
              label="High Alerts"
              value={summary.highAlerts}
              icon={Flame}
              color="bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400"
              active={alertFilter === "high"}
              onClick={() => setAlertFilter(alertFilter === "high" ? "all" : "high")}
            />
            <SummaryTile
              label="Medium Alerts"
              value={summary.mediumAlerts}
              icon={AlertTriangle}
              color="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
              active={alertFilter === "medium"}
              onClick={() => setAlertFilter(alertFilter === "medium" ? "all" : "medium")}
            />
            <SummaryTile
              label="Stuck Onboardings"
              value={summary.stuckOnboardingCount}
              icon={Clock}
              color="bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400"
              active={false}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "pending", "in_progress", "complete"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              data-testid={`filter-status-${s}`}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Alert severity filter */}
        <Select value={alertFilter} onValueChange={setAlertFilter}>
          <SelectTrigger className="h-8 w-[155px] text-xs" data-testid="select-alert-filter">
            <SelectValue placeholder="Alert level..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All alert levels</SelectItem>
            <SelectItem value="critical">Critical only</SelectItem>
            <SelectItem value="high">High only</SelectItem>
            <SelectItem value="medium">Medium only</SelectItem>
          </SelectContent>
        </Select>

        {/* Needs filter */}
        <Select value={needsFilter} onValueChange={setNeedsFilter}>
          <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-needs-filter">
            <SelectValue placeholder="Needs..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any need</SelectItem>
            <SelectItem value="account">Needs: Account</SelectItem>
            <SelectItem value="welcome">Needs: Welcome Draft</SelectItem>
            <SelectItem value="pail">Needs: PAIL Context</SelectItem>
            <SelectItem value="guardian">Needs: Guardian</SelectItem>
            <SelectItem value="session">Needs: Session</SelectItem>
            <SelectItem value="program">Needs: Program</SelectItem>
            <SelectItem value="payment">Needs: Payment</SelectItem>
            <SelectItem value="waiver">Needs: Waiver</SelectItem>
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, email, sport, school…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
            data-testid="input-search"
          />
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setStatusFilter("all"); setNeedsFilter("all"); setAlertFilter("all"); setSearchQuery(""); }}
            data-testid="button-clear-filters"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="font-medium text-destructive">Failed to load onboarding records</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
        </div>
      )}

      {!isLoading && !isError && records.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">No onboarding records found</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {hasFilters
              ? "Try adjusting your filters."
              : "Convert leads to athletes to start tracking onboarding progress."}
          </p>
          {hasFilters && (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { setStatusFilter("all"); setNeedsFilter("all"); setAlertFilter("all"); setSearchQuery(""); }}>
              Clear filters
            </Button>
          )}
          {!hasFilters && (
            <Link href="/admin/athlete-leads">
              <Button size="sm" className="mt-4 gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> Go to Athlete Intake
              </Button>
            </Link>
          )}
        </div>
      )}

      {!isLoading && !isError && records.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {records.length} athlete{records.length !== 1 ? "s" : ""} shown
            {summary.alertsTotal > 0 && ` · ${summary.alertsTotal} active alert${summary.alertsTotal !== 1 ? "s" : ""}`}
          </p>
          {records.map((record) => (
            <OnboardingCard
              key={record.id}
              record={record}
              onUpdate={handleUpdate}
              loading={mutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
