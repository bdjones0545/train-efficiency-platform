import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Search, Plus, Loader2, RefreshCw, Mail, CheckCircle, XCircle,
  ExternalLink, Edit2, ChevronDown, ChevronUp, Target, TrendingUp,
  Users, SendHorizonal, AlertCircle, FileText, Trash2, Filter,
  MessageSquare, PhoneOff
} from "lucide-react";
import type { TeamTrainingProspect, TeamTrainingOutreachDraft } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "Needs Review": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  "Approved": "bg-green-500/15 text-green-700 dark:text-green-400",
  "Contacted": "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  "Replied": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "Not Interested": "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  "Do Not Contact": "bg-red-500/15 text-red-700 dark:text-red-400",
};

const SPORTS = ["Football", "Soccer", "Basketball", "Baseball", "Volleyball", "Lacrosse", "Wrestling", "Cheer", "Swimming", "Track & Field", "Softball", "Martial Arts", "Tennis", "Cross Country"];
const STATUSES = ["New", "Needs Review", "Approved", "Contacted", "Replied", "Not Interested", "Do Not Contact"];
const ORG_TYPES = ["Youth Club", "High School Program", "AAU Team", "Travel Ball", "Club Team", "Academy", "Martial Arts Gym", "Community Program", "Private School", "Cheer Program", "Swim Team"];

type DraftWithProspect = TeamTrainingOutreachDraft & { prospect?: TeamTrainingProspect };

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{score}%</span>
    </div>
  );
}

