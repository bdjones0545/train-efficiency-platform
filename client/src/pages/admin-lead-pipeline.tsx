import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Flame, Thermometer, Snowflake, Brain, Zap, Mail, Phone, MapPin,
  Clock, ChevronRight, CheckCircle2, XCircle, RefreshCw, Target,
  TrendingUp, BarChart3, FlaskConical, Eye, ArrowRight, User,
  Megaphone, Tag, Calendar, AlertCircle, Loader2, Play,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  createdAt: string;
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
  call_now:                   { label: "Call Now",                icon: Phone,    color: "text-red-400" },
  send_educational_followup:  { label: "Send Follow-Up",          icon: Mail,     color: "text-blue-400" },
  schedule_consultation:      { label: "Schedule Consultation",   icon: Calendar, color: "text-violet-400" },
  send_urgency_reminder:      { label: "Send Urgency Reminder",   icon: AlertCircle, color: "text-amber-400" },
  wait_24h:                   { label: "Wait 24h",                icon: Clock,    color: "text-slate-400" },
  re_engage_7d:               { label: "Re-engage in 7d",         icon: RefreshCw, color: "text-slate-400" },
  mark_low_priority:          { label: "Mark Low Priority",       icon: Target,   color: "text-slate-500" },
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

function timeAgo(dt: string | null | undefined): string {
  if (!dt) return "—";
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

  const { data: drafts, isLoading: draftsLoading } = useQuery<GmailDraftAction[]>({
    queryKey: ["/api/lead-capture/intelligence", intel.submissionId, "drafts"],
    queryFn: () => fetch(`/api/lead-capture/intelligence/${intel.submissionId}/drafts`, { credentials: "include" }).then(r => r.json()),
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

  const nextActionCfg = NEXT_ACTION_LABELS[intel.suggestedNextAction || ""] || null;
  const NextActionIcon = nextActionCfg?.icon || Target;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <User className="h-4 w-4 text-orange-400" />
            {sub?.athleteName || intel.normalizedProfileJson?.athleteName || "Lead Detail"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <TemperatureBadge temp={intel.temperature} />
            <ScoreBadge score={intel.leadScore} />
            <UrgencyBadge urgency={intel.urgency} />
            {intel.tags?.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-zinc-700/60 text-zinc-300 border border-zinc-600">
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>

          {/* Pipeline Stage Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Pipeline Stage:</span>
            <Select
              value={intel.pipelineStage}
              onValueChange={v => onStageChange(intel.id, v)}
            >
              <SelectTrigger data-testid="select-pipeline-stage" className="h-7 w-44 bg-zinc-800 border-zinc-600 text-xs text-zinc-200">
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
            <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
              <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" /> AI Context Summary
              </p>
              <p className="text-sm text-zinc-300 leading-relaxed">{intel.aiSummary}</p>
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

          {/* Intake Intelligence */}
          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700 p-4">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Intake Intelligence
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {sub?.email && <div className="flex items-center gap-2 col-span-2"><Mail className="h-3.5 w-3.5 text-zinc-500" /><span className="text-zinc-300">{sub.email}</span></div>}
              {sub?.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-zinc-500" /><span className="text-zinc-300">{sub.phone}</span></div>}
              {(np?.sport || sub?.sport) && <div className="flex items-center gap-2"><Target className="h-3.5 w-3.5 text-zinc-500" /><span className="text-zinc-300">{np?.sport || sub?.sport}{np?.position ? ` / ${np.position}` : ""}</span></div>}
              {(np?.school || sub?.school) && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-zinc-500" /><span className="text-zinc-300">{np?.school || sub?.school}</span></div>}
              {np?.age && <div className="flex items-center gap-2"><span className="text-zinc-500 text-xs w-3.5">Age</span><span className="text-zinc-300">{np.age}{np.grade ? ` / ${np.grade}` : ""}</span></div>}
              {np?.commitmentLevel && <div className="flex items-center gap-2"><span className="text-zinc-500 text-xs">Commit:</span><span className="text-zinc-300 capitalize">{np.commitmentLevel}</span></div>}
              {np?.goals?.length > 0 && (
                <div className="col-span-2 flex items-start gap-2 mt-1">
                  <span className="text-zinc-500 text-xs mt-0.5">Goals:</span>
                  <span className="text-zinc-300 text-xs">{np.goals.join(", ")}</span>
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
                        <p className="text-[11px] text-zinc-500 mt-0.5">To: {draft.recipientEmail}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
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

          {/* Processing Log */}
          {intel.processingLog?.length > 0 && (
            <details className="rounded-lg bg-zinc-800/40 border border-zinc-700/50">
              <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
                <FlaskConical className="h-3 w-3" /> Processing Log
              </summary>
              <div className="px-4 pb-3 space-y-1">
                {intel.processingLog.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${entry.status === "ok" ? "bg-emerald-500" : entry.status === "error" ? "bg-red-500" : "bg-zinc-500"}`} />
                    <span className="text-zinc-400 font-medium">{entry.step}</span>
                    {entry.detail && <span className="text-zinc-500">— {entry.detail}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
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
          </div>
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

      {/* Temperature + Score */}
      <div className="flex flex-wrap gap-1.5">
        <TemperatureBadge temp={intel.temperature} />
        <ScoreBadge score={intel.leadScore} />
      </div>

      {/* AI Summary preview */}
      {intel.aiSummary && (
        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">{intel.aiSummary}</p>
      )}

      {/* Campaign Source */}
      {intel.campaignSource && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Megaphone className="h-3 w-3" />
          <span>{intel.campaignSource}{intel.campaignName ? ` / ${intel.campaignName}` : ""}</span>
        </div>
      )}

      {/* Suggested Next Action */}
      {nextActionCfg && (
        <div className={`flex items-center gap-1.5 text-[11px] font-medium ${nextActionCfg.color}`}>
          <NextActionIcon className="h-3 w-3" />
          <span>{nextActionCfg.label}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-zinc-600 border-t border-zinc-700/50 pt-2">
        <span>{timeAgo(intel.createdAt)}</span>
        {intel.gmailDraftActionId && (
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
    <div className="grid grid-cols-4 gap-3 mb-6">
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLeadPipelinePage() {
  const { toast } = useToast();
  const [selectedRow, setSelectedRow] = useState<PipelineRow | null>(null);
  const [activeStageFilter, setActiveStageFilter] = useState<string>("all");
  const [simLoading, setSimLoading] = useState(false);

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
    },
    onError: () => toast({ title: "Error updating stage", variant: "destructive" }),
  });

  const runSimulation = async (index: number) => {
    setSimLoading(true);
    try {
      const resp = await apiRequest("POST", "/api/lead-capture/intelligence/test-simulation", { payloadIndex: index });
      const data = await resp.json();
      toast({
        title: `Simulation complete — ${data.result?.temperature} lead`,
        description: `Score: ${data.result?.leadScore}/100 · ${data.result?.suggestedNextAction}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-capture/intelligence-stats"] });
    } catch {
      toast({ title: "Simulation failed", variant: "destructive" });
    } finally {
      setSimLoading(false);
    }
  };

  const filteredRows =
    activeStageFilter === "all"
      ? rows
      : rows.filter(r => r.intelligence.pipelineStage === activeStageFilter);

  const groupedByStage = STAGES.reduce<Record<string, PipelineRow[]>>((acc, s) => {
    acc[s.key] = rows.filter(r => r.intelligence.pipelineStage === s.key);
    return acc;
  }, {});

  const stagesToShow = activeStageFilter === "all" ? STAGES : STAGES.filter(s => s.key === activeStageFilter);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="h-6 w-6 text-orange-400" />
            Athlete Lead Pipeline
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            AI-powered intake intelligence, lead scoring, and deal pipeline automation
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            data-testid="button-simulate-intake-0"
            size="sm"
            variant="outline"
            className="h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
            disabled={simLoading}
            onClick={() => runSimulation(0)}
          >
            {simLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FlaskConical className="h-3 w-3 mr-1" />}
            Simulate Intake
          </Button>
          <Button
            data-testid="button-simulate-intake-1"
            size="sm"
            variant="outline"
            className="h-8 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
            disabled={simLoading}
            onClick={() => runSimulation(1)}
          >
            <Play className="h-3 w-3 mr-1" />
            Simulate Lead 2
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats.length > 0 && <StatsBar stats={stats} />}

      {/* Stage Filter Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <button
          data-testid="filter-stage-all"
          onClick={() => setActiveStageFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
            activeStageFilter === "all"
              ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
              : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          All ({rows.length})
        </button>
        {STAGES.map(s => {
          const cnt = groupedByStage[s.key]?.length || 0;
          return (
            <button
              key={s.key}
              data-testid={`filter-stage-${s.key}`}
              onClick={() => setActiveStageFilter(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                activeStageFilter === s.key
                  ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                  : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s.label} {cnt > 0 && <span className="ml-1 opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* Pipeline Kanban (or filtered list) */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-24 bg-zinc-800" />
              <Skeleton className="h-32 bg-zinc-800" />
              <Skeleton className="h-32 bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Brain className="h-12 w-12 text-zinc-700 mb-4" />
          <p className="text-zinc-400 font-medium">No intelligence profiles yet</p>
          <p className="text-zinc-600 text-sm mt-1 max-w-sm">
            Intelligence profiles are created automatically when a lead submits a landing page form. Use the Simulate button above to test the pipeline.
          </p>
        </div>
      ) : activeStageFilter !== "all" ? (
        // Filtered list view
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredRows.map(row => (
            <PipelineCard
              key={row.intelligence.id}
              row={row}
              onClick={() => setSelectedRow(row)}
            />
          ))}
          {filteredRows.length === 0 && (
            <p className="text-zinc-500 text-sm col-span-4 py-8 text-center">No leads in this stage.</p>
          )}
        </div>
      ) : (
        // Kanban view — show all stages side by side (show only non-empty + first 2 stages by default)
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {stagesToShow.map(stage => {
              const stageRows = groupedByStage[stage.key] || [];
              return (
                <div key={stage.key} className="w-64 flex-shrink-0">
                  {/* Stage Header */}
                  <div className={`flex items-center justify-between rounded-t-lg border px-3 py-2 mb-2 ${stage.color}`}>
                    <span className="text-xs font-semibold">{stage.label}</span>
                    <span className="text-xs font-bold">{stageRows.length}</span>
                  </div>
                  {/* Cards */}
                  <div className="space-y-2">
                    {stageRows.length === 0 ? (
                      <div className="h-16 rounded-lg border border-dashed border-zinc-700/40 flex items-center justify-center">
                        <span className="text-[11px] text-zinc-600">Empty</span>
                      </div>
                    ) : (
                      stageRows.map(row => (
                        <PipelineCard
                          key={row.intelligence.id}
                          row={row}
                          onClick={() => setSelectedRow(row)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead Detail Modal */}
      {selectedRow && (
        <LeadDetailModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onStageChange={(id, stage) => {
            stageMutation.mutate({ id, stage });
            setSelectedRow(prev => prev ? {
              ...prev,
              intelligence: { ...prev.intelligence, pipelineStage: stage },
            } : null);
          }}
        />
      )}
    </div>
  );
}
