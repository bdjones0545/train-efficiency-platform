import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Inbox, TrendingUp, Users, AlertCircle, DollarSign,
  Clock, RefreshCw, ChevronRight, Zap, UserCheck,
  BarChart3, Target, Calendar
} from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";

interface Opportunity {
  id: string;
  type: "fill_session" | "recover_cancellation" | "waitlist_demand" | "reactivation";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  estimatedValueCents: number;
  actionLabel: string;
  sessionId?: string;
  sessionStart?: string;
  clientId?: string;
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
    high: number;
    medium: number;
    low: number;
    byType: Record<string, number>;
  };
  estimatedTotalValueCents: number;
}

interface CampaignDraft {
  sessionId: string;
  subject: string;
  smsBody: string;
  emailBody: string;
}

function priorityBadge(priority: string) {
  switch (priority) {
    case "high": return <Badge className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20">High</Badge>;
    case "medium": return <Badge className="text-xs bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">Medium</Badge>;
    default: return <Badge className="text-xs bg-muted text-muted-foreground">Low</Badge>;
  }
}

function typeIcon(type: string) {
  switch (type) {
    case "fill_session": return <Target className="h-4 w-4 text-blue-500" />;
    case "recover_cancellation": return <RefreshCw className="h-4 w-4 text-red-500" />;
    case "waitlist_demand": return <Users className="h-4 w-4 text-purple-500" />;
    case "reactivation": return <UserCheck className="h-4 w-4 text-green-500" />;
    default: return <Zap className="h-4 w-4 text-muted-foreground" />;
  }
}

function typeLabel(type: string) {
  switch (type) {
    case "fill_session": return "Fill Session";
    case "recover_cancellation": return "Recover Cancellation";
    case "waitlist_demand": return "Waitlist Demand";
    case "reactivation": return "Client Reactivation";
    default: return type;
  }
}

function FillCampaignDialog({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CampaignDraft | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scheduling/fill-campaign", {
        sessionId: opportunity.sessionId,
        sessionName: opportunity.title.replace(/^Fill \d+ open spot[s]? in /, ""),
        startAt: opportunity.sessionStart,
        openSpots: opportunity.openSpots,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setDraft(data);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not generate campaign draft.", variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Fill Campaign Generator
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/40 text-sm">
            <p className="font-medium">{opportunity.title}</p>
            {opportunity.sessionStart && (
              <p className="text-xs text-muted-foreground mt-1">
                {format(parseISO(opportunity.sessionStart), "EEE MMM d · h:mm a")} ·{" "}
                {opportunity.openSpots} open spot{opportunity.openSpots !== 1 ? "s" : ""}
              </p>
            )}
          </div>

          {!draft ? (
            <Button
              className="w-full"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-campaign"
            >
              {generateMutation.isPending ? (
                <>Generating with AI...</>
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
                <Button size="sm" className="flex-1" onClick={() => {
                  navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.emailBody}`);
                  toast({ title: "Copied to clipboard" });
                }}>
                  Copy Email
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

  return (
    <Card
      className="p-4 space-y-3 hover:shadow-md transition-shadow"
      data-testid={`card-opportunity-${opp.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-md bg-muted">{typeIcon(opp.type)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm">{opp.title}</p>
            {priorityBadge(opp.priority)}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{opp.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="text-xs">{typeLabel(opp.type)}</Badge>
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
        {opp.daysInactive && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {opp.daysInactive}d inactive
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
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

export default function AdminSchedulingOpportunityInboxPage() {
  const [activeOpp, setActiveOpp] = useState<Opportunity | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const { data, isLoading, refetch } = useQuery<OpportunityData>({
    queryKey: ["/api/scheduling/opportunities"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling/opportunities", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 120_000,
  });

  const handleAction = (opp: Opportunity) => {
    if (opp.type === "fill_session") {
      setActiveOpp(opp);
    }
  };

  const opportunities = data?.opportunities ?? [];
  const filtered = opportunities.filter(o => {
    if (filterType !== "all" && o.type !== filterType) return false;
    if (filterPriority !== "all" && o.priority !== filterPriority) return false;
    return true;
  });

  const totalValue = data?.estimatedTotalValueCents ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary" />
            Opportunity Inbox
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI-detected scheduling opportunities ranked by revenue impact
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
            { label: "High Priority", value: data?.counts.high ?? 0, icon: AlertCircle, color: "text-red-600 dark:text-red-400" },
            { label: "Est. Revenue Gap", value: `$${Math.round(totalValue / 100).toLocaleString()}`, icon: DollarSign, color: "text-green-600 dark:text-green-400" },
            { label: "Sessions to Fill", value: data?.counts.byType.fill_session ?? 0, icon: Target, color: "text-blue-600 dark:text-blue-400" },
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

      {/* Type breakdown */}
      {data && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Filter:</span>
          {[
            { key: "all", label: `All (${data.counts.total})` },
            { key: "fill_session", label: `Fill Session (${data.counts.byType.fill_session ?? 0})` },
            { key: "recover_cancellation", label: `Cancellations (${data.counts.byType.recover_cancellation ?? 0})` },
            { key: "waitlist_demand", label: `Waitlist (${data.counts.byType.waitlist_demand ?? 0})` },
            { key: "reactivation", label: `Reactivation (${data.counts.byType.reactivation ?? 0})` },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilterType(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterType === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
              data-testid={`filter-type-${f.key}`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            {["all", "high", "medium", "low"].map(p => (
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
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">No opportunities found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filterType !== "all" || filterPriority !== "all"
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

      {activeOpp && activeOpp.type === "fill_session" && (
        <FillCampaignDialog opportunity={activeOpp} onClose={() => setActiveOpp(null)} />
      )}
    </div>
  );
}
