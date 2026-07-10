import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users, TrendingUp, Calendar, CheckCircle, Target, Filter,
  ChevronDown, ChevronUp, Phone, Mail, MapPin, Clock, Loader2,
  Trash2, Edit2, UserCheck, ClipboardList, DollarSign, BarChart2,
  Building2, Zap, ArrowRight, ExternalLink, X as XIcon, Star,
  Send, CalendarDays, CheckSquare, AlertCircle, RefreshCw,
  Flame, AlertTriangle, Snowflake, ArrowUpDown, SortAsc,
  TrendingDown, Activity, FileText, Eye,
  Brain, History, ChevronRight, GitBranch, PieChart, MessageSquare,
  LayoutDashboard, ArrowDown, Minus,
} from "lucide-react";
import type { LeadCaptureSubmission } from "@shared/schema";

// ─── Status config ─────────────────────────────────────────────────────────
const BOOKING_STATUS_MAP: Record<string, { label: string; className: string }> = {
  not_booked:        { label: "New",            className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  evaluation_booked: { label: "Eval Scheduled", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  enrolled:          { label: "Enrolled",        className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  attended:          { label: "Attended",        className: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  lost:              { label: "Lost",            className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  archived:          { label: "Archived",        className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const COMMITMENT_COLORS: Record<string, string> = {
  high:   "text-emerald-600 dark:text-emerald-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low:    "text-slate-500 dark:text-slate-400",
};

type UrgencyLevel = "hot" | "warn" | "cold" | "eval" | "normal" | "inactive";

function getUrgency(lead: LeadCaptureSubmission): UrgencyLevel {
  const status = lead.bookingStatus || "not_booked";
  if (status === "enrolled" || status === "attended") return "inactive";
  if (status === "lost" || status === "archived") return "inactive";
  if (status === "evaluation_booked") return "eval";

  const ageDays = lead.createdAt
    ? (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const score = lead.aiQualificationScore || 0;

  if (ageDays >= 7) return "cold";
  if (ageDays >= 3) return "warn";
  if (score >= 75 && ageDays < 4) return "hot";
  return "normal";
}

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; icon: any; badgeClass: string; cardBorderClass: string }> = {
  hot:      { label: "Hot Lead",        icon: Flame,         badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700", cardBorderClass: "border-l-4 border-l-emerald-500" },
  warn:     { label: "Follow-up Needed",icon: AlertTriangle,  badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-700",           cardBorderClass: "border-l-4 border-l-amber-400" },
  cold:     { label: "Cold Risk",       icon: Snowflake,      badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-700",                       cardBorderClass: "border-l-4 border-l-red-500" },
  eval:     { label: "Eval Scheduled",  icon: CalendarDays,   badgeClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700",     cardBorderClass: "" },
  normal:   { label: "New",             icon: Activity,       badgeClass: "",                                                                                                                        cardBorderClass: "" },
  inactive: { label: "",                icon: null,           badgeClass: "",                                                                                                                        cardBorderClass: "" },
};

const URGENCY_SORT_ORDER: Record<UrgencyLevel, number> = {
  cold: 0, warn: 1, hot: 2, eval: 3, normal: 4, inactive: 5,
};

function getStatusCfg(status: string | null | undefined) {
  return BOOKING_STATUS_MAP[status || "not_booked"] || BOOKING_STATUS_MAP.not_booked;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function daysAgo(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── AI Score Badge ─────────────────────────────────────────────────────────
function QualificationBadge({ score }: { score: number | null | undefined }) {
  if (!score && score !== 0) return null;
  const color =
    score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700" :
    score >= 60 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700" :
    score >= 40 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700" :
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-700";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${color}`}>
      <Star className="h-2.5 w-2.5" />
      {score} / 100
    </span>
  );
}

// ─── Urgency Badge ────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }: { urgency: UrgencyLevel }) {
  const cfg = URGENCY_CONFIG[urgency];
  if (!cfg.badgeClass || urgency === "normal" || urgency === "inactive") return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg.badgeClass}`}>
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {cfg.label}
    </span>
  );
}

// ─── Source Badge ────────────────────────────────────────────────────────────
function SourceBadge({ source, campaign }: { source?: string | null; campaign?: string | null }) {
  const label = campaign || source || "organic";
  const isAd = source === "facebook" || source === "instagram" || source === "meta" || source?.includes("paid");
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
      isAd
        ? "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-700"
        : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700"
    }`} data-testid="badge-source">
      {isAd ? "Ad" : "Organic"} · {label}
    </span>
  );
}

// ─── Draft Indicator ─────────────────────────────────────────────────────────
function DraftReadyBadge({ lead }: { lead: LeadCaptureSubmission }) {
  if (!(lead as any).adminEmailStatus && !(lead as any).aiNextAction) return null;
  const hasDraft = (lead as any).adminEmailStatus === "draft_created" || !!(lead as any).aiNextAction;
  if (!hasDraft) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-700">
      <FileText className="h-2.5 w-2.5" />
      Draft Ready
    </span>
  );
}

// ─── Convert to Athlete Modal ────────────────────────────────────────────────
interface ConvertResult {
  success: boolean;
  userId: string;
  athleteCreated: boolean;
  linkedExisting: boolean;
  accountInviteCreated: boolean;
  welcomeDraftCreated: boolean;
  welcomeDraftId: string | null;
  pailInitialized: boolean;
  pailContextSeeded: boolean;
  guardianLinked: boolean;
  guardianUserId?: string;
  guardianInviteCreated: boolean;
  guardianReason?: string;
  onboardingChecklistCreated: boolean;
  onboardingChecklistId?: string;
  onboardingStatus: "pending" | "in_progress" | "complete";
  nextBestAction: string;
  recommendedNextActions: string[];
  email: string;
  athleteName: string;
}

function ConvertAthleteModal({
  lead,
  onClose,
  onConverted,
}: {
  lead: LeadCaptureSubmission;
  onClose: () => void;
  onConverted: (result: ConvertResult) => void;
}) {
  const { toast } = useToast();
  const [result, setResult] = useState<ConvertResult | null>(null);

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/athlete-leads/${lead.id}/convert`, {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Conversion failed");
      return json as ConvertResult;
    },
    onSuccess: (data) => {
      setResult(data);
      onConverted(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads/stats"] });
      toast({
        title: data.athleteCreated ? "Athlete account created" : "Lead linked to existing athlete",
        description: data.welcomeDraftCreated
          ? "Welcome draft queued in AI Approvals."
          : "Conversion complete.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    },
  });

  const hasEmail = !!lead.email;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-500" />
            Convert to Athlete — {lead.athleteName}
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/30 border px-3 py-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap font-medium">
                <span data-testid="text-convert-name">{lead.athleteName}</span>
                {lead.sport && <span className="text-muted-foreground">· {lead.sport}</span>}
                {lead.age && <span className="text-muted-foreground">· Age {lead.age}</span>}
                {lead.school && <span className="text-muted-foreground">· {lead.school}</span>}
              </div>
              {lead.email && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="font-mono">{lead.email}</span>
                </div>
              )}
              {lead.parentName && (
                <div className="text-muted-foreground">
                  Parent: {lead.parentName}
                  {(lead as any).parentEmail && (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground/70">· {(lead as any).parentEmail}</span>
                  )}
                </div>
              )}
            </div>

            {!hasEmail && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>This lead has no email address. An athlete account can't be created without one. You can still proceed, but no account or invite will be sent.</span>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What will happen</p>
              <div className="space-y-2">
                {[
                  { icon: <UserCheck className="h-3.5 w-3.5 text-emerald-500" />, text: "Create or link a CLIENT account (users + user_profiles)", detail: hasEmail ? `Account will use ${lead.email}` : "Skipped — no email" },
                  { icon: <CheckSquare className="h-3.5 w-3.5 text-blue-500" />, text: "Mark lead as Enrolled + set convertedAt timestamp", detail: "leadCaptureSubmissions updated" },
                  { icon: <BarChart2 className="h-3.5 w-3.5 text-indigo-500" />, text: "Advance intelligence pipeline stage to 'converted'", detail: "Stage transition audit entry written" },
                  { icon: <Mail className="h-3.5 w-3.5 text-purple-500" />, text: "Queue AgentMail welcome draft for review", detail: "Queued in AI Approvals — not auto-sent" },
                  { icon: <Send className="h-3.5 w-3.5 text-teal-500" />, text: hasEmail ? "Send account invitation email (SendGrid)" : "Skip account invite — no email", detail: hasEmail ? `"Create your password" link, 7-day expiry` : "Manual invite later" },
                  { icon: <Zap className="h-3.5 w-3.5 text-yellow-500" />, text: "Initialize PAIL athlete intelligence profile", detail: "Seeded with intake data — grows with session history" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">{item.icon}</div>
                    <div>
                      <p className="text-sm">{item.text}</p>
                      <p className="text-[11px] text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground border-t pt-3">
              The original lead submission is preserved and linked to the new athlete account.
              Duplicate emails are detected — existing accounts will be linked, not duplicated.
            </p>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => convertMutation.mutate()}
                disabled={convertMutation.isPending}
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-confirm-convert"
              >
                {convertMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Converting…</>
                  : <><UserCheck className="h-4 w-4" /> Convert to Athlete</>
                }
              </Button>
              <Button variant="outline" onClick={onClose} disabled={convertMutation.isPending} data-testid="button-cancel-convert">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-1">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                {result.athleteCreated ? "Athlete account created!" : "Lead linked to existing athlete!"}
              </p>
              <p className="text-xs text-muted-foreground">{result.athleteName} · {result.email}</p>
              {result.onboardingChecklistCreated && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-500 font-medium">Onboarding checklist created · status: {result.onboardingStatus}</p>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Onboarding Checklist</p>
              {([
                { ok: result.athleteCreated || result.linkedExisting, label: result.athleteCreated ? "Account created" : "Linked to existing account", status: "done" },
                { ok: result.accountInviteCreated, label: "Account invite sent", status: result.accountInviteCreated ? "done" : "needs_action" },
                { ok: result.welcomeDraftCreated, label: "Welcome draft queued", status: result.welcomeDraftCreated ? "done" : "needs_action" },
                { ok: false, label: "Welcome draft approved", status: "pending" },
                { ok: result.pailContextSeeded, label: "PAIL intake context seeded", status: result.pailContextSeeded ? "done" : "needs_action" },
                { ok: result.guardianLinked, label: result.guardianLinked ? `Guardian linked${result.guardianInviteCreated ? " · invite sent" : ""}` : result.guardianReason || "Guardian — no info", status: result.guardianLinked ? "done" : "pending" },
                { ok: false, label: "First session scheduled", status: "needs_action" },
                { ok: false, label: "Program assigned", status: "needs_action" },
                { ok: false, label: "Payment / billing set up", status: "pending" },
                { ok: false, label: "Waiver completed", status: "pending" },
                { ok: false, label: "First session completed", status: "pending" },
              ] as { ok: boolean; label: string; status: "done" | "needs_action" | "pending" }[]).map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm py-0.5">
                  {item.status === "done"
                    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    : item.status === "needs_action"
                      ? <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      : <span className="h-3.5 w-3.5 shrink-0 mt-0.5 flex items-center justify-center text-muted-foreground/40 text-[10px]">–</span>
                  }
                  <span className={item.status === "done" ? "text-foreground" : item.status === "needs_action" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/60"}>
                    {item.label}
                    {item.status === "needs_action" && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-amber-500">Needs action</span>}
                    {item.status === "pending" && <span className="ml-1 text-[10px] text-muted-foreground/40">Not yet</span>}
                  </span>
                </div>
              ))}
            </div>

            {result.nextBestAction && (
              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2.5">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-0.5">Next best action</p>
                <p className="text-sm text-blue-800 dark:text-blue-300">{result.nextBestAction}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t flex-wrap sticky bottom-0 bg-background">
              {result.welcomeDraftCreated && (
                <Link href="/admin/ai-approvals">
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={onClose} data-testid="link-review-welcome-draft">
                    <ExternalLink className="h-3 w-3" /> Review Draft
                  </Button>
                </Link>
              )}
              <Link href="/admin/athlete-intelligence">
                <Button size="sm" variant="outline" className="text-xs gap-1" onClick={onClose} data-testid="link-athlete-intelligence">
                  <ExternalLink className="h-3 w-3" /> Athlete Intelligence
                </Button>
              </Link>
              <Link href="/admin/scheduling-command-center">
                <Button size="sm" variant="outline" className="text-xs gap-1" onClick={onClose} data-testid="link-schedule-session">
                  <ExternalLink className="h-3 w-3" /> Schedule Session
                </Button>
              </Link>
              <Button size="sm" variant="outline" onClick={onClose} className="ml-auto" data-testid="button-close-convert-success">
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── AgentMail Email Draft Modal ─────────────────────────────────────────────
function EmailDraftModal({
  lead,
  onClose,
}: {
  lead: LeadCaptureSubmission;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<"existing" | "created" | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const { isLoading: draftLoading, error: draftError } = useQuery<{
    draft: { id: string; subject: string | null; bodyPreview: string | null; result: any; recipientEmail: string | null; actionType: string };
    intelProfileId: string | null;
    source: "existing" | "created";
  }>({
    queryKey: [`/api/admin/athlete-leads/${lead.id}/draft`],
    refetchOnWindowFocus: false,
    retry: false,
    // @ts-ignore
    select: (data: any) => {
      if (!draftId) {
        setDraftId(data.draft.id);
        setDraftSource(data.source);
        const fullBody = data.draft.result?.fullBody || data.draft.bodyPreview || "";
        setSubject(data.draft.subject || "");
        setBody(fullBody);
      }
      return data;
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("No draft ID");
      const res = await apiRequest("POST", `/api/ai-approvals/${draftId}/approve`, {
        subject: subject.trim(),
        body: body.trim(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Send failed");
      return json;
    },
    onSuccess: () => {
      setSendSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
      toast({ title: "Email sent via AgentMail", description: `Draft sent to ${lead.email}` });
    },
    onError: (err: Error) => {
      const isGmailErr = err.message.toLowerCase().includes("gmail") || err.message.toLowerCase().includes("oauth");
      if (isGmailErr) {
        toast({ title: "Gmail not connected", description: "Connect Gmail in Settings to send emails through AgentMail.", variant: "destructive" });
      } else {
        toast({ title: "Send failed", description: err.message, variant: "destructive" });
      }
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-500" />
            AgentMail Draft — {lead.athleteName}
          </DialogTitle>
        </DialogHeader>

        {draftLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading AI draft…</span>
          </div>
        )}

        {draftError && !draftLoading && (
          <div className="flex items-center gap-2 text-sm text-red-600 py-4">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load draft. Please try again.
          </div>
        )}

        {sendSuccess && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-2">
            <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">Email sent!</p>
            <p className="text-xs text-muted-foreground">Sent to {lead.email} via AgentMail.</p>
            <Button size="sm" variant="outline" onClick={onClose} className="mt-2">Close</Button>
          </div>
        )}

        {!draftLoading && !draftError && !sendSuccess && draftId && (
          <div className="space-y-4">
            {draftSource === "existing" && (
              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded px-2.5 py-1.5 border border-blue-200 dark:border-blue-800">
                <Zap className="h-3 w-3 shrink-0" />
                AI draft loaded from intake pipeline — edit before sending.
              </div>
            )}
            {draftSource === "created" && (
              <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 rounded px-2.5 py-1.5 border border-purple-200 dark:border-purple-800">
                <Zap className="h-3 w-3 shrink-0" />
                New draft created from submission data — edit before sending.
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">To</p>
              <div className="text-sm bg-muted/40 border rounded px-3 py-2 font-mono text-muted-foreground">
                {lead.email}
                {lead.parentName && (
                  <span className="ml-2 text-[11px] text-muted-foreground/70">(parent: {lead.parentName})</span>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm h-9" data-testid="input-email-subject" />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="text-sm min-h-[160px] resize-none font-mono text-xs"
                data-testid="textarea-email-body"
              />
            </div>

            <div className="flex gap-2 flex-wrap pt-1 border-t">
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !subject.trim() || !body.trim()}
                className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-send-agentmail"
              >
                {sendMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                  : <><Send className="h-3.5 w-3.5" /> Send via AgentMail</>
                }
              </Button>
              <Button variant="outline" onClick={onClose} disabled={sendMutation.isPending} data-testid="button-save-draft-queue">
                Save to Queue
              </Button>
              <Link href="/admin/ai-approvals">
                <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground" onClick={onClose} data-testid="link-view-all-drafts">
                  <ExternalLink className="h-3 w-3" /> All Drafts
                </Button>
              </Link>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sending goes through AgentMail — logged, tracked, and tied to this lead's pipeline record.
              "Save to Queue" keeps the draft in AI Approvals for later.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Eval Modal ──────────────────────────────────────────────────────
function ScheduleEvalModal({
  lead,
  onBooked,
  onClose,
}: {
  lead: LeadCaptureSubmission;
  onBooked: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"initial" | "finding" | "slots_found" | "offering" | "offered" | "confirming" | "confirmed">("initial");
  const [slots, setSlots] = useState<any[]>([]);
  const [offeredSlots, setOfferedSlots] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [intelProfileId, setIntelProfileId] = useState<string | null>(null);
  const [schedCtx, setSchedCtx] = useState<any>(null);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const { isLoading: intelLoading } = useQuery<any>({
    queryKey: [`/api/lead-capture/intelligence/${lead.id}`],
    refetchOnWindowFocus: false,
    retry: false,
    // @ts-ignore
    select: (data: any) => {
      if (data?.id && !intelProfileId) setIntelProfileId(data.id);
      return data;
    },
  });

  const { isLoading: ctxLoading } = useQuery<any>({
    queryKey: [`/api/org/scheduling-agent/contexts/${lead.id}`],
    refetchOnWindowFocus: false,
    retry: false,
    // @ts-ignore
    select: (data: any) => {
      if (data && !schedCtx) {
        setSchedCtx(data);
        if (data.offeredSlots?.length && data.status === "slots_offered") {
          setOfferedSlots(data.offeredSlots);
          setStep("offered");
        }
      }
      return data;
    },
  });

  const isInitialLoading = intelLoading || ctxLoading;

  async function handleFindAndOffer() {
    if (!intelProfileId) { setError("AI lead profile not ready yet. Try again in a moment."); return; }
    setError(null); setStep("finding");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/find-slots", { submissionId: lead.id, durationMin: 60, lookAheadDays: 14 });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to find slots");
      if (!json.slots?.length) { setError("No available slots found in the next 14 days. Make sure coaches have availability set up."); setStep("initial"); return; }
      setSlots(json.slots); setStep("slots_found");
    } catch (err: any) { setError(err.message); setStep("initial"); }
  }

  async function handleOfferSlots() {
    if (!intelProfileId) return;
    setError(null); setStep("offering");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/offer-slots", { submissionId: lead.id, leadId: intelProfileId, durationMin: 60 });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to offer slots");
      setOfferedSlots(json.offeredSlots || slots); setStep("offered");
      toast({ title: "Slots offered via AgentMail", description: "An email draft with time options has been created and queued for review." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
    } catch (err: any) { setError(err.message); setStep("slots_found"); }
  }

  async function handleConfirmBooking() {
    if (!replyText.trim()) return;
    setError(null); setStep("confirming");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/confirm-booking", { submissionId: lead.id, replyText: replyText.trim() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to confirm booking");
      setConfirmResult(json);
      if (json.success) {
        setStep("confirmed"); onBooked();
        queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads/stats"] });
      } else {
        setError(json.message || "Could not auto-confirm. Low confidence — please mark manually or try a clearer reply.");
        setStep("offered");
      }
    } catch (err: any) { setError(err.message); setStep("offered"); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-indigo-500" />
            Schedule Evaluation — {lead.athleteName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/30 border px-3 py-2.5 text-xs space-y-1">
            <div className="flex items-center gap-4 flex-wrap">
              <span><span className="text-muted-foreground">Email:</span> {lead.email}</span>
              {lead.sport && <span><span className="text-muted-foreground">Sport:</span> {lead.sport}</span>}
              {lead.age && <span><span className="text-muted-foreground">Age:</span> {lead.age}</span>}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}

          {step === "initial" && (
            <div className="space-y-3">
              {isInitialLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading scheduling context…
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Find available evaluation slots and send them to the athlete via AgentMail. The athlete will reply to confirm their preferred time.</p>
                  <Button onClick={handleFindAndOffer} disabled={!intelProfileId} className="w-full gap-2" data-testid="button-find-slots">
                    <Calendar className="h-4 w-4" />Find Available Slots
                  </Button>
                  {!intelProfileId && <p className="text-[11px] text-amber-600 dark:text-amber-400">AI profile is still processing — refresh and try again in a moment.</p>}
                </>
              )}
            </div>
          )}

          {step === "finding" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Searching coach availability…</span>
            </div>
          )}

          {step === "slots_found" && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{slots.length} slot{slots.length !== 1 ? "s" : ""} found</p>
              <div className="space-y-2">
                {slots.map((slot: any, i: number) => (
                  <div key={i} className="rounded-md border px-3 py-2 text-sm bg-muted/20">
                    <p className="font-medium">{slot.displayDate || slot.date}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {slot.displayTime || `${slot.startTime}–${slot.endTime}`}
                      {slot.coachName && ` · ${slot.coachName}`}
                      {slot.durationMin && ` · ${slot.durationMin} min`}
                    </p>
                  </div>
                ))}
              </div>
              <Button onClick={handleOfferSlots} className="w-full gap-2" data-testid="button-offer-slots">
                <Send className="h-3.5 w-3.5" />Send Slot Options via AgentMail
              </Button>
              <p className="text-[11px] text-muted-foreground">An email draft with these time options will be queued in AI Approvals for review before sending.</p>
            </div>
          )}

          {step === "offering" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Creating AgentMail draft…</span>
            </div>
          )}

          {step === "offered" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-3 space-y-1">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
                  <CheckSquare className="h-4 w-4" />Slots sent via AgentMail
                </div>
                <p className="text-xs text-muted-foreground">The athlete will reply with their preferred time. Paste their reply below to confirm the booking.</p>
              </div>
              {offeredSlots.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Offered times</p>
                  {offeredSlots.map((slot: any, i: number) => (
                    <div key={i} className="rounded border px-2.5 py-1.5 text-xs text-muted-foreground bg-muted/20">
                      {slot.displayDate || slot.date} · {slot.displayTime || slot.startTime}
                      {slot.coachName && ` · ${slot.coachName}`}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Athlete's reply (paste here to auto-confirm)</p>
                <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={`e.g. "Thursday at 4pm works great!"`} className="text-sm min-h-[80px] resize-none" data-testid="textarea-reply-text" />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleConfirmBooking} disabled={!replyText.trim()} className="flex-1 gap-2" data-testid="button-confirm-booking">
                  <CheckCircle className="h-3.5 w-3.5" />Parse & Confirm Booking
                </Button>
                <Button variant="outline" onClick={handleFindAndOffer} className="gap-1.5 text-xs" data-testid="button-resend-slots">
                  <RefreshCw className="h-3 w-3" /> New Slots
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">AI will match the reply to an offered slot. If confidence is too low, you'll be prompted to confirm manually.</p>
            </div>
          )}

          {step === "confirming" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Parsing reply and confirming booking…</span>
            </div>
          )}

          {step === "confirmed" && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-2">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">Booking Confirmed!</p>
              {confirmResult?.selectedSlot && (
                <p className="text-sm text-muted-foreground">
                  {confirmResult.selectedSlot.displayDate} · {confirmResult.selectedSlot.displayTime}
                  {confirmResult.selectedSlot.coachName && ` · ${confirmResult.selectedSlot.coachName}`}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Lead status updated to <strong>Eval Scheduled</strong> and pipeline stage set to <strong>booked</strong>. A confirmation email draft has been queued in AI Approvals.</p>
              <Button size="sm" variant="outline" onClick={onClose} className="mt-2">Close</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enriched Intelligence Types ─────────────────────────────────────────────
interface EnrichedIntel {
  pipelineStage?: string | null;
  aiSummary?: string | null;
  leadScore?: number | null;
  temperature?: string | null;
  urgency?: string | null;
  suggestedNextAction?: string | null;
  suggestedNextActionReason?: string | null;
  stageTransitions?: Array<{ fromStage?: string; toStage?: string; reason?: string; source?: string; timestamp?: string }> | null;
  followUpStage?: string | null;
  lastInteractionAt?: string | null;
  nextFollowUpAt?: string | null;
  gmailDraftActionId?: string | null;
  tags?: string[] | null;
  outcome?: {
    outcomeStatus?: string | null;
    repliedAt?: string | null;
    bookedSessionAt?: string | null;
    convertedAt?: string | null;
    sentAt?: string | null;
  } | null;
}

interface RevenueOpsData {
  stageDistribution: Array<{ stage: string; count: number }>;
  bottleneckStage: string | null;
  sourceConversion: Array<{ source: string; total: number; converted: number; rate: number }>;
  outreachMetrics: {
    totalSent: number;
    totalReplied: number;
    totalBooked: number;
    totalConverted: number;
    replyRate: number;
    bookingRate: number;
    avgDaysToReply: number | null;
  };
  pipelineValueCents: number;
}

// ─── Lifecycle Bar ────────────────────────────────────────────────────────────
const LIFECYCLE_STEPS = [
  { key: "captured",   label: "Captured" },
  { key: "qualified",  label: "Scored" },
  { key: "outreached", label: "Outreached" },
  { key: "replied",    label: "Replied" },
  { key: "scheduled",  label: "Eval" },
  { key: "enrolled",   label: "Enrolled" },
];

function getLifecycleStep(lead: LeadCaptureSubmission, intel: EnrichedIntel | null): number {
  if (lead.bookingStatus === "enrolled" || intel?.pipelineStage === "converted") return 5;
  if (lead.bookingStatus === "evaluation_booked" || lead.bookingStatus === "attended" || intel?.pipelineStage === "booked" || intel?.pipelineStage === "scheduling") return 4;
  const replied = intel?.outcome?.outcomeStatus && ["replied", "meeting_booked", "booked_session"].includes(intel.outcome.outcomeStatus);
  if (replied) return 3;
  const outreached = !!(lead as any).contactedAt || (lead as any).adminEmailStatus === "sent" || intel?.pipelineStage === "engaged" || !!intel?.outcome?.sentAt;
  if (outreached) return 2;
  if ((lead.aiQualificationScore || 0) > 0 || (intel?.leadScore || 0) > 0) return 1;
  return 0;
}

function LifecycleBar({ lead, intel }: { lead: LeadCaptureSubmission; intel: EnrichedIntel | null }) {
  const step = getLifecycleStep(lead, intel);
  const isLost = lead.bookingStatus === "lost" || intel?.pipelineStage === "lost";
  const isStalled = intel?.pipelineStage === "stalled";

  return (
    <div className="flex items-center gap-0 w-full" data-testid="lifecycle-bar">
      {LIFECYCLE_STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        const dotColor = isLost && i === step
          ? "bg-red-400 dark:bg-red-500"
          : isStalled && i === step
          ? "bg-amber-400 dark:bg-amber-500"
          : done
          ? "bg-emerald-500"
          : active
          ? "bg-blue-500 ring-2 ring-blue-200 dark:ring-blue-900"
          : "bg-slate-200 dark:bg-slate-700";
        const lineColor = done ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700";
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0" title={s.label}>
              <div className={`h-2 w-2 rounded-full ${dotColor} transition-colors`} />
              <span className={`text-[8px] mt-0.5 leading-none hidden sm:block truncate max-w-[36px] ${done || active ? "text-foreground/60" : "text-muted-foreground/40"}`}>
                {s.label}
              </span>
            </div>
            {i < LIFECYCLE_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-0.5 rounded-full ${lineColor} transition-colors`} />
            )}
          </div>
        );
      })}
      {isLost && (
        <span className="ml-2 text-[10px] text-red-500 font-medium shrink-0">Lost</span>
      )}
      {isStalled && !isLost && (
        <span className="ml-2 text-[10px] text-amber-500 font-medium shrink-0">Stalled</span>
      )}
    </div>
  );
}

