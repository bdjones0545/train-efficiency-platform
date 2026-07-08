import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { parseApiResponse } from "@/lib/api-helpers";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  CheckCheck, X, Edit3, RefreshCw, Clock, TrendingUp, ChevronDown,
  ChevronRight, Globe, Archive, Brain, Zap, AlertTriangle, Users,
  Building2, GraduationCap, Briefcase, BarChart3, Mail,
  TrendingDown, DollarSign, Award, Target, MessageSquare, CalendarCheck,
  FileSignature, UserCheck, BarChart2, ShieldCheck, Send, Ban,
  Activity, BookOpen, CheckCircle2, XCircle, Lightbulb,
  Eye, EyeOff, User, Info, Sparkles, ExternalLink, ChevronLeft,
  Phone, MapPin, Star, Bookmark, BookmarkCheck,
} from "lucide-react";

// ─── Domain Configuration ─────────────────────────────────────────────────────

const DOMAIN_TABS = [
  { key: "all",          label: "All",            apiKey: "all",          icon: Mail },
  { key: "athlete",      label: "Athlete Leads",  apiKey: "athlete",      icon: Users },
  { key: "team_training",label: "Team Training",  apiKey: "team_training",icon: TrendingUp },
  { key: "schools",      label: "Schools",        apiKey: "schools",      icon: GraduationCap },
  { key: "orgs",         label: "Organizations",  apiKey: "orgs",         icon: Building2 },
  { key: "employment",   label: "Employment",     apiKey: "employment",   icon: Briefcase },
] as const;

const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Lead",
  parent_lead: "Parent Lead",
  team_training: "Team Training",
  school_partnership: "School Partnership",
  athletic_director: "Athletic Director",
  coach_outreach: "Coach Outreach",
  organization_outreach: "Org Outreach",
  business_outreach: "Business Outreach",
  employment_opportunity: "Employment",
  corporate_wellness: "Corporate Wellness",
  facility_partnership: "Facility Partnership",
  gym_owner: "Gym Owner",
};

const DOMAIN_BADGE_CLASS: Record<string, string> = {
  athlete_lead: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  parent_lead: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  team_training: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  school_partnership: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  athletic_director: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  coach_outreach: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  organization_outreach: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  business_outreach: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  employment_opportunity: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  corporate_wellness: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  facility_partnership: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  gym_owner: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
};

const DOMAIN_GROUP_TO_API: Record<string, string[]> = {
  athlete: ["athlete_lead", "parent_lead"],
  team_training: ["team_training"],
  schools: ["school_partnership", "athletic_director", "coach_outreach"],
  orgs: ["organization_outreach", "business_outreach", "corporate_wellness", "facility_partnership"],
  employment: ["employment_opportunity"],
};

// ─── Trigger + Action labels ──────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  form_submission: "Lead submitted form",
  no_reply_72h: "No reply after 72 hours",
  no_reply_48h: "No reply after 48 hours",
  no_reply_24h: "No reply after 24 hours",
  no_reply_7d: "No reply after 7 days",
  missed_appointment: "Missed appointment",
  abandoned_application: "Abandoned application",
  client_inactivity: "Client inactivity",
  followup: "Scheduled follow-up",
  manual: "Manual generation",
  inbound_reply: "Reply received",
  recovery: "Recovery sequence",
  renewal: "Renewal reminder",
  re_engagement: "Re-engagement",
};

