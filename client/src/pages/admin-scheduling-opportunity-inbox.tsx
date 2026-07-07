import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import {
  Inbox, Users, AlertCircle, DollarSign,
  Clock, RefreshCw, ChevronRight, Zap, UserCheck,
  BarChart3, Target, Calendar, User, X, Check,
  ChevronDown, ChevronUp, Loader2, Mail, MessageSquare,
  Bell, ArrowLeft, Copy
} from "lucide-react";
import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  type: string;
  category: "revenue" | "capacity" | "retention" | "coach";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  estimatedValueCents: number;
  actionLabel: string;
  sessionId?: string;
  sessionStart?: string;
  clientId?: string;
  coachId?: string;
  openSpots?: number;
  registered?: number;
  capacity?: number;
  waitlistCount?: number;
  daysInactive?: number;
}

interface OpportunityData {
  opportunities: Opportunity[];
  counts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byCategory: {
      revenue: number;
      capacity: number;
      retention: number;
      coach: number;
    };
  };
  estimatedTotalValueCents: number;
}

interface RecipientCandidate {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  score: number;
  reasons: string[];
  excluded: boolean;
  exclusionReason?: string;
}

interface SessionContext {
  coachFirstName: string;
  coachLastName: string;
  serviceName: string;
  startAt: string;
  maxParticipants: number;
}

interface RecipientResult {
  recipients: RecipientCandidate[];
  sessionContext: SessionContext | null;
  registeredCount: number;
  openSpots: number;
}

interface CampaignDraft {
  sessionId: string;
  subject: string;
  previewText: string;
  emailBody: string;
  smsBody: string;
  pushBody: string;
  socialCaption: string;
  generatedAt: string;
  modelUsed: string;
  selectedCount: number;
  openSpots: number;
  sessionName: string;
  coachName: string;
  orgName: string;
}

// ── Recipient summary computation ─────────────────────────────────────────────

interface RecipientSummary {
  avgScore: number;
  topReasons: string[];
  sportMix: string[];
  waitlistedCount: number;
  coachRegularsCount: number;
}

function computeRecipientSummary(
  candidates: RecipientCandidate[],
  selectedIds: Set<string>
): RecipientSummary {
  const selected = candidates.filter((c) => selectedIds.has(c.userId));
  if (selected.length === 0) {
    return { avgScore: 0, topReasons: [], sportMix: [], waitlistedCount: 0, coachRegularsCount: 0 };
  }

  const avgScore = Math.round(selected.reduce((s, c) => s + c.score, 0) / selected.length);

  // Frequency-count all reason strings across selected recipients
  const reasonCounts = new Map<string, number>();
  selected.forEach((c) => {
    c.reasons.forEach((r) => {
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    });
  });

  // Convert to natural-language audience characteristics with counts
  const topReasons: string[] = [];
  reasonCounts.forEach((count, reason) => {
    if (count >= 2 || selected.length <= 3) {
      topReasons.push(`${count} athlete${count !== 1 ? "s" : ""}: ${reason.toLowerCase()}`);
    }
  });
  topReasons.sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    return numB - numA;
  });

  // Extract sport mentions
  const sportSet = new Set<string>();
  selected.forEach((c) => {
    c.reasons.forEach((r) => {
      const match = r.match(/^(\w[\w\s]+) athlete/i);
      if (match) sportSet.add(match[1].trim());
    });
  });

  const waitlistedCount = selected.filter((c) =>
    c.reasons.some((r) => r.toLowerCase().includes("waitlisted"))
  ).length;

  const coachRegularsCount = selected.filter((c) =>
    c.reasons.some((r) => r.toLowerCase().includes("trains with coach") || r.toLowerCase().includes("attended this session"))
  ).length;

  return {
    avgScore,
    topReasons: topReasons.slice(0, 6),
    sportMix: Array.from(sportSet),
    waitlistedCount,
    coachRegularsCount,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  switch (priority) {
    case "critical": return <Badge className="text-xs bg-red-700/15 text-red-800 dark:text-red-300 border-red-700/30">Critical</Badge>;
    case "high": return <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20">High</Badge>;
    case "medium": return <Badge className="text-xs bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">Medium</Badge>;
    default: return <Badge className="text-xs bg-muted text-muted-foreground">Low</Badge>;
  }
}