// ─── Intel Panel (expanded view) ─────────────────────────────────────────────
const PIPELINE_STAGE_LABELS: Record<string, { label: string; color: string }> = {
  new_lead:   { label: "New Lead",    color: "text-blue-600 dark:text-blue-400" },
  engaged:    { label: "Engaged",     color: "text-emerald-600 dark:text-emerald-400" },
  scheduling: { label: "Scheduling",  color: "text-indigo-600 dark:text-indigo-400" },
  booked:     { label: "Booked",      color: "text-teal-600 dark:text-teal-400" },
  converted:  { label: "Converted",   color: "text-emerald-700 dark:text-emerald-300" },
  stalled:    { label: "Stalled",     color: "text-amber-600 dark:text-amber-400" },
  lost:       { label: "Lost",        color: "text-red-600 dark:text-red-400" },
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  sent:           { label: "Outreach Sent",   color: "text-blue-600 dark:text-blue-400" },
  replied:        { label: "Replied",          color: "text-emerald-600 dark:text-emerald-400" },
  meeting_booked: { label: "Meeting Booked",  color: "text-teal-600 dark:text-teal-400" },
  booked_session: { label: "Session Booked",  color: "text-indigo-600 dark:text-indigo-400" },
  converted:      { label: "Converted",        color: "text-emerald-700 dark:text-emerald-300" },
  lost:           { label: "Lost",             color: "text-red-600 dark:text-red-400" },
  ignored:        { label: "No Reply",         color: "text-slate-500" },
  bounced:        { label: "Bounced",          color: "text-red-500" },
};

