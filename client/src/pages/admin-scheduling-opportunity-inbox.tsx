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
  Inbox, TrendingUp, Users, AlertCircle, DollarSign,
  Clock, RefreshCw, ChevronRight, Zap, UserCheck,
  BarChart3, Target, Calendar, User, X, Check,
  ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { useState } from "react";
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
  smsBody: string;
  emailBody: string;
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
        selected
          ? "bg-background border-border"
          : "bg-muted/30 border-transparent opacity-50"
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Checkbox */}
        <button
          data-testid={`recipient-toggle-${candidate.userId}`}
          onClick={onToggle}
          className={`flex-none w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/40 bg-transparent"
          }`}
        >
          {selected && <Check className="h-3 w-3" />}
        </button>

        {/* Avatar-like initial */}
        <div className="flex-none w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
          {(candidate.firstName?.[0] || candidate.email?.[0] || "?").toUpperCase()}
        </div>

        {/* Name + score */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{name}</p>
            {scoreBadge(candidate.score)}
          </div>
          {/* First reason as preview */}
          {candidate.reasons[0] && (
            <p className="text-xs text-muted-foreground truncate">
              • {candidate.reasons[0]}
            </p>
          )}
        </div>

        {/* Expand reasons */}
        {candidate.reasons.length > 1 && (
          <button
            data-testid={`recipient-expand-${candidate.userId}`}
            onClick={() => setExpanded(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Remove */}
        <button
          data-testid={`recipient-remove-${candidate.userId}`}
          onClick={onRemove}
          className="flex-none text-muted-foreground hover:text-destructive transition-colors p-1"
          title="Remove from list"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded reasons */}
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

// ── Fill Campaign Dialog ───────────────────────────────────────────────────────

function FillCampaignDialog({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity;
  onClose: () => void;
}) {
  const { toast } = useToast();

  // Step state: 'recipients' (Phase 1) → 'draft' (Phase 2, copy generation)
  const [step, setStep] = useState<"recipients" | "draft">("recipients");

  // Recipient state
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());

  // Copy draft state (Phase 2)
  const [draft, setDraft] = useState<CampaignDraft | null>(null);

  const bookingId = opportunity.sessionId || "unknown";

  // ── Recipient query ──────────────────────────────────────────────────────
  const { data: recipientData, isLoading: recipientsLoading, error: recipientsError } = useQuery<RecipientResult>({
    queryKey: [`/api/scheduling-intelligence/fill-campaign/${bookingId}/recipients`],
    queryFn: async () => authenticatedFetch(
      `/api/scheduling-intelligence/fill-campaign/${bookingId}/recipients`
    ),
    enabled: step === "recipients",
    retry: 1,
  });

  // Filter out removed candidates, build visible list
  const allRecipients = (recipientData?.recipients ?? []).filter(
    (r) => !removedIds.has(r.userId)
  );
  const selectedIds = new Set(
    allRecipients
      .filter((r) => !deselectedIds.has(r.userId))
      .map((r) => r.userId)
  );
  const selectedCount = selectedIds.size;
  const openSpots = recipientData?.openSpots ?? opportunity.openSpots ?? 0;
  const { label: fillLabel, color: fillColor } = fillProbabilityLabel(selectedCount, openSpots);

  const toggleRecipient = (userId: string) => {
    setDeselectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
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

  // ── Campaign copy generation (Phase 2, already built) ────────────────────
  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/scheduling-intelligence/fill-campaign/${bookingId}`, {
        sessionName: opportunity.title.replace(/^Fill \d+ open spot[s]? in /, ""),
        startAt: opportunity.sessionStart,
        openSpots: selectedCount,
      });
      return res.json();
    },
    onSuccess: (data) => setDraft(data),
    onError: () => toast({ title: "Error", description: "Could not generate campaign draft.", variant: "destructive" }),
  });

  const handleConfirmRecipients = () => {
    if (selectedCount === 0) {
      toast({ title: "No recipients selected", description: "Select at least one recipient to continue.", variant: "destructive" });
      return;
    }
    setStep("draft");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {step === "recipients" ? "Recommended Recipients" : "Fill Campaign Generator"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground -mt-1">
          <span className={step === "recipients" ? "text-primary font-medium" : ""}>1 · Select Recipients</span>
          <ChevronRight className="h-3 w-3" />
          <span className={step === "draft" ? "text-primary font-medium" : ""}>2 · Generate Copy</span>
        </div>

        {/* Session context pill */}
        <div className="p-3 rounded-lg bg-muted/40 text-sm flex-none">
          <p className="font-medium">{opportunity.title}</p>
          {opportunity.sessionStart && (
            <p className="text-xs text-muted-foreground mt-1">
              {format(parseISO(opportunity.sessionStart), "EEE MMM d · h:mm a")}
              {" · "}{openSpots} open spot{openSpots !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* ── Step 1: Recipients ─────────────────────────────────────────── */}
        {step === "recipients" && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {recipientsLoading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analyzing athlete history…</p>
              </div>
            )}

            {recipientsError && (
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
                    <p className="text-lg font-bold text-primary" data-testid="metric-recommended-count">{allRecipients.length}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Recommended</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <p className="text-lg font-bold" data-testid="metric-open-spots">{openSpots}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Open Spots</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2 text-center">
                    <p className={`text-lg font-bold ${fillColor}`} data-testid="metric-fill-probability">{fillLabel}</p>
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

                    {/* Scrollable recipient list */}
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
                  Confirm {selectedCount} Recipient{selectedCount !== 1 ? "s" : ""}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Campaign Copy (Phase 2) ───────────────────────────── */}
        {step === "draft" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                data-testid="button-back-to-recipients"
                onClick={() => { setStep("recipients"); setDraft(null); }}
                className="text-primary hover:underline"
              >
                ← Back to recipients
              </button>
              <span>·</span>
              <span>{selectedCount} recipient{selectedCount !== 1 ? "s" : ""} confirmed</span>
            </div>

            {!draft ? (
              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate-campaign"
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating with AI…</>
                ) : (
                  <><Zap className="h-4 w-4 mr-2" />Generate Fill Campaign</>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject Line</p>
                  <div className="p-3 rounded-lg border bg-background text-sm font-medium">{draft.subject}</div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SMS</p>
                  <div className="p-3 rounded-lg border bg-background text-sm whitespace-pre-wrap">{draft.smsBody}</div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</p>
                  <div className="p-3 rounded-lg border bg-background text-sm whitespace-pre-wrap">{draft.emailBody}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    data-testid="button-copy-email"
                    onClick={() => {
                      navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.emailBody}`);
                      toast({ title: "Copied to clipboard" });
                    }}
                  >
                    Copy Email
                  </Button>
                </div>
              </div>
            )}
          </div>
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
    queryFn: async () => {
      return authenticatedFetch("/api/scheduling-intelligence/opportunities");
    },
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
  const filtered = opportunities.filter(o => {
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
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Opportunities", value: data?.counts.total ?? 0, icon: Inbox, color: "text-primary" },
            { label: "Critical + High", value: (data?.counts.critical ?? 0) + (data?.counts.high ?? 0), icon: AlertCircle, color: "text-red-600 dark:text-red-400" },
            { label: "Est. Revenue Gap", value: `$${Math.round(totalValue / 100).toLocaleString()}`, icon: DollarSign, color: "text-green-600 dark:text-green-400" },
            { label: "Revenue Opps", value: data?.counts.byCategory?.revenue ?? 0, icon: Target, color: "text-blue-600 dark:text-blue-400" },
          ].map(stat => (
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
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {categoryTabs.map(tab => (
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
              {["all", "critical", "high", "medium", "low"].map(p => (
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
        </div>
      )}

      {/* Opportunity List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-28" />)}
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
          {filtered.map(opp => (
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
