import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import {
  Send, Users, CheckCircle2, XCircle, RefreshCw, Clock,
  Mail, MessageSquare, Bell, ChevronRight, BarChart3,
  Calendar, User, DollarSign, Loader2, AlertCircle,
  FileText, TrendingUp, Check, X, RotateCcw, Eye,
  Activity
} from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Submission {
  id: string;
  org_id: string;
  booking_id: string;
  status: string;
  version: number;
  parent_submission_id: string | null;
  subject: string;
  preview_text: string;
  email_body: string;
  sms_body: string;
  push_body: string;
  social_caption: string;
  recipients: Array<{ userId: string; email: string; firstName: string; lastName: string; score: number }>;
  recipient_count: number;
  recipient_summary: {
    avgScore?: number;
    topReasons?: string[];
    waitlistedCount?: number;
    coachRegularsCount?: number;
  };
  session_name: string;
  coach_name: string;
  org_name: string;
  open_spots: number;
  estimated_value_cents: number;
  fill_probability: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  rejection_type: string | null;
  timeline: Array<{ event: string; timestamp: string; note: string | null }>;
  analytics: {
    delivered?: number;
    opened?: number;
    clicked?: number;
    booked?: number;
    revenueGenerated?: number;
  };
  submitted_at: string;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface VersionMeta {
  id: string;
  version: number;
  status: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending_approval: { label: "Pending Approval", color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20", icon: Clock },
  approved:         { label: "Approved",         color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",           icon: CheckCircle2 },
  sending:          { label: "Sending",           color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20",   icon: Send },
  completed:        { label: "Completed",         color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",       icon: CheckCircle2 },
  rejected:         { label: "Rejected",          color: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",              icon: XCircle },
  superseded:       { label: "Superseded",        color: "bg-muted text-muted-foreground border-transparent",                           icon: RefreshCw },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted text-muted-foreground border-transparent", icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge className={`text-xs flex items-center gap-1 ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function fillProbColor(label: string) {
  if (label === "High") return "text-green-600 dark:text-green-400";
  if (label === "Medium") return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function TimelineTrack({ timeline }: { timeline: Submission["timeline"] }) {
  if (!timeline || timeline.length === 0) return null;
  const ICONS: Record<string, typeof Clock> = {
    "Created": FileText,
    "Recipients Selected": Users,
    "Generated": RefreshCw,
    "Submitted": Send,
    "Approved": CheckCircle2,
    "Sent": Mail,
    "Completed": CheckCircle2,
    "Rejected": XCircle,
    "Regeneration Requested": RotateCcw,
    "Superseded": RefreshCw,
  };
  return (
    <div className="space-y-1">
      {timeline.map((entry, i) => {
        const Icon = ICONS[entry.event] ?? Activity;
        const isLast = i === timeline.length - 1;
        return (
          <div key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center flex-none">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-none ${isLast ? "bg-primary" : "bg-muted"}`}>
                <Icon className={`h-2.5 w-2.5 ${isLast ? "text-primary-foreground" : "text-muted-foreground"}`} />
              </div>
              {i < timeline.length - 1 && <div className="w-px flex-1 bg-border mt-0.5 mb-0.5" style={{ minHeight: 12 }} />}
            </div>
            <div className="pb-2 min-w-0">
              <p className="text-xs font-medium">{entry.event}</p>
              {entry.note && <p className="text-[10px] text-muted-foreground">{entry.note}</p>}
              <p className="text-[10px] text-muted-foreground">
                {format(parseISO(entry.timestamp), "MMM d, h:mm a")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalyticsRow({ analytics, recipientCount }: { analytics: Submission["analytics"]; recipientCount: number }) {
  const stats = [
    { label: "Recipients", value: recipientCount, icon: Users, active: true },
    { label: "Delivered", value: analytics?.delivered ?? "—", icon: Mail, active: false },
    { label: "Opened", value: analytics?.opened ?? "—", icon: Eye, active: false },
    { label: "Clicked", value: analytics?.clicked ?? "—", icon: TrendingUp, active: false },
    { label: "Booked", value: analytics?.booked ?? "—", icon: Calendar, active: false },
    { label: "Revenue", value: analytics?.revenueGenerated ? `$${analytics.revenueGenerated}` : "—", icon: DollarSign, active: false },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((s) => (
        <div key={s.label} className={`rounded-lg border p-2 text-center ${s.active ? "bg-background" : "bg-muted/20"}`}>
          <s.icon className={`h-3.5 w-3.5 mx-auto mb-1 ${s.active ? "text-primary" : "text-muted-foreground"}`} />
          <p className={`text-lg font-bold leading-none ${s.active ? "" : "text-muted-foreground"}`}>{s.value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Approval Detail Dialog ─────────────────────────────────────────────────────

function ApprovalDialog({
  submission,
  versions,
  onClose,
  onApprove,
  onReject,
  onRequestRegeneration,
  isActing,
}: {
  submission: Submission;
  versions: VersionMeta[];
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onRequestRegeneration: (notes: string) => void;
  isActing: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"email" | "sms" | "push">("email");
  const [showReject, setShowReject] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [regenNotes, setRegenNotes] = useState("");

  const isPending = submission.status === "pending_approval";
  const estimatedRevenue = submission.estimated_value_cents > 0
    ? `$${Math.round(submission.estimated_value_cents / 100).toLocaleString()}`
    : null;

  const tabs = [
    { key: "email" as const, label: "Email", icon: Mail },
    { key: "sms" as const, label: "SMS", icon: MessageSquare },
    { key: "push" as const, label: "Push", icon: Bell },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b flex-none">
          <DialogTitle className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              <span className="text-base">Fill Campaign — v{submission.version}</span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={submission.status} />
              {versions.length > 1 && (
                <Badge variant="outline" className="text-xs">{versions.length} versions</Badge>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
          {/* Campaign Summary */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Campaign Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Session", value: submission.session_name, icon: Calendar },
                { label: "Coach", value: submission.coach_name, icon: User },
                { label: "Recipients", value: `${submission.recipient_count} selected`, icon: Users },
                { label: "Open Spots", value: String(submission.open_spots), icon: BarChart3 },
                { label: "Fill Probability", value: submission.fill_probability || "—", icon: TrendingUp, valueClass: fillProbColor(submission.fill_probability) },
                { label: "Est. Revenue", value: estimatedRevenue ?? "—", icon: DollarSign, valueClass: estimatedRevenue ? "text-green-600 dark:text-green-400" : "" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-muted/30 p-2.5">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                    <s.icon className="h-3 w-3" />
                    <span className="text-[10px]">{s.label}</span>
                  </div>
                  <p className={`text-sm font-medium truncate ${s.valueClass ?? ""}`}>{s.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Recipient Preview */}
          {submission.recipients && submission.recipients.length > 0 && (
            <section>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Recipient Preview
                {submission.recipient_summary?.avgScore && (
                  <span className="ml-2 text-primary normal-case font-normal">
                    avg {submission.recipient_summary.avgScore}% match
                  </span>
                )}
              </p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {submission.recipients.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded-md bg-muted/30">
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground flex-none">
                      {(r.firstName?.[0] || r.email?.[0] || "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{r.firstName} {r.lastName}</span>
                      <span className="text-muted-foreground ml-1.5 truncate">{r.email}</span>
                    </div>
                    <Badge className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/15 flex-none">
                      {r.score}%
                    </Badge>
                  </div>
                ))}
                {submission.recipients.length > 10 && (
                  <p className="text-xs text-muted-foreground pl-1.5">
                    +{submission.recipients.length - 10} more recipients
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Campaign Preview */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Campaign Preview</p>
            <div className="flex gap-1 mb-3">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    activeTab === tab.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                  }`}
                >
                  <tab.icon className="h-3 w-3" />
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "email" && (
              <div className="space-y-2">
                <div className="rounded-lg border bg-background p-2.5">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Subject</p>
                  <p className="text-sm font-medium">{submission.subject}</p>
                </div>
                {submission.preview_text && (
                  <div className="rounded-lg border bg-background p-2.5">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Preview Text</p>
                    <p className="text-xs italic text-muted-foreground">{submission.preview_text}</p>
                  </div>
                )}
                <div className="rounded-lg border bg-background p-2.5">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Email Body</p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{submission.email_body}</p>
                </div>
              </div>
            )}

            {activeTab === "sms" && (
              <div className="rounded-lg border bg-background p-2.5">
                <p className="text-[10px] text-muted-foreground mb-1">SMS Body</p>
                <p className="text-sm whitespace-pre-wrap">{submission.sms_body}</p>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {submission.sms_body?.length ?? 0} chars · ~{Math.ceil((submission.sms_body?.length ?? 0) / 160)} segment
                </p>
              </div>
            )}

            {activeTab === "push" && (
              <div className="space-y-2">
                <div className="rounded-lg border bg-background p-2.5">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Push Notification</p>
                  <p className="text-sm font-medium">{submission.push_body}</p>
                </div>
                {submission.social_caption && (
                  <div className="rounded-lg border bg-background p-2.5">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Social Caption</p>
                    <p className="text-sm">{submission.social_caption}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Campaign Timeline */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Campaign Timeline</p>
            <TimelineTrack timeline={submission.timeline} />
          </section>

          {/* Analytics */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Analytics
              {submission.status !== "completed" && (
                <span className="ml-2 text-muted-foreground normal-case font-normal text-[10px]">tracking begins after send</span>
              )}
            </p>
            <AnalyticsRow analytics={submission.analytics ?? {}} recipientCount={submission.recipient_count} />
          </section>

          {/* Version history */}
          {versions.length > 1 && (
            <section>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Version History</p>
              <div className="space-y-1">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-xs p-2 rounded-md bg-muted/30">
                    <span className="font-medium w-16 flex-none">Version {v.version}</span>
                    <StatusBadge status={v.status} />
                    <span className="text-muted-foreground ml-auto">
                      {format(parseISO(v.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Rejection reason if rejected */}
          {submission.status === "rejected" && submission.rejection_reason && (
            <div className="flex gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-400 text-xs">
              <XCircle className="h-3.5 w-3.5 flex-none mt-0.5" />
              <div>
                <p className="font-medium mb-0.5">
                  {submission.rejection_type === "regeneration_requested" ? "Regeneration Requested" : "Rejected"}
                </p>
                <p>{submission.rejection_reason}</p>
              </div>
            </div>
          )}
        </div>

        {/* Action footer */}
        {isPending && (
          <div className="border-t px-5 py-4 flex-none space-y-3">
            {showReject && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Reason for rejection (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="text-xs resize-none h-16"
                  data-testid="input-reject-reason"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => onReject(rejectReason)}
                    disabled={isActing}
                    data-testid="button-confirm-reject"
                  >
                    {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1.5" />}
                    Confirm Rejection
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowReject(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {showRegen && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Notes for regeneration (optional — describe what to change)"
                  value={regenNotes}
                  onChange={(e) => setRegenNotes(e.target.value)}
                  className="text-xs resize-none h-16"
                  data-testid="input-regen-notes"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                    onClick={() => onRequestRegeneration(regenNotes)}
                    disabled={isActing}
                    data-testid="button-confirm-regen"
                  >
                    {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                    Request New Version
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowRegen(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {!showReject && !showRegen && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRegen(true)}
                  className="border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                  data-testid="button-request-regeneration"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Request Regeneration
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowReject(true)}
                  className="border-red-500/30 text-red-700 dark:text-red-400 hover:bg-red-500/10"
                  data-testid="button-reject-campaign"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={onApprove}
                  disabled={isActing}
                  data-testid="button-approve-campaign"
                >
                  {isActing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Approve &amp; Send
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Campaign Card ──────────────────────────────────────────────────────────────

function CampaignCard({ sub, onOpen }: { sub: Submission; onOpen: () => void }) {
  const estimatedRevenue = sub.estimated_value_cents > 0
    ? `$${Math.round(sub.estimated_value_cents / 100).toLocaleString()}`
    : null;

  return (
    <Card
      className="p-4 hover:shadow-md transition-shadow cursor-pointer"
      data-testid={`card-campaign-${sub.id}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{sub.subject || "Fill Campaign"}</p>
            <StatusBadge status={sub.status} />
            {sub.version > 1 && (
              <Badge variant="outline" className="text-[10px]">v{sub.version}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {sub.session_name}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {sub.coach_name}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {sub.recipient_count} recipient{sub.recipient_count !== 1 ? "s" : ""}
            </span>
            {estimatedRevenue && (
              <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
                <DollarSign className="h-3 w-3" />
                {estimatedRevenue}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className="text-xs text-muted-foreground">
            {format(parseISO(sub.submitted_at || sub.created_at), "MMM d, h:mm a")}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Progress mini-timeline */}
      {sub.timeline && sub.timeline.length > 0 && (
        <div className="mt-3 pt-2 border-t flex items-center gap-1 overflow-hidden">
          {["Created", "Recipients Selected", "Generated", "Submitted", "Approved", "Sent", "Completed"].map((ev, i) => {
            const done = sub.timeline.some((t) => t.event === ev);
            const isCurrent = !done && sub.timeline.some((t, ti) =>
              ti === sub.timeline.length - 1 &&
              ["Created", "Recipients Selected", "Generated", "Submitted", "Approved", "Sent", "Completed"].indexOf(t.event) === i - 1
            );
            return (
              <div key={ev} className="flex items-center gap-1 flex-shrink-0">
                <div className={`w-1.5 h-1.5 rounded-full ${done ? "bg-primary" : isCurrent ? "bg-primary/40" : "bg-muted"}`} />
                {i < 6 && <div className={`h-px w-3 ${done ? "bg-primary/40" : "bg-muted"}`} />}
              </div>
            );
          })}
          <span className="text-[10px] text-muted-foreground ml-1">
            {sub.timeline[sub.timeline.length - 1]?.event}
          </span>
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFillCampaignsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeStatus, setActiveStatus] = useState("all");
  const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
  const [activeVersions, setActiveVersions] = useState<VersionMeta[]>([]);

  const { data, isLoading, refetch } = useQuery<{ submissions: Submission[]; total: number }>({
    queryKey: ["/api/scheduling-intelligence/fill-campaigns", activeStatus],
    queryFn: () => authenticatedFetch(
      `/api/scheduling-intelligence/fill-campaigns?status=${activeStatus}`
    ),
    refetchInterval: 60_000,
  });

  const openDetail = async (sub: Submission) => {
    setActiveSubmission(sub);
    try {
      const detail = await authenticatedFetch(
        `/api/scheduling-intelligence/fill-campaign/submission/${sub.id}`
      );
      setActiveSubmission(detail.submission ?? sub);
      setActiveVersions(detail.versions ?? []);
    } catch {
      setActiveVersions([]);
    }
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("POST", `/api/scheduling-intelligence/fill-campaign/submission/${id}/approve`, {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({
        title: "Campaign approved",
        description: data.sentCount > 0
          ? `${data.sentCount} email${data.sentCount !== 1 ? "s" : ""} dispatched.`
          : "Campaign approved — outbound queue updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-campaigns"] });
      setActiveSubmission(null);
    },
    onError: () => toast({ title: "Error", description: "Approval failed.", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      apiRequest("POST", `/api/scheduling-intelligence/fill-campaign/submission/${id}/reject`, { reason }),
    onSuccess: () => {
      toast({ title: "Campaign rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-campaigns"] });
      setActiveSubmission(null);
    },
    onError: () => toast({ title: "Error", description: "Rejection failed.", variant: "destructive" }),
  });

  const regenMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) =>
      apiRequest("POST", `/api/scheduling-intelligence/fill-campaign/submission/${id}/request-regeneration`, { notes }),
    onSuccess: () => {
      toast({ title: "Regeneration requested", description: "Go to the Opportunity Inbox to create a new version." });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling-intelligence/fill-campaigns"] });
      setActiveSubmission(null);
    },
    onError: () => toast({ title: "Error", description: "Request failed.", variant: "destructive" }),
  });

  const submissions = data?.submissions ?? [];
  const statusTabs = [
    { key: "all", label: "All", count: data?.total ?? 0 },
    { key: "pending_approval", label: "Pending", count: submissions.filter((s) => s.status === "pending_approval").length },
    { key: "approved", label: "Approved", count: submissions.filter((s) => s.status === "approved").length },
    { key: "completed", label: "Completed", count: submissions.filter((s) => s.status === "completed").length },
    { key: "rejected", label: "Rejected", count: submissions.filter((s) => s.status === "rejected").length },
  ];

  const isActing = approveMutation.isPending || rejectMutation.isPending || regenMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Send className="h-6 w-6 text-primary" />
            Fill Campaign Queue
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review, approve, and track AI-generated session fill campaigns
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
          data-testid="button-refresh-campaigns"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Campaigns", value: data?.total ?? 0, icon: Send, color: "text-primary" },
            { label: "Pending Review", value: submissions.filter((s) => s.status === "pending_approval").length, icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
            { label: "Completed", value: submissions.filter((s) => s.status === "completed").length, icon: CheckCircle2, color: "text-green-600 dark:text-green-400" },
            { label: "Rejected", value: submissions.filter((s) => s.status === "rejected").length, icon: XCircle, color: "text-red-600 dark:text-red-400" },
          ].map((stat) => (
            <Card key={stat.label} className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <stat.icon className="h-4 w-4" />
                <span className="text-xs">{stat.label}</span>
              </div>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveStatus(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeStatus === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
            }`}
            data-testid={`filter-status-${tab.key}`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Campaign list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : submissions.length === 0 ? (
        <Card className="p-12 text-center">
          <Send className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">No campaigns yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeStatus === "pending_approval"
              ? "No campaigns awaiting approval."
              : "Generate fill campaigns from the Opportunity Inbox to see them here."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => { window.location.href = "/admin/scheduling-opportunity-inbox"; }}
          >
            Go to Opportunity Inbox
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {submissions.map((sub) => (
            <CampaignCard key={sub.id} sub={sub} onOpen={() => openDetail(sub)} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Auto-refreshes every 60 seconds · {submissions.length} campaign{submissions.length !== 1 ? "s" : ""} shown
      </p>

      {/* Approval detail dialog */}
      {activeSubmission && (
        <ApprovalDialog
          submission={activeSubmission}
          versions={activeVersions}
          onClose={() => { setActiveSubmission(null); setActiveVersions([]); }}
          onApprove={() => approveMutation.mutate(activeSubmission.id)}
          onReject={(reason) => rejectMutation.mutate({ id: activeSubmission.id, reason })}
          onRequestRegeneration={(notes) => regenMutation.mutate({ id: activeSubmission.id, notes })}
          isActing={isActing}
        />
      )}
    </div>
  );
}