function IntelPanel({ intel }: { intel: EnrichedIntel }) {
  const stageCfg = intel.pipelineStage ? (PIPELINE_STAGE_LABELS[intel.pipelineStage] ?? PIPELINE_STAGE_LABELS.new_lead) : null;
  const outcomeCfg = intel.outcome?.outcomeStatus ? (OUTCOME_LABELS[intel.outcome.outcomeStatus] ?? null) : null;
  const transitions = (intel.stageTransitions || []).slice(-3).reverse();
  const hasDraft = !!intel.gmailDraftActionId;

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-2.5 space-y-2" data-testid="intel-panel">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Brain className="h-3 w-3 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
          Revenue Intelligence
        </p>
        <div className="flex items-center gap-2 ml-auto">
          {stageCfg && (
            <span className={`text-[10px] font-semibold ${stageCfg.color}`}>
              Pipeline: {stageCfg.label}
            </span>
          )}
          {outcomeCfg && (
            <span className={`text-[10px] font-medium ${outcomeCfg.color} flex items-center gap-0.5`}>
              <MessageSquare className="h-2.5 w-2.5" />
              {outcomeCfg.label}
            </span>
          )}
        </div>
      </div>

      {/* AI Summary */}
      {intel.aiSummary && (
        <p className="text-[11px] text-blue-800 dark:text-blue-200 leading-relaxed">{intel.aiSummary}</p>
      )}

      {/* Suggested next action */}
      {intel.suggestedNextAction && (
        <div className="flex items-start gap-1.5 rounded bg-white/60 dark:bg-slate-900/40 border border-blue-100 dark:border-blue-900 px-2 py-1.5">
          <Zap className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
              Suggested: {intel.suggestedNextAction.replace(/_/g, " ")}
            </p>
            {intel.suggestedNextActionReason && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{intel.suggestedNextActionReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Outcome + draft signals */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {intel.outcome?.repliedAt && (
          <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-2.5 w-2.5" />Replied {timeAgo(intel.outcome.repliedAt)}
          </span>
        )}
        {intel.outcome?.sentAt && !intel.outcome?.repliedAt && (
          <span className="flex items-center gap-0.5">
            <Send className="h-2.5 w-2.5" />Outreach sent {timeAgo(intel.outcome.sentAt)}
          </span>
        )}
        {intel.nextFollowUpAt && (
          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
            <Clock className="h-2.5 w-2.5" />Next follow-up {timeAgo(intel.nextFollowUpAt)}
          </span>
        )}
        {hasDraft && (
          <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
            <FileText className="h-2.5 w-2.5" />Draft queued
          </span>
        )}
        {(intel.leadScore || 0) > 0 && (
          <span className="flex items-center gap-0.5">
            <Star className="h-2.5 w-2.5" />AI score: {intel.leadScore}/100
          </span>
        )}
      </div>

      {/* Tags */}
      {intel.tags && intel.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intel.tags.slice(0, 6).map((t, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-medium">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Stage transition history */}
      {transitions.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60 flex items-center gap-1">
            <History className="h-2.5 w-2.5" /> Recent Stage History
          </p>
          {transitions.map((t, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/60">{t.fromStage?.replace(/_/g, " ") ?? "?"}</span>
              <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
              <span className="font-semibold text-foreground/80">{t.toStage?.replace(/_/g, " ") ?? "?"}</span>
              {t.reason && <span className="truncate text-muted-foreground/60">— {t.reason}</span>}
              {t.timestamp && <span className="ml-auto shrink-0">{timeAgo(t.timestamp)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Revenue Ops Panel ────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  new_lead:   "bg-blue-500",
  engaged:    "bg-emerald-500",
  scheduling: "bg-indigo-500",
  booked:     "bg-teal-500",
  converted:  "bg-emerald-600",
  stalled:    "bg-amber-500",
  lost:       "bg-red-400",
};

function RevenueOpsPanel({ data }: { data: RevenueOpsData }) {
  const [collapsed, setCollapsed] = useState(false);
  const totalInFunnel = data.stageDistribution.filter((s) => !["converted", "lost"].includes(s.stage)).reduce((a, b) => a + b.count, 0);
  const maxCount = Math.max(...data.stageDistribution.map((s) => s.count), 1);

  const fmtDollars = (cents: number) =>
    cents >= 100000 ? `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}` :
    cents > 0 ? `$${Math.round(cents / 100).toLocaleString()}` : "$0";

  return (
    <Card className="border-slate-200 dark:border-slate-700" data-testid="revenue-ops-panel">
      <div
        className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none hover:bg-muted/20 transition-colors rounded-lg"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-xs font-semibold text-foreground/80">Revenue Operations</span>
          {data.bottleneckStage && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
              <AlertTriangle className="h-2.5 w-2.5" />
              Bottleneck: {data.bottleneckStage.replace(/_/g, " ")}
            </span>
          )}
          {(data.pipelineValueCents || 0) > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {fmtDollars(data.pipelineValueCents)} pipeline value
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">{totalInFunnel} active leads</span>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-4 border-t">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
            {/* Pipeline funnel */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <GitBranch className="h-2.5 w-2.5" /> Pipeline Stages
              </p>
              <div className="space-y-1.5">
                {data.stageDistribution.filter((s) => s.count > 0 || !["stalled", "lost"].includes(s.stage)).map((s) => (
                  <div key={s.stage} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={`font-medium ${s.stage === data.bottleneckStage ? "text-amber-600 dark:text-amber-400" : "text-foreground/70"}`}>
                        {s.stage.replace(/_/g, " ")}
                        {s.stage === data.bottleneckStage && " ⚠"}
                      </span>
                      <span className="font-bold">{s.count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${STAGE_COLORS[s.stage] ?? "bg-slate-400"} transition-all`}
                        style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Outreach metrics */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Send className="h-2.5 w-2.5" /> Outreach Performance
              </p>
              {data.outreachMetrics.totalSent === 0 ? (
                <p className="text-[11px] text-muted-foreground/60">No outreach tracked yet</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-muted/30 border p-2 text-center">
                      <p className="text-base font-bold">{data.outreachMetrics.totalSent}</p>
                      <p className="text-[10px] text-muted-foreground">Outreached</p>
                    </div>
                    <div className={`rounded-md border p-2 text-center ${data.outreachMetrics.replyRate >= 20 ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-muted/30"}`}>
                      <p className={`text-base font-bold ${data.outreachMetrics.replyRate >= 20 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                        {data.outreachMetrics.replyRate}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">Reply Rate</p>
                    </div>
                    <div className="rounded-md bg-muted/30 border p-2 text-center">
                      <p className="text-base font-bold">{data.outreachMetrics.totalBooked}</p>
                      <p className="text-[10px] text-muted-foreground">Booked</p>
                    </div>
                    <div className={`rounded-md border p-2 text-center ${data.outreachMetrics.bookingRate >= 10 ? "bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800" : "bg-muted/30"}`}>
                      <p className={`text-base font-bold ${data.outreachMetrics.bookingRate >= 10 ? "text-teal-700 dark:text-teal-400" : ""}`}>
                        {data.outreachMetrics.bookingRate}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">Book Rate</p>
                    </div>
                  </div>
                  {data.outreachMetrics.avgDaysToReply !== null && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      Avg {data.outreachMetrics.avgDaysToReply}d to reply
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Source quality */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <PieChart className="h-2.5 w-2.5" /> Source Conversion
              </p>
              {data.sourceConversion.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60">No attribution data yet</p>
              ) : (
                <div className="space-y-1.5">
                  {data.sourceConversion.map((s) => (
                    <div key={s.source} className="flex items-center gap-2 text-[10px]">
                      <span className="truncate flex-1 font-medium text-foreground/70" title={s.source}>{s.source}</span>
                      <span className="text-muted-foreground">{s.total} leads</span>
                      <span className={`font-semibold min-w-[30px] text-right ${s.rate >= 20 ? "text-emerald-600 dark:text-emerald-400" : s.rate > 0 ? "text-foreground/70" : "text-muted-foreground/40"}`}>
                        {s.rate}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Athlete Lead Card ───────────────────────────────────────────────────────
function AthleteLeadCard({
  lead,
  intel,
  onUpdate,
  onDelete,
  onEdit,
  onEmail,
  onSchedule,
  onConvert,
}: {
  lead: LeadCaptureSubmission;
  intel?: EnrichedIntel | null;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onEdit: (lead: LeadCaptureSubmission) => void;
  onEmail: (lead: LeadCaptureSubmission) => void;
  onSchedule: (lead: LeadCaptureSubmission) => void;
  onConvert: (lead: LeadCaptureSubmission) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = getStatusCfg(lead.bookingStatus);
  const commitmentColor = COMMITMENT_COLORS[lead.commitmentLevel || ""] || COMMITMENT_COLORS.low;
  const urgency = getUrgency(lead);
  const urgencyCfg = URGENCY_CONFIG[urgency];
  const days = daysAgo(lead.createdAt?.toString());
  const isContacted = !!(lead as any).contactedAt || (lead as any).adminEmailStatus === "sent";
  const intelData = intel ?? null;

  return (
    <Card className={`p-4 space-y-3 ${urgencyCfg.cardBorderClass}`} data-testid={`card-athlete-lead-${lead.id}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate" data-testid={`text-athlete-name-${lead.id}`}>
              {lead.athleteName}
            </h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusCfg.className}`}
              data-testid={`badge-athlete-status-${lead.id}`}>
              {statusCfg.label}
            </span>
            <QualificationBadge score={lead.aiQualificationScore} />
            <UrgencyBadge urgency={urgency} />
            <DraftReadyBadge lead={lead} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {lead.parentName && (
              <p className="text-xs text-muted-foreground">
                <span className="text-muted-foreground/60">Parent:</span> {lead.parentName}
                {(lead as any).parentEmail && (
                  <span className="ml-1 font-mono text-muted-foreground/60">· {(lead as any).parentEmail}</span>
                )}
              </p>
            )}
            {lead.sport && <span className="text-xs text-muted-foreground">· {lead.sport}</span>}
            {lead.age && <span className="text-xs text-muted-foreground">· Age {lead.age}</span>}
            {lead.school && <span className="text-xs text-muted-foreground">· {lead.school}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground" data-testid={`text-time-${lead.id}`}>
            {timeAgo(lead.createdAt?.toString())}
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(lead)} data-testid={`button-edit-athlete-${lead.id}`}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded((e) => !e)} data-testid={`button-expand-athlete-${lead.id}`}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Intelligence signals row */}
      <div className="flex items-center gap-3 flex-wrap">
        <SourceBadge source={lead.utmSource} campaign={lead.utmCampaign} />
        {lead.commitmentLevel && (
          <span className={`text-xs font-medium capitalize ${commitmentColor}`} data-testid={`text-commitment-${lead.id}`}>
            {lead.commitmentLevel} commitment
          </span>
        )}
        {lead.experienceLevel && (
          <span className="text-xs text-muted-foreground capitalize">{lead.experienceLevel.replace(/_/g, " ")} experience</span>
        )}
        {/* Time signals */}
        {urgency === "cold" && (
          <span className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
            <Clock className="h-3 w-3" />{days}d without contact — cold risk
          </span>
        )}
        {urgency === "warn" && !isContacted && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
            <Clock className="h-3 w-3" />{days}d since submission — follow up
          </span>
        )}
        {urgency === "hot" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
            <Flame className="h-3 w-3" />High-score lead — contact now
          </span>
        )}
        {isContacted && urgency !== "inactive" && urgency !== "cold" && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-emerald-500" />Contacted
          </span>
        )}
      </div>

      {/* Lifecycle progress bar */}
      <div className="pt-0.5">
        <LifecycleBar lead={lead} intel={intelData} />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-indigo-300 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
          onClick={() => onSchedule(lead)}
          disabled={lead.bookingStatus === "enrolled"}
          data-testid={`button-schedule-eval-${lead.id}`}
        >
          <Calendar className="h-3 w-3 mr-1" />
          {lead.bookingStatus === "evaluation_booked" ? "Reschedule Eval" : "Schedule Eval"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          onClick={() => onConvert(lead)}
          disabled={lead.bookingStatus === "enrolled"}
          data-testid={`button-convert-athlete-${lead.id}`}
        >
          <UserCheck className="h-3 w-3 mr-1" />
          {lead.bookingStatus === "enrolled" ? "Enrolled ✓" : "Convert to Athlete"}
        </Button>
        {lead.email && (
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 text-xs ${(lead as any).aiNextAction ? "text-blue-600 dark:text-blue-400" : ""}`}
            onClick={() => onEmail(lead)}
            data-testid={`button-email-athlete-${lead.id}`}
          >
            <Mail className="h-3 w-3 mr-1" />
            {(lead as any).aiNextAction ? "Draft Ready" : "Email"}
          </Button>
        )}
        {lead.phone && (
          <a href={`tel:${lead.phone}`} data-testid={`link-phone-athlete-${lead.id}`}>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Phone className="h-3 w-3 mr-1" /> Call
            </Button>
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => onUpdate(lead.id, { bookingStatus: "archived" })}
          disabled={lead.bookingStatus === "archived"}
          data-testid={`button-archive-athlete-${lead.id}`}
        >
          Archive
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 ml-auto"
          onClick={() => { if (window.confirm(`Delete lead for "${lead.athleteName}"?`)) onDelete(lead.id); }}
          data-testid={`button-delete-athlete-${lead.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {lead.email && (
              <div className="col-span-2 flex items-center gap-1.5">
                <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="font-mono">{lead.email}</span>
              </div>
            )}
            {lead.phone && (
              <div className="col-span-2 flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{lead.phone}</span>
              </div>
            )}
            {lead.grade && <div><span className="text-muted-foreground">Grade:</span> {lead.grade}</div>}
            {lead.position && <div><span className="text-muted-foreground">Position:</span> {lead.position}</div>}
            {lead.currentTrainingStatus && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Training status:</span>{" "}
                <span className="capitalize">{lead.currentTrainingStatus.replace(/_/g, " ")}</span>
              </div>
            )}
            {(lead as any).contactedAt && (
              <div className="col-span-2 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-3 w-3 shrink-0" />
                Contacted {formatDate((lead as any).contactedAt?.toString())}
              </div>
            )}
            {(lead as any).evaluationBookedAt && (
              <div className="col-span-2 flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                <CalendarDays className="h-3 w-3 shrink-0" />
                Eval: {formatDate((lead as any).evaluationBookedAt?.toString())}
              </div>
            )}
            {lead.createdAt && (
              <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                Submitted {formatDate(lead.createdAt?.toString())}
              </div>
            )}
          </div>

          {lead.goals && (lead.goals as string[]).length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Goals</p>
              <div className="flex flex-wrap gap-1">
                {(lead.goals as string[]).map((g, i) => (
                  <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {lead.aiQualificationReason && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-0.5 flex items-center gap-1">
                <Zap className="h-2.5 w-2.5" /> AI Intelligence
              </p>
              <p className="text-[11px] text-blue-800 dark:text-blue-300">{lead.aiQualificationReason}</p>
            </div>
          )}

          {(lead as any).aiNextAction && (
            <div className="rounded-md bg-muted/30 border p-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Recommended Next Action</p>
              <p className="text-[11px]">{(lead as any).aiNextAction}</p>
            </div>
          )}

          {(lead.utmSource || lead.utmCampaign || lead.utmMedium) && (
            <div className="rounded-md bg-muted/30 border p-2 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Campaign Attribution</p>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                {lead.utmSource && <div><span className="text-muted-foreground">Source:</span> {lead.utmSource}</div>}
                {lead.utmMedium && <div><span className="text-muted-foreground">Medium:</span> {lead.utmMedium}</div>}
                {lead.utmCampaign && <div className="col-span-2"><span className="text-muted-foreground">Campaign:</span> {lead.utmCampaign}</div>}
                {lead.utmContent && <div className="col-span-2"><span className="text-muted-foreground">Content:</span> {lead.utmContent}</div>}
              </div>
            </div>
          )}

          {/* Revenue Intelligence Panel — surfaces enriched intel profile data */}
          {intelData && (intelData.aiSummary || intelData.pipelineStage || intelData.suggestedNextAction || intelData.outcome || (intelData.stageTransitions && intelData.stageTransitions.length > 0)) && (
            <IntelPanel intel={intelData} />
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────
function EditLeadModal({
  lead,
  onClose,
  onSave,
  isSaving,
}: {
  lead: LeadCaptureSubmission;
  onClose: () => void;
  onSave: (id: string, data: Record<string, any>) => void;
  isSaving: boolean;
}) {
  const [notes, setNotes] = useState(lead.notes || "");
  const [bookingStatus, setBookingStatus] = useState(lead.bookingStatus || "not_booked");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit — {lead.athleteName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Application Status</p>
            <Select value={bookingStatus} onValueChange={setBookingStatus}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_booked">New</SelectItem>
                <SelectItem value="evaluation_booked">Eval Scheduled</SelectItem>
                <SelectItem value="attended">Attended</SelectItem>
                <SelectItem value="enrolled">Enrolled</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Notes</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm min-h-[80px] resize-none"
              placeholder="Add internal notes..."
              data-testid="textarea-edit-notes"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">Cancel</Button>
            <Button onClick={() => onSave(lead.id, { notes, bookingStatus })} disabled={isSaving} data-testid="button-save-edit">
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Intelligence Command Strip ───────────────────────────────────────────────
function IntelligenceStrip({
  stats,
  activeFilter,
  onFilterChange,
}: {
  stats: any;
  activeFilter: string;
  onFilterChange: (f: string) => void;
}) {
  const pills = [
    { key: "hot",   label: "Hot Leads",       count: stats?.hotLeads || 0,      icon: Flame,          colorActive: "bg-emerald-600 text-white border-emerald-600", colorInactive: "text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" },
    { key: "warn",  label: "Needs Follow-up", count: stats?.needsFollowUp || 0,  icon: AlertTriangle,   colorActive: "bg-amber-500 text-white border-amber-500",     colorInactive: "text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30" },
    { key: "cold",  label: "Cold Risk",        count: stats?.coldRisk || 0,       icon: Snowflake,      colorActive: "bg-red-600 text-white border-red-600",         colorInactive: "text-red-700 dark:text-red-400 border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/30" },
    { key: "eval",  label: "Eval Scheduled",   count: stats?.evalScheduled || 0,  icon: CalendarDays,   colorActive: "bg-indigo-600 text-white border-indigo-600",   colorInactive: "text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30" },
  ];

  const hasAlerts = (stats?.coldRisk || 0) + (stats?.needsFollowUp || 0) > 0;

  return (
    <Card className={`p-3 ${hasAlerts ? "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
          <Activity className="h-3.5 w-3.5" />
          Pipeline Intelligence
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-1">
          {pills.map(({ key, label, count, icon: Icon, colorActive, colorInactive }) => (
            <button
              key={key}
              onClick={() => onFilterChange(activeFilter === key ? "all" : key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                activeFilter === key ? colorActive : colorInactive
              }`}
              data-testid={`filter-urgency-${key}`}
            >
              <Icon className="h-3 w-3" />
              {label}
              <span className={`ml-0.5 px-1 py-0.5 rounded text-[10px] font-bold ${activeFilter === key ? "bg-white/20" : "bg-current/10"}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
        {activeFilter !== "all" && (
          <button
            onClick={() => onFilterChange("all")}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="button-clear-urgency-filter"
          >
            <XIcon className="h-3 w-3" /> Clear filter
          </button>
        )}
        {hasAlerts && activeFilter === "all" && (
          <p className="ml-auto text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            {(stats?.coldRisk || 0) + (stats?.needsFollowUp || 0)} leads need attention
          </p>
        )}
      </div>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AdminAthleteLeadsPage() {
  const { toast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [filterSport, setFilterSport] = useState("all");
  const [sortBy, setSortBy] = useState<"urgency" | "newest" | "score" | "waiting">("urgency");
  const [editLead, setEditLead] = useState<LeadCaptureSubmission | null>(null);
  const [emailLead, setEmailLead] = useState<LeadCaptureSubmission | null>(null);
  const [scheduleLead, setScheduleLead] = useState<LeadCaptureSubmission | null>(null);
  const [convertLead, setConvertLead] = useState<LeadCaptureSubmission | null>(null);

  const { data: leads, isLoading } = useQuery<LeadCaptureSubmission[]>({
    queryKey: ["/api/admin/athlete-leads"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    total: number;
    evalScheduled: number;
    converted: number;
    enrolled: number;
    conversionRate: number;
    projectedRevenue: number;
    sourceAttribution: Record<string, number>;
    newToday: number;
    hotLeads: number;
    needsFollowUp: number;
    coldRisk: number;
    lostLeads: number;
  }>({
    queryKey: ["/api/admin/athlete-leads/stats"],
  });

  const { data: enrichedData } = useQuery<{ enriched: Record<string, EnrichedIntel> }>({
    queryKey: ["/api/admin/athlete-leads/enriched"],
    staleTime: 60_000,
  });

  const { data: revenueOps } = useQuery<RevenueOpsData>({
    queryKey: ["/api/admin/athlete-leads/revenue-ops"],
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/admin/athlete-leads/${id}`, data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Update failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads/stats"] });
      setEditLead(null);
      toast({ title: "Lead updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/athlete-leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads/stats"] });
      toast({ title: "Lead deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const sports = useMemo(() => [...new Set((leads || []).map((l) => l.sport).filter(Boolean))] as string[], [leads]);

  const filtered = useMemo(() => {
    let list = (leads || []).filter((l) => {
      if (filterStatus !== "all" && l.bookingStatus !== filterStatus) return false;
      if (filterSport !== "all" && l.sport !== filterSport) return false;
      if (filterUrgency !== "all" && getUrgency(l) !== filterUrgency) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (
          !l.athleteName.toLowerCase().includes(q) &&
          !(l.parentName || "").toLowerCase().includes(q) &&
          !(l.sport || "").toLowerCase().includes(q) &&
          !(l.school || "").toLowerCase().includes(q) &&
          !(l.email || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "urgency") {
        const ua = URGENCY_SORT_ORDER[getUrgency(a)];
        const ub = URGENCY_SORT_ORDER[getUrgency(b)];
        if (ua !== ub) return ua - ub;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
      if (sortBy === "newest") {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
      if (sortBy === "score") {
        return (b.aiQualificationScore || 0) - (a.aiQualificationScore || 0);
      }
      if (sortBy === "waiting") {
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      }
      return 0;
    });

    return list;
  }, [leads, filterStatus, filterSport, filterUrgency, searchText, sortBy]);

  const topSources = useMemo(() =>
    stats?.sourceAttribution
      ? Object.entries(stats.sourceAttribution).sort(([, a], [, b]) => b - a).slice(0, 4)
      : [],
    [stats]
  );

  return (
    <div className="space-y-5">
      {/* ── System navigation banner ── */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">CRM System:</span>
          </div>
          <Link href="/admin/athlete-leads">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-orange-500 text-white shadow-sm" data-testid="nav-athlete-leads-active">
              <Users className="h-3.5 w-3.5" />Athlete Intake Pipeline<span className="ml-1 opacity-80">B2C</span>
            </button>
          </Link>
          <Link href="/admin/team-training-leads">
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-colors" data-testid="nav-b2b-partnerships">
              <Building2 className="h-3.5 w-3.5" />Team Partnerships<span className="ml-1 opacity-60">B2B</span>
            </button>
          </Link>
          <p className="text-[11px] text-muted-foreground ml-auto hidden sm:block">
            Athlete applications · parent inquiries · onboarding pipeline
          </p>
        </div>
      </div>

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Athlete Intake Pipeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Revenue intelligence and athlete acquisition engine — conversions, follow-ups, and onboarding.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/lead-pipeline">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="link-pipeline-view">
              <BarChart2 className="h-3.5 w-3.5" /> Pipeline View
            </Button>
          </Link>
          <Link href="/admin/ai-approvals">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="link-ai-approvals">
              <FileText className="h-3.5 w-3.5" /> AI Approvals
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {statsLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Card className="p-3 text-center">
              <ClipboardList className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-total">{stats?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Total</p>
              {(stats?.newToday || 0) > 0 && (
                <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">+{stats?.newToday} today</p>
              )}
            </Card>
            <Card className="p-3 text-center">
              <Flame className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-stat-hot">{stats?.hotLeads || 0}</p>
              <p className="text-xs text-muted-foreground">Hot Leads</p>
            </Card>
            <Card className={`p-3 text-center ${(stats?.needsFollowUp || 0) > 0 ? "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10" : ""}`}>
              <AlertTriangle className={`h-4 w-4 mx-auto mb-1 ${(stats?.needsFollowUp || 0) > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
              <p className={`text-xl font-bold ${(stats?.needsFollowUp || 0) > 0 ? "text-amber-600 dark:text-amber-400" : ""}`} data-testid="text-stat-followup">{stats?.needsFollowUp || 0}</p>
              <p className="text-xs text-muted-foreground">Needs Follow-up</p>
            </Card>
            <Card className={`p-3 text-center ${(stats?.coldRisk || 0) > 0 ? "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10" : ""}`}>
              <Snowflake className={`h-4 w-4 mx-auto mb-1 ${(stats?.coldRisk || 0) > 0 ? "text-red-500" : "text-muted-foreground"}`} />
              <p className={`text-xl font-bold ${(stats?.coldRisk || 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-stat-cold">{stats?.coldRisk || 0}</p>
              <p className="text-xs text-muted-foreground">Cold Risk</p>
            </Card>
            <Card className="p-3 text-center">
              <Calendar className="h-4 w-4 mx-auto text-indigo-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-eval">{stats?.evalScheduled || 0}</p>
              <p className="text-xs text-muted-foreground">Eval Scheduled</p>
            </Card>
            <Card className="p-3 text-center">
              <UserCheck className="h-4 w-4 mx-auto text-teal-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-enrolled">{stats?.enrolled || 0}</p>
              <p className="text-xs text-muted-foreground">Enrolled</p>
              {(stats?.total || 0) > 0 && (
                <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium mt-0.5">{stats?.conversionRate || 0}% rate</p>
              )}
            </Card>
            <Card className="p-3 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-1 mb-1.5">
                <BarChart2 className="h-3.5 w-3.5 text-purple-500" />
                <p className="text-xs font-medium">Sources</p>
              </div>
              <div className="space-y-0.5">
                {topSources.length > 0 ? topSources.map(([src, count]) => (
                  <div key={src} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[80px]" title={src}>{src}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground">No data</p>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* ── Intelligence command strip ── */}
      {!statsLoading && (
        <IntelligenceStrip
          stats={stats}
          activeFilter={filterUrgency}
          onFilterChange={(f) => {
            setFilterUrgency(f);
            setFilterStatus("all");
          }}
        />
      )}

      {/* ── Revenue Operations panel ── */}
      {revenueOps && <RevenueOpsPanel data={revenueOps} />}

      {/* ── Filters + Sort ── */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search athletes, email, school…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="h-8 text-sm w-52"
            data-testid="input-search"
          />
          <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setFilterUrgency("all"); }}>
            <SelectTrigger className="h-8 text-xs w-40" data-testid="select-filter-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="not_booked">New</SelectItem>
              <SelectItem value="evaluation_booked">Eval Scheduled</SelectItem>
              <SelectItem value="attended">Attended</SelectItem>
              <SelectItem value="enrolled">Enrolled</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {sports.length > 0 && (
            <Select value={filterSport} onValueChange={setFilterSport}>
              <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-sport">
                <SelectValue placeholder="All Sports" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sports</SelectItem>
                {sports.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <SortAsc className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="h-8 text-xs w-36" data-testid="select-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgency">By Urgency</SelectItem>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="score">AI Score</SelectItem>
                <SelectItem value="waiting">Longest Waiting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{filtered.length} leads</span>
        </div>
      </Card>

      {/* ── Lead cards ── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">
            {filterUrgency !== "all"
              ? `No leads match the "${URGENCY_CONFIG[filterUrgency as UrgencyLevel]?.label || filterUrgency}" filter`
              : "No leads match your filters"}
          </p>
          <p className="text-xs mt-1">
            {filterUrgency !== "all"
              ? "Great — no action needed in this category."
              : "Try adjusting the search or status filter."}
          </p>
          {(filterUrgency !== "all" || filterStatus !== "all" || searchText) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs"
              onClick={() => { setFilterUrgency("all"); setFilterStatus("all"); setSearchText(""); }}
              data-testid="button-clear-all-filters"
            >
              Clear all filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((lead) => (
            <AthleteLeadCard
              key={lead.id}
              lead={lead}
              intel={enrichedData?.enriched?.[lead.id] ?? null}
              onUpdate={(id, data) => updateMutation.mutate({ id, data })}
              onDelete={(id) => deleteMutation.mutate(id)}
              onEdit={setEditLead}
              onEmail={setEmailLead}
              onSchedule={setScheduleLead}
              onConvert={setConvertLead}
            />
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {convertLead && (
        <ConvertAthleteModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
          onConverted={() => setConvertLead(null)}
        />
      )}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSave={(id, data) => updateMutation.mutate({ id, data })}
          isSaving={updateMutation.isPending}
        />
      )}
      {emailLead && (
        <EmailDraftModal
          lead={emailLead}
          onClose={() => setEmailLead(null)}
        />
      )}
      {scheduleLead && (
        <ScheduleEvalModal
          lead={scheduleLead}
          onClose={() => setScheduleLead(null)}
          onBooked={() => {
            updateMutation.mutate({
              id: scheduleLead.id,
              data: { bookingStatus: "evaluation_booked", evaluationBookedAt: new Date().toISOString() },
            });
          }}
        />
      )}
    </div>
  );
}