function prettyActionType(actionType: string): string {
  const t = (actionType ?? "").replace(/^propose_draft:/, "").replace(/[_-]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function prettyRecipient(email: string | null | undefined): string {
  if (!email) return "Unknown recipient";
  const local = email.split("@")[0].replace(/[._-]/g, " ");
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Array safety helper ──────────────────────────────────────────────────────
// Guards against API error objects (e.g. { message: "Not authorized" }) being
// passed to array methods. The ?? [] pattern doesn't help here because ?? only
// replaces null/undefined — a truthy error object slips through and crashes .filter()
const asArray = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

// Safe fetch wrapper — throws on HTTP errors so TanStack Query treats them as
// errors (data stays undefined) rather than returning the error JSON as data.
async function safeFetch(url: string): Promise<any> {
  return authenticatedFetch(url);
}

// ─── Feedback Chips ───────────────────────────────────────────────────────────

const DOMAIN_FEEDBACK_CHIPS: Record<string, string[]> = {
  athlete_lead: [
    "Too formal", "Too casual", "Too long", "Too short",
    "Mention athlete goals", "Mention sport", "Mention school/grade",
    "Stronger scheduling language", "Missing scheduling link",
    "More personal", "Avoid pricing for now", "Too generic",
  ],
  parent_lead: [
    "Needs parent-friendly language", "Mention parent", "Mention athlete goals",
    "Mention sport", "Too salesy", "Too long", "Warmer tone", "Clearer next step",
    "More personal", "Too formal",
  ],
  evaluation_scheduling: [
    "Stronger scheduling language", "Missing scheduling link", "Clearer next step",
    "Too long", "Too formal", "Weak CTA", "Too casual",
  ],
  retention: [
    "Warmer tone", "More personal", "Reference past sessions",
    "Too aggressive", "Clearer next step", "Too long", "Too formal",
  ],
  payment_recovery: [
    "Too aggressive", "Too salesy", "Too long", "More professional",
    "Clearer next step", "Too formal", "Warmer tone",
  ],
  program_assignment: [
    "Mention athlete goals", "Mention sport", "Better formatting",
    "Clearer next step", "Too long", "Too generic",
  ],
  win_back: [
    "More empathetic", "Mention previous relationship", "Too salesy",
    "Too long", "Clearer next step", "Warmer tone", "Too formal",
  ],
  onboarding: [
    "Too long", "Too formal", "More personal", "Mention athlete goals",
    "Clearer next step", "Better formatting", "Too generic",
  ],
  general: [
    "Too formal", "Too casual", "Too long", "Too short",
    "More personal", "Clearer next step", "Too generic", "Weak CTA",
  ],
};

function getFeedbackChips(domain?: string | null): string[] {
  return DOMAIN_FEEDBACK_CHIPS[domain ?? "general"] ?? DOMAIN_FEEDBACK_CHIPS.general;
}

function FeedbackChips({ selected, onToggle, domain }: { selected: string[]; onToggle: (chip: string) => void; domain?: string | null }) {
  const chips = getFeedbackChips(domain);
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((chip) => (
        <button
          key={chip}
          data-testid={`chip-${chip.toLowerCase().replace(/\s+/g, "-")}`}
          onClick={() => onToggle(chip)}
          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
            selected.includes(chip)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-border hover:border-primary"
          }`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

// ─── Reject Dialog ────────────────────────────────────────────────────────────

function RejectDialog({
  proposalId, open, onClose, onDone,
}: { proposalId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [coaching, setCoaching] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/reject`, {
      reason, coachingFeedbackText: coaching, feedbackTags: chips,
    }),
    onSuccess: () => {
      toast({ title: "Draft rejected" });
      onDone(); onClose(); setReason(""); setCoaching(""); setChips([]);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = reason.trim() || coaching.trim() || chips.length > 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Reject Draft</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason (optional)</Label>
            <Input data-testid="input-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief reason…" className="mt-1" />
          </div>
          <div>
            <Label>Coach the AI (optional)</Label>
            <Textarea
              data-testid="textarea-coaching"
              value={coaching}
              onChange={(e) => setCoaching(e.target.value)}
              placeholder={"What should the AI do differently?\n\nExamples:\n• \"Mention the sport next time\"\n• \"Keep it under 100 words\"\n• \"End with a scheduling link\""}
              className="mt-1 min-h-[100px] text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Quick tags (optional)</Label>
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-reject"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit & Send Dialog ───────────────────────────────────────────────────────

function EditSendDialog({
  proposal, open, onClose, onDone,
}: { proposal: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState(proposal?.subject ?? "");
  const [body, setBody] = useState(proposal?.bodyPreview ?? "");
  const [coaching, setCoaching] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposal.id}/edit-send`, {
      subject, body, coachingFeedbackText: coaching, feedbackTags: chips,
    }),
    onSuccess: () => { toast({ title: "Sent!" }); onDone(); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Edit & Send</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input data-testid="input-edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea data-testid="textarea-edit-body" value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 min-h-[180px] text-sm font-mono" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Coaching note for AI (optional)</Label>
            <Textarea
              data-testid="textarea-edit-coaching"
              value={coaching}
              onChange={(e) => setCoaching(e.target.value)}
              placeholder="What did you change and why?"
              className="mt-1 min-h-[60px] text-sm"
            />
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-edit-send"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !subject || !body}
          >
            {mutation.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Regenerate Dialog ────────────────────────────────────────────────────────

function RegenerateDialog({
  proposal, open, onClose, onDone,
}: { proposal: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [revised, setRevised] = useState<{ subject: string; body: string } | null>(null);
  const { toast } = useToast();

  const regenMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/ai-approvals/${proposal.id}/regenerate`, {
        feedbackText: [feedback, ...chips].filter(Boolean).join(". "),
      }),
    onSuccess: (data: any) => setRevised({ subject: data.subject, body: data.body }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/ai-approvals/${proposal.id}/approve`, {
        subject: revised?.subject, body: revised?.body,
      }),
    onSuccess: () => {
      toast({ title: "Revised draft sent!" });
      onDone(); onClose();
      setFeedback(""); setChips([]); setRevised(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => { onClose(); setRevised(null); setFeedback(""); setChips([]); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Regenerate with Feedback</DialogTitle></DialogHeader>
        {!revised ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell the AI what to improve. It will rewrite the draft using your feedback and past learning rules.
            </p>
            <Textarea
              data-testid="textarea-regen-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="E.g. 'Make it shorter and more personal. End with a direct question.'"
              className="min-h-[80px] text-sm"
            />
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                data-testid="button-regen-submit"
                onClick={() => regenMutation.mutate()}
                disabled={regenMutation.isPending || (!feedback.trim() && chips.length === 0)}
              >
                {regenMutation.isPending
                  ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Regenerating…</>
                  : "Regenerate"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Original</p>
                <div className="rounded-md bg-muted p-3 space-y-1">
                  <p className="text-xs font-medium">{proposal.subject}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{proposal.bodyPreview}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-green-600 mb-1">Revised</p>
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 space-y-1">
                  <p className="text-xs font-medium">{revised.subject}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{revised.body}</p>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRevised(null)}>Try again</Button>
              <Button
                data-testid="button-use-revised"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Sending…" : "Use this draft & Send"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Email Preview Pane ───────────────────────────────────────────────────────

function EmailPreviewPane({
  subject, body, recipientEmail, orgName, logoUrl, primaryColor,
}: {
  subject: string;
  body: string;
  recipientEmail?: string;
  orgName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}) {
  const accentColor = primaryColor?.trim() || "#3b82f6";

  const renderBody = (text: string) => {
    const paragraphs = text.split(/\n\n+/);
    return paragraphs.map((para, pi) => {
      const lines = para.split("\n");
      return (
        <p key={pi} className="mb-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          {lines.map((line, li) => {
            const parts = line.split(/(https?:\/\/[^\s]+)/g);
            return (
              <span key={li}>
                {parts.map((part, ki) =>
                  /^https?:\/\//.test(part) ? (
                    <a key={ki} href={part} className="text-blue-600 dark:text-blue-400 underline break-all"
                       target="_blank" rel="noopener noreferrer">{part}</a>
                  ) : part
                )}
                {li < lines.length - 1 && <br />}
              </span>
            );
          })}
        </p>
      );
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden shadow-sm">
      {/* Email client meta header */}
      <div className="bg-muted/40 border-b px-4 py-3 space-y-1.5">
        <div className="flex items-start gap-2 text-xs">
          <span className="w-10 text-right text-muted-foreground font-medium shrink-0 mt-0.5">From:</span>
          <span className="font-semibold text-foreground">{orgName || "AI Coach"}</span>
        </div>
        {recipientEmail && (
          <div className="flex items-start gap-2 text-xs">
            <span className="w-10 text-right text-muted-foreground font-medium shrink-0 mt-0.5">To:</span>
            <span className="text-foreground">{recipientEmail}</span>
          </div>
        )}
        <div className="flex items-start gap-2 text-xs">
          <span className="w-10 text-right text-muted-foreground font-medium shrink-0 mt-0.5">Subj:</span>
          <span className="font-bold text-foreground">{subject || "(No subject)"}</span>
        </div>
      </div>

      {/* Email body */}
      <div className="bg-white dark:bg-gray-900 px-6 py-5">
        {/* Org header branding */}
        {(logoUrl || orgName) && (
          <div className="flex items-center gap-2 mb-5 pb-4 border-b border-gray-100 dark:border-gray-800">
            {logoUrl ? (
              <img src={logoUrl} alt={orgName ?? ""} className="h-8 max-w-[140px] object-contain" />
            ) : (
              <span className="font-bold text-base" style={{ color: accentColor }}>{orgName}</span>
            )}
          </div>
        )}

        {/* Body paragraphs */}
        <div>{renderBody(body || "No content")}</div>

        {/* CTA hint if links present */}
        {/https?:\/\//.test(body) && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 text-xs text-muted-foreground flex items-center gap-1.5">
            <ExternalLink className="w-3 h-3 shrink-0" />
            Links highlighted above — click to preview destination (opens in new tab).
          </div>
        )}

        {/* Footer */}
        {orgName && (
          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 text-center">
            {orgName}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Approval Review Drawer ───────────────────────────────────────────────────

type DrawerMode = "view" | "reject" | "regen";

function ApprovalReviewDrawer({
  proposalId,
  open,
  onClose,
  onRefresh,
}: {
  proposalId: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<DrawerMode>("view");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectChips, setRejectChips] = useState<string[]>([]);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenChips, setRegenChips] = useState<string[]>([]);
  const [regenResult, setRegenResult] = useState<{ subject: string; body: string } | null>(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [isSaved, setIsSaved] = useState(false);

  const { data: detail, isLoading } = useQuery<any>({
    queryKey: ["/api/ai-approvals/detail", proposalId],
    queryFn: () => safeFetch(`/api/ai-approvals/${proposalId}`),
    enabled: open && !!proposalId,
  });

  const proposal = detail?.proposal;
  const lead = detail?.lead;
  const org = detail?.org as { name?: string; logoUrl?: string | null; primaryColor?: string | null; emailPrimaryColor?: string | null; tagline?: string | null } | null;
  const resultData = (proposal?.result && typeof proposal.result === "object") ? proposal.result as any : {};

  useEffect(() => {
    if (proposal) {
      // Full body source fix: prefer saved edits > result.fullBody > result.body > bodyPreview
      const fullBody = resultData.savedBody ?? resultData.fullBody ?? resultData.body ?? proposal.bodyPreview ?? "";
      const fullSubject = resultData.savedSubject ?? proposal.subject ?? "";
      setSubject(fullSubject);
      setBody(fullBody);
      setIsSaved(!!(resultData.savedBody || resultData.savedSubject));
    }
  }, [proposal?.id]);

  useEffect(() => {
    if (!open) {
      setMode("view");
      setViewMode("edit");
      setIsEditing(false);
      setIsSaved(false);
      setRejectReason("");
      setRejectChips([]);
      setRegenFeedback("");
      setRegenChips([]);
      setRegenResult(null);
    }
  }, [open]);

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/approve`, isEditing ? { subject, body } : {}),
    onSuccess: () => {
      toast({ title: "Sent!", description: `Email delivered to ${proposal?.recipientEmail}` });
      onRefresh(); onClose();
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/reject`, {
      reason: rejectReason,
      feedbackTags: rejectChips,
      coachingFeedbackText: rejectReason,
    }),
    onSuccess: () => {
      toast({ title: "Draft rejected", description: "Feedback saved for AI learning." });
      onRefresh(); onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const regenMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/regenerate`, {
      feedbackText: [regenFeedback, ...regenChips].filter(Boolean).join(". "),
    }).then(parseApiResponse),
    onSuccess: (data: any) => setRegenResult({ subject: data?.subject ?? "", body: data?.body ?? "" }),
    onError: (e: any) => toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const useRegenMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/approve`, {
      subject: regenResult?.subject,
      body: regenResult?.body,
    }),
    onSuccess: () => {
      toast({ title: "Revised draft sent!" });
      onRefresh(); onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/ai-approvals/${proposalId}/save-edits`, {
      editedSubject: subject,
      editedBody: body,
    }),
    onSuccess: () => {
      setIsSaved(true);
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/detail", proposalId] });
      toast({ title: "Edits saved", description: "Draft saved. Email has not been sent." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const toggleRejectChip = (chip: string) =>
    setRejectChips((p) => p.includes(chip) ? p.filter((c) => c !== chip) : [...p, chip]);
  const toggleRegenChip = (chip: string) =>
    setRegenChips((p) => p.includes(chip) ? p.filter((c) => c !== chip) : [...p, chip]);

  const riskColor = proposal?.riskLevel === "low" ? "text-green-600 dark:text-green-400"
    : proposal?.riskLevel === "high" ? "text-red-600 dark:text-red-400"
    : "text-yellow-600 dark:text-yellow-400";

  const domain = proposal?.communicationDomain ?? "athlete_lead";
  const domainLabel = DOMAIN_LABELS[domain] ?? domain;
  const domainClass = DOMAIN_BADGE_CLASS[domain] ?? "bg-gray-100 text-gray-800";
  const isBlocked = proposal?.status === "blocked";
  const isAutoEligible = resultData.autoExecuteEligible === true;
  const triggerLabel = TRIGGER_LABELS[resultData.triggerType ?? ""] ?? resultData.triggerType ?? null;
  const confidence = resultData.confidence != null ? Math.round(Number(resultData.confidence) * 100) : null;

  const recipientName = lead?.name ?? prettyRecipient(proposal?.recipientEmail);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SheetTitle className="text-base flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              Review AI Draft
            </SheetTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {isAutoEligible && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3" /> Policy Approved
                </span>
              )}
              {isBlocked && (
                <span className="flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded-full">
                  <Ban className="w-3 h-3" /> Blocked
                </span>
              )}
              <span className={`text-xs font-semibold uppercase ${riskColor}`} data-testid="drawer-risk-label">
                {proposal?.riskLevel ?? "medium"} risk
              </span>
            </div>
          </div>
          {proposal && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${domainClass}`}>{domainLabel}</span>
              <Badge variant="outline" className="text-xs">{prettyActionType(proposal.actionType)}</Badge>
              {proposal.createdByAgent && (
                <span className="text-xs text-muted-foreground">by {proposal.createdByAgent}</span>
              )}
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : "—"}
              </span>
            </div>
          )}
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !proposal ? (
            <p className="text-center text-muted-foreground py-12">Failed to load proposal.</p>
          ) : (
            <>
              {/* ── Explainability Panel ── */}
              {(triggerLabel || resultData.workflowName || resultData.reasoning || confidence != null) && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" /> Why did the agent generate this?
                  </p>
                  {triggerLabel && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground w-24 shrink-0">Trigger</span>
                      <span className="font-medium">{triggerLabel}</span>
                    </div>
                  )}
                  {(resultData.workflowName || resultData.ruleName) && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground w-24 shrink-0">Rule</span>
                      <span className="font-medium">{resultData.workflowName ?? resultData.ruleName}</span>
                    </div>
                  )}
                  {resultData.reasoning && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground w-24 shrink-0 mt-0.5">Reasoning</span>
                      <span className="text-muted-foreground leading-relaxed">{resultData.reasoning}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                    {confidence != null && (
                      <span>
                        Confidence: <span className={`font-semibold ${confidence >= 80 ? "text-green-600" : confidence >= 60 ? "text-yellow-600" : "text-red-600"}`}>{confidence}%</span>
                      </span>
                    )}
                    <span className={`font-semibold uppercase ${riskColor}`}>
                      {proposal.riskLevel ?? "medium"} risk
                    </span>
                  </div>
                </div>
              )}

              {/* ── Recipient / Lead Context Panel ── */}
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Recipient Context
                </p>

                {/* Avatar + name + email */}
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {recipientName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm" data-testid="drawer-recipient-name">{recipientName}</p>
                    <p className="text-xs text-muted-foreground truncate">{proposal.recipientEmail}</p>
                  </div>
                </div>

                {lead ? (
                  <div className="space-y-3">
                    {/* Pipeline & score row */}
                    {(lead.pipelineStage || lead.temperature || lead.leadScore != null) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {lead.temperature && (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            lead.temperature === "hot" ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" :
                            lead.temperature === "warm" ? "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400" :
                            "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
                          }`} data-testid="badge-lead-temperature">
                            {lead.temperature} lead
                          </span>
                        )}
                        {lead.pipelineStage && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                            {lead.pipelineStage.replace(/_/g, " ")}
                          </span>
                        )}
                        {lead.leadScore != null && (
                          <span className="text-xs flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-500" />
                            <span className="font-semibold">{lead.leadScore}</span>
                            <span className="text-muted-foreground">/ 100</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Key fields grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {lead.athleteName && lead.parentName && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted-foreground">Athlete: </span>
                          <span className="text-xs font-medium">{lead.athleteName}</span>
                        </div>
                      )}
                      {lead.sport && lead.sport !== "unknown" && (
                        <div>
                          <span className="text-xs text-muted-foreground">Sport: </span>
                          <span className="text-xs font-medium capitalize">{lead.sport}</span>
                        </div>
                      )}
                      {lead.position && (
                        <div>
                          <span className="text-xs text-muted-foreground">Position: </span>
                          <span className="text-xs font-medium">{lead.position}</span>
                        </div>
                      )}
                      {(lead.age || lead.grade) && (
                        <div>
                          <span className="text-xs text-muted-foreground">{lead.age ? "Age" : "Grade"}: </span>
                          <span className="text-xs font-medium">{lead.age ?? lead.grade}</span>
                        </div>
                      )}
                      {lead.school && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted-foreground">School: </span>
                          <span className="text-xs font-medium">{lead.school}</span>
                        </div>
                      )}
                      {lead.experienceLevel && (
                        <div>
                          <span className="text-xs text-muted-foreground">Experience: </span>
                          <span className="text-xs font-medium capitalize">{lead.experienceLevel.replace(/_/g, " ")}</span>
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-xs">{lead.phone}</span>
                        </div>
                      )}
                      {(lead.organization || (lead.city && lead.state)) && (
                        <div className="col-span-2 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-xs">{lead.organization ?? `${lead.city}, ${lead.state}`}</span>
                        </div>
                      )}
                      {(lead.bookingStatus ?? lead.outreachStatus) && (
                        <div>
                          <span className="text-xs text-muted-foreground">Status: </span>
                          <span className="text-xs font-medium capitalize">{(lead.bookingStatus ?? lead.outreachStatus ?? "").replace(/_/g, " ")}</span>
                        </div>
                      )}
                      {lead.followUpCount != null && lead.followUpCount > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Follow-ups: </span>
                          <span className="text-xs font-medium">{lead.followUpCount}</span>
                        </div>
                      )}
                      {lead.lastInteractionAt && (
                        <div className="col-span-2">
                          <span className="text-xs text-muted-foreground">Last contact: </span>
                          <span className="text-xs font-medium">{new Date(lead.lastInteractionAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Goals */}
                    {Array.isArray(lead.goals) && lead.goals.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Goals:</p>
                        <div className="flex flex-wrap gap-1">
                          {lead.goals.map((g: string, i: number) => (
                            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{g}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Parent info */}
                    {(lead.parentName || lead.parentEmail) && (
                      <div className="rounded bg-muted/40 px-3 py-2 space-y-0.5">
                        <p className="text-xs font-semibold text-muted-foreground">Parent / Guardian</p>
                        {lead.parentName && <p className="text-xs font-medium">{lead.parentName}</p>}
                        {lead.parentEmail && <p className="text-xs text-muted-foreground">{lead.parentEmail}</p>}
                      </div>
                    )}

                    {/* AI summary */}
                    {lead.aiSummary && (
                      <div className="rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 px-3 py-2">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                          <Brain className="w-3 h-3" /> AI Assessment
                        </p>
                        <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">{lead.aiSummary}</p>
                      </div>
                    )}

                    {/* Suggested next action */}
                    {lead.aiNextAction && (
                      <div className="rounded bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 px-3 py-2">
                        <p className="text-xs font-semibold text-green-700 dark:text-green-300 mb-1 flex items-center gap-1">
                          <Lightbulb className="w-3 h-3" /> Suggested Next Action
                        </p>
                        <p className="text-xs text-green-800 dark:text-green-200 leading-relaxed">{lead.aiNextAction}</p>
                      </div>
                    )}

                    {/* UTM source */}
                    {lead.utmSource && (
                      <p className="text-xs text-muted-foreground">
                        Source: <span className="font-medium">{lead.utmSource}{lead.utmMedium ? ` / ${lead.utmMedium}` : ""}{lead.utmCampaign ? ` — ${lead.utmCampaign}` : ""}</span>
                      </p>
                    )}

                    {/* Workflow context for non-lead drafts */}
                    {(resultData.workflowType || resultData.triggerEvent || resultData.workflowName) && (
                      <div className="rounded bg-muted/40 px-3 py-2 space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground">Workflow Context</p>
                        {resultData.workflowName && <p className="text-xs"><span className="text-muted-foreground">Workflow: </span><span className="font-medium">{resultData.workflowName}</span></p>}
                        {resultData.workflowType && <p className="text-xs"><span className="text-muted-foreground">Type: </span><span className="font-medium capitalize">{String(resultData.workflowType).replace(/_/g, " ")}</span></p>}
                        {resultData.triggerEvent && <p className="text-xs"><span className="text-muted-foreground">Trigger: </span><span className="font-medium">{resultData.triggerEvent}</span></p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic py-1">No linked context found for this draft.</p>
                )}
              </div>

              <Separator />

              {/* ── Email Draft / Editor / Preview ── */}
              {mode === "view" && (
                <div className="space-y-3">
                  {/* Section header with Edit/Preview toggle */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      Email Draft
                      {isSaved && (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 ml-1">
                          <BookmarkCheck className="w-3 h-3" /> Edits saved
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Edit/Preview toggle */}
                      <div className="flex items-center rounded-md border overflow-hidden text-xs">
                        <button
                          className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${viewMode === "edit" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => { setViewMode("edit"); }}
                          data-testid="button-view-mode-edit"
                        >
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                        <button
                          className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${viewMode === "preview" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => { setViewMode("preview"); setIsEditing(false); }}
                          data-testid="button-view-mode-preview"
                        >
                          <Eye className="w-3 h-3" /> Preview
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── EDIT MODE ── */}
                  {viewMode === "edit" && (
                    <div className="space-y-3">
                      {/* Subject */}
                      <div>
                        <p className="text-xs text-muted-foreground font-medium mb-1">SUBJECT</p>
                        {isEditing ? (
                          <Input
                            data-testid="drawer-input-subject"
                            value={subject}
                            onChange={(e) => { setSubject(e.target.value); setIsSaved(false); }}
                            className="text-sm font-medium"
                          />
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold bg-muted/30 rounded px-3 py-2 border flex-1" data-testid="drawer-text-subject">
                              {subject || "(No subject)"}
                            </p>
                            <button
                              className="text-xs text-primary underline flex items-center gap-1 shrink-0"
                              onClick={() => setIsEditing(true)}
                              data-testid="button-toggle-edit"
                            >
                              <Edit3 className="w-3 h-3" /> Edit
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div>
                        <p className="text-xs text-muted-foreground font-medium mb-1">EMAIL BODY</p>
                        {isEditing ? (
                          <Textarea
                            data-testid="drawer-textarea-body"
                            value={body}
                            onChange={(e) => { setBody(e.target.value); setIsSaved(false); }}
                            className="min-h-[280px] text-sm font-mono leading-relaxed"
                          />
                        ) : (
                          <div className="bg-muted/30 rounded border px-3 py-3">
                            <pre className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-sans" data-testid="drawer-text-body">
                              {body || "No content"}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* Cancel edit link */}
                      {isEditing && (
                        <button
                          className="text-xs text-muted-foreground underline"
                          onClick={() => {
                            const fullBody = resultData.savedBody ?? resultData.fullBody ?? resultData.body ?? proposal?.bodyPreview ?? "";
                            const fullSubject = resultData.savedSubject ?? proposal?.subject ?? "";
                            setSubject(fullSubject);
                            setBody(fullBody);
                            setIsEditing(false);
                          }}
                        >
                          Discard changes
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── PREVIEW MODE ── */}
                  {viewMode === "preview" && (
                    <EmailPreviewPane
                      subject={subject}
                      body={body}
                      recipientEmail={proposal?.recipientEmail ?? undefined}
                      orgName={org?.name ?? undefined}
                      logoUrl={org?.logoUrl ?? undefined}
                      primaryColor={org?.primaryColor ?? org?.emailPrimaryColor ?? undefined}
                    />
                  )}
                </div>
              )}

              {/* ── Reject Flow ── */}
              {mode === "reject" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMode("view")} className="text-muted-foreground hover:text-foreground">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <p className="text-sm font-semibold">Reject & Coach the AI</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your feedback trains the agent to generate better drafts in the future.
                  </p>
                  <Textarea
                    data-testid="drawer-textarea-reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="What should the AI do differently? e.g. 'Make it shorter, mention the sport, end with a question.'"
                    className="min-h-[80px] text-sm"
                  />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Quick tags (optional)</p>
                    <FeedbackChips selected={rejectChips} onToggle={toggleRejectChip} domain={domain} />
                  </div>
                </div>
              )}

              {/* ── Regen Flow ── */}
              {mode === "regen" && !regenResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMode("view")} className="text-muted-foreground hover:text-foreground">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <p className="text-sm font-semibold">Regenerate with Feedback</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Describe what to improve. The AI will rewrite using your feedback and past learning rules.
                  </p>
                  <Textarea
                    data-testid="drawer-textarea-regen-feedback"
                    value={regenFeedback}
                    onChange={(e) => setRegenFeedback(e.target.value)}
                    placeholder="E.g. 'Make it shorter and more personal. End with a direct question.'"
                    className="min-h-[80px] text-sm"
                  />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Quick tags</p>
                    <FeedbackChips selected={regenChips} onToggle={toggleRegenChip} domain={domain} />
                  </div>
                </div>
              )}

              {/* ── Regen Result Preview ── */}
              {mode === "regen" && regenResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setRegenResult(null)} className="text-muted-foreground hover:text-foreground">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <p className="text-sm font-semibold">Revised Draft</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Original</p>
                      <div className="rounded-md bg-muted p-3 space-y-1 h-full">
                        <p className="text-xs font-medium">{proposal.subject}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{proposal.bodyPreview}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-600 mb-1">Revised</p>
                      <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 space-y-1">
                        <p className="text-xs font-medium">{regenResult.subject}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{regenResult.body}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky Footer */}
        {proposal && !isBlocked && (
          <div className="border-t px-5 py-4 shrink-0 bg-background">
            {mode === "view" && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  data-testid="drawer-button-approve"
                  size="sm"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || saveMutation.isPending || (isEditing && (!subject.trim() || !body.trim()))}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {approveMutation.isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending…</>
                    : isEditing
                    ? <><Send className="w-3.5 h-3.5 mr-1.5" />Edit & Send</>
                    : <><CheckCheck className="w-3.5 h-3.5 mr-1.5" />Approve & Send</>}
                </Button>
                {isEditing && (
                  <Button
                    data-testid="drawer-button-save"
                    size="sm"
                    variant="outline"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || approveMutation.isPending || !subject.trim() || !body.trim()}
                  >
                    {saveMutation.isPending
                      ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</>
                      : <><Bookmark className="w-3.5 h-3.5 mr-1.5" />Save & Review Later</>}
                  </Button>
                )}
                <Button
                  data-testid="drawer-button-regen"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("regen")}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />Regenerate
                </Button>
                <Button
                  data-testid="drawer-button-reject"
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                  onClick={() => setMode("reject")}
                >
                  <X className="w-3.5 h-3.5 mr-1.5" />Reject
                </Button>
              </div>
            )}

            {mode === "reject" && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode("view")}>Cancel</Button>
                <Button
                  data-testid="drawer-button-confirm-reject"
                  variant="destructive"
                  size="sm"
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending || (!rejectReason.trim() && rejectChips.length === 0)}
                >
                  {rejectMutation.isPending ? "Rejecting…" : "Confirm Reject"}
                </Button>
              </div>
            )}

            {mode === "regen" && !regenResult && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode("view")}>Cancel</Button>
                <Button
                  data-testid="drawer-button-confirm-regen"
                  size="sm"
                  onClick={() => regenMutation.mutate()}
                  disabled={regenMutation.isPending || (!regenFeedback.trim() && regenChips.length === 0)}
                >
                  {regenMutation.isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Regenerating…</>
                    : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Regenerate</>}
                </Button>
              </div>
            )}

            {mode === "regen" && regenResult && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setRegenResult(null)}>Try again</Button>
                <Button
                  data-testid="drawer-button-use-revised"
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => useRegenMutation.mutate()}
                  disabled={useRegenMutation.isPending}
                >
                  {useRegenMutation.isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending…</>
                    : <><CheckCheck className="w-3.5 h-3.5 mr-1.5" />Use Revised & Send</>}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Proposal Card (mobile-first) ─────────────────────────────────────────────

function ProposalCard({ proposal, onRefresh }: { proposal: any; onRefresh: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { toast } = useToast();

  const domain = proposal.communicationDomain ?? "athlete_lead";
  const domainLabel = DOMAIN_LABELS[domain] ?? domain;
  const domainClass = DOMAIN_BADGE_CLASS[domain] ?? "bg-gray-100 text-gray-800";

  const resultData = (proposal.result && typeof proposal.result === "object") ? proposal.result as any : {};
  const isAutoEligible = resultData.autoExecuteEligible === true;
  const isBlocked = proposal.status === "blocked";

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposal.id}/approve`, {}),
    onSuccess: () => { toast({ title: "Sent!" }); onRefresh(); },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const riskColor =
    proposal.riskLevel === "low" ? "text-green-600 dark:text-green-400" :
    proposal.riskLevel === "high" ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400";

  const cardBorder = isAutoEligible
    ? "border-green-200 dark:border-green-800 ring-1 ring-green-200 dark:ring-green-800"
    : isBlocked
    ? "border-red-200 dark:border-red-900 opacity-75"
    : "";

  const recipientDisplay = prettyRecipient(proposal.recipientEmail);

  return (
    <>
      <Card
        data-testid={`card-proposal-${proposal.id}`}
        className={`hover:shadow-md transition-shadow cursor-pointer ${cardBorder}`}
        onClick={() => setDrawerOpen(true)}
      >
        <CardContent className="p-4 space-y-2.5">
          {/* Status badges row */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${domainClass}`} data-testid={`badge-domain-${proposal.id}`}>
                {domainLabel}
              </span>
              {isAutoEligible && (
                <span
                  data-testid={`badge-auto-eligible-${proposal.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300"
                >
                  <ShieldCheck className="w-3 h-3" /> Policy Approved
                </span>
              )}
              {isBlocked && (
                <span
                  data-testid={`badge-blocked-${proposal.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"
                >
                  <Ban className="w-3 h-3" /> Blocked
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>

          {/* Recipient + subject */}
          <div>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm" data-testid={`text-recipient-${proposal.id}`}>{recipientDisplay}</p>
              <span className={`text-xs font-medium ${riskColor}`} data-testid={`text-risk-${proposal.id}`}>
                · {proposal.riskLevel?.toUpperCase() ?? "MEDIUM"} RISK
              </span>
            </div>
            <p className="text-sm font-medium truncate text-foreground/80 mt-0.5" data-testid={`text-subject-${proposal.id}`}>
              {proposal.subject ?? "(No subject)"}
            </p>
          </div>

          {/* Body snippet */}
          <p
            className="text-xs text-muted-foreground leading-relaxed line-clamp-2"
            data-testid={`text-body-${proposal.id}`}
          >
            {proposal.bodyPreview ?? "No content"}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-0.5" onClick={(e) => e.stopPropagation()}>
            <Button
              data-testid={`button-review-${proposal.id}`}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
            >
              <Eye className="w-3 h-3 mr-1" />Review
            </Button>
            {!isBlocked && (
              <Button
                data-testid={`button-approve-${proposal.id}`}
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                onClick={(e) => { e.stopPropagation(); approveMutation.mutate(); }}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending
                  ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Sending…</>
                  : <><CheckCheck className="w-3 h-3 mr-1" />{isAutoEligible ? "Send Now" : "Approve & Send"}</>}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ApprovalReviewDrawer
        proposalId={proposal.id}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefresh={onRefresh}
      />
    </>
  );
}

// ─── Metrics Bar ─────────────────────────────────────────────────────────────

function MetricsBar({ domain }: { domain: string }) {
  const { data: metrics } = useQuery<any>({
    queryKey: ["/api/ai-approvals/metrics", domain],
    queryFn: () => safeFetch(`/api/ai-approvals/metrics?domain=${domain}`),
  });
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;

  const autoEligibleCount = metrics.autoEligible ?? 0;

  return (
    <div className="space-y-3">
      {autoEligibleCount > 0 && (
        <div
          data-testid="banner-auto-eligible"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-300"
        >
          <ShieldCheck className="w-4 h-4 shrink-0 text-green-600" />
          <span>
            <span className="font-semibold">{autoEligibleCount} draft{autoEligibleCount !== 1 ? "s" : ""}</span>
            {" "}already passed governance checks. Review is optional.{" "}
            <span className="text-green-600 font-medium">Click Send Now to deliver.</span>
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Auto-Eligible",  value: metrics.autoEligible ?? 0,  icon: ShieldCheck,   color: "text-green-600",  card: "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10" },
          { label: "Pending",        value: metrics.pending,               icon: Clock,         color: "text-yellow-600", card: "" },
          { label: "Approval Rate",  value: metrics.approvalRate != null ? `${metrics.approvalRate}%` : "—", icon: TrendingUp, color: "text-blue-600", card: "" },
          { label: "Total Reviewed", value: metrics.totalReviewed,         icon: CheckCheck,    color: "text-blue-600",   card: "" },
          { label: "Oldest Pending", value: metrics.oldestPendingHours != null ? `${metrics.oldestPendingHours}h` : "—", icon: AlertTriangle, color: "text-orange-600", card: "" },
        ].map(({ label, value, icon: Icon, color, card }) => (
          <Card key={label} className={`p-3 ${card}`}>
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${color} shrink-0`} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-bold" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {value ?? "—"}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Autonomy Panel ───────────────────────────────────────────────────────────

const LEVEL_LABELS = ["Manual Review", "Notify Only", "Auto-Send Low Risk", "Full Autonomy"];
const LEVEL_COLORS = [
  "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
];

function AutonomyPanel({ activeDomainTab }: { activeDomainTab: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: autonomyData } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals/autonomy"],
    queryFn: () => safeFetch("/api/ai-approvals/autonomy"),
  });

  const allowedDomains = activeDomainTab !== "all" ? (DOMAIN_GROUP_TO_API[activeDomainTab] ?? null) : null;
  const displayData = asArray<any>(autonomyData).filter((d) => !allowedDomains || allowedDomains.includes(d.domain));

  const promoteMutation = useMutation({
    mutationFn: ({ domain, level }: { domain: string; level: number }) =>
      apiRequest("POST", `/api/ai-approvals/autonomy/intake_outreach`, {
        autonomyLevel: level, enabled: level > 0, communicationDomain: domain,
      }),
    onSuccess: () => {
      toast({ title: "Autonomy updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/autonomy"] });
    },
    onError: () => toast({ title: "Error updating autonomy", variant: "destructive" }),
  });

  if (!autonomyData?.length) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                <CardTitle className="text-sm">Autonomy by Domain</CardTitle>
                <span className="text-xs text-muted-foreground ml-1">
                  ({displayData.filter((d) => d.domainAutonomyLevel > 0).length}/{displayData.length} enabled)
                </span>
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-2">
            {displayData.map((d) => {
              const level = Math.min(d.domainAutonomyLevel ?? 0, 3);
              const hasRepeated = (d.repeatedMistakes?.length ?? 0) > 0;
              return (
                <div key={d.domain} data-testid={`autonomy-card-${d.domain}`} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{DOMAIN_LABELS[d.domain] ?? d.domain}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_COLORS[level]}`}>
                        L{level}: {LEVEL_LABELS[level]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{d.totalReviewed} reviewed</span>
                      <span>{d.approvalRate}% approved</span>
                      {d.ruleCount > 0 && <span className="text-blue-600">{d.ruleCount} rules</span>}
                    </div>
                  </div>

                  {hasRepeated && (
                    <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 dark:bg-orange-950/20 rounded px-2 py-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Repeated mistakes block promotion: {d.repeatedMistakes.join(", ")}
                    </div>
                  )}

                  {(d.readyForLevel2 || d.readyForLevel3) && !hasRepeated && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600">
                        Ready for Level {d.readyForLevel3 ? 3 : 2}
                      </span>
                      <Button
                        size="sm" variant="outline"
                        className="h-6 text-xs"
                        data-testid={`button-promote-${d.domain}`}
                        onClick={() => promoteMutation.mutate({ domain: d.domain, level: d.readyForLevel3 ? 3 : 2 })}
                        disabled={promoteMutation.isPending}
                      >
                        Promote
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Learning Dashboard ───────────────────────────────────────────────────────

// ─── Learning Health Card ─────────────────────────────────────────────────────

const DOMAIN_LABEL_MAP: Record<string, string> = {
  athlete_lead: "Athlete Leads", parent_lead: "Parent Leads",
  team_training: "Team Training", school_partnership: "School Partnerships",
  athletic_director: "Athletic Directors", coach_outreach: "Coach Outreach",
  organization_outreach: "Org Outreach", business_outreach: "Business Outreach",
  employment_opportunity: "Employment", corporate_wellness: "Corporate Wellness",
  facility_partnership: "Facility Partnerships", gym_owner: "Gym Owners",
};

function LearningHealthCard() {
  const { data: health, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/learning-health"],
    refetchInterval: 60_000,
  });

  const score = health?.healthScore ?? null;
  const scoreColor =
    score === null ? "text-muted-foreground" :
    score >= 80 ? "text-green-600 dark:text-green-400" :
    score >= 50 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-600 dark:text-red-400";
  const scoreBg =
    score === null ? "" :
    score >= 80 ? "border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-950/10" :
    score >= 50 ? "border-yellow-200 dark:border-yellow-800 bg-yellow-50/40 dark:bg-yellow-950/10" :
    "border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-950/10";

  const fb = health?.feedback7d ?? {};
  const approvalRatio = fb.approvalRatio;
  const conversionRate = fb.conversionRate;

  return (
    <Card data-testid="learning-health-card" className={`mb-4 ${scoreBg}`}>
      <CardHeader className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm">Learning System Health</CardTitle>
            {score !== null && (
              <span data-testid="health-score" className={`text-sm font-bold ${scoreColor}`}>
                {score}/100
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">Last 7 days</span>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !health ? (
          <p className="text-sm text-muted-foreground">No data available.</p>
        ) : (
          <div className="space-y-3">
            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div data-testid="stat-feedback" className="bg-background/60 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Feedback received</p>
                <p className="text-xl font-bold">{fb.total ?? 0}</p>
                {fb.total > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="text-green-600">✓{fb.approved ?? 0}</span>
                    {" · "}
                    <span className="text-red-600">✗{fb.rejected ?? 0}</span>
                  </p>
                )}
              </div>
              <div data-testid="stat-rules" className="bg-background/60 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Rules created</p>
                <p className="text-xl font-bold">{health.totalRules ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">active rules</p>
              </div>
              <div data-testid="stat-approval-ratio" className="bg-background/60 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Approval ratio</p>
                <p className={`text-xl font-bold ${approvalRatio === null ? "text-muted-foreground" : approvalRatio >= 60 ? "text-green-600" : "text-yellow-600"}`}>
                  {approvalRatio !== null ? `${approvalRatio}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">of reviews</p>
              </div>
              <div data-testid="stat-domain-coverage" className="bg-background/60 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Domain coverage</p>
                <p className="text-xl font-bold">
                  {health.domainsWithRules ?? 0}
                  <span className="text-sm font-normal text-muted-foreground">/{health.totalDomains ?? 12}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">domains learned</p>
              </div>
            </div>

            {/* Conversion rate bar */}
            {fb.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> Feedback → Rules conversion
                  </span>
                  <span className="font-medium">{conversionRate ?? 0}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    data-testid="conversion-bar"
                    className={`h-1.5 rounded-full transition-all ${
                      (conversionRate ?? 0) >= 50 ? "bg-green-500" :
                      (conversionRate ?? 0) >= 20 ? "bg-yellow-500" : "bg-red-400"
                    }`}
                    style={{ width: `${Math.min(conversionRate ?? 0, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Domains with zero rules */}
            {(health.domainsWithZeroRules ?? []).length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Learning blind spots — no rules yet
                </p>
                <div className="flex flex-wrap gap-1">
                  {(health.domainsWithZeroRules as string[]).map((d) => (
                    <span
                      key={d}
                      data-testid={`blind-spot-${d}`}
                      className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full"
                    >
                      {DOMAIN_LABEL_MAP[d] ?? d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Failed extractions warning */}
            {(health.failedExtractions ?? 0) > 0 && (
              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-400">
                  <span className="font-semibold">{health.failedExtractions}</span> rejection{health.failedExtractions !== 1 ? "s" : ""} had reasons but failed to generate rules.
                  Reasons may be too vague for the AI to extract actionable rules.
                </p>
              </div>
            )}

            {/* Latest rule */}
            {health.latestRule && (
              <div className="bg-muted/40 border rounded-lg p-3 flex items-start gap-2">
                <Lightbulb className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">Latest learned rule</p>
                  <p data-testid="latest-rule-text" className="text-xs font-medium leading-relaxed truncate">
                    {health.latestRule.rule_text}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {DOMAIN_LABEL_MAP[health.latestRule.communication_domain] ?? health.latestRule.communication_domain}
                    {" · "}
                    {health.latestRule.rule_type}
                  </p>
                </div>
              </div>
            )}

            {/* All good state */}
            {(health.failedExtractions ?? 0) === 0 && (health.domainsWithZeroRules ?? []).length <= 4 && (health.totalRules ?? 0) > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Learning system active — {health.totalRules} rules across {health.domainsWithRules} domains
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Learning Dashboard (full rule explorer) ──────────────────────────────────

function LearningDashboard({ activeDomainTab }: { activeDomainTab: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [activeLearningDomain, setActiveLearningDomain] = useState("athlete_lead");

  const { data: dashboard } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals/learning-dashboard"],
    enabled: open,
  });

  const archiveMutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiRequest("PATCH", `/api/ai-approvals/learning-rules/${ruleId}`, { status: "archived" }),
    onSuccess: () => {
      toast({ title: "Rule archived" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/learning-dashboard"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const globalMutation = useMutation({
    mutationFn: ({ id, val }: { id: string; val: boolean }) =>
      apiRequest("PATCH", `/api/ai-approvals/learning-rules/${id}`, { appliesGlobally: val }),
    onSuccess: () => {
      toast({ title: "Rule updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/learning-dashboard"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const allowedApiDomains = activeDomainTab !== "all" ? (DOMAIN_GROUP_TO_API[activeDomainTab] ?? null) : null;
  const visibleDomains = asArray<any>(dashboard).filter((d) => !allowedApiDomains || allowedApiDomains.includes(d.domain));
  const activeEntry = visibleDomains.find((d) => d.domain === activeLearningDomain) ?? visibleDomains[0];

  const totalRules = asArray<any>(dashboard).reduce((s: number, d: any) => s + (d.rulesCount ?? 0), 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-500" />
                <CardTitle className="text-sm">What the AI Has Learned</CardTitle>
                {totalRules > 0 && (
                  <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">
                    {totalRules} rules
                  </span>
                )}
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0">
            {!dashboard ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : visibleDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No learning data yet for this domain.</p>
            ) : (
              <div className="flex gap-4 min-h-[200px]">
                {/* Domain sidebar nav */}
                <div className="flex flex-col gap-1 min-w-[160px] shrink-0">
                  {visibleDomains.map((d) => (
                    <button
                      key={d.domain}
                      data-testid={`learning-nav-${d.domain}`}
                      onClick={() => setActiveLearningDomain(d.domain)}
                      className={`text-left text-xs px-3 py-2 rounded-md transition-colors ${
                        activeEntry?.domain === d.domain
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="block font-medium">{d.label}</span>
                      <span className="opacity-70">{d.rulesCount} rules · {d.reviewedCount} reviewed</span>
                      {d.autoEligibleRate != null && (
                        <span
                          data-testid={`auto-eligible-rate-${d.domain}`}
                          className={`block mt-0.5 font-semibold ${
                            activeEntry?.domain === d.domain
                              ? "text-green-200"
                              : "text-green-600 dark:text-green-400"
                          }`}
                        >
                          {d.autoEligibleRate}% Auto-Eligible
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Rules content */}
                {activeEntry && (
                  <div className="flex-1 space-y-4 min-w-0">
                    {/* Outcome summary */}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="text-green-600 font-medium">
                        ✓ {(activeEntry.outcomes?.approved ?? 0) + (activeEntry.outcomes?.edited ?? 0)} approved
                      </span>
                      <span className="text-red-600 font-medium">
                        ✗ {activeEntry.outcomes?.rejected ?? 0} rejected
                      </span>
                      <span>📧 {activeEntry.outcomes?.sent ?? 0} sent</span>
                      {(activeEntry.outcomes?.replied ?? 0) > 0 && (
                        <span>💬 {activeEntry.outcomes.replied} replied</span>
                      )}
                    </div>

                    {/* Repeated mistakes warning */}
                    {activeEntry.repeatedMistakes?.length > 0 && (
                      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Repeated Mistakes — blocks autonomy promotion
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {activeEntry.repeatedMistakes.map((m: any) => (
                            <span key={m.tag ?? m} className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-2 py-0.5 rounded-full">
                              {m.tag ?? m}{m.count ? ` ×${m.count}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rule categories */}
                    {[
                      { key: "doRules",     emoji: "✅", label: "Do" },
                      { key: "avoidRules",  emoji: "🚫", label: "Avoid" },
                      { key: "toneRules",   emoji: "🎙",  label: "Tone" },
                      { key: "ctaRules",    emoji: "👆", label: "CTA" },
                      { key: "lengthRules", emoji: "📏", label: "Length" },
                    ].map(({ key, emoji, label }) => {
                      const rules: any[] = activeEntry[key] ?? [];
                      if (rules.length === 0) return null;
                      return (
                        <div key={key}>
                          <p className="text-xs font-semibold mb-1.5">{emoji} {label}</p>
                          <div className="space-y-1.5">
                            {rules.map((r: any) => (
                              <div
                                key={r.id}
                                data-testid={`rule-${r.id}`}
                                className="flex items-start gap-2 text-xs text-muted-foreground group"
                              >
                                <span className="flex-1 leading-relaxed">{r.text}</span>
                                <span className="opacity-40 shrink-0 tabular-nums">
                                  {Math.round(parseFloat(r.confidence ?? "0.75") * 100)}%
                                </span>
                                <button
                                  data-testid={`button-globe-${r.id}`}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  title={r.appliesGlobally ? "Remove global" : "Apply globally"}
                                  onClick={() => globalMutation.mutate({ id: r.id, val: !r.appliesGlobally })}
                                >
                                  <Globe className={`w-3 h-3 ${r.appliesGlobally ? "text-blue-500" : "text-muted-foreground"}`} />
                                </button>
                                <button
                                  data-testid={`button-archive-${r.id}`}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  title="Archive rule"
                                  onClick={() => archiveMutation.mutate(r.id)}
                                >
                                  <Archive className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Top rejection tags */}
                    {activeEntry.topRejectionTags?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-1.5">🏷 Top Rejection Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {activeEntry.topRejectionTags.map((t: any) => (
                            <span
                              key={t.tag}
                              className="text-xs bg-muted px-2 py-0.5 rounded-full"
                            >
                              {t.tag} <span className="text-muted-foreground">×{t.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Proposals Panel ──────────────────────────────────────────────────────────

function ProposalsPanel({ domain }: { domain: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: rawProposals, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/ai-approvals", domain],
    queryFn: () => safeFetch(`/api/ai-approvals?domain=${domain}`),
  });
  // Normalize: API always returns an array, but guard against error objects
  const proposals = asArray<any>(rawProposals);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/metrics"] });
  };

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/ai-approvals/bulk-approve", { ids }).then(parseApiResponse),
    onSuccess: (data: any) => {
      toast({ title: `Bulk approved: ${data?.sent ?? 0} sent` });
      setSelected(new Set()); invalidate();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/ai-approvals/bulk-reject", { ids }),
    onSuccess: () => { toast({ title: "Bulk rejected" }); setSelected(new Set()); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectableProposals = proposals.filter((p) => p.status !== "blocked");
  const allSelected = selectableProposals.length > 0 && selectableProposals.every((p) => selected.has(p.id));

  if (isError) {
    return (
      <QueryErrorState
        title="Unable to load approval queue"
        message="There was a problem fetching AI proposals. Please try again."
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Loading drafts…</div>;
  }

  return (
    <div>
      {proposals.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="checkbox-select-all"
              checked={allSelected}
              onChange={() => allSelected ? setSelected(new Set()) : setSelected(new Set(selectableProposals.map((p) => p.id)))}
              className="rounded"
            />
            Select all ({selectableProposals.length})
          </label>
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                data-testid="button-bulk-approve"
                onClick={() => bulkApproveMutation.mutate([...selected])}
                disabled={bulkApproveMutation.isPending}
              >
                <CheckCheck className="w-3 h-3 mr-1" /> Approve {selected.size}
              </Button>
              <Button
                size="sm" variant="outline"
                className="text-red-600 border-red-200 h-7 text-xs"
                data-testid="button-bulk-reject"
                onClick={() => bulkRejectMutation.mutate([...selected])}
                disabled={bulkRejectMutation.isPending}
              >
                <X className="w-3 h-3 mr-1" /> Reject {selected.size}
              </Button>
            </>
          )}
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="text-center py-16" data-testid="text-empty-state">
          <CheckCheck className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">All caught up!</p>
          <p className="text-sm text-muted-foreground mt-1">No pending AI drafts for this domain.</p>
        </div>
      ) : (() => {
        const autoEligibleGroup = proposals.filter((p) => {
          const r = (p.result && typeof p.result === "object") ? p.result as any : {};
          return r.autoExecuteEligible === true;
        });
        const blockedGroup = proposals.filter((p) => p.status === "blocked");
        const awaitingGroup = proposals.filter((p) => {
          const r = (p.result && typeof p.result === "object") ? p.result as any : {};
          return p.status !== "blocked" && r.autoExecuteEligible !== true;
        });

        const renderGroup = (items: any[], selectable = true) => items.map((p) => (
          <div key={p.id} className="flex items-start gap-2">
            {selectable ? (
              <input
                type="checkbox"
                data-testid={`checkbox-select-${p.id}`}
                checked={selected.has(p.id)}
                onChange={() => toggleSelect(p.id)}
                className="mt-4 rounded"
              />
            ) : (
              <div className="w-4 mt-4 shrink-0" />
            )}
            <div className="flex-1">
              <ProposalCard proposal={p} onRefresh={invalidate} />
            </div>
          </div>
        ));

        return (
          <div className="space-y-6">
            {autoEligibleGroup.length > 0 && (
              <div data-testid="section-auto-eligible">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                    Auto-Eligible ({autoEligibleGroup.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — Passed all governance checks. Ready to send with one click.
                  </span>
                </div>
                <div className="space-y-3">{renderGroup(autoEligibleGroup)}</div>
              </div>
            )}

            {awaitingGroup.length > 0 && (
              <div data-testid="section-awaiting-review">
                {autoEligibleGroup.length > 0 && <div className="border-t my-2" />}
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-yellow-600" />
                  <span className="text-sm font-semibold text-foreground">
                    Awaiting Review ({awaitingGroup.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — Requires human review before sending.
                  </span>
                </div>
                <div className="space-y-3">{renderGroup(awaitingGroup)}</div>
              </div>
            )}

            {blockedGroup.length > 0 && (
              <div data-testid="section-blocked">
                {(autoEligibleGroup.length > 0 || awaitingGroup.length > 0) && <div className="border-t my-2" />}
                <div className="flex items-center gap-2 mb-3">
                  <Ban className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Blocked ({blockedGroup.length})
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — Blocked by governance policy.
                  </span>
                </div>
                <div className="space-y-3">{renderGroup(blockedGroup, false)}</div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Outcomes Panel ───────────────────────────────────────────────────────────

const OUTCOME_STATUS_OPTIONS = [
  { value: "sent",               label: "Sent" },
  { value: "opened",             label: "Opened" },
  { value: "replied",            label: "Replied" },
  { value: "meeting_booked",     label: "Meeting Booked" },
  { value: "proposal_requested", label: "Proposal Requested" },
  { value: "proposal_sent",      label: "Proposal Sent" },
  { value: "proposal_accepted",  label: "Proposal Accepted" },
  { value: "contract_signed",    label: "Contract Signed" },
  { value: "hired",              label: "Hired" },
  { value: "booked_session",     label: "Session Booked" },
  { value: "converted",          label: "Converted" },
  { value: "lost",               label: "Lost" },
  { value: "bounced",            label: "Bounced" },
  { value: "ignored",            label: "Ignored" },
];

const OUTCOME_STATUS_COLOR: Record<string, string> = {
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  opened: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  replied: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  meeting_booked: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  proposal_requested: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  proposal_sent: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  proposal_accepted: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  contract_signed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  hired: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  booked_session: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  converted: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  bounced: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ignored: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function OutcomesPanel({ activeDomainTab }: { activeDomainTab: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: dashboard } = useQuery<any>({
    queryKey: ["/api/outcomes/dashboard"],
    queryFn: () => safeFetch("/api/outcomes/dashboard"),
    enabled: open,
  });

  const { data: rawSentMessages } = useQuery<any>({
    queryKey: ["/api/outcomes/sent", activeDomainTab],
    queryFn: () => safeFetch(`/api/outcomes/sent?domain=${activeDomainTab}`),
    enabled: open,
  });
  // Normalize: API returns an array, but guard against error objects or undefined
  const sentMessages = asArray<any>(rawSentMessages);

  const updateMutation = useMutation({
    mutationFn: ({ id, outcomeStatus, revenueCents }: { id: string; outcomeStatus: string; revenueCents?: number }) =>
      apiRequest("PATCH", `/api/outcomes/${id}`, { outcomeStatus, revenueCents }),
    onSuccess: () => {
      toast({ title: "Outcome updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes/sent"] });
    },
    onError: () => toast({ title: "Error updating outcome", variant: "destructive" }),
  });

  const allowedDomains = activeDomainTab !== "all" ? (DOMAIN_GROUP_TO_API[activeDomainTab] ?? null) : null;
  const overall = dashboard?.overall;

  const byDomain = asArray<any>(dashboard?.byDomain).filter((d: any) =>
    !allowedDomains || allowedDomains.includes(d.domain),
  );

  const displayMessages = allowedDomains
    ? sentMessages.filter((m: any) => allowedDomains.includes(m.communicationDomain ?? ""))
    : sentMessages;

  const fmtRevenue = (cents: number) =>
    cents >= 100 ? `$${Math.round(cents / 100).toLocaleString()}` : `$0`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-green-500" />
                <CardTitle className="text-sm">Outcome Intelligence</CardTitle>
                {overall && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({overall.total} sent · {overall.replyRate}% reply rate)
                  </span>
                )}
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-5">

            {/* Overall metrics */}
            {overall && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Sent",          value: overall.total,              icon: Mail,          color: "text-blue-600" },
                  { label: "Replied",       value: `${overall.replied} (${overall.replyRate}%)`, icon: MessageSquare,  color: "text-green-600" },
                  { label: "Meetings",      value: overall.meetingsBooked,     icon: CalendarCheck, color: "text-emerald-600" },
                  { label: "Contracts",     value: overall.contractsSigned,    icon: FileSignature, color: "text-purple-600" },
                  { label: "Hires",         value: overall.hires,              icon: UserCheck,     color: "text-violet-600" },
                  { label: "Sessions",      value: overall.sessionsBooked,     icon: Award,         color: "text-orange-600" },
                  { label: "Proposals",     value: overall.proposalsRequested, icon: BarChart2,     color: "text-teal-600" },
                  { label: "Revenue",       value: fmtRevenue(overall.revenueCents ?? 0), icon: DollarSign, color: "text-amber-600" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-lg border bg-muted/20 p-2.5 flex items-center gap-2">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
                    <div>
                      <p className="text-xs text-muted-foreground leading-none">{label}</p>
                      <p className="text-sm font-bold leading-tight mt-0.5">{value ?? 0}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* By-domain breakdown */}
            {byDomain.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">BY DOMAIN</p>
                <div className="space-y-1.5">
                  {byDomain.map((d: any) => (
                    <div key={d.domain} className="rounded-lg border p-2.5 space-y-1.5" data-testid={`outcome-domain-${d.domain}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-medium">{d.label}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">{d.sent} sent</span>
                          <span className="text-green-600">{d.replyRate}% replied</span>
                          <span className="text-emerald-600">{d.meetingRate}% meetings</span>
                          <span className="text-purple-600">{d.conversionRate}% converted</span>
                          {d.revenueCents > 0 && <span className="text-amber-600">{fmtRevenue(d.revenueCents)}</span>}
                        </div>
                      </div>
                      {(d.topWinRules.length > 0 || d.topLoseRules.length > 0) && (
                        <div className="flex flex-wrap gap-2 text-xs">
                          {d.topWinRules.map((r: any) => (
                            <span key={r.id} className="flex items-center gap-1 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 rounded px-1.5 py-0.5">
                              <TrendingUp className="w-2.5 h-2.5" />{r.text.slice(0, 50)}{r.text.length > 50 ? "…" : ""}
                            </span>
                          ))}
                          {d.topLoseRules.map((r: any) => (
                            <span key={r.id} className="flex items-center gap-1 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded px-1.5 py-0.5">
                              <TrendingDown className="w-2.5 h-2.5" />{r.text.slice(0, 50)}{r.text.length > 50 ? "…" : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Manual outcome editing — recent sent messages */}
            {displayMessages.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">RECENT SENT — MARK OUTCOMES</p>
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {displayMessages.slice(0, 30).map((msg: any) => (
                    <div
                      key={msg.id}
                      className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/20 text-sm"
                      data-testid={`outcome-row-${msg.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{msg.recipientEmail ?? "Unknown recipient"}</div>
                        <div className="text-xs text-muted-foreground">
                          {DOMAIN_LABELS[msg.communicationDomain] ?? msg.communicationDomain}
                          {msg.messageType && ` · ${msg.messageType}`}
                          {msg.sentAt && ` · ${new Date(msg.sentAt).toLocaleDateString()}`}
                        </div>
                      </div>
                      <Badge className={`text-xs shrink-0 ${OUTCOME_STATUS_COLOR[msg.outcomeStatus] ?? "bg-gray-100 text-gray-700"}`}>
                        {msg.outcomeStatus ?? "sent"}
                      </Badge>
                      <Select
                        value={msg.outcomeStatus ?? "sent"}
                        onValueChange={(val) => updateMutation.mutate({ id: msg.id, outcomeStatus: val })}
                      >
                        <SelectTrigger className="h-7 w-40 text-xs shrink-0" data-testid={`select-outcome-${msg.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OUTCOME_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!overall && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No outcomes tracked yet. Approve and send messages to start tracking results.
              </p>
            )}

          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function AdminAiApprovalsPage() {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Communications Center</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Review, approve, and coach AI-generated outreach across all communication domains.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BarChart3 className="w-4 h-4" />
          <span>Learning enabled · {DOMAIN_TABS.length - 1} domains</span>
        </div>
      </div>

      {/* Metrics */}
      <MetricsBar domain={activeTab} />

      {/* Domain Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1 w-full sm:w-auto" data-testid="tabs-domain">
          {DOMAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                data-testid={`tab-${tab.key}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {DOMAIN_TABS.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            <ProposalsPanel domain={tab.apiKey} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Autonomy Panel */}
      <AutonomyPanel activeDomainTab={activeTab} />

      {/* Learning Health Card */}
      <LearningHealthCard />

      {/* Learning Dashboard */}
      <LearningDashboard activeDomainTab={activeTab} />

      {/* Outcome Intelligence */}
      <OutcomesPanel activeDomainTab={activeTab} />
    </div>
  );
}