function categoryIcon(category: string) {
  switch (category) {
    case "revenue": return <DollarSign className="h-4 w-4 text-green-500" />;
    case "capacity": return <BarChart3 className="h-4 w-4 text-purple-500" />;
    case "retention": return <UserCheck className="h-4 w-4 text-blue-500" />;
    case "coach": return <User className="h-4 w-4 text-orange-500" />;
    default: return <Zap className="h-4 w-4 text-muted-foreground" />;
  }
}

function categoryLabel(category: string) {
  switch (category) {
    case "revenue": return "Revenue";
    case "capacity": return "Capacity";
    case "retention": return "Retention";
    case "coach": return "Coach";
    default: return category;
  }
}

function scoreBadge(score: number) {
  const pct = `${score}% match`;
  if (score >= 70) return <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20">{pct}</Badge>;
  if (score >= 40) return <Badge className="text-xs bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">{pct}</Badge>;
  return <Badge className="text-xs bg-muted text-muted-foreground">{pct}</Badge>;
}

function fillProbabilityLabel(recommended: number, openSpots: number): { label: string; color: string } {
  if (openSpots === 0) return { label: "N/A", color: "text-muted-foreground" };
  const ratio = recommended / Math.max(1, openSpots);
  if (ratio >= 1.5) return { label: "High", color: "text-green-600 dark:text-green-400" };
  if (ratio >= 1.0) return { label: "Medium", color: "text-yellow-600 dark:text-yellow-400" };
  return { label: "Low", color: "text-red-600 dark:text-red-400" };
}

// ── Recipient Card ─────────────────────────────────────────────────────────────

