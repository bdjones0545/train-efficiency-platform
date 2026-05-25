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

// ─── Athlete Lead Card ───────────────────────────────────────────────────────
function AthleteLeadCard({
  lead,
  onUpdate,
  onDelete,
  onEdit,
}: {
  lead: LeadCaptureSubmission;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onEdit: (lead: LeadCaptureSubmission) => void;
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
          onClick={() => onUpdate(lead.id, { bookingStatus: "evaluation_booked", evaluationBookedAt: new Date().toISOString() })}
          disabled={lead.bookingStatus === "evaluation_booked" || lead.bookingStatus === "enrolled"}
          data-testid={`button-schedule-eval-${lead.id}`}
        >
          <Calendar className="h-3 w-3 mr-1" /> Schedule Eval
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-emerald-400 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          onClick={() => onUpdate(lead.id, { bookingStatus: "enrolled", convertedAt: new Date().toISOString() })}
          disabled={lead.bookingStatus === "enrolled"}
          data-testid={`button-convert-athlete-${lead.id}`}
        >
          <UserCheck className="h-3 w-3 mr-1" /> Convert to Athlete
        </Button>
        {lead.email && (
          <a href={`mailto:${lead.email}`} data-testid={`link-email-athlete-${lead.id}`}>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Mail className="h-3 w-3 mr-1" /> Email
            </Button>
          </a>
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
          <p className="text-sm font-medium">
            {(leads || []).length === 0
              ? "No athlete applications yet"
              : "No leads match your filters"}
          </p>
          <p className="text-xs mt-1 max-w-xs mx-auto">
            {(leads || []).length === 0
              ? "Athlete applications submitted through your landing pages will appear here."
              : "Try adjusting your search or filters."}
          </p>
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
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editLead && (
        <EditLeadModal
          lead={editLead}
          onClose={() => setEditLead(null)}
          onSave={(id, data) => updateMutation.mutate({ id, data })}
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  );
}