function ProspectCard({
  prospect,
  onStatusChange,
  onEdit,
  onGenerateEmail,
  onDelete,
  onMarkReplied,
  onDoNotContact,
}: {
  prospect: TeamTrainingProspect;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (p: TeamTrainingProspect) => void;
  onGenerateEmail: (p: TeamTrainingProspect) => void;
  onDelete: (id: string) => void;
  onMarkReplied: (id: string) => void;
  onDoNotContact: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4 space-y-3" data-testid={`card-prospect-${prospect.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate" data-testid={`text-prospect-name-${prospect.id}`}>{prospect.prospectName}</h3>
            <Badge className={`text-xs shrink-0 ${STATUS_COLORS[prospect.outreachStatus || "New"]}`} data-testid={`badge-status-${prospect.id}`}>
              {prospect.outreachStatus}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {prospect.organizationType} · {prospect.sport} · {prospect.city}, {prospect.state}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(prospect)} data-testid={`button-edit-${prospect.id}`}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded((e) => !e)} data-testid={`button-expand-${prospect.id}`}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <ConfidenceBar score={prospect.confidenceScore || 50} />

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onGenerateEmail(prospect)} data-testid={`button-generate-email-${prospect.id}`}>
          <Mail className="h-3 w-3 mr-1" /> Generate Email
        </Button>
        {prospect.outreachStatus !== "Replied" && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onMarkReplied(prospect.id)} data-testid={`button-mark-replied-${prospect.id}`}>
            <MessageSquare className="h-3 w-3 mr-1" /> Mark Replied
          </Button>
        )}
        {prospect.outreachStatus !== "Do Not Contact" && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => onDoNotContact(prospect.id)} data-testid={`button-dnc-${prospect.id}`}>
            <PhoneOff className="h-3 w-3 mr-1" /> Do Not Contact
          </Button>
        )}
        {prospect.websiteUrl && (
          <a href={prospect.websiteUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-website-${prospect.id}`}>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <ExternalLink className="h-3 w-3 mr-1" /> Website
            </Button>
          </a>
        )}
        {prospect.sourceUrl && (
          <a href={prospect.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${prospect.id}`}>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
              Source
            </Button>
          </a>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 pt-2 border-t text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Contact:</span> {prospect.contactName}</div>
            <div><span className="text-muted-foreground">Role:</span> {prospect.contactRole}</div>
            <div><span className="text-muted-foreground">Email:</span> {prospect.contactEmail || <span className="italic text-muted-foreground">not set</span>}</div>
            <div><span className="text-muted-foreground">Phone:</span> {prospect.contactPhone || <span className="italic text-muted-foreground">not set</span>}</div>
            {prospect.lastContactedAt && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Last Contacted:</span>{" "}
                {new Date(prospect.lastContactedAt).toLocaleDateString()}
              </div>
            )}
          </div>
          {prospect.notes && (
            <p className="text-muted-foreground italic border-l-2 pl-2">{prospect.notes}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Select value={prospect.outreachStatus || "New"} onValueChange={(v) => onStatusChange(prospect.id, v)}>
              <SelectTrigger className="h-7 text-xs w-40" data-testid={`select-status-${prospect.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => onDelete(prospect.id)} data-testid={`button-delete-${prospect.id}`}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DraftCard({ draft, onApprove, onSend, onEdit }: {
  draft: DraftWithProspect;
  onApprove: (id: string) => void;
  onSend: (id: string) => void;
  onEdit: (draft: DraftWithProspect) => void;
}) {
  return (
    <Card className="p-4 space-y-3" data-testid={`card-draft-${draft.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{draft.prospect?.prospectName || "Unknown Prospect"}</p>
          <p className="text-xs text-muted-foreground">{draft.subject}</p>
        </div>
        <div className="flex items-center gap-1 text-xs shrink-0">
          {draft.sentAt ? (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-xs">Sent</Badge>
          ) : draft.approved ? (
            <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 text-xs">Approved</Badge>
          ) : (
            <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 text-xs">Pending Review</Badge>
          )}
        </div>
      </div>
      <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/50 rounded p-2 max-h-32 overflow-y-auto font-sans">{draft.body}</pre>
      <div className="flex gap-2 flex-wrap">
        {!draft.sentAt && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEdit(draft)} data-testid={`button-edit-draft-${draft.id}`}>
            <Edit2 className="h-3 w-3 mr-1" /> Edit
          </Button>
        )}
        {!draft.approved && !draft.sentAt && (
          <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onApprove(draft.id)} data-testid={`button-approve-draft-${draft.id}`}>
            <CheckCircle className="h-3 w-3 mr-1" /> Approve
          </Button>
        )}
        {draft.approved && !draft.sentAt && (
          <Button size="sm" className="h-7 text-xs" onClick={() => onSend(draft.id)} data-testid={`button-send-draft-${draft.id}`}>
            <SendHorizonal className="h-3 w-3 mr-1" /> Send Now
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function AdminTeamTrainingLeadsPage() {
  const { toast } = useToast();

  const [filterSport, setFilterSport] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCity, setFilterCity] = useState("");
  const [searchText, setSearchText] = useState("");
  const [researchDialogOpen, setResearchDialogOpen] = useState(false);
  const [researchSport, setResearchSport] = useState("all");
  const [researchLimit, setResearchLimit] = useState("8");
  const [editProspect, setEditProspect] = useState<TeamTrainingProspect | null>(null);
  const [editDraft, setEditDraft] = useState<DraftWithProspect | null>(null);
  const [generateEmailForProspect, setGenerateEmailForProspect] = useState<TeamTrainingProspect | null>(null);
  const [estimatedValue, setEstimatedValue] = useState("500");

  const { data: stats, isLoading: statsLoading } = useQuery<{ newLeads: number; pendingApproval: number; sentThisWeek: number; replies: number }>({
    queryKey: ["/api/admin/team-training/stats"],
  });

  const { data: prospects, isLoading: prospectsLoading } = useQuery<TeamTrainingProspect[]>({
    queryKey: ["/api/admin/team-training/prospects"],
  });

  const { data: drafts, isLoading: draftsLoading } = useQuery<DraftWithProspect[]>({
    queryKey: ["/api/admin/team-training/drafts"],
  });

  const researchMutation = useMutation({
    mutationFn: async (data: { sport?: string; limit: number }) => {
      const res = await apiRequest("POST", "/api/admin/team-training/research", data);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Found ${data.count} new leads`, description: "Prospects added to your pipeline." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      setResearchDialogOpen(false);
    },
    onError: (err: Error) => toast({ title: "Research failed", description: err.message, variant: "destructive" }),
  });

  const updateProspectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TeamTrainingProspect> }) => {
      const res = await apiRequest("PATCH", `/api/admin/team-training/prospects/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      setEditProspect(null);
      toast({ title: "Prospect updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteProspectMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/team-training/prospects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Prospect deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const generateEmailMutation = useMutation({
    mutationFn: async (prospectId: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/prospects/${prospectId}/generate-email`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      setGenerateEmailForProspect(null);
      toast({ title: "Email draft generated", description: "Review it in the Drafts tab." });
    },
    onError: (err: Error) => toast({ title: "Email generation failed", description: err.message, variant: "destructive" }),
  });

  const approveDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/drafts/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Draft approved", description: "You can now send this email." });
    },
    onError: (err: Error) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
  });

  const sendDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/drafts/${id}/send`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Email sent", description: `Sent to ${data.sentTo}` });
    },
    onError: (err: Error) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const updateDraftMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TeamTrainingOutreachDraft> }) => {
      const res = await apiRequest("PATCH", `/api/admin/team-training/drafts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      setEditDraft(null);
      toast({ title: "Draft updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const markRepliedMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/prospects/${id}/mark-replied`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Marked as replied" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const doNotContactMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/prospects/${id}/do-not-contact`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Marked as Do Not Contact" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const filteredProspects = (prospects || []).filter((p) => {
    if (filterSport && filterSport !== "all" && p.sport?.toLowerCase() !== filterSport.toLowerCase()) return false;
    if (filterStatus && filterStatus !== "all" && p.outreachStatus !== filterStatus) return false;
    if (filterCity && !p.city?.toLowerCase().includes(filterCity.toLowerCase())) return false;
    if (searchText && !p.prospectName.toLowerCase().includes(searchText.toLowerCase()) && !p.contactName?.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const pipelineValue = (prospects || []).filter((p) => !["Do Not Contact", "Not Interested"].includes(p.outreachStatus || "")).length * (parseInt(estimatedValue) || 500);

  const [editProspectForm, setEditProspectForm] = useState<Partial<TeamTrainingProspect>>({});

  const openEditProspect = (p: TeamTrainingProspect) => {
    setEditProspect(p);
    setEditProspectForm(p);
  };

  const [editDraftForm, setEditDraftForm] = useState<{ subject: string; body: string }>({ subject: "", body: "" });

  const openEditDraft = (d: DraftWithProspect) => {
    setEditDraft(d);
    setEditDraftForm({ subject: d.subject, body: d.body });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Team Training Leads</h1>
          <p className="text-muted-foreground mt-1 text-sm">Research and reach out to local sports organizations for team training partnerships.</p>
        </div>
        <Button onClick={() => setResearchDialogOpen(true)} data-testid="button-research-leads">
          <Search className="h-4 w-4 mr-2" /> Research New Leads
        </Button>
      </div>

      {/* Dashboard stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Card className="p-3 text-center">
              <Target className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-new-leads">{stats?.newLeads || 0}</p>
              <p className="text-xs text-muted-foreground">New Leads</p>
            </Card>
            <Card className="p-3 text-center">
              <FileText className="h-4 w-4 mx-auto text-yellow-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-pending">{stats?.pendingApproval || 0}</p>
              <p className="text-xs text-muted-foreground">Drafts Pending</p>
            </Card>
            <Card className="p-3 text-center">
              <SendHorizonal className="h-4 w-4 mx-auto text-purple-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-sent">{stats?.sentThisWeek || 0}</p>
              <p className="text-xs text-muted-foreground">Sent This Week</p>
            </Card>
            <Card className="p-3 text-center">
              <MessageSquare className="h-4 w-4 mx-auto text-green-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-replies">{stats?.replies || 0}</p>
              <p className="text-xs text-muted-foreground">Replies</p>
            </Card>
            <Card className="p-3 text-center">
              <TrendingUp className="h-4 w-4 mx-auto text-primary mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-pipeline">${pipelineValue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Est. Pipeline</p>
            </Card>
          </>
        )}
      </div>

      {/* Pipeline value setting */}
      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Estimated value per prospect:</span>
          <div className="flex items-center gap-1">
            <span className="text-sm">$</span>
            <Input
              type="number"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              className="w-24 h-7 text-sm"
              data-testid="input-estimated-value"
            />
            <span className="text-xs text-muted-foreground">/session or /month</span>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="prospects">
        <TabsList>
          <TabsTrigger value="prospects" data-testid="tab-prospects">
            Leads ({filteredProspects.length})
          </TabsTrigger>
          <TabsTrigger value="drafts" data-testid="tab-drafts">
            Drafts ({drafts?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prospects" className="mt-4 space-y-4">
          {/* Filters */}
          <Card className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search by name..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="h-8 text-sm w-40"
                data-testid="input-search"
              />
              <Select value={filterSport} onValueChange={setFilterSport}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-sport">
                  <SelectValue placeholder="All Sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Filter by city..."
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
                className="h-8 text-sm w-32"
                data-testid="input-filter-city"
              />
              {(filterSport !== "all" || filterStatus !== "all" || filterCity || searchText) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterSport("all"); setFilterStatus("all"); setFilterCity(""); setSearchText(""); }} data-testid="button-clear-filters">
                  Clear
                </Button>
              )}
            </div>
          </Card>

          {prospectsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : filteredProspects.length === 0 ? (
            <Card className="p-12 text-center">
              <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-40" />
              <p className="font-medium text-muted-foreground" data-testid="text-empty-state">No leads found</p>
              <p className="text-sm text-muted-foreground mt-1">Click "Research New Leads" to discover local sports organizations in your area.</p>
              <Button className="mt-4" onClick={() => setResearchDialogOpen(true)} data-testid="button-research-empty">
                <Search className="h-4 w-4 mr-2" /> Research New Leads
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProspects.map((p) => (
                <ProspectCard
                  key={p.id}
                  prospect={p}
                  onStatusChange={(id, status) => updateProspectMutation.mutate({ id, data: { outreachStatus: status as any } })}
                  onEdit={openEditProspect}
                  onGenerateEmail={setGenerateEmailForProspect}
                  onDelete={(id) => deleteProspectMutation.mutate(id)}
                  onMarkReplied={(id) => markRepliedMutation.mutate(id)}
                  onDoNotContact={(id) => doNotContactMutation.mutate(id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drafts" className="mt-4 space-y-4">
          {draftsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : !drafts || drafts.length === 0 ? (
            <Card className="p-12 text-center">
              <Mail className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-40" />
              <p className="font-medium text-muted-foreground" data-testid="text-empty-drafts">No email drafts yet</p>
              <p className="text-sm text-muted-foreground mt-1">Generate an email draft from any lead card to start the approval process.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {drafts.map((d) => (
                <DraftCard
                  key={d.id}
                  draft={d}
                  onApprove={(id) => approveDraftMutation.mutate(id)}
                  onSend={(id) => sendDraftMutation.mutate(id)}
                  onEdit={openEditDraft}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Research dialog */}
      <Dialog open={researchDialogOpen} onOpenChange={setResearchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Research New Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              The AI agent will search for local sports organizations near your location that are good candidates for team training partnerships.
            </p>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Sport focus (optional)</label>
              <Select value={researchSport} onValueChange={setResearchSport}>
                <SelectTrigger data-testid="select-research-sport">
                  <SelectValue placeholder="All sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sports</SelectItem>
                  {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Number of leads to find</label>
              <Select value={researchLimit} onValueChange={setResearchLimit}>
                <SelectTrigger data-testid="select-research-limit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 leads</SelectItem>
                  <SelectItem value="8">8 leads</SelectItem>
                  <SelectItem value="12">12 leads</SelectItem>
                  <SelectItem value="15">15 leads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3 text-xs text-yellow-800 dark:text-yellow-300 flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Prospects are added for review only. No emails are sent automatically. Always verify contact info before reaching out.</span>
            </div>
            <Button
              className="w-full"
              onClick={() => researchMutation.mutate({ sport: researchSport === "all" ? undefined : researchSport, limit: parseInt(researchLimit) })}
              disabled={researchMutation.isPending}
              data-testid="button-start-research"
            >
              {researchMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Researching...</>
              ) : (
                <><Search className="h-4 w-4 mr-2" /> Start Research</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate email confirm dialog */}
      <Dialog open={!!generateEmailForProspect} onOpenChange={(o) => !o && setGenerateEmailForProspect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Outreach Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Generate a personalized outreach email draft for <strong>{generateEmailForProspect?.prospectName}</strong>.
              The draft will appear in the Drafts tab for your review before sending.
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 text-xs text-blue-800 dark:text-blue-300 flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>The email will not be sent until you review and approve it in the Drafts tab.</span>
            </div>
            <Button
              className="w-full"
              onClick={() => generateEmailForProspect && generateEmailMutation.mutate(generateEmailForProspect.id)}
              disabled={generateEmailMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateEmailMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Mail className="h-4 w-4 mr-2" /> Generate Draft</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit prospect dialog */}
      <Dialog open={!!editProspect} onOpenChange={(o) => !o && setEditProspect(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Prospect</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Organization Name</label>
                <Input value={editProspectForm.prospectName || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, prospectName: e.target.value }))} data-testid="input-edit-name" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Organization Type</label>
                <Select value={editProspectForm.organizationType || ""} onValueChange={(v) => setEditProspectForm((f) => ({ ...f, organizationType: v }))}>
                  <SelectTrigger className="text-sm" data-testid="select-edit-org-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
                <Select value={editProspectForm.sport || ""} onValueChange={(v) => setEditProspectForm((f) => ({ ...f, sport: v }))}>
                  <SelectTrigger className="text-sm" data-testid="select-edit-sport">
                    <SelectValue placeholder="Select sport" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">City</label>
                <Input value={editProspectForm.city || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, city: e.target.value }))} data-testid="input-edit-city" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">State</label>
                <Input value={editProspectForm.state || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, state: e.target.value }))} maxLength={2} data-testid="input-edit-state" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contact Name</label>
                <Input value={editProspectForm.contactName || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, contactName: e.target.value }))} data-testid="input-edit-contact-name" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contact Role</label>
                <Input value={editProspectForm.contactRole || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, contactRole: e.target.value }))} data-testid="input-edit-contact-role" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contact Email</label>
                <Input type="email" value={editProspectForm.contactEmail || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, contactEmail: e.target.value }))} data-testid="input-edit-email" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contact Phone</label>
                <Input value={editProspectForm.contactPhone || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, contactPhone: e.target.value }))} data-testid="input-edit-phone" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Website URL</label>
                <Input value={editProspectForm.websiteUrl || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, websiteUrl: e.target.value }))} data-testid="input-edit-website" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                <Textarea value={editProspectForm.notes || ""} onChange={(e) => setEditProspectForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="input-edit-notes" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select value={editProspectForm.outreachStatus || "New"} onValueChange={(v) => setEditProspectForm((f) => ({ ...f, outreachStatus: v as any }))}>
                  <SelectTrigger className="text-sm" data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => editProspect && updateProspectMutation.mutate({ id: editProspect.id, data: editProspectForm })}
              disabled={updateProspectMutation.isPending}
              data-testid="button-save-prospect"
            >
              {updateProspectMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit draft dialog */}
      <Dialog open={!!editDraft} onOpenChange={(o) => !o && setEditDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Email Draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
              <Input value={editDraftForm.subject} onChange={(e) => setEditDraftForm((f) => ({ ...f, subject: e.target.value }))} data-testid="input-edit-draft-subject" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Body</label>
              <Textarea value={editDraftForm.body} onChange={(e) => setEditDraftForm((f) => ({ ...f, body: e.target.value }))} rows={12} className="font-mono text-sm" data-testid="input-edit-draft-body" />
            </div>
            <Button
              className="w-full"
              onClick={() => editDraft && updateDraftMutation.mutate({ id: editDraft.id, data: editDraftForm })}
              disabled={updateDraftMutation.isPending}
              data-testid="button-save-draft"
            >
              {updateDraftMutation.isPending ? "Saving..." : "Save Draft"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
