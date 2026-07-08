import { useState } from "react";
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
} from "lucide-react";
import type { LeadCaptureSubmission } from "@shared/schema";

// ─── Status config ─────────────────────────────────────────────────────────
const BOOKING_STATUS_MAP: Record<string, { label: string; className: string }> = {
  not_booked:       { label: "New",             className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  evaluation_booked:{ label: "Eval Scheduled",  className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  enrolled:         { label: "Enrolled",         className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  attended:         { label: "Attended",         className: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  lost:             { label: "Lost",             className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  archived:         { label: "Archived",         className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const COMMITMENT_COLORS: Record<string, string> = {
  high:   "text-emerald-600 dark:text-emerald-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low:    "text-slate-500 dark:text-slate-400",
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
            {/* Lead summary */}
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
                <div className="text-muted-foreground">Parent: {lead.parentName}</div>
              )}
            </div>

            {!hasEmail && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>This lead has no email address. An athlete account can't be created without one. You can still proceed, but no account or invite will be sent.</span>
              </div>
            )}

            {/* What will happen */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What will happen</p>
              <div className="space-y-2">
                {[
                  {
                    icon: <UserCheck className="h-3.5 w-3.5 text-emerald-500" />,
                    text: "Create or link a CLIENT account (users + user_profiles)",
                    detail: hasEmail ? `Account will use ${lead.email}` : "Skipped — no email",
                  },
                  {
                    icon: <CheckSquare className="h-3.5 w-3.5 text-blue-500" />,
                    text: "Mark lead as Enrolled + set convertedAt timestamp",
                    detail: "leadCaptureSubmissions updated",
                  },
                  {
                    icon: <BarChart2 className="h-3.5 w-3.5 text-indigo-500" />,
                    text: "Advance intelligence pipeline stage to 'converted'",
                    detail: "Stage transition audit entry written",
                  },
                  {
                    icon: <Mail className="h-3.5 w-3.5 text-purple-500" />,
                    text: "Queue AgentMail welcome draft for review",
                    detail: "Queued in AI Approvals — not auto-sent",
                  },
                  {
                    icon: <Send className="h-3.5 w-3.5 text-teal-500" />,
                    text: hasEmail ? "Send account invitation email (SendGrid)" : "Skip account invite — no email",
                    detail: hasEmail ? "\"Create your password\" link, 7-day expiry" : "Manual invite later",
                  },
                  {
                    icon: <Zap className="h-3.5 w-3.5 text-yellow-500" />,
                    text: "Initialize PAIL athlete intelligence profile",
                    detail: "Seeded with intake data — grows with session history",
                  },
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
          /* Success state */
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-2">
              <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                {result.athleteCreated ? "Athlete account created!" : "Lead linked to existing athlete!"}
              </p>
              <p className="text-xs text-muted-foreground">{result.email}</p>
            </div>

            <div className="space-y-2">
              {[
                {
                  ok: result.athleteCreated || result.linkedExisting,
                  label: result.athleteCreated ? "Athlete account created" : "Linked to existing athlete account",
                },
                {
                  ok: true,
                  label: "Lead marked Enrolled · convertedAt set · linked to user",
                },
                {
                  ok: true,
                  label: "Intelligence pipeline stage → converted",
                },
                {
                  ok: result.welcomeDraftCreated,
                  label: result.welcomeDraftCreated
                    ? "Welcome draft queued in AI Approvals"
                    : "Welcome draft not created (draft engine error)",
                },
                {
                  ok: result.accountInviteCreated,
                  label: result.accountInviteCreated
                    ? "Account invitation email queued (SendGrid)"
                    : "Account invite skipped — no email on lead",
                },
                {
                  ok: result.pailInitialized,
                  label: result.pailInitialized
                    ? "PAIL athlete intelligence initialized"
                    : "PAIL initialization skipped (no athlete ID)",
                },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  {item.ok
                    ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    : <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  }
                  <span className={item.ok ? "" : "text-muted-foreground"}>{item.label}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t flex-wrap">
              {result.welcomeDraftCreated && (
                <Link href="/admin/ai-approvals">
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={onClose} data-testid="link-review-welcome-draft">
                    <ExternalLink className="h-3 w-3" /> Review Welcome Draft
                  </Button>
                </Link>
              )}
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
    // @ts-ignore — using select to set state as a side-effect (safe here)
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
        toast({
          title: "Gmail not connected",
          description: "Connect Gmail in Settings to send emails through AgentMail.",
          variant: "destructive",
        });
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
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="text-sm"
                placeholder="Subject line…"
                data-testid="input-email-subject"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Message</p>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="text-sm min-h-[180px] resize-none font-mono"
                placeholder="Email body…"
                data-testid="textarea-email-body"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !subject.trim() || !body.trim()}
                className="gap-1.5"
                data-testid="button-send-email"
              >
                {sendMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                  : <><Send className="h-3.5 w-3.5" /> Send via AgentMail</>
                }
              </Button>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={sendMutation.isPending}
                data-testid="button-save-draft-queue"
              >
                Save to Queue
              </Button>
              <Link href="/admin/ai-approvals">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1 text-muted-foreground"
                  onClick={onClose}
                  data-testid="link-view-all-drafts"
                >
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

  // Load intel profile for this submission (to get intelProfileId as leadId)
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

  // Load existing scheduling context if any
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
    if (!intelProfileId) {
      setError("AI lead profile not ready yet. Try again in a moment.");
      return;
    }
    setError(null);
    setStep("finding");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/find-slots", {
        submissionId: lead.id,
        durationMin: 60,
        lookAheadDays: 14,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to find slots");
      if (!json.slots?.length) {
        setError("No available slots found in the next 14 days. Make sure coaches have availability set up.");
        setStep("initial");
        return;
      }
      setSlots(json.slots);
      setStep("slots_found");
    } catch (err: any) {
      setError(err.message);
      setStep("initial");
    }
  }

  async function handleOfferSlots() {
    if (!intelProfileId) return;
    setError(null);
    setStep("offering");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/offer-slots", {
        submissionId: lead.id,
        leadId: intelProfileId,
        durationMin: 60,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to offer slots");
      setOfferedSlots(json.offeredSlots || slots);
      setStep("offered");
      toast({
        title: "Slots offered via AgentMail",
        description: "An email draft with time options has been created and queued for review.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
    } catch (err: any) {
      setError(err.message);
      setStep("slots_found");
    }
  }

  async function handleConfirmBooking() {
    if (!replyText.trim()) return;
    setError(null);
    setStep("confirming");
    try {
      const res = await apiRequest("POST", "/api/org/scheduling-agent/confirm-booking", {
        submissionId: lead.id,
        replyText: replyText.trim(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to confirm booking");
      setConfirmResult(json);
      if (json.success) {
        setStep("confirmed");
        onBooked();
        queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads/stats"] });
      } else {
        setError(json.message || "Could not auto-confirm. Low confidence — please mark manually or try a clearer reply.");
        setStep("offered");
      }
    } catch (err: any) {
      setError(err.message);
      setStep("offered");
    }
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
          {/* Lead summary */}
          <div className="rounded-lg bg-muted/30 border px-3 py-2.5 text-xs space-y-1">
            <div className="flex items-center gap-4 flex-wrap">
              <span><span className="text-muted-foreground">Email:</span> {lead.email}</span>
              {lead.sport && <span><span className="text-muted-foreground">Sport:</span> {lead.sport}</span>}
              {lead.age && <span><span className="text-muted-foreground">Age:</span> {lead.age}</span>}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step: Initial ── */}
          {(step === "initial") && (
            <div className="space-y-3">
              {isInitialLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading scheduling context…
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Find available evaluation slots and send them to the athlete via AgentMail.
                    The athlete will reply to confirm their preferred time.
                  </p>
                  <Button
                    onClick={handleFindAndOffer}
                    disabled={!intelProfileId}
                    className="w-full gap-2"
                    data-testid="button-find-slots"
                  >
                    <Calendar className="h-4 w-4" />
                    Find Available Slots
                  </Button>
                  {!intelProfileId && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      AI profile is still processing — refresh and try again in a moment.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step: Finding slots ── */}
          {step === "finding" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Searching coach availability…</span>
            </div>
          )}

          {/* ── Step: Slots found ── */}
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
              <Button
                onClick={handleOfferSlots}
                className="w-full gap-2"
                data-testid="button-offer-slots"
              >
                <Send className="h-3.5 w-3.5" />
                Send Slot Options via AgentMail
              </Button>
              <p className="text-[11px] text-muted-foreground">
                An email draft with these time options will be queued in AI Approvals for review before sending.
              </p>
            </div>
          )}

          {/* ── Step: Offering ── */}
          {step === "offering" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Creating AgentMail draft…</span>
            </div>
          )}

          {/* ── Step: Slots offered / confirm booking ── */}
          {step === "offered" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-3 space-y-1">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
                  <CheckSquare className="h-4 w-4" />
                  Slots sent via AgentMail
                </div>
                <p className="text-xs text-muted-foreground">
                  The athlete will reply with their preferred time. Paste their reply below to confirm the booking.
                </p>
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
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Athlete's reply (paste here to auto-confirm)
                </p>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`e.g. "Thursday at 4pm works great!"`}
                  className="text-sm min-h-[80px] resize-none"
                  data-testid="textarea-reply-text"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleConfirmBooking}
                  disabled={!replyText.trim()}
                  className="flex-1 gap-2"
                  data-testid="button-confirm-booking"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Parse & Confirm Booking
                </Button>
                <Button
                  variant="outline"
                  onClick={handleFindAndOffer}
                  className="gap-1.5 text-xs"
                  data-testid="button-resend-slots"
                >
                  <RefreshCw className="h-3 w-3" /> New Slots
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                AI will match the reply to an offered slot. If confidence is too low, you'll be prompted to confirm manually.
              </p>
            </div>
          )}

          {/* ── Step: Confirming ── */}
          {step === "confirming" && (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Parsing reply and confirming booking…</span>
            </div>
          )}

          {/* ── Step: Confirmed ── */}
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
              <p className="text-xs text-muted-foreground">
                Lead status updated to <strong>Eval Scheduled</strong> and pipeline stage set to <strong>booked</strong>.
                A confirmation email draft has been queued in AI Approvals.
              </p>
              <Button size="sm" variant="outline" onClick={onClose} className="mt-2">Close</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Athlete Lead Card ───────────────────────────────────────────────────────
function AthleteLeadCard({
  lead,
  onUpdate,
  onDelete,
  onEdit,
  onEmail,
  onSchedule,
  onConvert,
}: {
  lead: LeadCaptureSubmission;
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

  return (
    <Card className="p-4 space-y-3" data-testid={`card-athlete-lead-${lead.id}`}>
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
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {lead.parentName && (
              <p className="text-xs text-muted-foreground">
                <span className="text-muted-foreground/60">Parent:</span> {lead.parentName}
              </p>
            )}
            {lead.sport && (
              <span className="text-xs text-muted-foreground">· {lead.sport}</span>
            )}
            {lead.age && (
              <span className="text-xs text-muted-foreground">· Age {lead.age}</span>
            )}
            {lead.school && (
              <span className="text-xs text-muted-foreground">· {lead.school}</span>
            )}
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

      {/* Source + commitment row */}
      <div className="flex items-center gap-2 flex-wrap">
        <SourceBadge source={lead.utmSource} campaign={lead.utmCampaign} />
        {lead.commitmentLevel && (
          <span className={`text-xs font-medium capitalize ${commitmentColor}`} data-testid={`text-commitment-${lead.id}`}>
            {lead.commitmentLevel} commitment
          </span>
        )}
        {lead.experienceLevel && (
          <span className="text-xs text-muted-foreground capitalize">{lead.experienceLevel.replace(/_/g, " ")} experience</span>
        )}
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
            className="h-7 text-xs"
            onClick={() => onEmail(lead)}
            data-testid={`button-email-athlete-${lead.id}`}
          >
            <Mail className="h-3 w-3 mr-1" /> Email
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
            {lead.grade && (
              <div><span className="text-muted-foreground">Grade:</span> {lead.grade}</div>
            )}
            {lead.position && (
              <div><span className="text-muted-foreground">Position:</span> {lead.position}</div>
            )}
            {lead.currentTrainingStatus && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Training status:</span>{" "}
                <span className="capitalize">{lead.currentTrainingStatus.replace(/_/g, " ")}</span>
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
            <div className="rounded-md bg-muted/40 border p-2 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">AI Assessment</p>
              <p className="text-muted-foreground leading-relaxed">{lead.aiQualificationReason}</p>
            </div>
          )}

          {lead.notes && (
            <div className="rounded-md bg-muted/40 border-l-2 border-primary/30 pl-2 py-1.5">
              <p className="text-muted-foreground italic">{lead.notes}</p>
            </div>
          )}

          {/* Timeline milestones */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full shrink-0 ${lead.createdAt ? "bg-blue-500" : "bg-muted"}`} />
                <span className="text-muted-foreground">Applied — {formatDate(lead.createdAt?.toString())}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full shrink-0 ${lead.evaluationBookedAt ? "bg-indigo-500" : "bg-muted"}`} />
                <span className="text-muted-foreground">Eval Scheduled — {formatDate(lead.evaluationBookedAt?.toString())}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full shrink-0 ${lead.convertedAt ? "bg-emerald-500" : "bg-muted"}`} />
                <span className="text-muted-foreground">Converted — {formatDate(lead.convertedAt?.toString())}</span>
              </div>
            </div>
          </div>

          {/* UTM attribution */}
          {(lead.utmSource || lead.utmMedium || lead.utmCampaign) && (
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
            <Button
              onClick={() => onSave(lead.id, { notes, bookingStatus })}
              disabled={isSaving}
              data-testid="button-save-edit"
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AdminAthleteLeadsPage() {
  const { toast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSport, setFilterSport] = useState("all");
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
  }>({
    queryKey: ["/api/admin/athlete-leads/stats"],
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

  const sports = [...new Set((leads || []).map((l) => l.sport).filter(Boolean))] as string[];

  const filtered = (leads || []).filter((l) => {
    if (filterStatus !== "all" && l.bookingStatus !== filterStatus) return false;
    if (filterSport !== "all" && l.sport !== filterSport) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (
        !l.athleteName.toLowerCase().includes(q) &&
        !(l.parentName || "").toLowerCase().includes(q) &&
        !(l.sport || "").toLowerCase().includes(q) &&
        !(l.school || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const topSources = stats?.sourceAttribution
    ? Object.entries(stats.sourceAttribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 4)
    : [];

  return (
    <div className="space-y-6">
      {/* ── System-type navigation banner ── */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">CRM System:</span>
          </div>
          <Link href="/admin/athlete-leads">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-orange-500 text-white shadow-sm"
              data-testid="nav-athlete-leads-active"
            >
              <Users className="h-3.5 w-3.5" />
              Athlete Intake Pipeline
              <span className="ml-1 opacity-80">B2C</span>
            </button>
          </Link>
          <Link href="/admin/team-training-leads">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-colors"
              data-testid="nav-b2b-partnerships"
            >
              <Building2 className="h-3.5 w-3.5" />
              Team Partnerships
              <span className="ml-1 opacity-60">B2B</span>
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
            Manage athlete applications and parent inquiries from ads, forms, and landing pages.
          </p>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {statsLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Card className="p-3 text-center">
              <ClipboardList className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-total">{stats?.total || 0}</p>
              <p className="text-xs text-muted-foreground">Applications</p>
            </Card>
            <Card className="p-3 text-center">
              <Calendar className="h-4 w-4 mx-auto text-indigo-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-eval">{stats?.evalScheduled || 0}</p>
              <p className="text-xs text-muted-foreground">Evals Scheduled</p>
            </Card>
            <Card className="p-3 text-center">
              <TrendingUp className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-conversion">{stats?.conversionRate || 0}%</p>
              <p className="text-xs text-muted-foreground">Conversion Rate</p>
            </Card>
            <Card className="p-3 text-center">
              <UserCheck className="h-4 w-4 mx-auto text-teal-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-enrolled">{stats?.enrolled || 0}</p>
              <p className="text-xs text-muted-foreground">Enrolled</p>
            </Card>
            <Card className="p-3 text-center col-span-2 lg:col-span-1">
              <DollarSign className="h-4 w-4 mx-auto text-primary mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-revenue">${(stats?.projectedRevenue || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Projected Revenue</p>
            </Card>
            <Card className="p-3 col-span-2 lg:col-span-1">
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

      {/* ── Filters ── */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search athletes..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="h-8 text-sm w-44"
            data-testid="input-search"
          />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
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
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} leads</span>
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
          <p className="text-sm font-medium">No leads match your filters</p>
          <p className="text-xs mt-1">Try adjusting the search or status filter.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((lead) => (
            <AthleteLeadCard
              key={lead.id}
              lead={lead}
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

      {/* ── Convert to Athlete Modal ── */}
      {convertLead && (
        <ConvertAthleteModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
          onConverted={() => setConvertLead(null)}
        />
      )}

      {/* ── Edit Modal ── */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSave={(id, data) => updateMutation.mutate({ id, data })}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* ── Email Draft Modal ── */}
      {emailLead && (
        <EmailDraftModal
          lead={emailLead}
          onClose={() => setEmailLead(null)}
        />
      )}

      {/* ── Schedule Eval Modal ── */}
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
