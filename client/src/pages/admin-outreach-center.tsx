import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users, Target, Building2, Mail, Search, Filter, ChevronDown, ChevronUp,
  Star, Flame, Zap, MapPin, Calendar, Phone, ExternalLink, RefreshCw,
  ClipboardList, TrendingUp, CheckCircle, AlertCircle, UserCheck,
  BarChart2, Activity, Loader2, ArrowRight, Clock,
} from "lucide-react";
import type { LeadCaptureSubmission, TeamTrainingProspect } from "@shared/schema";

// ─── Lead Type Config ────────────────────────────────────────────────────────

const LEAD_TYPE_CFG: Record<string, { label: string; emoji: string; className: string }> = {
  individual_athlete_lead: {
    label: "Athlete Lead",
    emoji: "🏃",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  },
  team_training_lead: {
    label: "Team Training",
    emoji: "🏆",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  },
  team_partnership: {
    label: "Team Training",
    emoji: "🏆",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  },
  organization_prospect: {
    label: "Organization",
    emoji: "🏢",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-700",
  },
  outreach_contact: {
    label: "Outreach Contact",
    emoji: "✉️",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  },
};

const SOURCE_CFG: Record<string, { label: string; className: string }> = {
  lead_capture_form: { label: "Lead Capture Form", className: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300 border-green-200 dark:border-green-800" },
  deep_search: { label: "Deep Search", className: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
  manual_entry: { label: "Manual Entry", className: "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700" },
  import: { label: "Import", className: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 border-orange-200 dark:border-orange-800" },
  meta_ad: { label: "Meta Ad", className: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  referral: { label: "Referral", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  gmail_reply: { label: "Gmail Reply Recovery", className: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border-red-200 dark:border-red-800" },
};

const BOOKING_STATUS_MAP: Record<string, { label: string; className: string }> = {
  not_booked:        { label: "New",          className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  evaluation_booked: { label: "Eval Booked",  className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  enrolled:          { label: "Enrolled",     className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  attended:          { label: "Attended",     className: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  lost:              { label: "Lost",         className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  archived:          { label: "Archived",     className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
};

const PROSPECT_STATUS_MAP: Record<string, { label: string; className: string }> = {
  New:              { label: "New",           className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  "Needs Review":   { label: "Needs Review",  className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  Approved:         { label: "Approved",      className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
  Contacted:        { label: "Contacted",     className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
  Replied:          { label: "Replied",       className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  "Not Interested": { label: "Not Interested", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  "Do Not Contact": { label: "Do Not Contact", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const TABS = [
  { key: "all",                   label: "All",              icon: BarChart2 },
  { key: "individual_athlete_lead", label: "Athlete Leads",  icon: Users },
  { key: "team",                  label: "Team Training",    icon: Target },
  { key: "organization_prospect", label: "Organizations",    icon: Building2 },
  { key: "outreach_contact",      label: "Outreach Contacts", icon: Mail },
];

// ─── Helper functions ────────────────────────────────────────────────────────

function resolveAthleteSource(lead: LeadCaptureSubmission): string {
  if (lead.utmSource === "facebook" || lead.utmSource === "instagram" || lead.utmSource === "meta") return "meta_ad";
  if (lead.utmSource === "referral") return "referral";
  if (lead.utmSource || lead.utmCampaign) return "lead_capture_form";
  return "lead_capture_form";
}

function resolveProspectSource(p: TeamTrainingProspect): string {
  if (p.discoveryMethod === "web_search" || p.discoverySourceType === "web") return "deep_search";
  if (p.discoveryMethod === "import") return "import";
  return "manual_entry";
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Small reusable components ───────────────────────────────────────────────

function LeadTypeBadge({ type }: { type: string }) {
  const cfg = LEAD_TYPE_CFG[type] ?? LEAD_TYPE_CFG.outreach_contact;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}
      data-testid="badge-lead-type">
      <span>{cfg.emoji}</span> {cfg.label}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_CFG[source] ?? SOURCE_CFG.manual_entry;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.className}`}
      data-testid="badge-source">
      {cfg.label}
    </span>
  );
}

function QualScore({ score }: { score: number | null | undefined }) {
  if (!score && score !== 0) return null;
  const color = score >= 80 ? "text-emerald-600 dark:text-emerald-400" :
                score >= 60 ? "text-blue-600 dark:text-blue-400" :
                score >= 40 ? "text-yellow-600 dark:text-yellow-400" :
                              "text-red-500 dark:text-red-400";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Star className="h-3 w-3" /> {score}
    </span>
  );
}

// ─── Athlete Lead Card ────────────────────────────────────────────────────────

function AthleteLeadCard({ lead, onUpdate }: { lead: LeadCaptureSubmission; onUpdate: (id: string, data: Record<string, any>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = BOOKING_STATUS_MAP[lead.bookingStatus ?? "not_booked"] ?? BOOKING_STATUS_MAP.not_booked;
  const source = resolveAthleteSource(lead);

  return (
    <Card className="p-4 space-y-3 hover:shadow-sm transition-shadow" data-testid={`card-athlete-${lead.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LeadTypeBadge type="individual_athlete_lead" />
            <h3 className="font-semibold text-sm" data-testid={`text-name-${lead.id}`}>{lead.athleteName}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
            <QualScore score={lead.aiQualificationScore} />
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            {lead.parentName && <span>Parent: <span className="text-foreground/80">{lead.parentName}</span></span>}
            {lead.sport && <span>· {lead.sport}</span>}
            {lead.age && <span>· Age {lead.age}</span>}
            {lead.grade && <span>· Grade {lead.grade}</span>}
            {lead.school && <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {lead.school}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <SourceBadge source={source} />
            {(lead.utmCampaign || lead.utmSource) && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                {lead.utmCampaign || lead.utmSource}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{timeAgo(lead.createdAt?.toString())}</span>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
          onClick={() => setExpanded(e => !e)} data-testid={`button-expand-${lead.id}`}>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {expanded && (
        <div className="pt-2 border-t space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {lead.commitmentLevel && (
              <div><span className="text-muted-foreground">Commitment:</span> <span className="capitalize font-medium">{lead.commitmentLevel}</span></div>
            )}
            {lead.experienceLevel && (
              <div><span className="text-muted-foreground">Experience:</span> <span className="capitalize font-medium">{lead.experienceLevel.replace(/_/g, " ")}</span></div>
            )}
            {lead.email && (
              <div className="col-span-2 flex items-center gap-1">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground truncate">{lead.email}</span>
              </div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{lead.phone}</span>
              </div>
            )}
          </div>
          {Array.isArray(lead.goals) && lead.goals.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Goals: </span>
              <span>{lead.goals.join(", ")}</span>
            </div>
          )}
          {lead.aiQualificationReason && (
            <div className="text-xs bg-muted/40 rounded p-2">
              <span className="font-medium">AI note: </span>
              <span className="text-muted-foreground">{lead.aiQualificationReason}</span>
            </div>
          )}
          {lead.aiNextAction && (
            <div className="flex items-start gap-1.5 text-xs bg-blue-50 dark:bg-blue-950/30 rounded p-2">
              <Zap className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
              <span><span className="font-medium text-blue-700 dark:text-blue-300">Next Action: </span>{lead.aiNextAction}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => onUpdate(lead.id, { bookingStatus: "evaluation_booked", evaluationBookedAt: new Date().toISOString() })}
              disabled={lead.bookingStatus === "evaluation_booked" || lead.bookingStatus === "enrolled"}
              data-testid={`button-eval-${lead.id}`}>
              <Calendar className="h-3 w-3 mr-1" /> Book Eval
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-300"
              onClick={() => onUpdate(lead.id, { bookingStatus: "enrolled", convertedAt: new Date().toISOString() })}
              disabled={lead.bookingStatus === "enrolled"}
              data-testid={`button-enroll-${lead.id}`}>
              <CheckCircle className="h-3 w-3 mr-1" /> Mark Enrolled
            </Button>
            <Link href="/admin/athlete-leads">
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" data-testid={`button-view-full-${lead.id}`}>
                View Full <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Team Training Card ────────────────────────────────────────────────────────

function TeamTrainingCard({ prospect }: { prospect: TeamTrainingProspect }) {
  const [expanded, setExpanded] = useState(false);
  const leadType = prospect.leadType ?? "team_partnership";
  const statusCfg = PROSPECT_STATUS_MAP[prospect.outreachStatus ?? "New"] ?? PROSPECT_STATUS_MAP.New;
  const source = resolveProspectSource(prospect);
  const contactConfidencePct = prospect.contactConfidenceScore != null
    ? Math.round(prospect.contactConfidenceScore * 100) : (prospect.contactConfidence ?? 0);

  return (
    <Card className="p-4 space-y-3 hover:shadow-sm transition-shadow" data-testid={`card-prospect-${prospect.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LeadTypeBadge type={leadType} />
            <h3 className="font-semibold text-sm" data-testid={`text-name-${prospect.id}`}>{prospect.prospectName}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
            {prospect.confidenceScore != null && (
              <span className="text-[11px] text-muted-foreground">
                <Activity className="h-3 w-3 inline mr-0.5" />{prospect.confidenceScore}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            {prospect.organizationType && prospect.organizationType !== "unknown" && (
              <span className="capitalize">{prospect.organizationType.replace(/_/g, " ")}</span>
            )}
            {prospect.sport && prospect.sport !== "unknown" && <span>· {prospect.sport}</span>}
            {(prospect.city && prospect.city !== "unknown") && (
              <span className="flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" /> {prospect.city}{prospect.state && prospect.state !== "unknown" ? `, ${prospect.state}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <SourceBadge source={source} />
            {prospect.estimatedValue != null && prospect.estimatedValue > 0 && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                ${prospect.estimatedValue.toLocaleString()} est.
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{timeAgo(prospect.createdAt?.toString())}</span>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
          onClick={() => setExpanded(e => !e)} data-testid={`button-expand-${prospect.id}`}>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {expanded && (
        <div className="pt-2 border-t space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {prospect.contactName && prospect.contactName !== "unknown" && (
              <div><span className="text-muted-foreground">Contact:</span> <span className="font-medium">{prospect.contactName}</span>
                {prospect.contactRole && prospect.contactRole !== "unknown" && (
                  <span className="text-muted-foreground"> ({prospect.contactRole})</span>
                )}
              </div>
            )}
            {prospect.decisionMakerName && (
              <div><span className="text-muted-foreground">Decision Maker:</span> <span className="font-medium">{prospect.decisionMakerName}</span>
                {prospect.decisionMakerTitle && <span className="text-muted-foreground"> · {prospect.decisionMakerTitle}</span>}
              </div>
            )}
            {(prospect.contactEmail || prospect.decisionMakerEmail) && (
              <div className="col-span-2 flex items-center gap-1">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground truncate">{prospect.decisionMakerEmail || prospect.contactEmail}</span>
                {contactConfidencePct > 0 && (
                  <span className={`ml-1 text-[10px] font-medium ${contactConfidencePct >= 70 ? "text-emerald-600 dark:text-emerald-400" : contactConfidencePct >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-500"}`}>
                    {contactConfidencePct}% confidence
                  </span>
                )}
              </div>
            )}
          </div>
          {prospect.notes && (
            <div className="text-xs bg-muted/40 rounded p-2 text-muted-foreground line-clamp-2">{prospect.notes}</div>
          )}
          {prospect.lastContactedAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last contacted {timeAgo(prospect.lastContactedAt.toString())}
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {prospect.websiteUrl && (
              <a href={prospect.websiteUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-website-${prospect.id}`}>
                  <ExternalLink className="h-3 w-3 mr-1" /> Website
                </Button>
              </a>
            )}
            <Link href="/admin/team-training-leads">
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" data-testid={`button-view-full-${prospect.id}`}>
                View Full <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ athleteLeads, teamProspects }: { athleteLeads: LeadCaptureSubmission[]; teamProspects: TeamTrainingProspect[] }) {
  const hotAthletes = athleteLeads.filter(l => (l.aiQualificationScore ?? 0) >= 70).length;
  const booked = athleteLeads.filter(l => l.bookingStatus === "evaluation_booked" || l.bookingStatus === "enrolled").length;
  const outreachPending = teamProspects.filter(p => p.outreachStatus === "New" || p.outreachStatus === "Needs Review").length;
  const replied = teamProspects.filter(p => p.outreachStatus === "Replied").length;

  const stats = [
    { label: "Athlete Leads", value: athleteLeads.length, icon: Users, color: "text-blue-600 dark:text-blue-400" },
    { label: "Team Prospects", value: teamProspects.length, icon: Target, color: "text-amber-600 dark:text-amber-400" },
    { label: "Hot Leads", value: hotAthletes, icon: Flame, color: "text-red-500 dark:text-red-400" },
    { label: "Booked / Enrolled", value: booked, icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Outreach Pending", value: outreachPending, icon: AlertCircle, color: "text-yellow-600 dark:text-yellow-400" },
    { label: "Replies Received", value: replied, icon: TrendingUp, color: "text-purple-600 dark:text-purple-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4" data-testid="stats-bar">
      {stats.map(s => (
        <Card key={s.label} className="p-3 text-center">
          <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
          <div className={`text-xl font-bold ${s.color}`} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>{s.value}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{s.label}</div>
        </Card>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

const EMPTY_STATE_MSG: Record<string, { title: string; description: string; icon: any }> = {
  all: {
    title: "No leads yet",
    description: "Leads from campaigns, landing pages, and prospect research will appear here.",
    icon: ClipboardList,
  },
  individual_athlete_lead: {
    title: "No athlete leads yet",
    description: "Individual athlete leads from campaigns and landing pages appear here. Create a lead capture program to start collecting submissions.",
    icon: Users,
  },
  team: {
    title: "No team training leads",
    description: "Schools, clubs, teams, organizations, and group opportunities appear here. Run an AI prospect search to find leads.",
    icon: Target,
  },
  organization_prospect: {
    title: "No organization prospects",
    description: "Facilities, gyms, and organizations tagged as organization prospects appear here.",
    icon: Building2,
  },
  outreach_contact: {
    title: "No outreach contacts",
    description: "General outreach contacts appear here once tagged.",
    icon: Mail,
  },
};

function EmptyState({ tab }: { tab: string }) {
  const cfg = EMPTY_STATE_MSG[tab] ?? EMPTY_STATE_MSG.all;
  return (
    <div className="text-center py-16 space-y-3" data-testid="empty-state">
      <cfg.icon className="h-10 w-10 mx-auto text-muted-foreground/40" />
      <h3 className="font-semibold text-muted-foreground">{cfg.title}</h3>
      <p className="text-sm text-muted-foreground/70 max-w-sm mx-auto">{cfg.description}</p>
      <div className="flex items-center justify-center gap-2 pt-2">
        <Link href="/admin/athlete-leads">
          <Button size="sm" variant="outline" data-testid="button-go-athlete-leads">Athlete Leads</Button>
        </Link>
        <Link href="/admin/team-training-leads">
          <Button size="sm" variant="outline" data-testid="button-go-team-leads">Team Training</Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminOutreachCenterPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSport, setFilterSport] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { data: athleteLeads = [], isLoading: athleteLoading } = useQuery<LeadCaptureSubmission[]>({
    queryKey: ["/api/admin/athlete-leads"],
  });

  const { data: teamProspects = [], isLoading: teamLoading } = useQuery<TeamTrainingProspect[]>({
    queryKey: ["/api/admin/team-training/prospects"],
  });

  const isLoading = athleteLoading || teamLoading;

  const updateAthleteMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/admin/athlete-leads/${id}`, data);
      if (!res.ok) throw new Error("Update failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
      toast({ title: "Lead updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const sports = useMemo(() => {
    const set = new Set<string>();
    athleteLeads.forEach(l => l.sport && set.add(l.sport));
    teamProspects.forEach(p => p.sport && p.sport !== "unknown" && set.add(p.sport));
    return Array.from(set).sort();
  }, [athleteLeads, teamProspects]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    teamProspects.forEach(p => p.city && p.city !== "unknown" && set.add(p.city));
    return Array.from(set).sort();
  }, [teamProspects]);

  const filteredAthletes = useMemo(() => athleteLeads.filter(l => {
    if (filterStatus !== "all" && l.bookingStatus !== filterStatus) return false;
    if (filterSport !== "all" && l.sport !== filterSport) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!l.athleteName.toLowerCase().includes(q) &&
          !(l.parentName ?? "").toLowerCase().includes(q) &&
          !(l.sport ?? "").toLowerCase().includes(q) &&
          !(l.school ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [athleteLeads, filterStatus, filterSport, searchText]);

  const filteredTeam = useMemo(() => teamProspects.filter(p => {
    if (filterSport !== "all" && p.sport?.toLowerCase() !== filterSport.toLowerCase()) return false;
    if (filterCity !== "all" && !p.city?.toLowerCase().includes(filterCity.toLowerCase())) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!p.prospectName.toLowerCase().includes(q) &&
          !(p.contactName ?? "").toLowerCase().includes(q) &&
          !(p.city ?? "").toLowerCase().includes(q) &&
          !(p.sport ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [teamProspects, filterSport, filterCity, searchText]);

  const filteredOrgProspects = filteredTeam.filter(p => p.leadType === "organization_prospect");
  const filteredTeamTraining = filteredTeam.filter(p => p.leadType !== "organization_prospect");

  function getTabCount(tab: string): number {
    switch (tab) {
      case "all": return filteredAthletes.length + filteredTeam.length;
      case "individual_athlete_lead": return filteredAthletes.length;
      case "team": return filteredTeamTraining.length;
      case "organization_prospect": return filteredOrgProspects.length;
      case "outreach_contact": return 0;
      default: return 0;
    }
  }

  function renderCards() {
    if (activeTab === "individual_athlete_lead") {
      if (filteredAthletes.length === 0) return <EmptyState tab={activeTab} />;
      return (
        <div className="space-y-3">
          {filteredAthletes.map(l => (
            <AthleteLeadCard key={l.id} lead={l}
              onUpdate={(id, data) => updateAthleteMutation.mutate({ id, data })} />
          ))}
        </div>
      );
    }
    if (activeTab === "team") {
      if (filteredTeamTraining.length === 0) return <EmptyState tab={activeTab} />;
      return (
        <div className="space-y-3">
          {filteredTeamTraining.map(p => <TeamTrainingCard key={p.id} prospect={p} />)}
        </div>
      );
    }
    if (activeTab === "organization_prospect") {
      if (filteredOrgProspects.length === 0) return <EmptyState tab={activeTab} />;
      return (
        <div className="space-y-3">
          {filteredOrgProspects.map(p => <TeamTrainingCard key={p.id} prospect={p} />)}
        </div>
      );
    }
    if (activeTab === "outreach_contact") {
      return <EmptyState tab={activeTab} />;
    }
    // All tab
    const allEmpty = filteredAthletes.length === 0 && filteredTeam.length === 0;
    if (allEmpty) return <EmptyState tab="all" />;
    return (
      <div className="space-y-3">
        {filteredAthletes.map(l => (
          <AthleteLeadCard key={l.id} lead={l}
            onUpdate={(id, data) => updateAthleteMutation.mutate({ id, data })} />
        ))}
        {filteredTeam.map(p => <TeamTrainingCard key={p.id} prospect={p} />)}
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Outreach Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All leads — athletes, teams, organizations — in one view</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-leads"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
          }} data-testid="button-refresh">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <Link href="/admin/athlete-leads">
            <Button size="sm" variant="outline" data-testid="button-athlete-leads-full">
              <Users className="h-3.5 w-3.5 mr-1.5" /> Athlete Leads
            </Button>
          </Link>
          <Link href="/admin/team-training-leads">
            <Button size="sm" variant="outline" data-testid="button-team-leads-full">
              <Target className="h-3.5 w-3.5 mr-1.5" /> Team Training
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Bar */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <StatsBar athleteLeads={athleteLeads as LeadCaptureSubmission[]} teamProspects={teamProspects as TeamTrainingProspect[]} />
      )}

      {/* Search + Filters */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search name, school, sport, city…"
              value={searchText} onChange={e => setSearchText(e.target.value)}
              className="pl-9 w-full" data-testid="input-search" />
          </div>
          <Button size="sm" variant="outline" className="shrink-0 self-start sm:self-auto" onClick={() => setShowFilters(f => !f)} data-testid="button-toggle-filters">
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Filters
            {(filterStatus !== "all" || filterSport !== "all" || filterCity !== "all") && (
              <span className="ml-1.5 h-2 w-2 rounded-full bg-primary inline-block" />
            )}
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 bg-muted/30 rounded-lg border" data-testid="filter-bar">
            <Select value={filterSport} onValueChange={setFilterSport}>
              <SelectTrigger className="h-8 w-full text-xs" data-testid="select-sport">
                <SelectValue placeholder="Sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sports</SelectItem>
                {sports.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            {(activeTab === "all" || activeTab === "individual_athlete_lead") && (
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 w-full text-xs" data-testid="select-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(BOOKING_STATUS_MAP).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {(activeTab === "all" || activeTab === "team" || activeTab === "organization_prospect") && cities.length > 0 && (
              <Select value={filterCity} onValueChange={setFilterCity}>
                <SelectTrigger className="h-8 w-full text-xs" data-testid="select-city">
                  <SelectValue placeholder="City" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cities</SelectItem>
                  {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {(filterStatus !== "all" || filterSport !== "all" || filterCity !== "all") && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground justify-start sm:justify-center"
                onClick={() => { setFilterStatus("all"); setFilterSport("all"); setFilterCity("all"); }}
                data-testid="button-clear-filters">
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Segmented Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide border-b" data-testid="tabs-bar">
        {TABS.map(tab => {
          const count = getTabCount(tab.key);
          const active = activeTab === tab.key;
          return (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md whitespace-nowrap transition-colors shrink-0 border-b-2 ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
              data-testid={`tab-${tab.key}`}>
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        renderCards()
      )}
    </div>
  );
}
