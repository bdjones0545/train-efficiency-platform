import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson, parseApiResponse} from "@/lib/api-helpers";
import {
  Flame, Thermometer, Snowflake, Brain, Zap, Mail, Phone, MapPin,
  Clock, ChevronRight, CheckCircle2, XCircle, RefreshCw, Target,
  TrendingUp, BarChart3, FlaskConical, Eye, ArrowRight, User,
  Megaphone, Tag, Calendar, AlertCircle, Loader2, Play, ShieldOff,
  Ban, History, Timer, ChevronDown, Activity, GitBranch, Bell,
  AlertTriangle, CalendarCheck, Search, Send, RotateCcw, BookOpen,
  MapPinIcon, UserCheck, Hourglass,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StageTransition {
  fromStage: string;
  toStage: string;
  reason: string;
  source: string;
  confidence: number;
  timestamp: string;
}

interface ProcessingTimelineEntry {
  intake_received: string | null;
  scoring_completed: string | null;
  ai_summary_generated: string | null;
  outreach_draft_generated: string | null;
  profile_persisted: string | null;
  gmail_draft_queued: string | null;
  follow_up_scheduled: string | null;
  processing_completed: string | null;
  processing_duration_ms: number | null;
}

interface IntelligenceProfile {
  id: string;
  orgId: string;
  submissionId: string;
  pipelineStage: string;
  aiSummary: string | null;
  normalizedProfileJson: any;
  leadScore: number | null;
  temperature: string | null;
  urgency: string | null;
  suggestedNextAction: string | null;
  suggestedNextActionReason: string | null;
  campaignSource: string | null;
  campaignMedium: string | null;
  campaignName: string | null;
  tags: string[];
  gmailDraftActionId: string | null;
  initialDraftSubject: string | null;
  initialDraftBody: string | null;
  followUpStage: string | null;
  nextFollowUpAt: string | null;
  lastInteractionAt: string | null;
  intakeProcessedAt: string | null;
  processingLog: any[];
  processingDurationMs: number | null;
  unsubscribed: boolean;
  suppressed: boolean;
  suppressionReason: string | null;
  suppressedAt: string | null;
  stageTransitions: StageTransition[];
  createdAt: string;
  updatedAt: string | null;
}

interface PipelineRow {
  intelligence: IntelligenceProfile;
  submission: {
    id: string;
    athleteName: string;
    email: string;
    phone: string | null;
    sport: string | null;
    school: string | null;
    bookingStatus: string | null;
    createdAt: string | null;
  } | null;
}

interface GmailDraftAction {
  id: string;
  actionType: string;
  recipientEmail: string;
  subject: string | null;
  bodyPreview: string | null;
  riskLevel: string;
  approvalRequired: boolean;
  status: string;
  result: any;
  createdAt: string;
}

interface OfferedSlot {
  date: string;
  startTime: string;
  endTime: string;
  displayDate: string;
  displayTime: string;
  location: string;
  locationAddress: string;
  coachId: string;
  coachName: string;
  durationMin: number;
  confidenceScore: number;
  reasonSelected: string;
}

interface SchedulingContext {
  id: string;
  orgId: string;
  leadId: string;
  submissionId: string;
  gmailThreadId: string | null;
  offeredSlots: OfferedSlot[];
  selectedSlot: OfferedSlot | null;
  status: string;
  expiresAt: string | null;
  athleticBookingId: string | null;
  lastReplyMessageId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StatRow {
  pipelineStage: string;
  temperature: string | null;
  cnt: number | string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES = [
  { key: "new_lead",    label: "New Lead",    color: "bg-blue-500/10 border-blue-500/30 text-blue-400" },
  { key: "engaged",     label: "Engaged",     color: "bg-violet-500/10 border-violet-500/30 text-violet-400" },
  { key: "scheduling",  label: "Scheduling",  color: "bg-amber-500/10 border-amber-500/30 text-amber-400" },
  { key: "booked",      label: "Booked",      color: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" },
  { key: "converted",   label: "Converted",   color: "bg-green-500/10 border-green-500/30 text-green-400" },
  { key: "stalled",     label: "Stalled",     color: "bg-slate-500/10 border-slate-500/30 text-slate-400" },
  { key: "lost",        label: "Lost",        color: "bg-red-500/10 border-red-500/30 text-red-400" },
];

const NEXT_ACTION_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  call_now:                         { label: "Call Now",                  icon: Phone,        color: "text-red-400" },
  send_educational_followup:        { label: "Send Follow-Up",            icon: Mail,         color: "text-blue-400" },
  schedule_consultation:            { label: "Schedule Consultation",     icon: Calendar,     color: "text-violet-400" },
  send_urgency_reminder:            { label: "Send Urgency Reminder",     icon: AlertCircle,  color: "text-amber-400" },
  wait_24h:                         { label: "Wait 24h",                  icon: Clock,        color: "text-slate-400" },
  re_engage_7d:                     { label: "Re-engage in 7d",           icon: RefreshCw,    color: "text-slate-400" },
  mark_low_priority:                { label: "Mark Low Priority",         icon: Target,       color: "text-slate-500" },
  suggest_available_slots:          { label: "Suggest Available Slots",   icon: CalendarCheck, color: "text-cyan-400" },
  wait_for_time_confirmation:       { label: "Awaiting Confirmation",     icon: Hourglass,    color: "text-amber-400" },
  send_confirmation_and_prepare_session: { label: "Send Confirmation",   icon: CheckCircle2, color: "text-emerald-400" },
  follow_up_to_confirm_time:        { label: "Follow Up on Time",         icon: Bell,         color: "text-orange-400" },
};

const FOLLOW_UP_STAGE_LABELS: Record<string, { label: string; color: string }> = {
  none:         { label: "No Follow-up",   color: "text-zinc-500" },
  pending_24h:  { label: "24h Due",        color: "text-amber-400" },
  pending_72h:  { label: "72h Due",        color: "text-orange-400" },
  pending_7d:   { label: "7-day Due",      color: "text-red-400" },
  exhausted:    { label: "Exhausted",      color: "text-zinc-500" },
};

const SOURCE_LABELS: Record<string, string> = {
  intake_pipeline:      "Intake Pipeline",
  gmail_reply_classifier: "Reply AI",
  recovery_cron:        "Recovery Cron",
  manual_admin:         "Admin",
  scheduling_system:    "Scheduler",
  payment_system:       "Payments",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TemperatureBadge({ temp }: { temp: string | null | undefined }) {
  if (!temp) return null;
  const cfg =
    temp === "hot"  ? { icon: Flame,       label: "Hot",  cls: "bg-red-500/15 text-red-400 border-red-500/30" } :
    temp === "warm" ? { icon: Thermometer, label: "Warm", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" } :
                      { icon: Snowflake,   label: "Cold", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
  const Icon = cfg.icon;
  return (
    <span data-testid={`badge-temperature-${temp}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.cls}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const color =
    score >= 70 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    score >= 45 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                  "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <span data-testid="badge-lead-score" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${color}`}>
      <BarChart3 className="h-3 w-3" />
      {score}/100
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string | null | undefined }) {
  if (!urgency) return null;
  const color =
    urgency === "high"   ? "bg-red-500/15 text-red-400 border-red-500/30" :
    urgency === "medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                           "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border capitalize ${color}`}>
      {urgency} urgency
    </span>
  );
}

function SuppressionBadge({ unsubscribed, suppressed }: { unsubscribed: boolean; suppressed: boolean }) {
  if (unsubscribed) return (
    <span data-testid="badge-unsubscribed" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-red-900/30 text-red-400 border-red-500/40">
      <Ban className="h-3 w-3" /> Unsubscribed
    </span>
  );
  if (suppressed) return (
    <span data-testid="badge-suppressed" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-zinc-700/60 text-zinc-400 border-zinc-600">
      <ShieldOff className="h-3 w-3" /> Suppressed
    </span>
  );
  return null;
}

function timeAgo(dt: string | null | undefined): string {
  if (!dt) return "—";
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeUntil(dt: string | null | undefined): string {
  if (!dt) return "—";
  const diff = new Date(dt).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

// ─── AI Summary Collapsible ───────────────────────────────────────────────────

function AiSummaryCollapsible({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  return (
    <div className="max-w-full overflow-hidden">
      <p className={`text-sm text-zinc-300 leading-relaxed whitespace-normal break-words overflow-hidden max-w-full ${!expanded && isLong ? "line-clamp-3" : ""}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 text-[11px] text-orange-400/80 hover:text-orange-400 underline"
        >
          {expanded ? "Show less" : "Show full summary"}
        </button>
      )}
    </div>
  );
}

// ─── Scheduling Context Panel ─────────────────────────────────────────────────

const SCHED_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  none:                 { label: "No context",         color: "text-zinc-500",   bg: "bg-zinc-700/40 border-zinc-600" },
  slots_offered:        { label: "Slots Offered",       color: "text-cyan-400",   bg: "bg-cyan-900/30 border-cyan-700/50" },
  awaiting_confirmation:{ label: "Awaiting Confirm",   color: "text-amber-400",  bg: "bg-amber-900/30 border-amber-700/50" },
  booked:               { label: "Booked",              color: "text-emerald-400",bg: "bg-emerald-900/30 border-emerald-700/50" },
  expired:              { label: "Expired",             color: "text-red-400",    bg: "bg-red-900/20 border-red-800/40" },
  cancelled:            { label: "Cancelled",           color: "text-zinc-500",   bg: "bg-zinc-800/40 border-zinc-700" },
};

function ConfidenceDot({ score }: { score: number }) {
  const cls = score >= 0.85 ? "bg-emerald-500" : score >= 0.70 ? "bg-amber-500" : "bg-zinc-500";
  return <span title={`${Math.round(score * 100)}% confidence`} className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />;
}

function SchedulingContextPanel({
  intel,
  onRefresh,
}: {
  intel: IntelligenceProfile;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [confirmReplyText, setConfirmReplyText] = useState("");
  const [showConfirmInput, setShowConfirmInput] = useState(false);
  const [showTestResult, setShowTestResult] = useState<any>(null);

  const { data: ctx, isLoading } = useQuery<SchedulingContext | null>({
    queryKey: ["/api/org/scheduling-agent/contexts", intel.submissionId],
    queryFn: () => fetchJson(`/api/org/scheduling-agent/contexts/${intel.submissionId}`),
  });

  const findSlotsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/org/scheduling-agent/find-slots", {
        submissionId: intel.submissionId,
        durationMin: 60,
      }).then(r => parseApiResponse<any>(r)),
    onSuccess: (data) => {
      toast({ title: `Found ${data.count} available slot${data.count !== 1 ? "s" : ""}` });
      queryClient.invalidateQueries({ queryKey: ["/api/org/scheduling-agent/contexts", intel.submissionId] });
    },
    onError: () => toast({ title: "Error finding slots", variant: "destructive" }),
  });

  const offerSlotsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/org/scheduling-agent/offer-slots", {
        submissionId: intel.submissionId,
        leadId: intel.id,
        gmailThreadId: ctx?.gmailThreadId || undefined,
        durationMin: 60,
      }).then(r => parseApiResponse<any>(r)),
    onSuccess: (data) => {
      toast({ title: "Slots offered", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/org/scheduling-agent/contexts", intel.submissionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      onRefresh();
    },
    onError: () => toast({ title: "Error offering slots", variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/org/scheduling-agent/confirm-booking", {
        submissionId: intel.submissionId,
        replyText: confirmReplyText,
        gmailThreadId: ctx?.gmailThreadId || undefined,
      }).then(r => parseApiResponse<any>(r)),
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Booking confirmed!", description: data.message });
      } else {
        toast({ title: "Review needed", description: data.message, variant: "destructive" });
      }
      setShowConfirmInput(false);
      setConfirmReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/org/scheduling-agent/contexts", intel.submissionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      onRefresh();
    },
    onError: () => toast({ title: "Error confirming booking", variant: "destructive" }),
  });

  const testFlowMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/scheduling-agent/test-flow", {}).then(r => parseApiResponse<any>(r)),
    onSuccess: (data) => {
      setShowTestResult(data);
      toast({ title: "Test flow complete", description: data.summary || (data.note ? "Note: " + data.note : "") });
    },
    onError: () => toast({ title: "Test flow error", variant: "destructive" }),
  });

  const statusCfg = SCHED_STATUS_LABELS[ctx?.status || "none"] || SCHED_STATUS_LABELS.none;
  const isExpired = ctx?.expiresAt && new Date(ctx.expiresAt).getTime() < Date.now() && ctx.status === "slots_offered";
  const offeredSlots = ctx?.offeredSlots || [];
  const selectedSlot = ctx?.selectedSlot;

  return (
    <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wide flex items-center gap-1.5">
          <CalendarCheck className="h-3.5 w-3.5" /> Scheduling Context
        </p>
        {ctx && (
          <span data-testid="badge-scheduling-status" className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusCfg.bg} ${statusCfg.color}`}>
            {statusCfg.label}
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-12 bg-zinc-700" />
      ) : !ctx ? (
        <p className="text-xs text-zinc-500 italic">No scheduling context yet. Use "Find Slots" to start.</p>
      ) : (
        <div className="space-y-3">
          {/* Expiry warning */}
          {isExpired && (
            <div className="rounded bg-red-950/40 border border-red-800/40 px-3 py-2 text-xs text-red-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              Offered slots expired — regenerate options
            </div>
          )}

          {/* Offered Slots */}
          {offeredSlots.length > 0 && !selectedSlot && (
            <div>
              <p className="text-[11px] text-zinc-500 font-medium mb-2 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Offered Options ({offeredSlots.length})
                {ctx.expiresAt && !isExpired && (
                  <span className="ml-auto text-zinc-600">expires {timeUntil(ctx.expiresAt)}</span>
                )}
              </p>
              <div className="space-y-1.5">
                {offeredSlots.map((slot, i) => (
                  <div key={i} data-testid={`slot-offered-${i}`} className="rounded bg-zinc-900/60 border border-zinc-700/60 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <ConfidenceDot score={slot.confidenceScore} />
                      <span className="text-zinc-200 font-medium">{slot.displayDate}</span>
                      <span className="text-zinc-400">{slot.displayTime}</span>
                      <span className="ml-auto text-zinc-500">{slot.durationMin}min</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500">
                      {slot.location && slot.location !== "TBD" && (
                        <span className="flex items-center gap-1"><MapPinIcon className="h-2.5 w-2.5" />{slot.location}</span>
                      )}
                      <span className="flex items-center gap-1"><UserCheck className="h-2.5 w-2.5" />{slot.coachName}</span>
                      <span className="ml-auto text-zinc-600 italic">{slot.reasonSelected}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected / Booked Slot */}
          {selectedSlot && (
            <div className="rounded bg-emerald-900/30 border border-emerald-700/40 px-3 py-2 text-xs space-y-1">
              <p className="text-emerald-400 font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Session Booked
              </p>
              <p className="text-zinc-200 font-medium">{selectedSlot.displayDate} at {selectedSlot.displayTime}</p>
              <div className="flex items-center gap-3 text-zinc-400">
                {selectedSlot.location !== "TBD" && (
                  <span className="flex items-center gap-1"><MapPinIcon className="h-2.5 w-2.5" />{selectedSlot.location}</span>
                )}
                <span className="flex items-center gap-1"><UserCheck className="h-2.5 w-2.5" />{selectedSlot.coachName}</span>
              </div>
              {ctx.athleticBookingId && (
                <p className="text-[11px] text-zinc-600">Booking ID: {ctx.athleticBookingId}</p>
              )}
            </div>
          )}

          {/* Notes */}
          {ctx.notes && (
            <p className="text-[11px] text-zinc-600 italic">{ctx.notes}</p>
          )}
        </div>
      )}

      {/* Confirm booking input */}
      {showConfirmInput && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">Paste the lead's reply to parse and confirm booking:</p>
          <Textarea
            data-testid="input-confirm-reply"
            value={confirmReplyText}
            onChange={e => setConfirmReplyText(e.target.value)}
            placeholder="e.g. Thursday at 4 works for me!"
            className="text-xs bg-zinc-900 border-zinc-600 text-zinc-200 h-20 resize-none"
          />
          <div className="flex gap-2">
            <Button
              data-testid="button-parse-confirm"
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!confirmReplyText.trim() || confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Parse &amp; Confirm
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-600 text-zinc-400" onClick={() => setShowConfirmInput(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Test result */}
      {showTestResult && (
        <div className="rounded bg-zinc-900/80 border border-zinc-700 p-3 text-[11px] text-zinc-400 space-y-1">
          <p className="text-xs font-semibold text-zinc-300 mb-1">Test Flow Result</p>
          {showTestResult.note && <p className="text-amber-400">{showTestResult.note}</p>}
          {showTestResult.slotsFound && (
            <p>Slots found: <span className="text-cyan-400">{showTestResult.slotsFound.count}</span></p>
          )}
          {showTestResult.selectionLogic && (
            <p>Best slot: <span className="text-zinc-300">{showTestResult.selectionLogic.topSlot?.displayDate} {showTestResult.selectionLogic.topSlot?.displayTime}</span></p>
          )}
          {showTestResult.confirmationParsing && (
            <div className="space-y-0.5 mt-1">
              {showTestResult.confirmationParsing.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={t.isConfirmation === t.expected ? "text-emerald-400" : "text-red-400"}>
                    {t.isConfirmation === t.expected ? "✓" : "✗"}
                  </span>
                  <span className="truncate">{t.reply}</span>
                  <span className="ml-auto text-zinc-600">{Math.round(t.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-zinc-600 mt-1" onClick={() => setShowTestResult(null)}>
            Close
          </Button>
        </div>
      )}

      {/* Action Buttons */}
      {ctx?.status !== "booked" && (
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="button-find-slots"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
            disabled={findSlotsMutation.isPending}
            onClick={() => findSlotsMutation.mutate()}
          >
            {findSlotsMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
            Find Slots
          </Button>
          <Button
            data-testid="button-offer-slots"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-cyan-700/50 text-cyan-400 hover:bg-cyan-950/30"
            disabled={offerSlotsMutation.isPending}
            onClick={() => offerSlotsMutation.mutate()}
          >
            {offerSlotsMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
            Offer Slots
          </Button>
          {ctx && offeredSlots.length > 0 && !showConfirmInput && (
            <Button
              data-testid="button-confirm-booking"
              size="sm"
              variant="outline"
              className="h-7 text-xs border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/30"
              onClick={() => setShowConfirmInput(true)}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" /> Confirm Booking
            </Button>
          )}
          {(isExpired || (ctx && offeredSlots.length > 0)) && (
            <Button
              data-testid="button-regenerate-slots"
              size="sm"
              variant="outline"
              className="h-7 text-xs border-zinc-600 text-zinc-400 hover:bg-zinc-700"
              disabled={offerSlotsMutation.isPending}
              onClick={() => offerSlotsMutation.mutate()}
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Regenerate
            </Button>
          )}
        </div>
      )}

      {/* Test Flow button */}
      <div className="pt-1 border-t border-zinc-700/40">
        <Button
          data-testid="button-test-scheduling-flow"
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] text-zinc-600 hover:text-zinc-400"
          disabled={testFlowMutation.isPending}
          onClick={() => testFlowMutation.mutate()}
        >
          {testFlowMutation.isPending ? <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5 mr-1" />}
          Run Availability Test
        </Button>
      </div>
    </div>
  );
}

// ─── Processing Timeline ──────────────────────────────────────────────────────

function ProcessingTimeline({ log, durationMs }: { log: any[]; durationMs: number | null }) {
  const timelineEntry = log?.find((e: any) => e.step === "processing_timeline");
  const timeline: ProcessingTimelineEntry | null = timelineEntry?.detail
    ? (() => { try { return JSON.parse(timelineEntry.detail); } catch { return null; } })()
    : null;

  const steps = log?.filter((e: any) => e.step !== "processing_timeline") || [];

  return (
    <details className="rounded-lg bg-zinc-800/40 border border-zinc-700/50" open>
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Timer className="h-3 w-3 text-blue-400" /> Processing Timeline</span>
        {durationMs != null && (
          <span className="text-[11px] font-normal text-zinc-500 normal-case">{durationMs}ms total</span>
        )}
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {/* Step log */}
        <div className="space-y-1 pt-1">
          {steps.map((entry: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-[11px] min-w-0">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${entry.status === "ok" ? "bg-emerald-500" : entry.status === "error" ? "bg-red-500" : "bg-zinc-500"}`} />
              <div className="flex-1 min-w-0">
                <span className="text-zinc-400 font-medium break-all">{entry.step}</span>
                {entry.detail && <span className="ml-1 text-zinc-500 break-words">{entry.detail}</span>}
                <span className="ml-1 text-zinc-600">{formatDateTime(entry.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Named timestamps */}
        {timeline && (
          <div className="mt-2 pt-2 border-t border-zinc-700/50 grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4 text-[11px]">
            {[
              ["Intake received",     timeline.intake_received],
              ["Scoring done",        timeline.scoring_completed],
              ["AI summary",          timeline.ai_summary_generated],
              ["Draft generated",     timeline.outreach_draft_generated],
              ["Profile persisted",   timeline.profile_persisted],
              ["Gmail draft queued",  timeline.gmail_draft_queued],
              ["Follow-up scheduled", timeline.follow_up_scheduled],
              ["Pipeline complete",   timeline.processing_completed],
            ].map(([label, dt]) => dt && (
              <div key={label as string} className="flex items-baseline gap-1 min-w-0">
                <span className="text-zinc-600 shrink-0">{label}:</span>
                <span className="text-zinc-400 truncate">{formatDateTime(dt as string)}</span>
              </div>
            ))}
            {timeline.processing_duration_ms != null && (
              <div className="col-span-2 flex items-center gap-1.5 mt-1">
                <span className="text-zinc-600">Duration:</span>
                <span className="text-emerald-400 font-semibold">{timeline.processing_duration_ms}ms</span>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// ─── Stage Transition History ─────────────────────────────────────────────────

function StageTransitionHistory({ transitions }: { transitions: StageTransition[] }) {
  if (!transitions?.length) return null;
  return (
    <details className="rounded-lg bg-zinc-800/40 border border-zinc-700/50">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center justify-between">
        <span className="flex items-center gap-1.5"><GitBranch className="h-3 w-3 text-violet-400" /> Stage History</span>
        <span className="text-[11px] font-normal text-zinc-500 normal-case">{transitions.length} transition{transitions.length !== 1 ? "s" : ""}</span>
      </summary>
      <div className="px-4 pb-4 pt-2 space-y-2">
        {transitions.map((t, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <div className="flex flex-col items-center mt-0.5">
              <div className="w-2 h-2 rounded-full bg-violet-500/60 flex-shrink-0" />
              {i < transitions.length - 1 && <div className="w-px h-4 bg-zinc-700 mt-0.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-zinc-400 font-medium capitalize">{t.fromStage.replace(/_/g, " ")}</span>
                <ArrowRight className="h-2.5 w-2.5 text-zinc-600" />
                <span className="text-zinc-200 font-semibold capitalize">{t.toStage.replace(/_/g, " ")}</span>
                <span className="text-zinc-600 ml-auto flex-shrink-0">{timeAgo(t.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-zinc-500 flex-wrap">
                <span className="bg-zinc-700/60 px-1.5 py-0.5 rounded text-[10px]">{SOURCE_LABELS[t.source] || t.source}</span>
                {t.confidence < 1 && <span className="text-zinc-600">{Math.round(t.confidence * 100)}% conf</span>}
                <span className="text-zinc-600 truncate">{t.reason}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// ─── Follow-up Schedule Panel ─────────────────────────────────────────────────

function FollowUpSchedule({ intel }: { intel: IntelligenceProfile }) {
  const fus = intel.followUpStage || "none";
  const cfg = FOLLOW_UP_STAGE_LABELS[fus] || FOLLOW_UP_STAGE_LABELS.none;
  const isDue = intel.nextFollowUpAt && new Date(intel.nextFollowUpAt).getTime() < Date.now();

  return (
    <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
      <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <Bell className="h-3.5 w-3.5" /> Follow-up Schedule
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-zinc-500 shrink-0">Stage:</span>
          <span className={`font-semibold ${cfg.color} truncate`}>{cfg.label}</span>
        </div>
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-zinc-500 shrink-0">Next due:</span>
          <span className={`font-semibold ${isDue ? "text-red-400" : "text-zinc-300"} truncate`}>
            {intel.nextFollowUpAt ? `${timeUntil(intel.nextFollowUpAt)}` : "—"}
          </span>
        </div>
        {intel.intakeProcessedAt && (
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-zinc-500 shrink-0">Intake processed:</span>
            <span className="text-zinc-300 truncate">{formatDateTime(intel.intakeProcessedAt)}</span>
          </div>
        )}
        {intel.lastInteractionAt && (
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-zinc-500 shrink-0">Last interaction:</span>
            <span className="text-zinc-300">{timeAgo(intel.lastInteractionAt)}</span>
          </div>
        )}
        {intel.processingDurationMs != null && (
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-zinc-500 shrink-0">Pipeline time:</span>
            <span className="text-emerald-400 font-semibold">{intel.processingDurationMs}ms</span>
          </div>
        )}
        {intel.updatedAt && (
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="text-zinc-500 shrink-0">Last automation:</span>
            <span className="text-zinc-300">{timeAgo(intel.updatedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead Detail Modal ────────────────────────────────────────────────────────

function LeadDetailModal({
  row,
  onClose,
  onStageChange,
}: {
  row: PipelineRow;
  onClose: () => void;
  onStageChange: (id: string, stage: string) => void;
}) {
  const { toast } = useToast();
  const intel = row.intelligence;
  const sub = row.submission;
  const np = intel.normalizedProfileJson as any;
  const [showSuppressConfirm, setShowSuppressConfirm] = useState(false);

  const { data: drafts, isLoading: draftsLoading } = useQuery<GmailDraftAction[]>({
    queryKey: ["/api/lead-capture/intelligence", intel.submissionId, "drafts"],
    queryFn: () => fetchJson(`/api/lead-capture/intelligence/${intel.submissionId}/drafts`),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/lead-capture/intelligence/${intel.submissionId}/reprocess`, {}),
    onSuccess: () => {
      toast({ title: "Reprocessed", description: "Intelligence pipeline re-ran successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to reprocess.", variant: "destructive" }),
  });

  const draftStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/gmail-agent-actions/${id}/status`, { status }),
    onSuccess: () => {
      toast({ title: "Draft updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence", intel.submissionId, "drafts"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const suppressMutation = useMutation({
    mutationFn: ({ reason, unsubscribe }: { reason: string; unsubscribe: boolean }) =>
      apiRequest("PATCH", `/api/lead-capture/intelligence/${intel.id}/suppress`, { reason, unsubscribe }),
    onSuccess: () => {
      toast({ title: "Lead suppressed", description: "All pending drafts dismissed." });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      setShowSuppressConfirm(false);
      onClose();
    },
    onError: () => toast({ title: "Error suppressing lead", variant: "destructive" }),
  });

  const nextActionCfg = NEXT_ACTION_LABELS[intel.suggestedNextAction || ""] || null;
  const NextActionIcon = nextActionCfg?.icon || Target;
  const transitions = (intel.stageTransitions as StageTransition[]) || [];
  const isContactable = !intel.suppressed && !intel.unsubscribed;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[85dvh] sm:max-h-[90dvh] flex flex-col p-0 gap-0 bg-zinc-900 border-zinc-700 text-zinc-100 overflow-x-hidden rounded-t-2xl sm:rounded-lg fixed bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 translate-y-0 sm:translate-x-[-50%] left-0 sm:left-1/2">
        <DialogHeader className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-zinc-700/60">
          <DialogTitle className="flex items-center gap-2 text-white min-w-0">
            <User className="h-4 w-4 text-orange-400 shrink-0" />
            <span className="truncate">{sub?.athleteName || intel.normalizedProfileJson?.athleteName || "Lead Detail"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <TemperatureBadge temp={intel.temperature} />
            <ScoreBadge score={intel.leadScore} />
            <UrgencyBadge urgency={intel.urgency} />
            <SuppressionBadge unsubscribed={intel.unsubscribed} suppressed={intel.suppressed} />
            {intel.tags?.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-zinc-700/60 text-zinc-300 border border-zinc-600">
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>

          {/* Suppression warning */}
          {(intel.suppressed || intel.unsubscribed) && (
            <div className="rounded-lg bg-red-950/40 border border-red-800/40 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="text-red-300 font-semibold">
                  {intel.unsubscribed ? "Unsubscribed" : "Suppressed"} — No further outreach
                </p>
                {intel.suppressionReason && <p className="text-red-400/80 mt-0.5">Reason: {intel.suppressionReason}</p>}
                {intel.suppressedAt && <p className="text-red-500/70 mt-0.5">{formatDateTime(intel.suppressedAt)}</p>}
              </div>
            </div>
          )}

          {/* Pipeline Stage Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
            <span className="text-xs text-zinc-400 font-medium shrink-0">Pipeline Stage:</span>
            <Select
              value={intel.pipelineStage}
              onValueChange={v => onStageChange(intel.id, v)}
              disabled={intel.suppressed || intel.unsubscribed}
            >
              <SelectTrigger data-testid="select-pipeline-stage" className="h-8 w-full sm:w-48 bg-zinc-800 border-zinc-600 text-xs text-zinc-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-600">
                {STAGES.map(s => (
                  <SelectItem key={s.key} value={s.key} className="text-xs text-zinc-200">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* AI Summary */}
          {intel.aiSummary && (
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4 max-w-full">
              <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" /> AI Context Summary
              </p>
              <AiSummaryCollapsible text={intel.aiSummary} />
            </div>
          )}

          {/* Suggested Next Action */}
          {intel.suggestedNextAction && (
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Suggested Next Action
              </p>
              <div className="flex items-start gap-2">
                <NextActionIcon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${nextActionCfg?.color || "text-zinc-400"}`} />
                <div>
                  <p className="text-sm font-medium text-zinc-100">{nextActionCfg?.label || intel.suggestedNextAction}</p>
                  {intel.suggestedNextActionReason && (
                    <p className="text-xs text-zinc-400 mt-0.5">{intel.suggestedNextActionReason}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Follow-up Schedule */}
          <FollowUpSchedule intel={intel} />

          {/* Scheduling Context */}
          <SchedulingContextPanel
            intel={intel}
            onRefresh={onClose}
          />

          {/* Intake Intelligence */}
          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Intake Intelligence
            </p>
            <div className="space-y-1.5 text-sm">
              {sub?.email && <div className="flex items-center gap-2 min-w-0"><Mail className="h-3.5 w-3.5 text-zinc-500 shrink-0" /><span className="text-zinc-300 break-all min-w-0">{sub.email}</span></div>}
              {sub?.phone && <div className="flex items-center gap-2 min-w-0"><Phone className="h-3.5 w-3.5 text-zinc-500 shrink-0" /><span className="text-zinc-300">{sub.phone}</span></div>}
              {(np?.sport || sub?.sport) && <div className="flex items-center gap-2 min-w-0"><Target className="h-3.5 w-3.5 text-zinc-500 shrink-0" /><span className="text-zinc-300 truncate">{np?.sport || sub?.sport}{np?.position ? ` / ${np.position}` : ""}</span></div>}
              {(np?.school || sub?.school) && <div className="flex items-center gap-2 min-w-0"><MapPin className="h-3.5 w-3.5 text-zinc-500 shrink-0" /><span className="text-zinc-300 break-words min-w-0">{np?.school || sub?.school}</span></div>}
              {np?.age && <div className="flex items-center gap-2 min-w-0"><span className="text-zinc-500 text-xs shrink-0">Age</span><span className="text-zinc-300">{np.age}{np.grade ? ` / ${np.grade}` : ""}</span></div>}
              {np?.commitmentLevel && <div className="flex items-center gap-2 min-w-0"><span className="text-zinc-500 text-xs shrink-0">Commit:</span><span className="text-zinc-300 capitalize">{np.commitmentLevel}</span></div>}
              {np?.goals?.length > 0 && (
                <div className="flex items-start gap-2 mt-1 min-w-0">
                  <span className="text-zinc-500 text-xs mt-0.5 shrink-0">Goals:</span>
                  <span className="text-zinc-300 text-xs break-words min-w-0">{np.goals.join(", ")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Campaign Attribution */}
          {(intel.campaignSource || intel.campaignName) && (
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Megaphone className="h-3.5 w-3.5" /> Campaign Attribution
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {intel.campaignSource && <span className="bg-zinc-700/60 text-zinc-300 px-2 py-1 rounded border border-zinc-600">Source: {intel.campaignSource}</span>}
                {intel.campaignMedium && <span className="bg-zinc-700/60 text-zinc-300 px-2 py-1 rounded border border-zinc-600">Medium: {intel.campaignMedium}</span>}
                {intel.campaignName && <span className="bg-zinc-700/60 text-zinc-300 px-2 py-1 rounded border border-zinc-600">Campaign: {intel.campaignName}</span>}
              </div>
            </div>
          )}

          {/* AI Outreach Drafts */}
          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Outreach Drafts
            </p>
            {draftsLoading ? (
              <Skeleton className="h-16 bg-zinc-700" />
            ) : !drafts?.length ? (
              <p className="text-xs text-zinc-500 italic">No drafts generated yet.</p>
            ) : (
              <div className="space-y-3">
                {drafts.map(draft => (
                  <div key={draft.id} className="rounded bg-zinc-900/60 border border-zinc-700 p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="text-xs font-semibold text-zinc-200">{draft.subject}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">To: {draft.recipientEmail} · {draft.actionType}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                        draft.status === "approved" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                        draft.status === "dismissed" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                        "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      }`}>{draft.status}</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line">
                      {draft.result?.fullBody || draft.bodyPreview || ""}
                    </p>
                    {draft.status === "proposed" && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          data-testid={`button-approve-draft-${draft.id}`}
                          size="sm"
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={draftStatusMutation.isPending}
                          onClick={() => draftStatusMutation.mutate({ id: draft.id, status: "approved" })}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                        </Button>
                        <Button
                          data-testid={`button-dismiss-draft-${draft.id}`}
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-zinc-600 text-zinc-400 hover:bg-zinc-700"
                          disabled={draftStatusMutation.isPending}
                          onClick={() => draftStatusMutation.mutate({ id: draft.id, status: "dismissed" })}
                        >
                          <XCircle className="h-3 w-3 mr-1" /> Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Processing Timeline */}
          {intel.processingLog?.length > 0 && (
            <ProcessingTimeline log={intel.processingLog} durationMs={intel.processingDurationMs} />
          )}

          {/* Stage Transition History */}
          <StageTransitionHistory transitions={transitions} />

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-700/50">
            <Button
              data-testid="button-reprocess-intelligence"
              size="sm"
              variant="outline"
              className="h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              disabled={reprocessMutation.isPending}
              onClick={() => reprocessMutation.mutate()}
            >
              {reprocessMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Re-run AI Pipeline
            </Button>
            {isContactable && (
              <Button
                data-testid="button-suppress-lead"
                size="sm"
                variant="outline"
                className="h-8 text-xs border-red-800/50 text-red-400 hover:bg-red-950/30"
                onClick={() => setShowSuppressConfirm(true)}
              >
                <ShieldOff className="h-3 w-3 mr-1" /> Suppress Lead
              </Button>
            )}
          </div>

          {/* Suppress confirm */}
          {showSuppressConfirm && (
            <div className="rounded-lg bg-red-950/40 border border-red-700/40 p-4 space-y-3">
              <p className="text-sm text-red-300 font-semibold">Suppress this lead?</p>
              <p className="text-xs text-zinc-400">This will dismiss all pending outreach drafts and prevent future recovery cron drafts. The lead's stage will be set to Lost.</p>
              <div className="flex gap-2">
                <Button
                  data-testid="button-confirm-suppress"
                  size="sm"
                  className="h-7 text-xs bg-red-700 hover:bg-red-800 text-white"
                  disabled={suppressMutation.isPending}
                  onClick={() => suppressMutation.mutate({ reason: "Manually suppressed by admin", unsubscribe: false })}
                >
                  {suppressMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Ban className="h-3 w-3 mr-1" />}
                  Confirm Suppress
                </Button>
                <Button
                  data-testid="button-confirm-unsubscribe"
                  size="sm"
                  className="h-7 text-xs bg-red-900 hover:bg-red-800 text-red-200"
                  disabled={suppressMutation.isPending}
                  onClick={() => suppressMutation.mutate({ reason: "Unsubscribed via admin", unsubscribe: true })}
                >
                  Mark Unsubscribed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-zinc-600 text-zinc-400"
                  onClick={() => setShowSuppressConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pipeline Card ────────────────────────────────────────────────────────────

function PipelineCard({ row, onClick }: { row: PipelineRow; onClick: () => void }) {
  const intel = row.intelligence;
  const sub = row.submission;
  const np = intel.normalizedProfileJson as any;
  const athleteName = sub?.athleteName || np?.athleteName || "Unknown Athlete";
  const sport = sub?.sport || np?.sport;
  const school = sub?.school || np?.school;
  const nextActionCfg = NEXT_ACTION_LABELS[intel.suggestedNextAction || ""] || null;
  const NextActionIcon = nextActionCfg?.icon || Target;
  const transitions = (intel.stageTransitions as StageTransition[]) || [];
  const fus = intel.followUpStage || "none";
  const fusCfg = FOLLOW_UP_STAGE_LABELS[fus];
  const isFollowUpDue = intel.nextFollowUpAt && new Date(intel.nextFollowUpAt).getTime() < Date.now() && fus !== "none" && fus !== "exhausted";

  return (
    <div
      data-testid={`card-lead-pipeline-${intel.id}`}
      onClick={onClick}
      className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-500/80 hover:bg-zinc-800/90 transition-all cursor-pointer p-3 space-y-2.5 group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{athleteName}</p>
          {(sport || school) && (
            <p className="text-xs text-zinc-500 truncate mt-0.5">
              {[sport, school].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 mt-0.5" />
      </div>

      {/* Temperature + Score + Suppression + Scheduling */}
      <div className="flex flex-wrap gap-1.5">
        <TemperatureBadge temp={intel.temperature} />
        <ScoreBadge score={intel.leadScore} />
        {(intel.suppressed || intel.unsubscribed) && (
          <SuppressionBadge unsubscribed={intel.unsubscribed} suppressed={intel.suppressed} />
        )}
        {intel.pipelineStage === "scheduling" && (
          <span data-testid="badge-scheduling" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-cyan-900/30 text-cyan-400 border-cyan-700/50">
            <CalendarCheck className="h-3 w-3" /> Scheduling
          </span>
        )}
        {intel.pipelineStage === "booked" && (
          <span data-testid="badge-booked" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-900/30 text-emerald-400 border-emerald-700/50">
            <CheckCircle2 className="h-3 w-3" /> Booked
          </span>
        )}
      </div>

      {/* AI Summary preview */}
      {intel.aiSummary && (
        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">{intel.aiSummary}</p>
      )}

      {/* Campaign Source */}
      {intel.campaignSource && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 min-w-0">
          <Megaphone className="h-3 w-3 shrink-0" />
          <span className="truncate">{intel.campaignSource}{intel.campaignName ? ` / ${intel.campaignName}` : ""}</span>
        </div>
      )}

      {/* Suggested Next Action */}
      {nextActionCfg && !intel.suppressed && !intel.unsubscribed && (
        <div className={`flex items-center gap-1.5 text-[11px] font-medium ${nextActionCfg.color}`}>
          <NextActionIcon className="h-3 w-3" />
          <span>{nextActionCfg.label}</span>
        </div>
      )}

      {/* Follow-up due indicator */}
      {isFollowUpDue && !intel.suppressed && !intel.unsubscribed && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
          <Bell className="h-3 w-3" />
          <span>{fusCfg?.label} follow-up overdue</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-zinc-600 border-t border-zinc-700/50 pt-2">
        <div className="flex items-center gap-2">
          <span>{timeAgo(intel.createdAt)}</span>
          {transitions.length > 0 && (
            <span className="flex items-center gap-0.5 text-violet-500/70">
              <GitBranch className="h-2.5 w-2.5" /> {transitions.length}
            </span>
          )}
        </div>
        {intel.gmailDraftActionId && !intel.suppressed && (
          <span className="flex items-center gap-1 text-amber-500/70">
            <Mail className="h-2.5 w-2.5" /> Draft queued
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: StatRow[] }) {
  const total = stats.reduce((s, r) => s + Number(r.cnt), 0);
  const hot = stats.filter(r => r.temperature === "hot").reduce((s, r) => s + Number(r.cnt), 0);
  const warm = stats.filter(r => r.temperature === "warm").reduce((s, r) => s + Number(r.cnt), 0);
  const converted = stats.filter(r => r.pipelineStage === "converted").reduce((s, r) => s + Number(r.cnt), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5 sm:mb-6">
      {[
        { label: "Total Leads", value: total, icon: User, color: "text-blue-400" },
        { label: "Hot Leads", value: hot, icon: Flame, color: "text-red-400" },
        { label: "Warm Leads", value: warm, icon: Thermometer, color: "text-amber-400" },
        { label: "Converted", value: converted, icon: CheckCircle2, color: "text-emerald-400" },
      ].map(s => {
        const Icon = s.icon;
        return (
          <Card key={s.label} className="bg-zinc-800/50 border-zinc-700/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-4 w-4 ${s.color}`} />
              <span className="text-xs text-zinc-500">{s.label}</span>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Mobile Board View ────────────────────────────────────────────────────────

function MobileBoardView({
  rows,
  onSelectRow,
  mobileStage,
  setMobileStage,
}: {
  rows: PipelineRow[];
  onSelectRow: (row: PipelineRow) => void;
  mobileStage: string;
  setMobileStage: (s: string) => void;
}) {
  const visibleRows = mobileStage === "all"
    ? rows
    : rows.filter(r => r.intelligence.pipelineStage === mobileStage);

  return (
    <div className="space-y-3">
      {/* Stage selector */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500 font-medium">Pipeline Stage</p>
        <Select value={mobileStage} onValueChange={setMobileStage}>
          <SelectTrigger
            data-testid="select-mobile-pipeline-stage"
            className="w-full bg-zinc-800 border-zinc-600 text-sm text-zinc-200 h-9"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600">
            <SelectItem value="all" className="text-sm text-zinc-200">
              All Stages ({rows.length})
            </SelectItem>
            {STAGES.map(s => {
              const cnt = rows.filter(r => r.intelligence.pipelineStage === s.key).length;
              return (
                <SelectItem key={s.key} value={s.key} className="text-sm text-zinc-200">
                  {s.label} ({cnt})
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Quick stage chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 -mx-1 px-1">
          <button
            onClick={() => setMobileStage("all")}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
              mobileStage === "all"
                ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                : "bg-transparent border-zinc-700 text-zinc-500"
            }`}
          >
            All
          </button>
          {STAGES.map(s => {
            const cnt = rows.filter(r => r.intelligence.pipelineStage === s.key).length;
            if (!cnt && mobileStage !== s.key) return null;
            return (
              <button
                key={s.key}
                onClick={() => setMobileStage(s.key)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                  mobileStage === s.key
                    ? `${s.color} font-semibold`
                    : "bg-transparent border-zinc-700 text-zinc-500"
                }`}
              >
                {s.label} {cnt > 0 ? `(${cnt})` : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stage header when filtered */}
      {mobileStage !== "all" && (
        <div className={`rounded-lg px-3 py-2 border ${STAGES.find(s => s.key === mobileStage)?.color || ""}`}>
          <span className="text-xs font-semibold">
            {STAGES.find(s => s.key === mobileStage)?.label} — {visibleRows.length} lead{visibleRows.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Lead cards */}
      {visibleRows.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-700/50 rounded-lg">
          <p className="text-sm">No leads in {mobileStage === "all" ? "pipeline" : STAGES.find(s => s.key === mobileStage)?.label}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map(row => (
            <PipelineCard
              key={row.intelligence.id}
              row={row}
              onClick={() => onSelectRow(row)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLeadPipelinePage() {
  const { toast } = useToast();
  const [selectedRow, setSelectedRow] = useState<PipelineRow | null>(null);
  const [activeStageFilter, setActiveStageFilter] = useState<string>("all");
  const [mobileStage, setMobileStage] = useState<string>("all");
  const [simLoading, setSimLoading] = useState(false);
  const [cronResult, setCronResult] = useState<any>(null);

  const { data: rows = [], isLoading } = useQuery<PipelineRow[]>({
    queryKey: ["/api/lead-capture/intelligence"],
  });

  const { data: stats = [] } = useQuery<StatRow[]>({
    queryKey: ["/api/lead-capture/intelligence-stats"],
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      apiRequest("PATCH", `/api/lead-capture/intelligence/${id}/stage`, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence-stats"] });
      toast({ title: "Stage updated" });
      if (selectedRow) {
        queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence", selectedRow.intelligence.submissionId] });
      }
    },
    onError: () => toast({ title: "Error updating stage", variant: "destructive" }),
  });

  const cronMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-capture/recovery-cron/run", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      setCronResult(data);
      toast({ title: "Recovery cron ran", description: `Queued ${data.queuedDrafts} draft(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
    },
    onError: () => toast({ title: "Cron error", variant: "destructive" }),
  });

  const runSimulation = async (index: number) => {
    setSimLoading(true);
    try {
      const data = await authenticatedFetch("/api/lead-capture/intelligence/test-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloadIndex: index }),
      });
      if (data.profileId) {
        toast({ title: "Simulation complete", description: `Score: ${data.leadScore} (${data.temperature})` });
        queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
        queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence-stats"] });
      } else {
        toast({ title: "Simulation failed", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSimLoading(false);
    }
  };

  const filteredRows = activeStageFilter === "all"
    ? rows
    : rows.filter(r => r.intelligence.pipelineStage === activeStageFilter);

  const stageGroups = STAGES.map(s => ({
    ...s,
    rows: rows.filter(r => r.intelligence.pipelineStage === s.key),
  }));

  return (
    <div className="w-full overflow-x-hidden p-4 sm:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-5 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-orange-400 shrink-0" />
            Lead Pipeline
          </h1>
          <p className="text-sm text-zinc-500 mt-1">AI-powered lead intelligence and follow-up automation</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            data-testid="button-run-recovery-cron"
            size="sm"
            variant="outline"
            className="h-8 text-xs border-cyan-700/50 text-cyan-400 hover:bg-cyan-950/30"
            disabled={cronMutation.isPending}
            onClick={() => cronMutation.mutate()}
          >
            {cronMutation.isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Activity className="h-3 w-3 mr-1.5" />}
            Recovery Cron
          </Button>
          {[0, 1].map(i => (
            <Button
              key={i}
              data-testid={`button-run-simulation-${i}`}
              size="sm"
              variant="outline"
              className="h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              disabled={simLoading}
              onClick={() => runSimulation(i)}
            >
              {simLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FlaskConical className="h-3 w-3 mr-1" />}
              Sim {i + 1}
            </Button>
          ))}
        </div>
      </div>

      {/* Cron result */}
      {cronResult && (
        <div className="mb-4 rounded-lg bg-cyan-950/30 border border-cyan-700/30 px-4 py-3 text-xs text-cyan-300 flex items-start gap-2">
          <Activity className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">Recovery Cron Result: </span>
            Processed {cronResult.processedCount} leads · Queued {cronResult.queuedDrafts} draft(s) · Skipped {cronResult.skippedDuplicate} duplicates · {cronResult.skippedSuppressed} suppressed · {cronResult.durationMs}ms
            {cronResult.errors?.length > 0 && <span className="text-red-400 ml-2">{cronResult.errors.length} error(s)</span>}
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {stats.length > 0 && <StatsBar stats={stats} />}

      {/* Stage Filter — desktop only (mobile uses MobileBoardView selector) */}
      <div className="hidden md:flex gap-2 mb-5 flex-wrap">
        <button
          data-testid="filter-stage-all"
          onClick={() => setActiveStageFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            activeStageFilter === "all"
              ? "bg-zinc-700 border-zinc-500 text-zinc-100"
              : "bg-transparent border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          }`}
        >
          All ({rows.length})
        </button>
        {STAGES.map(s => {
          const cnt = rows.filter(r => r.intelligence.pipelineStage === s.key).length;
          if (!cnt && activeStageFilter !== s.key) return null;
          return (
            <button
              key={s.key}
              data-testid={`filter-stage-${s.key}`}
              onClick={() => setActiveStageFilter(activeStageFilter === s.key ? "all" : s.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                activeStageFilter === s.key
                  ? `${s.color} font-semibold`
                  : "bg-transparent border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* ── Mobile Board (< md) ── */}
      {isLoading ? (
        <div className="md:hidden space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 bg-zinc-800 rounded-lg" />)}
        </div>
      ) : (
        <div className="md:hidden">
          <MobileBoardView
            rows={rows}
            onSelectRow={setSelectedRow}
            mobileStage={mobileStage}
            setMobileStage={setMobileStage}
          />
        </div>
      )}

      {/* ── Desktop Kanban (≥ md) ── */}
      {isLoading ? (
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {STAGES.slice(0, 4).map(s => (
            <div key={s.key} className="space-y-2">
              <Skeleton className="h-6 bg-zinc-700" />
              <Skeleton className="h-24 bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : activeStageFilter === "all" ? (
        <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {stageGroups.map(group => (
            <div key={group.key} className="min-w-0">
              <div className={`rounded-t-lg px-3 py-2 border-t border-x mb-2 ${group.color}`}>
                <span className="text-xs font-semibold">{group.label}</span>
                <span className="ml-1.5 text-[11px] opacity-60">({group.rows.length})</span>
              </div>
              <div className="space-y-2">
                {group.rows.length === 0 ? (
                  <div className="text-center py-4 text-[11px] text-zinc-600 border border-dashed border-zinc-700/50 rounded-lg">
                    Empty
                  </div>
                ) : (
                  group.rows.map(row => (
                    <PipelineCard
                      key={row.intelligence.id}
                      row={row}
                      onClick={() => setSelectedRow(row)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredRows.length === 0 ? (
            <div className="col-span-3 text-center py-16 text-zinc-500">
              No leads in <span className="font-medium">{STAGES.find(s => s.key === activeStageFilter)?.label}</span>
            </div>
          ) : (
            filteredRows.map(row => (
              <PipelineCard
                key={row.intelligence.id}
                row={row}
                onClick={() => setSelectedRow(row)}
              />
            ))
          )}
        </div>
      )}

      {/* Lead Detail Modal */}
      {selectedRow && (
        <LeadDetailModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onStageChange={(id, stage) => {
            stageMutation.mutate({ id, stage });
            setSelectedRow(prev => prev
              ? { ...prev, intelligence: { ...prev.intelligence, pipelineStage: stage } }
              : null
            );
          }}
        />
      )}
    </div>
  );
}
