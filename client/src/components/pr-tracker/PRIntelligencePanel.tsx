import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Sparkles,
  Search,
  FileText,
  TrendingUp,
  ClipboardList,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Eye,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiSummary {
  id: string;
  summaryType: string;
  generatedText: string;
  editedText: string | null;
  status: string;
  createdAt: string;
}

interface PublicProfile {
  id: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidenceScore: number | null;
  extractedData: any;
  status: string;
  approvedByCoachId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface ResearchJob {
  id: string;
  status: string;
  query: any;
  result: any;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Props {
  athleteUserId: string;
  orgToken: string;
  athleteName: string;
  coachNotes: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeFmt(dateStr: string | null | undefined, fmt = "MMM d, yyyy") {
  if (!dateStr) return "—";
  try { return format(parseISO(dateStr), fmt); } catch { return dateStr; }
}

function confidenceBadge(score: number | null) {
  const s = score ?? 0;
  if (s >= 0.75) return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">{Math.round(s * 100)}% confidence</Badge>;
  if (s >= 0.4) return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">{Math.round(s * 100)}% confidence</Badge>;
  return <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 text-xs">{Math.round(s * 100)}% confidence</Badge>;
}

function summaryTypeLabel(type: string) {
  switch (type) {
    case "notes": return "Coach Notes Summary";
    case "pr_progress": return "PR Progress Summary";
    case "player_report": return "Player Report";
    case "full_profile": return "Full Profile";
    default: return type;
  }
}

function summaryTypeIcon(type: string) {
  switch (type) {
    case "notes": return <ClipboardList className="h-4 w-4" />;
    case "pr_progress": return <TrendingUp className="h-4 w-4" />;
    case "player_report": return <FileText className="h-4 w-4" />;
    default: return <Brain className="h-4 w-4" />;
  }
}

// ─── Research Form ────────────────────────────────────────────────────────────

function ResearchForm({ athleteUserId, orgToken, athleteName, onJobStarted }: { athleteUserId: string; orgToken: string; athleteName: string; onJobStarted: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    athleteName,
    school: "",
    team: "",
    sport: "",
    graduationYear: "",
    location: "",
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Research started", description: "Results will appear when the search completes." });
      onJobStarted();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Provide details to help the agent find the right athlete on public sports sites.</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { key: "athleteName", label: "Athlete Name", placeholder: "Full name" },
          { key: "school", label: "School / Org", placeholder: "School or club name" },
          { key: "team", label: "Team", placeholder: "Team name" },
          { key: "sport", label: "Sport", placeholder: "e.g. Football" },
          { key: "graduationYear", label: "Grad Year", placeholder: "e.g. 2025" },
          { key: "location", label: "City / State", placeholder: "e.g. Austin, TX" },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            <input
              value={(form as any)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              data-testid={`input-research-${key}`}
              className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <Button
        onClick={() => startMutation.mutate()}
        disabled={startMutation.isPending || !form.athleteName}
        size="sm"
        className="w-full"
        data-testid="button-start-research"
      >
        {startMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Searching…</> : <><Search className="h-3.5 w-3.5 mr-1.5" /> Find Public Info</>}
      </Button>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ summary, athleteUserId, orgToken, onUpdated }: { summary: AiSummary; athleteUserId: string; orgToken: string; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(summary.editedText || summary.generatedText);
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summary/${summary.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ editedText: editText }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Summary saved" });
      setEditing(false);
      onUpdated();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summary/${summary.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Summary approved" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const displayText = summary.editedText || summary.generatedText;

  return (
    <Card className="overflow-hidden" data-testid={`summary-card-${summary.id}`}>
      <button
        className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        data-testid={`button-expand-summary-${summary.id}`}
      >
        <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 text-violet-500">
          {summaryTypeIcon(summary.summaryType)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{summaryTypeLabel(summary.summaryType)}</p>
            {summary.status === "approved" && (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">Approved</Badge>
            )}
            {summary.status === "draft" && (
              <Badge variant="outline" className="text-xs">Draft</Badge>
            )}
            {summary.editedText && (
              <Badge variant="secondary" className="text-xs">Edited</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{safeFmt(summary.createdAt, "MMM d, yyyy h:mm a")}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {editing ? (
            <>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[240px] text-sm font-mono resize-none"
                data-testid={`textarea-edit-summary-${summary.id}`}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1" data-testid={`button-save-summary-${summary.id}`}>
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />} Save Changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditText(summary.editedText || summary.generatedText); }}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto" data-testid={`text-summary-content-${summary.id}`}>
                {displayText}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid={`button-edit-summary-${summary.id}`}>
                  <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                {summary.status !== "approved" && (
                  <Button size="sm" variant="outline" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10" data-testid={`button-approve-summary-${summary.id}`}>
                    {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />} Approve
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Public Profile Card ──────────────────────────────────────────────────────

function PublicProfileCard({ profile, athleteUserId, orgToken, onUpdated }: { profile: PublicProfile; athleteUserId: string; orgToken: string; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/public-profile/${profile.id}/approve`, {
        method: "PATCH",
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile data approved" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/public-profile/${profile.id}/reject`, {
        method: "PATCH",
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile data rejected" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const data = profile.extractedData || {};
  const fields = Object.entries(data).filter(([, v]) => v && String(v).trim());

  return (
    <Card className={`overflow-hidden ${profile.status === "rejected" ? "opacity-50" : ""}`} data-testid={`public-profile-card-${profile.id}`}>
      <button
        className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        data-testid={`button-expand-profile-${profile.id}`}
      >
        <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 text-blue-500">
          <Search className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{profile.sourceTitle || profile.sourceName || "Unknown source"}</p>
            {profile.status === "pending_review" && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">Needs Review</Badge>
            )}
            {profile.status === "approved" && (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">Approved</Badge>
            )}
            {profile.status === "rejected" && (
              <Badge variant="secondary" className="text-xs">Rejected</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {profile.sourceName && <span className="text-xs text-muted-foreground">{profile.sourceName}</span>}
            {confidenceBadge(profile.confidenceScore)}
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {profile.sourceUrl && (
            <a
              href={profile.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              data-testid={`link-source-${profile.id}`}
            >
              <ExternalLink className="h-3 w-3" /> {profile.sourceUrl}
            </a>
          )}

          {fields.length > 0 && (
            <div className="rounded-lg border divide-y text-xs">
              {fields.map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-muted-foreground capitalize w-24 flex-shrink-0">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                  <span className="font-medium">{String(val)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Coach review required before this data becomes part of the athlete profile. Verify this is the correct athlete before approving.
            </p>
          </div>

          {profile.status === "pending_review" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid={`button-approve-profile-${profile.id}`}
              >
                {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />} Approve Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="flex-1 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                data-testid={`button-reject-profile-${profile.id}`}
              >
                {rejectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1.5" />} Reject
              </Button>
            </div>
          )}

          {profile.status === "approved" && profile.approvedAt && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Approved {safeFmt(profile.approvedAt)}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors relative ${active ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-amber-500 text-white text-[9px] flex items-center justify-center font-bold">{badge > 9 ? "9+" : badge}</span>
      )}
    </button>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function PRIntelligencePanel({ athleteUserId, orgToken, athleteName, coachNotes }: Props) {
  const [activeTab, setActiveTab] = useState<"summaries" | "research" | "public">("summaries");
  const [generating, setGenerating] = useState<string | null>(null);
  const [pollingResearch, setPollingResearch] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const summariesQuery = useQuery<{ summaries: AiSummary[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/summaries"],
    queryFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summaries`, {
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const researchJobsQuery = useQuery<{ jobs: ResearchJob[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/research-jobs"],
    queryFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/research-jobs`, {
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: pollingResearch ? 4000 : false,
  });

  const publicProfilesQuery = useQuery<{ profiles: PublicProfile[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "public-profiles"],
    queryFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/public-profiles`, {
        headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const runningJobs = (researchJobsQuery.data?.jobs || []).filter((j) => j.status === "running" || j.status === "pending");

  if (runningJobs.length > 0 && !pollingResearch) setPollingResearch(true);
  if (runningJobs.length === 0 && pollingResearch) {
    setPollingResearch(false);
    queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, "public-profiles"] });
  }

  const pendingReviewCount = (publicProfilesQuery.data?.profiles || []).filter((p) => p.status === "pending_review").length;

  async function generateSummary(summaryType: "notes" | "pr_progress" | "player_report") {
    setGenerating(summaryType);
    try {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ summaryType, coachNotes }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Summary generated", description: "Review and edit before saving to athlete profile." });
      queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/summaries"] });
      setActiveTab("summaries");
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  }

  const summaries = summariesQuery.data?.summaries || [];
  const profiles = publicProfilesQuery.data?.profiles || [];
  const jobs = researchJobsQuery.data?.jobs || [];

  return (
    <section data-testid="section-pr-intelligence">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-violet-500" /> PR Intelligence
        </h2>
        <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-600 dark:text-violet-400">
          AI-Assisted
        </Badge>
      </div>

      {/* Quick Action Buttons */}
      <Card className="p-4 mb-3">
        <p className="text-xs text-muted-foreground mb-3">Generate AI-assisted insights from this athlete's data. All outputs are drafts — review before using.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateSummary("notes")}
            disabled={!!generating}
            className="flex items-center gap-1.5 text-xs h-9"
            data-testid="button-generate-notes-summary"
          >
            {generating === "notes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}
            Summarize Notes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateSummary("pr_progress")}
            disabled={!!generating}
            className="flex items-center gap-1.5 text-xs h-9"
            data-testid="button-generate-pr-progress"
          >
            {generating === "pr_progress" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
            PR Progress
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateSummary("player_report")}
            disabled={!!generating}
            className="flex items-center gap-1.5 text-xs h-9 col-span-2 sm:col-span-1"
            data-testid="button-generate-player-report"
          >
            {generating === "player_report" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Player Report
          </Button>
        </div>

        {generating && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            Generating {generating === "notes" ? "notes summary" : generating === "pr_progress" ? "PR progress analysis" : "player report"}…
          </div>
        )}
      </Card>

      {/* Tabs */}
      <div className="flex items-center gap-0 border rounded-xl overflow-hidden mb-3">
        <TabBtn active={activeTab === "summaries"} onClick={() => setActiveTab("summaries")} icon={<Brain className="h-3.5 w-3.5" />} label="Summaries" badge={summaries.filter((s) => s.status === "draft").length} />
        <TabBtn active={activeTab === "research"} onClick={() => setActiveTab("research")} icon={<Search className="h-3.5 w-3.5" />} label="Research" />
        <TabBtn active={activeTab === "public"} onClick={() => setActiveTab("public")} icon={<Eye className="h-3.5 w-3.5" />} label="Public Info" badge={pendingReviewCount} />
      </div>

      {/* Summaries Tab */}
      {activeTab === "summaries" && (
        <div className="space-y-2">
          {summariesQuery.isLoading ? (
            <>
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </>
          ) : summaries.length === 0 ? (
            <Card className="p-6 text-center border-dashed">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-violet-500 opacity-40" />
              <p className="text-sm font-medium">No summaries yet</p>
              <p className="text-xs text-muted-foreground mt-1">Use the buttons above to generate your first AI summary.</p>
            </Card>
          ) : (
            summaries.map((s) => (
              <SummaryCard
                key={s.id}
                summary={s}
                athleteUserId={athleteUserId}
                orgToken={orgToken}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/summaries"] })}
              />
            ))
          )}
        </div>
      )}

      {/* Research Tab */}
      {activeTab === "research" && (
        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search className="h-4 w-4 text-blue-500" />
              <p className="text-sm font-semibold">Find Public Athlete Info</p>
            </div>
            <ResearchForm
              athleteUserId={athleteUserId}
              orgToken={orgToken}
              athleteName={athleteName}
              onJobStarted={() => {
                setPollingResearch(true);
                setActiveTab("public");
                queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/research-jobs"] });
              }}
            />
          </Card>

          {jobs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Searches</p>
              {jobs.slice(0, 5).map((job) => (
                <Card key={job.id} className="p-3 flex items-center gap-3" data-testid={`job-card-${job.id}`}>
                  <div className="flex-shrink-0">
                    {job.status === "running" || job.status === "pending" ? (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    ) : job.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{(job.query as any)?.athleteName || "Search"}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.status === "running" || job.status === "pending" ? "Searching…" : job.status === "completed" ? `Completed ${safeFmt(job.completedAt)}` : `Failed: ${job.errorMessage || "unknown error"}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{job.status}</Badge>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Public Info Tab */}
      {activeTab === "public" && (
        <div className="space-y-2">
          {runningJobs.length > 0 && (
            <Card className="p-3 flex items-center gap-3 border-blue-500/20 bg-blue-500/5">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Research in progress</p>
                <p className="text-xs text-muted-foreground">Results will appear automatically when the search completes.</p>
              </div>
            </Card>
          )}

          {publicProfilesQuery.isLoading ? (
            <>
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </>
          ) : profiles.length === 0 ? (
            <Card className="p-6 text-center border-dashed">
              <Search className="h-8 w-8 mx-auto mb-2 text-blue-500 opacity-40" />
              <p className="text-sm font-medium">No public info found yet</p>
              <p className="text-xs text-muted-foreground mt-1">Use the Research tab to search for public athlete information.</p>
            </Card>
          ) : (
            <>
              {pendingReviewCount > 0 && (
                <Card className="p-3 flex items-center gap-3 border-amber-500/20 bg-amber-500/5">
                  <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">{pendingReviewCount} result{pendingReviewCount !== 1 ? "s" : ""} pending your review. Approve or reject before data is saved to this athlete's profile.</p>
                </Card>
              )}
              {profiles.map((p) => (
                <PublicProfileCard
                  key={p.id}
                  profile={p}
                  athleteUserId={athleteUserId}
                  orgToken={orgToken}
                  onUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, "public-profiles"] })}
                />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
