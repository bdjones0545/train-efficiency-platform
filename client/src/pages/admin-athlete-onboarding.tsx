import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
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
  Dumbbell,
  Zap,
  Sparkles,
  Play,
  ArrowRight,
  RotateCcw,
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

interface ProgramRecommendation {
  recommendedProgramId?: string;
  recommendedProgramName?: string;
  reason: string;
  confidence: number;
  actionUrl: string;
  actionLabel: string;
}

type ReadinessState = "needs_program" | "needs_first_session" | "ready_to_train" | "actively_training";

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
  position: string | null;
  goals: string[];
  experienceLevel: string | null;
  currentTrainingStatus: string | null;
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
  recommendation?: ProgramRecommendation;
  readinessState?: ReadinessState;
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

const readinessConfig: Record<ReadinessState, { label: string; color: string; icon: typeof Dumbbell; description: string }> = {
  needs_program: {
    label: "Needs Program",
    color: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
    icon: Dumbbell,
    description: "Assign a training program to unlock the first session",
  },
  needs_first_session: {
    label: "Needs First Session",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    icon: Calendar,
    description: "Program assigned — schedule the athlete's first session to get them training",
  },
  ready_to_train: {
    label: "Ready to Train",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    icon: Zap,
    description: "Program assigned and session scheduled — athlete is ready",
  },
  actively_training: {
    label: "Actively Training",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
    icon: Trophy,
    description: "First session completed — athlete is actively training",
  },
};