function RecipientCard({
  candidate,
  selected,
  onToggle,
  onRemove,
}: {
  candidate: RecipientCandidate;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = `${candidate.firstName} ${candidate.lastName}`.trim() || candidate.email;

  return (
    <div
      data-testid={`recipient-card-${candidate.userId}`}
      className={`rounded-lg border px-3 py-2.5 transition-colors ${
        selected ? "bg-background border-border" : "bg-muted/30 border-transparent opacity-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          data-testid={`recipient-toggle-${candidate.userId}`}
          onClick={onToggle}
          className={`flex-none w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40 bg-transparent"
          }`}
        >
          {selected && <Check className="h-3 w-3" />}
        </button>
        <div className="flex-none w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
          {(candidate.firstName?.[0] || candidate.email?.[0] || "?").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{name}</p>
            {scoreBadge(candidate.score)}
          </div>
          {candidate.reasons[0] && (
            <p className="text-xs text-muted-foreground truncate">• {candidate.reasons[0]}</p>
          )}
        </div>
        {candidate.reasons.length > 1 && (
          <button
            data-testid={`recipient-expand-${candidate.userId}`}
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          data-testid={`recipient-remove-${candidate.userId}`}
          onClick={onRemove}
          className="flex-none text-muted-foreground hover:text-destructive transition-colors p-1"
          title="Remove from list"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && candidate.reasons.length > 1 && (
        <div className="mt-2 pl-[52px] space-y-0.5">
          {candidate.reasons.map((r, i) => (
            <p key={i} className="text-xs text-muted-foreground">• {r}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reason label distiller ─────────────────────────────────────────────────────

function distillReason(raw: string): string {
  // raw format from computeRecipientSummary: "N athletes: reason lowercase"
  const stripped = raw.replace(/^\d+\s+athlete[s]?:\s*/i, "");
  if (/attended this session/i.test(stripped)) return "Previous attendee";
  if (/trains with coach\s+(\S+)/i.test(stripped)) {
    const m = stripped.match(/trains with coach\s+(\S+)/i);
    return m ? `Coach ${m[1]} regular` : "Coach regular";
  }
  if (/usually attends on\s+(\w+)/i.test(stripped)) {
    const m = stripped.match(/usually attends on\s+(\w+)/i);
    return m ? `${m[1]} athlete` : "Regular day attendee";
  }
  if (/(\w+(?:\s+\w+)?)\s+athlete.*match/i.test(stripped)) {
    const m = stripped.match(/^(\w+(?:\s+\w+)?)\s+athlete/i);
    return m ? `${m[1]} athlete` : "Sport match";
  }
  if (/waitlisted/i.test(stripped)) return "On waitlist";
  if (/active in the last 30/i.test(stripped)) return "Recently active";
  if (/active in the last 60/i.test(stripped)) return "Active this quarter";
  if (/high consistency/i.test(stripped)) return "High consistency";
  if (/sessions in/i.test(stripped)) return "Consistent attendee";
  if (/recently cancelled/i.test(stripped)) return "Recent cancellation";
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ── Campaign Preview (Step 2) ─────────────────────────────────────────────────

function CampaignPreview({
  draft,
  opportunity,
  selectedCount,
  recipientSummary,
  onRegenerate,
  onBack,
  isPending,
}: {
  draft: CampaignDraft;
  opportunity: Opportunity;
  selectedCount: number;
  recipientSummary: RecipientSummary;
  onRegenerate: () => void;
  onBack: () => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"email" | "sms" | "push">("email");

  const estimatedRevenue = opportunity.estimatedValueCents > 0
    ? `$${Math.round(opportunity.estimatedValueCents / 100).toLocaleString()}`
    : null;

  const copyText = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const tabs = [
    { key: "email" as const, label: "Email", icon: Mail },
    { key: "sms" as const, label: "SMS", icon: MessageSquare },
    { key: "push" as const, label: "Push", icon: Bell },
  ];

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {/* Back link */}
      <div className="flex items-center gap-2 text-xs flex-none">
        <button
          data-testid="button-back-to-recipients"
          onClick={onBack}
          className="text-primary hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />Back to recipients
        </button>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{selectedCount} recipient{selectedCount !== 1 ? "s" : ""} confirmed</span>
      </div>

      {/* Campaign Summary card */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2 flex-none">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Summary</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Session</span>
            <p className="font-medium truncate">{draft.sessionName}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Coach</span>
            <p className="font-medium">{draft.coachName}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Recipients</span>
            <p className="font-medium">{selectedCount} selected</p>
          </div>
          <div>
            <span className="text-muted-foreground">Open spots</span>
            <p className="font-medium">{draft.openSpots}</p>
          </div>
          {estimatedRevenue && (
            <div>
              <span className="text-muted-foreground">Est. revenue</span>
              <p className="font-medium text-green-600 dark:text-green-400">{estimatedRevenue}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Model</span>
            <p className="font-medium text-muted-foreground">{draft.modelUsed}</p>
          </div>
        </div>
      </div>

      {/* Audience Summary card */}
      {(selectedCount > 0 || recipientSummary.topReasons.length > 0) && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5 flex-none">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Audience Summary</p>

          {/* Recipient count + avg match row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Recipients</p>
              <p className="text-2xl font-bold leading-none" data-testid="audience-recipient-count">{selectedCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">selected</p>
            </div>
            {recipientSummary.avgScore > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Average Match</p>
                <p className={`text-2xl font-bold leading-none ${
                  recipientSummary.avgScore >= 70
                    ? "text-green-600 dark:text-green-400"
                    : recipientSummary.avgScore >= 40
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-muted-foreground"
                }`} data-testid="audience-avg-score">{recipientSummary.avgScore}%</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">relevance score</p>
              </div>
            )}
          </div>

          {/* Top reasons */}
          {recipientSummary.topReasons.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">Top reasons</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {recipientSummary.topReasons.slice(0, 6).map((reason, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-foreground">
                    <Check className="h-3 w-3 flex-none text-green-500" />
                    <span className="truncate">{distillReason(reason)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fill probability + revenue row */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/60">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Est. Fill Probability</p>
              <p className={`text-sm font-semibold ${fillProbabilityLabel(selectedCount, draft.openSpots ?? 0).color}`}
                data-testid="audience-fill-probability">
                {fillProbabilityLabel(selectedCount, draft.openSpots ?? 0).label}
              </p>
            </div>
            {opportunity.estimatedValueCents > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Est. Revenue</p>
                <p className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="audience-est-revenue">
                  ${Math.round(opportunity.estimatedValueCents / 100).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 flex-none">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-testid={`tab-campaign-${tab.key}`}
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

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === "email" && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Subject</p>
              <div className="p-2.5 rounded-lg border bg-background text-sm font-medium">{draft.subject}</div>
            </div>
            {draft.previewText && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Preview Text</p>
                <div className="p-2.5 rounded-lg border bg-background text-xs text-muted-foreground italic">{draft.previewText}</div>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Email Body</p>
              <div className="p-2.5 rounded-lg border bg-background text-sm whitespace-pre-wrap leading-relaxed">{draft.emailBody}</div>
            </div>
          </div>
        )}

        {activeTab === "sms" && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">SMS Message</p>
              <div className="p-2.5 rounded-lg border bg-background text-sm whitespace-pre-wrap">{draft.smsBody}</div>
            </div>
            <p className="text-xs text-muted-foreground">
              {draft.smsBody?.length ?? 0} characters · ~{Math.ceil((draft.smsBody?.length ?? 0) / 160)} segment{Math.ceil((draft.smsBody?.length ?? 0) / 160) !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {activeTab === "push" && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Push Notification</p>
              <div className="p-2.5 rounded-lg border bg-background text-sm font-medium">{draft.pushBody}</div>
            </div>
            {draft.socialCaption && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Social Caption (optional)</p>
                <div className="p-2.5 rounded-lg border bg-background text-sm whitespace-pre-wrap">{draft.socialCaption}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-none pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isPending}
          data-testid="button-regenerate-campaign"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          data-testid="button-copy-email"
          onClick={() => copyText(`Subject: ${draft.subject}\nPreview: ${draft.previewText}\n\n${draft.emailBody}`, "Email")}
        >
          <Copy className="h-3.5 w-3.5 mr-1.5" />Copy Email
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          data-testid="button-copy-sms"
          onClick={() => copyText(draft.smsBody, "SMS")}
        >
          <Copy className="h-3.5 w-3.5 mr-1.5" />Copy SMS
        </Button>
      </div>
    </div>
  );
}

// ── Fill Campaign Dialog ───────────────────────────────────────────────────────

function FillCampaignDialog({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"recipients" | "draft">("recipients");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<CampaignDraft | null>(null);

  const bookingId = opportunity.sessionId || "unknown";

  // ── Phase 1: Recipient query ──────────────────────────────────────────────
  const { data: recipientData, isLoading: recipientsLoading, error: recipientsError } = useQuery<RecipientResult>({
    queryKey: [`/api/scheduling-intelligence/fill-campaign/${bookingId}/recipients`],
    queryFn: async () =>
      authenticatedFetch(`/api/scheduling-intelligence/fill-campaign/${bookingId}/recipients`),
    enabled: true,
    retry: 1,
  });

  const allRecipients = useMemo(
    () => (recipientData?.recipients ?? []).filter((r) => !removedIds.has(r.userId)),
    [recipientData, removedIds]
  );

  const selectedIds = useMemo(
    () => new Set(allRecipients.filter((r) => !deselectedIds.has(r.userId)).map((r) => r.userId)),
    [allRecipients, deselectedIds]
  );

  const selectedCount = selectedIds.size;
  const openSpots = recipientData?.openSpots ?? opportunity.openSpots ?? 0;
  const { label: fillLabel, color: fillColor } = fillProbabilityLabel(selectedCount, openSpots);

  const recipientSummary = useMemo(
    () => computeRecipientSummary(allRecipients, selectedIds),
    [allRecipients, selectedIds]
  );

  const toggleRecipient = (userId: string) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const removeRecipient = (userId: string) => {
    setRemovedIds((prev) => new Set([...prev, userId]));
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  // ── Phase 2: Campaign copy generation ────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scheduling-intelligence/fill-campaign/${bookingId}`, {
        sessionName: opportunity.title.replace(/^Fill \d+ open spot[s]? in /, ""),
        startAt: opportunity.sessionStart,
        openSpots,
        selectedCount,
        recipientIds: Array.from(selectedIds),
        recipientSummary,
      });
      return res.json() as Promise<CampaignDraft>;
    },
    onSuccess: (data) => setDraft(data),
    onError: () =>
      toast({ title: "Error", description: "Could not generate campaign draft.", variant: "destructive" }),
  });

  const handleConfirmRecipients = () => {
    if (selectedCount === 0) {
      toast({
        title: "No recipients selected",
        description: "Select at least one recipient to continue.",
        variant: "destructive",
      });
      return;
    }
    setStep("draft");
    generateMutation.mutate();
  };

  const handleBackToRecipients = () => {
    setStep("recipients");
    setDraft(null);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {step === "recipients" ? "Recommended Recipients" : "Campaign Preview"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-1">
          <span className={step === "recipients" ? "text-primary font-medium" : ""}>1 · Select Recipients</span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === "draft" ? "text-primary font-medium" : ""}>2 · Campaign Copy</span>
        </div>

        {/* Session context pill */}
        <div className="p-3 rounded-lg bg-muted/40 text-sm flex-none">
          <p className="font-medium">{opportunity.title}</p>
          {opportunity.sessionStart && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(parseISO(opportunity.sessionStart), "EEE MMM d · h:mm a")}
              {" · "}{openSpots} open spot{openSpots !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* ── Step 1: Recipient Selection ─────────────────────────────────── */}
        {step === "recipients" && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {recipientsLoading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analyzing athlete history…</p>
              </div>
            )}

            {recipientsError && !recipientsLoading && (
              <div className="py-6 text-center">
                <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Could not load recipient suggestions.</p>
              </div>
            )}

            {!recipientsLoading && !recipientsError && (
              <>
                {/* Summary metrics */}
                <div className="grid grid-cols-3 gap-2 flex-none">
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <p className="text-lg font-bold text-primary" data-testid="metric-recommended-count">
                      {allRecipients.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Recommended</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <p className="text-lg font-bold" data-testid="metric-open-spots">{openSpots}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Open Spots</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <p className={`text-lg font-bold ${fillColor}`} data-testid="metric-fill-probability">
                      {fillLabel}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Fill Probability</p>
                  </div>
                </div>

                {allRecipients.length === 0 ? (
                  <div className="py-6 text-center">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">No recipients found</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      No active clients match the criteria for this session.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-xs text-muted-foreground flex-none">
                      <span>{selectedCount} selected · {allRecipients.length} recommended</span>
                      <button
                        data-testid="button-select-all"
                        className="text-primary hover:underline"
                        onClick={() => setDeselectedIds(new Set())}
                      >
                        Select all
                      </button>
                    </div>
                    <div className="overflow-y-auto flex-1 space-y-1.5 pr-0.5">
                      {allRecipients.map((candidate) => (
                        <RecipientCard
                          key={candidate.userId}
                          candidate={candidate}
                          selected={selectedIds.has(candidate.userId)}
                          onToggle={() => toggleRecipient(candidate.userId)}
                          onRemove={() => removeRecipient(candidate.userId)}
                        />
                      ))}
                    </div>
                  </>
                )}

                <Button
                  className="w-full flex-none"
                  onClick={handleConfirmRecipients}
                  disabled={selectedCount === 0}
                  data-testid="button-confirm-recipients"
                >
                  Confirm {selectedCount} Recipient{selectedCount !== 1 ? "s" : ""} & Generate Campaign
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Campaign Copy ──────────────────────────────────────── */}
        {step === "draft" && (
          <>
            {/* Loading state while generating */}
            {generateMutation.isPending && !draft && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 flex-1">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-sm font-medium">Crafting your campaign…</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Personalizing for {selectedCount} athlete{selectedCount !== 1 ? "s" : ""} with audience context
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {generateMutation.isError && !draft && (
              <div className="py-6 text-center flex-1">
                <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Generation failed.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => generateMutation.mutate()}>
                  Try again
                </Button>
                <button
                  className="block mx-auto mt-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleBackToRecipients}
                >
                  ← Back to recipients
                </button>
              </div>
            )}

            {/* Preview */}
            {draft && (
              <CampaignPreview
                draft={draft}
                opportunity={opportunity}
                selectedCount={selectedCount}
                recipientSummary={recipientSummary}
                onRegenerate={() => generateMutation.mutate()}
                onBack={handleBackToRecipients}
                isPending={generateMutation.isPending}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Opportunity Card ───────────────────────────────────────────────────────────

function OpportunityCard({
  opp,
  onAction,
}: {
  opp: Opportunity;
  onAction: (opp: Opportunity) => void;
}) {
  const valueDisplay = opp.estimatedValueCents > 0
    ? `$${Math.round(opp.estimatedValueCents / 100).toLocaleString()}`
    : null;
  const isCritical = opp.priority === "critical";

  return (
    <Card
      className={`p-4 space-y-3 hover:shadow-md transition-shadow ${isCritical ? "border-red-500/40 bg-red-500/5" : ""}`}
      data-testid={`card-opportunity-${opp.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-md bg-muted">{categoryIcon(opp.category)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm">{opp.title}</p>
            {priorityBadge(opp.priority)}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opp.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="text-xs">{categoryLabel(opp.category)}</Badge>
        {valueDisplay && (
          <div className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
            <DollarSign className="h-3 w-3" />
            <span>{valueDisplay} opportunity</span>
          </div>
        )}
        {opp.sessionStart && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {format(parseISO(opp.sessionStart), "MMM d")}
          </span>
        )}
        {opp.daysInactive != null && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {opp.daysInactive}d inactive
          </span>
        )}
        <Button
          size="sm"
          variant={isCritical ? "default" : "outline"}
          className="ml-auto h-7 text-xs"
          onClick={() => onAction(opp)}
          data-testid={`button-opportunity-action-${opp.id}`}
        >
          {opp.actionLabel}
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminSchedulingOpportunityInboxPage() {
  const [activeOpp, setActiveOpp] = useState<Opportunity | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const { data, isLoading, refetch } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling-intelligence/opportunities"],
    queryFn: async () => authenticatedFetch("/api/scheduling-intelligence/opportunities"),
    refetchInterval: 120_000,
  });

  const handleAction = (opp: Opportunity) => {
    if (opp.category === "revenue" && opp.type === "fill_session") {
      setActiveOpp(opp);
    } else if (opp.category === "revenue" && opp.type === "recover_cancellation") {
      window.location.href = "/admin/scheduling-command-center";
    } else if (opp.category === "capacity" && opp.type === "waitlist_demand") {
      window.location.href = "/sessions";
    } else if (opp.category === "retention" && opp.type === "reactivation") {
      window.location.href = "/admin/ai-outreach-opportunities";
    } else if (opp.category === "coach") {
      window.location.href = "/admin/coach-capacity";
    } else {
      window.location.href = "/admin/scheduling-command-center";
    }
  };

  const opportunities = data?.opportunities ?? [];
  const filtered = opportunities.filter((o) => {
    if (activeCategory !== "all" && o.category !== activeCategory) return false;
    if (filterPriority !== "all" && o.priority !== filterPriority) return false;
    return true;
  });

  const totalValue = data?.estimatedTotalValueCents ?? 0;
  const criticalCount = data?.counts.critical ?? 0;

  const categoryTabs = [
    { key: "all", label: "All", count: data?.counts.total ?? 0, icon: Inbox },
    { key: "revenue", label: "Revenue", count: data?.counts.byCategory?.revenue ?? 0, icon: DollarSign },
    { key: "capacity", label: "Capacity", count: data?.counts.byCategory?.capacity ?? 0, icon: BarChart3 },
    { key: "retention", label: "Retention", count: data?.counts.byCategory?.retention ?? 0, icon: Users },
    { key: "coach", label: "Coach", count: data?.counts.byCategory?.coach ?? 0, icon: User },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary" />
            Opportunity Inbox
            {criticalCount > 0 && (
              <Badge className="text-xs bg-red-700/15 text-red-800 dark:text-red-300 border-red-700/30 ml-1">
                {criticalCount} Critical
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI-detected scheduling opportunities ranked by priority and revenue impact
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
          data-testid="button-refresh-opportunities"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Opportunities", value: data?.counts.total ?? 0, icon: Inbox, color: "text-primary" },
            { label: "Critical + High", value: (data?.counts.critical ?? 0) + (data?.counts.high ?? 0), icon: AlertCircle, color: "text-red-600 dark:text-red-400" },
            { label: "Est. Revenue Gap", value: `$${Math.round(totalValue / 100).toLocaleString()}`, icon: DollarSign, color: "text-green-600 dark:text-green-400" },
            { label: "Revenue Opps", value: data?.counts.byCategory?.revenue ?? 0, icon: Target, color: "text-blue-600 dark:text-blue-400" },
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

      {/* Category Tabs */}
      {data && (
        <div className="flex items-center gap-2 flex-wrap">
          {categoryTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveCategory(tab.key)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeCategory === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
              data-testid={`filter-category-${tab.key}`}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label} ({tab.count})
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            {["all", "critical", "high", "medium", "low"].map((p) => (
              <button
                key={p}
                onClick={() => setFilterPriority(p)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  filterPriority === p
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
                }`}
                data-testid={`filter-priority-${p}`}
              >
                {p === "all" ? "All Priority" : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Opportunity List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">No opportunities found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCategory !== "all" || filterPriority !== "all"
              ? "Try clearing filters."
              : "Your scheduling is looking great — no gaps detected right now."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((opp) => (
            <OpportunityCard key={opp.id} opp={opp} onAction={handleAction} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Auto-refreshes every 2 minutes · Showing {filtered.length} of {opportunities.length} opportunities
      </p>

      {activeOpp && (
        <FillCampaignDialog opportunity={activeOpp} onClose={() => setActiveOpp(null)} />
      )}
    </div>
  );
}