function severityConfig(severity: OnboardingAlert["severity"]) {
  switch (severity) {
    case "critical":
      return { bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-400", badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400", label: "Critical", icon: ShieldAlert };
    case "high":
      return { bg: "bg-orange-50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800", text: "text-orange-700 dark:text-orange-400", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400", label: "High", icon: Flame };
    case "medium":
      return { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400", label: "Medium", icon: AlertTriangle };
    default:
      return { bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-400", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400", label: "Low", icon: AlertCircle };
  }
}

function requiredCount(r: OnboardingRecord): number {
  return [r.accountInviteSent, r.welcomeDraftQueued, r.pailContextSeeded, r.firstSessionScheduled, r.programAssigned].filter(Boolean).length;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (confidence >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-slate-500";
}

// ─── Checklist Item ───────────────────────────────────────────────────────────

function ChecklistItem({ done, needsAction, label }: { done: boolean; needsAction: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {done
        ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
        : needsAction
          ? <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
          : <span className="h-3 w-3 shrink-0" />
      }
      <span className={done ? "text-foreground" : needsAction ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/50 line-through"}>
        {label}
      </span>
    </div>
  );
}

// ─── Readiness Banner ─────────────────────────────────────────────────────────

function ReadinessBanner({ state, recommendation, onSchedule, onSync, syncLoading }: {
  state: ReadinessState;
  recommendation?: ProgramRecommendation;
  onSchedule?: () => void;
  onSync?: () => void;
  syncLoading?: boolean;
}) {
  const cfg = readinessConfig[state];
  const Icon = cfg.icon;

  if (state === "actively_training") {
    return (
      <div className="rounded-md bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 px-3 py-2.5 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-purple-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">Actively Training</p>
          <p className="text-[11px] text-purple-600/80 dark:text-purple-400/70">First session completed — athlete is in the training system.</p>
        </div>
      </div>
    );
  }

  if (state === "ready_to_train") {
    return (
      <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2.5 flex items-center gap-2">
        <Zap className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Ready to Train</p>
          <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70">Program assigned and session scheduled — mark first session complete when done.</p>
        </div>
      </div>
    );
  }

  if (state === "needs_first_session") {
    return (
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Schedule First Session</p>
              <p className="text-[11px] text-blue-600/80 dark:text-blue-400/70">Program is assigned — next step is to book the first training session.</p>
            </div>
          </div>
          <Link href="/admin/scheduling-command-center">
            <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
              Schedule <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // needs_program — show recommendation panel
  if (!recommendation) {
    return (
      <div className="rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2.5 flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-orange-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Assign a Training Program</p>
          <p className="text-[11px] text-orange-600/80 dark:text-orange-400/70">No program assigned — assign one to unlock the training journey.</p>
        </div>
        <Link href="/admin/athlete-intelligence">
          <Button size="sm" variant="outline" className="h-6 text-[10px] shrink-0 border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
            Open Builder
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">
            Program Recommendation
            {recommendation.recommendedProgramName && (
              <span className="ml-1 font-normal">— {recommendation.recommendedProgramName}</span>
            )}
          </p>
          <p className="text-[11px] text-orange-600/80 dark:text-orange-400/70 mt-0.5">{recommendation.reason}</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 max-w-[80px]">
              <Progress value={recommendation.confidence} className="h-1" />
            </div>
            <span className={`text-[10px] font-medium ${confidenceColor(recommendation.confidence)}`}>
              {recommendation.confidence}% match
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={recommendation.actionUrl}>
          <Button size="sm" className="h-6 text-[10px] gap-1 bg-orange-600 hover:bg-orange-700 text-white">
            <Dumbbell className="h-3 w-3" /> {recommendation.actionLabel}
          </Button>
        </Link>
        <span className="text-[10px] text-muted-foreground">
          {recommendation.recommendedProgramName
            ? "Program found in your library"
            : "No programs in library yet — use the program builder"}
        </span>
      </div>
    </div>
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

// ─── Onboarding Card ──────────────────────────────────────────────────────────

function OnboardingCard({
  record,
  onUpdate,
  onSync,
  loading,
  syncLoading,
}: {
  record: OnboardingRecord;
  onUpdate: (id: string, updates: Record<string, boolean>) => void;
  onSync: (id: string) => void;
  loading: boolean;
  syncLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const required = requiredCount(record);
  const progressPct = Math.round((required / 5) * 100);
  const hasParentContext = !!(record.parentName || record.parentEmail);
  const topAlert = record.alerts[0] ?? null;
  const alertCfg = topAlert ? severityConfig(topAlert.severity) : null;
  const readiness = record.readinessState ?? "needs_program";
  const rCfg = readinessConfig[readiness];
  const RIcon = rCfg.icon;

  const borderClass = record.highestSeverity === "critical"
    ? "border-red-300 dark:border-red-800"
    : record.highestSeverity === "high"
      ? "border-orange-300 dark:border-orange-800"
      : readiness === "actively_training"
        ? "border-purple-200 dark:border-purple-800"
        : readiness === "ready_to_train"
          ? "border-emerald-200 dark:border-emerald-800"
          : "border-border";

  return (
    <Card className={`border ${borderClass}`} data-testid={`card-onboarding-${record.id}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate" data-testid={`text-athlete-name-${record.id}`}>
                {record.athleteName}
              </h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColors(record.status)}`}
                data-testid={`badge-status-${record.id}`}>
                {statusLabel(record.status)}
              </span>
              {/* Readiness state badge */}
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${rCfg.color}`}
                data-testid={`badge-readiness-${record.id}`}>
                <RIcon className="h-2.5 w-2.5" />
                {rCfg.label}
              </span>
              {/* Alert severity badge */}
              {record.highestSeverity && alertCfg && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${alertCfg.badge}`}
                  data-testid={`badge-alert-severity-${record.id}`}>
                  {alertCfg.label} alert
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{record.email}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {record.sport && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{record.sport}</Badge>}
              {record.experienceLevel && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{record.experienceLevel}</Badge>}
              {record.grade && <Badge variant="outline" className="text-[10px] h-4 px-1.5">{record.grade}</Badge>}
              {record.school && <span className="text-[11px] text-muted-foreground">{record.school}</span>}
            </div>
            {record.goals && record.goals.length > 0 && (
              <p className="text-[11px] text-muted-foreground/70 mt-1 truncate">
                Goals: {record.goals.slice(0, 3).join(", ")}
              </p>
            )}
            {hasParentContext && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Parent: {record.parentName || "—"}
                {record.guardianLinked && (
                  <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">(linked ✓)</span>
                )}
              </p>
            )}
          </div>

          <div className="text-right shrink-0">
            <p className="text-[10px] text-muted-foreground">Updated {timeAgo(record.updatedAt)}</p>
            <div className="flex items-center gap-1 mt-1 justify-end">
              <button
                onClick={() => onSync(record.id)}
                disabled={syncLoading}
                className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-0.5"
                title="Sync from real data"
                data-testid={`button-sync-${record.id}`}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                data-testid={`button-expand-${record.id}`}
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? "Less" : "Details"}
              </button>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">{required} of 5 required steps</span>
            <span className="text-[10px] font-medium text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                readiness === "actively_training" ? "bg-purple-500"
                : readiness === "ready_to_train" ? "bg-emerald-500"
                : record.highestSeverity === "critical" ? "bg-red-500"
                : record.highestSeverity === "high" ? "bg-orange-500"
                : "bg-amber-400"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        {/* Readiness panel (shown always, unless actively training without alerts) */}
        {record.status !== "complete" && (
          <ReadinessBanner
            state={readiness}
            recommendation={record.recommendation}
            syncLoading={syncLoading}
          />
        )}

        {/* Top alert callout */}
        {topAlert && alertCfg && (
          <div className={`rounded-md border ${alertCfg.bg} ${alertCfg.border} px-3 py-2`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <alertCfg.icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${alertCfg.text}`} />
                <div>
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${alertCfg.text}`}>
                    {alertCfg.label} Alert
                  </p>
                  <p className="text-xs text-foreground mt-0.5" data-testid={`text-top-alert-${record.id}`}>
                    {topAlert.message}
                  </p>
                </div>
              </div>
              {topAlert.actionUrl && (
                <Link href={topAlert.actionUrl}>
                  <Button size="sm" variant="outline"
                    className={`h-6 text-[10px] shrink-0 border ${alertCfg.border} ${alertCfg.text}`}
                    data-testid={`button-alert-action-${record.id}`}>
                    {topAlert.actionLabel}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Complete state */}
        {record.status === "complete" && record.alertCount === 0 && (
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-emerald-500" />
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              Athlete fully onboarded and actively training!
            </p>
          </div>
        )}

        {/* Expanded section */}
        {expanded && (
          <div className="space-y-3 pt-1 border-t">
            {/* Athlete profile summary */}
            {(record.position || record.currentTrainingStatus) && (
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {record.position && <p>Position: {record.position}</p>}
                {record.currentTrainingStatus && <p>Training status: {record.currentTrainingStatus}</p>}
              </div>
            )}

            {/* All alerts */}
            {record.alerts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  All Alerts ({record.alertCount})
                </p>
                {record.alerts.map(alert => {
                  const aCfg = severityConfig(alert.severity);
                  return (
                    <div key={alert.key} className={`rounded-md border ${aCfg.bg} ${aCfg.border} px-3 py-2 flex items-start justify-between gap-2`}>
                      <div className="flex items-start gap-2 min-w-0">
                        <aCfg.icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${aCfg.text}`} />
                        <div className="min-w-0">
                          <p className={`text-[10px] font-semibold uppercase ${aCfg.text}`}>{aCfg.label}</p>
                          <p className="text-xs text-foreground mt-0.5">{alert.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{alert.ageHours}h since onboarding started</p>
                        </div>
                      </div>
                      {alert.actionUrl && (
                        <Link href={alert.actionUrl}>
                          <Button size="sm" variant="outline"
                            className={`h-6 text-[10px] shrink-0 border ${aCfg.border} ${aCfg.text}`}>
                            {alert.actionLabel}
                          </Button>
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Checklist */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Checklist</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <ChecklistItem done={record.accountInviteSent} needsAction={!record.accountInviteSent} label="Account invite" />
                <ChecklistItem done={record.welcomeDraftQueued} needsAction={!record.welcomeDraftQueued} label="Welcome draft queued" />
                <ChecklistItem done={record.welcomeDraftApproved} needsAction={record.welcomeDraftQueued && !record.welcomeDraftApproved} label="Welcome draft approved" />
                <ChecklistItem done={record.pailContextSeeded} needsAction={!record.pailContextSeeded} label="PAIL context" />
                <ChecklistItem done={record.guardianLinked} needsAction={hasParentContext && !record.guardianLinked} label="Guardian linked" />
                <ChecklistItem done={record.programAssigned} needsAction={!record.programAssigned} label="Program assigned ✓ real data" />
                <ChecklistItem done={record.firstSessionScheduled} needsAction={!record.firstSessionScheduled} label="First session scheduled ✓ real data" />
                <ChecklistItem done={record.firstSessionCompleted} needsAction={false} label="First session completed ✓ real data" />
                <ChecklistItem done={record.paymentSetup} needsAction={false} label="Payment set up" />
                <ChecklistItem done={record.waiverCompleted} needsAction={false} label="Waiver completed" />
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {/* Program actions */}
          {!record.programAssigned && (
            <Link href="/admin/athlete-intelligence">
              <Button size="sm" variant="default" className="h-7 text-xs gap-1"
                data-testid={`button-assign-program-${record.id}`}>
                <Dumbbell className="h-3 w-3" />
                {record.recommendation?.recommendedProgramName ? "Assign Recommended Program" : "Open Program Builder"}
              </Button>
            </Link>
          )}

          {/* First session actions */}
          {!record.firstSessionScheduled && (
            <Link href="/admin/scheduling-command-center">
              <Button size="sm" variant={record.programAssigned ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                data-testid={`button-schedule-session-${record.id}`}>
                <Calendar className="h-3 w-3" /> Schedule First Session
              </Button>
            </Link>
          )}

          {/* Mark first session scheduled (manual fallback) */}
          {!record.firstSessionScheduled && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={loading}
              onClick={() => onUpdate(record.id, { firstSessionScheduled: true })}
              data-testid={`button-mark-scheduled-${record.id}`}>
              <CheckCircle className="h-3 w-3" /> Mark Scheduled
            </Button>
          )}

          {/* Mark first session complete */}
          {record.firstSessionScheduled && !record.firstSessionCompleted && (
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400"
              disabled={loading}
              onClick={() => onUpdate(record.id, { firstSessionCompleted: true })}
              data-testid={`button-mark-session-complete-${record.id}`}>
              <Play className="h-3 w-3" /> Mark First Session Complete
            </Button>
          )}

          {/* Mark program assigned (manual fallback) */}
          {!record.programAssigned && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              disabled={loading}
              onClick={() => onUpdate(record.id, { programAssigned: true })}
              data-testid={`button-mark-program-${record.id}`}>
              <UserCheck className="h-3 w-3" /> Mark Program Assigned
            </Button>
          )}

          {/* Welcome draft */}
          {record.welcomeDraftQueued && !record.welcomeDraftApproved && (
            <Link href="/admin/ai-approvals">
              <Button size="sm" variant="outline"
                className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                data-testid={`button-review-draft-${record.id}`}>
                <Mail className="h-3 w-3" /> Review Draft
              </Button>
            </Link>
          )}

          {/* PAIL Intelligence */}
          <Link href="/admin/athlete-intelligence">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
              data-testid={`button-intelligence-${record.id}`}>
              <Brain className="h-3 w-3" /> Intelligence
            </Button>
          </Link>

          {/* Source lead */}
          {record.leadSubmissionId && (
            <Link href="/admin/athlete-leads">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
                data-testid={`button-source-lead-${record.id}`}>
                <ExternalLink className="h-3 w-3" /> Source Lead
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAthleteOnboardingPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [needsFilter, setNeedsFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
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
      const res = await fetch(`/api/admin/athlete-onboarding${q ? `?${q}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch onboarding records");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, boolean> }) =>
      apiRequest("PATCH", `/api/admin/athlete-onboarding/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-onboarding"] });
      toast({ title: "Updated", description: "Checklist updated successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/admin/athlete-onboarding/${id}/sync`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-onboarding"] });
      if (data?.synced) {
        toast({ title: "Synced", description: "Checklist updated from real booking/program data." });
      } else {
        toast({ title: "Already up to date", description: "No changes detected from real data." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const records = (data?.records ?? []).filter(r => {
    if (readinessFilter === "all") return true;
    return r.readinessState === readinessFilter;
  });

  const summary = data?.summary ?? {
    total: 0, needsAction: 0, pending: 0, complete: 0,
    alertsTotal: 0, criticalAlerts: 0, highAlerts: 0, mediumAlerts: 0, stuckOnboardingCount: 0,
  };

  const rawRecords = data?.records ?? [];
  const readinessCounts = {
    needs_program: rawRecords.filter(r => r.readinessState === "needs_program").length,
    needs_first_session: rawRecords.filter(r => r.readinessState === "needs_first_session").length,
    ready_to_train: rawRecords.filter(r => r.readinessState === "ready_to_train").length,
    actively_training: rawRecords.filter(r => r.readinessState === "actively_training").length,
  };

  const hasFilters = statusFilter !== "all" || needsFilter !== "all" || alertFilter !== "all" || readinessFilter !== "all" || searchQuery;

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
            Track onboarding from converted lead to actively training — syncs with real booking and program data.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5" data-testid="button-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Status summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Total Athletes" value={summary.total} icon={Users} color="bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" />
        <SummaryTile label="In Progress" value={summary.needsAction} icon={Clock} color="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400" />
        <SummaryTile label="Pending" value={summary.pending} icon={AlertCircle} color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" />
        <SummaryTile label="Complete" value={summary.complete} icon={Trophy} color="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400" />
      </div>

      {/* Readiness state breakdown */}
      {summary.total > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Readiness Breakdown</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(["needs_program", "needs_first_session", "ready_to_train", "actively_training"] as ReadinessState[]).map(state => {
              const cfg = readinessConfig[state];
              const Icon = cfg.icon;
              const count = readinessCounts[state];
              return (
                <SummaryTile
                  key={state}
                  label={cfg.label}
                  value={count}
                  icon={Icon}
                  color={cfg.color}
                  active={readinessFilter === state}
                  onClick={() => setReadinessFilter(readinessFilter === state ? "all" : state)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Alert summary */}
      {summary.alertsTotal > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Alerts</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile label="Critical Alerts" value={summary.criticalAlerts} icon={ShieldAlert}
              color="bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
              active={alertFilter === "critical"}
              onClick={() => setAlertFilter(alertFilter === "critical" ? "all" : "critical")} />
            <SummaryTile label="High Alerts" value={summary.highAlerts} icon={Flame}
              color="bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400"
              active={alertFilter === "high"}
              onClick={() => setAlertFilter(alertFilter === "high" ? "all" : "high")} />
            <SummaryTile label="Medium Alerts" value={summary.mediumAlerts} icon={AlertTriangle}
              color="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
              active={alertFilter === "medium"}
              onClick={() => setAlertFilter(alertFilter === "medium" ? "all" : "medium")} />
            <SummaryTile label="Stuck Onboardings" value={summary.stuckOnboardingCount} icon={Clock}
              color="bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400" />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "pending", "in_progress", "complete"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-status-${s}`}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
              }`}>
              {s === "all" ? "All" : s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Alert filter */}
        <Select value={alertFilter} onValueChange={setAlertFilter}>
          <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-alert-filter">
            <SelectValue placeholder="Alert level" />
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
          <SelectTrigger className="h-8 w-[145px] text-xs" data-testid="select-needs-filter">
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
          <Input placeholder="Search name, email, sport, school…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" data-testid="input-search" />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => { setStatusFilter("all"); setNeedsFilter("all"); setAlertFilter("all"); setReadinessFilter("all"); setSearchQuery(""); }}
            data-testid="button-clear-filters">
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
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
            {hasFilters ? "Try adjusting your filters." : "Convert leads to athletes to start tracking onboarding."}
          </p>
          {hasFilters ? (
            <Button variant="outline" size="sm" className="mt-4"
              onClick={() => { setStatusFilter("all"); setNeedsFilter("all"); setAlertFilter("all"); setReadinessFilter("all"); setSearchQuery(""); }}>
              Clear filters
            </Button>
          ) : (
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
            {readinessFilter !== "all" && ` · filtered by: ${readinessConfig[readinessFilter as ReadinessState]?.label}`}
          </p>
          {records.map(record => (
            <OnboardingCard
              key={record.id}
              record={record}
              onUpdate={(id, updates) => updateMutation.mutate({ id, updates })}
              onSync={id => syncMutation.mutate(id)}
              loading={updateMutation.isPending}
              syncLoading={syncMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
