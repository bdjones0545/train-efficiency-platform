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
  Save,
  ShieldCheck,
  Play,
  BarChart3,
  User,
  Star,
  Clock,
  Video,
  Image,
  Trophy,
  Zap,
  Target,
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

interface ExternalAsset {
  id: string;
  sourceType: string;
  sourceUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  extractedMetadata: any;
  confidenceScore: number | null;
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

function safeFmt(d: string | null | undefined, fmt = "MMM d, yyyy") {
  if (!d) return "—";
  try { return format(parseISO(d), fmt); } catch { return d; }
}

function ConfidenceBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const pct = Math.round(s * 100);
  if (s >= 0.75) return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] px-1.5">{pct}% match</Badge>;
  if (s >= 0.4) return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px] px-1.5">{pct}% match</Badge>;
  return <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px] px-1.5">{pct}% match</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px]">Approved</Badge>;
  if (status === "rejected") return <Badge variant="secondary" className="text-[10px]">Rejected</Badge>;
  if (status === "pending_review") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">Needs Review</Badge>;
  if (status === "draft") return <Badge variant="outline" className="text-[10px]">Draft</Badge>;
  return <Badge variant="outline" className="text-[10px] capitalize">{status}</Badge>;
}

function sourceTypeIcon(type: string) {
  switch (type) {
    case "hudl": return <Play className="h-4 w-4 text-orange-500" />;
    case "youtube": return <Video className="h-4 w-4 text-red-500" />;
    case "maxpreps": return <Trophy className="h-4 w-4 text-blue-500" />;
    case "stats": return <BarChart3 className="h-4 w-4 text-violet-500" />;
    case "roster": return <User className="h-4 w-4 text-cyan-500" />;
    case "recruiting": return <Target className="h-4 w-4 text-emerald-500" />;
    case "image": return <Image className="h-4 w-4 text-pink-500" />;
    default: return <ExternalLink className="h-4 w-4 text-muted-foreground" />;
  }
}

function summaryTypeLabel(type: string) {
  switch (type) {
    case "notes": return "Coach Notes Summary";
    case "pr_progress": return "PR Progress Analysis";
    case "player_report": return "Player Report";
    case "recruiting_snapshot": return "Recruiting Snapshot";
    case "full_profile": return "Full Profile";
    default: return type;
  }
}

function summaryTypeIcon(type: string) {
  switch (type) {
    case "notes": return <ClipboardList className="h-4 w-4" />;
    case "pr_progress": return <TrendingUp className="h-4 w-4" />;
    case "player_report": return <FileText className="h-4 w-4" />;
    case "recruiting_snapshot": return <Target className="h-4 w-4" />;
    default: return <Brain className="h-4 w-4" />;
  }
}

// ─── Approval controls shared component ──────────────────────────────────────

function ApproveRejectButtons({
  status,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
  approveTestId,
  rejectTestId,
}: {
  status: string;
  onApprove: () => void;
  onReject: () => void;
  approvePending: boolean;
  rejectPending: boolean;
  approveTestId?: string;
  rejectTestId?: string;
}) {
  if (status !== "pending_review") return null;
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={onApprove}
        disabled={approvePending}
        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
        data-testid={approveTestId}
      >
        {approvePending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onReject}
        disabled={rejectPending}
        className="flex-1 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs"
        data-testid={rejectTestId}
      >
        {rejectPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1.5" />}
        Reject
      </Button>
    </div>
  );
}

// ─── Review warning banner ────────────────────────────────────────────────────

function ReviewWarning() {
  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
      <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-amber-700 dark:text-amber-300">
        Coach review required. Verify this is the correct athlete before approving. No data enters the profile until you approve it.
      </p>
    </div>
  );
}

// ─── Expandable card wrapper ──────────────────────────────────────────────────

function ExpandCard({
  icon,
  title,
  badges,
  meta,
  expanded,
  onToggle,
  children,
  dimmed,
  testId,
  expandTestId,
}: {
  icon: React.ReactNode;
  title: string;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dimmed?: boolean;
  testId?: string;
  expandTestId?: string;
}) {
  return (
    <Card className={`overflow-hidden ${dimmed ? "opacity-50" : ""}`} data-testid={testId}>
      <button
        className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
        onClick={onToggle}
        data-testid={expandTestId}
      >
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold truncate">{title}</p>
            {badges}
          </div>
          {meta && <div className="flex items-center gap-2 mt-0.5 flex-wrap">{meta}</div>}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {expanded && <div className="border-t px-4 py-3 space-y-3">{children}</div>}
    </Card>
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
    onSuccess: () => { toast({ title: "Summary saved" }); setEditing(false); onUpdated(); },
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

  return (
    <ExpandCard
      icon={<span className="text-violet-500">{summaryTypeIcon(summary.summaryType)}</span>}
      title={summaryTypeLabel(summary.summaryType)}
      badges={<><StatusBadge status={summary.status} />{summary.editedText && <Badge variant="secondary" className="text-[10px]">Edited</Badge>}</>}
      meta={<span className="text-xs text-muted-foreground">{safeFmt(summary.createdAt, "MMM d, yyyy · h:mm a")}</span>}
      expanded={expanded}
      onToggle={() => setExpanded((e) => !e)}
      testId={`summary-card-${summary.id}`}
      expandTestId={`button-expand-summary-${summary.id}`}
    >
      {editing ? (
        <>
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="min-h-[260px] text-sm font-mono resize-none"
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
          <div className="text-sm whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3 max-h-72 overflow-y-auto" data-testid={`text-summary-content-${summary.id}`}>
            {summary.editedText || summary.generatedText}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid={`button-edit-summary-${summary.id}`}>
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            {summary.status !== "approved" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                data-testid={`button-approve-summary-${summary.id}`}
              >
                {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />} Approve to Profile
              </Button>
            )}
          </div>
        </>
      )}
    </ExpandCard>
  );
}

// ─── Public Profile Card ──────────────────────────────────────────────────────

function PublicProfileCard({ profile, athleteUserId, orgToken, onUpdated }: { profile: PublicProfile; athleteUserId: string; orgToken: string; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/public-profile/${profile.id}/approve`, {
        method: "PATCH", headers: { "X-Org-Auth-Token": orgToken },
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
        method: "PATCH", headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile data rejected" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fields = Object.entries(profile.extractedData || {}).filter(([, v]) => v && String(v).trim());

  return (
    <ExpandCard
      icon={<Search className="h-4 w-4 text-blue-500" />}
      title={profile.sourceTitle || profile.sourceName || "Unknown source"}
      badges={<><StatusBadge status={profile.status} /></>}
      meta={<><span className="text-xs text-muted-foreground">{profile.sourceName}</span><ConfidenceBadge score={profile.confidenceScore} /></>}
      expanded={expanded}
      onToggle={() => setExpanded((e) => !e)}
      dimmed={profile.status === "rejected"}
      testId={`public-profile-card-${profile.id}`}
      expandTestId={`button-expand-profile-${profile.id}`}
    >
      {profile.sourceUrl && (
        <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline break-all" data-testid={`link-source-${profile.id}`}>
          <ExternalLink className="h-3 w-3 flex-shrink-0" /> {profile.sourceUrl}
        </a>
      )}
      {fields.length > 0 && (
        <div className="rounded-lg border divide-y text-xs">
          {fields.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 px-3 py-2">
              <span className="text-muted-foreground capitalize w-28 flex-shrink-0">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <span className="font-medium">{String(val)}</span>
            </div>
          ))}
        </div>
      )}
      <ReviewWarning />
      <ApproveRejectButtons
        status={profile.status}
        onApprove={() => approveMutation.mutate()}
        onReject={() => rejectMutation.mutate()}
        approvePending={approveMutation.isPending}
        rejectPending={rejectMutation.isPending}
        approveTestId={`button-approve-profile-${profile.id}`}
        rejectTestId={`button-reject-profile-${profile.id}`}
      />
      {profile.status === "approved" && profile.approvedAt && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Approved {safeFmt(profile.approvedAt)}
        </p>
      )}
    </ExpandCard>
  );
}

// ─── External Asset Card ──────────────────────────────────────────────────────

function ExternalAssetCard({ asset, athleteUserId, orgToken, onUpdated }: { asset: ExternalAsset; athleteUserId: string; orgToken: string; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/external-asset/${asset.id}/approve`, {
        method: "PATCH", headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Asset approved" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/org/coach/athletes/${athleteUserId}/external-asset/${asset.id}/reject`, {
        method: "PATCH", headers: { "X-Org-Auth-Token": orgToken },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Asset rejected" }); onUpdated(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const meta = asset.extractedMetadata || {};
  const metaFields = Object.entries(meta).filter(([, v]) => v && String(v).trim());

  return (
    <ExpandCard
      icon={sourceTypeIcon(asset.sourceType)}
      title={asset.title || asset.sourceUrl}
      badges={<><StatusBadge status={asset.status} /><Badge variant="outline" className="text-[10px] capitalize">{asset.sourceType}</Badge></>}
      meta={<><ConfidenceBadge score={asset.confidenceScore} /><span className="text-xs text-muted-foreground">{safeFmt(asset.createdAt)}</span></>}
      expanded={expanded}
      onToggle={() => setExpanded((e) => !e)}
      dimmed={asset.status === "rejected"}
      testId={`asset-card-${asset.id}`}
      expandTestId={`button-expand-asset-${asset.id}`}
    >
      {asset.thumbnailUrl && (
        <img src={asset.thumbnailUrl} alt="thumbnail" className="w-full max-h-40 object-cover rounded-lg border" />
      )}
      <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline break-all" data-testid={`link-asset-${asset.id}`}>
        <ExternalLink className="h-3 w-3 flex-shrink-0" /> {asset.sourceUrl}
      </a>
      {metaFields.length > 0 && (
        <div className="rounded-lg border divide-y text-xs">
          {metaFields.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 px-3 py-2">
              <span className="text-muted-foreground capitalize w-28 flex-shrink-0">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <span className="font-medium">{String(val)}</span>
            </div>
          ))}
        </div>
      )}
      <ReviewWarning />
      <ApproveRejectButtons
        status={asset.status}
        onApprove={() => approveMutation.mutate()}
        onReject={() => rejectMutation.mutate()}
        approvePending={approveMutation.isPending}
        rejectPending={rejectMutation.isPending}
        approveTestId={`button-approve-asset-${asset.id}`}
        rejectTestId={`button-reject-asset-${asset.id}`}
      />
      {asset.status === "approved" && asset.approvedAt && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Approved {safeFmt(asset.approvedAt)}
        </p>
      )}
    </ExpandCard>
  );
}

// ─── Research Form ────────────────────────────────────────────────────────────

function ResearchForm({ athleteUserId, orgToken, athleteName, onJobStarted }: { athleteUserId: string; orgToken: string; athleteName: string; onJobStarted: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    athleteName,
    school: "",
    team: "",
    sport: "",
    position: "",
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
      toast({ title: "Research started", description: "Results appear when the search completes. Check Public Profile and Highlight Media tabs." });
      onJobStarted();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fields = [
    { key: "athleteName", label: "Athlete Name", placeholder: "Full name" },
    { key: "school", label: "School / Org", placeholder: "School or club name" },
    { key: "sport", label: "Sport", placeholder: "e.g. Football" },
    { key: "position", label: "Position", placeholder: "e.g. QB, WR" },
    { key: "graduationYear", label: "Grad Year", placeholder: "e.g. 2025" },
    { key: "location", label: "City / State", placeholder: "e.g. Austin, TX" },
    { key: "team", label: "Team Name", placeholder: "Team name" },
  ];

  return (
    <div className="space-y-3">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
        <Search className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          Searches publicly available sports sites only. All results require your review before becoming part of this athlete's profile.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key} className={`space-y-1 ${key === "athleteName" ? "col-span-2" : ""}`}>
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
        {startMutation.isPending ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Searching public sources…</>
        ) : (
          <><Search className="h-3.5 w-3.5 mr-1.5" /> Find Public Athlete Information</>
        )}
      </Button>
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

type TabId = "summary" | "public" | "stats" | "media" | "jobs" | "recruiting";

function TabBtn({ id, active, onClick, icon, label, badge }: { id: TabId; active: boolean; onClick: (t: TabId) => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={() => onClick(id)}
      data-testid={`tab-${id}`}
      className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
    >
      <span className="h-4 w-4 flex items-center justify-center">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-amber-500 text-white text-[8px] flex items-center justify-center font-bold leading-none">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Card className="p-7 text-center border-dashed">
      <div className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-30 flex items-center justify-center">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </Card>
  );
}

// ─── Running job banner ───────────────────────────────────────────────────────

function RunningJobBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Card className="p-3 flex items-center gap-3 border-blue-500/20 bg-blue-500/5 mb-2">
      <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
      <div>
        <p className="text-sm font-medium">Research in progress…</p>
        <p className="text-xs text-muted-foreground">Results will appear in Public Profile and Highlight Media tabs when complete.</p>
      </div>
    </Card>
  );
}

// ─── Pending review banner ────────────────────────────────────────────────────

function PendingBanner({ count, what }: { count: number; what: string }) {
  if (count === 0) return null;
  return (
    <Card className="p-3 flex items-center gap-3 border-amber-500/20 bg-amber-500/5 mb-2">
      <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
      <p className="text-xs text-amber-700 dark:text-amber-300">{count} {what} pending your review — approve or reject before data is added to this athlete's profile.</p>
    </Card>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function PRIntelligencePanel({ athleteUserId, orgToken, athleteName, coachNotes }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [generating, setGenerating] = useState<string | null>(null);
  const [pollingResearch, setPollingResearch] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: ["/api/org/coach/athletes", athleteUserId, key] });

  const summariesQ = useQuery<{ summaries: AiSummary[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/summaries"],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summaries`, { headers: { "X-Org-Auth-Token": orgToken } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const jobsQ = useQuery<{ jobs: ResearchJob[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "ai/research-jobs"],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/research-jobs`, { headers: { "X-Org-Auth-Token": orgToken } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: pollingResearch ? 4000 : false,
  });

  const profilesQ = useQuery<{ profiles: PublicProfile[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "public-profiles"],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/athletes/${athleteUserId}/public-profiles`, { headers: { "X-Org-Auth-Token": orgToken } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const assetsQ = useQuery<{ assets: ExternalAsset[] }>({
    queryKey: ["/api/org/coach/athletes", athleteUserId, "external-assets"],
    queryFn: async () => {
      const r = await fetch(`/api/org/coach/athletes/${athleteUserId}/external-assets`, { headers: { "X-Org-Auth-Token": orgToken } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const jobs = jobsQ.data?.jobs || [];
  const summaries = summariesQ.data?.summaries || [];
  const profiles = profilesQ.data?.profiles || [];
  const assets = assetsQ.data?.assets || [];

  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "pending");
  if (runningJobs.length > 0 && !pollingResearch) setPollingResearch(true);
  if (runningJobs.length === 0 && pollingResearch) {
    setPollingResearch(false);
    invalidate("public-profiles");
    invalidate("external-assets");
  }

  const pendingProfiles = profiles.filter((p) => p.status === "pending_review").length;
  const pendingAssets = assets.filter((a) => a.status === "pending_review").length;
  const pendingTotal = pendingProfiles + pendingAssets;

  const mediaAssets = assets.filter((a) => ["hudl", "youtube", "image"].includes(a.sourceType));
  const statsAssets = assets.filter((a) => ["stats", "maxpreps", "roster", "recruiting"].includes(a.sourceType));
  const recruitingSnaps = summaries.filter((s) => s.summaryType === "recruiting_snapshot");

  const pendingMedia = mediaAssets.filter((a) => a.status === "pending_review").length;
  const pendingStats = statsAssets.filter((a) => a.status === "pending_review").length;

  async function generateSummary(type: "notes" | "pr_progress" | "player_report" | "recruiting_snapshot") {
    setGenerating(type);
    try {
      const r = await fetch(`/api/org/coach/athletes/${athleteUserId}/ai/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify({ summaryType: type, coachNotes }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Summary generated", description: "Review and edit before approving to athlete profile." });
      invalidate("ai/summaries");
      setActiveTab("summary");
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  }

  return (
    <section data-testid="section-athlete-intelligence">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-violet-500" /> Athlete Intelligence
        </h2>
        <div className="flex items-center gap-2">
          {pendingTotal > 0 && (
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
              {pendingTotal} pending review
            </Badge>
          )}
          <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-600 dark:text-violet-400">
            AI-Assisted
          </Badge>
        </div>
      </div>

      {/* Quick Generation Actions */}
      <Card className="p-4 mb-3">
        <p className="text-xs text-muted-foreground mb-2.5">Generate AI-assisted insights. All outputs are drafts — review before using.</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { type: "notes" as const, icon: <ClipboardList className="h-3.5 w-3.5" />, label: "Coach Notes Summary" },
            { type: "pr_progress" as const, icon: <TrendingUp className="h-3.5 w-3.5" />, label: "PR Progress Analysis" },
            { type: "player_report" as const, icon: <FileText className="h-3.5 w-3.5" />, label: "Player Report" },
            { type: "recruiting_snapshot" as const, icon: <Target className="h-3.5 w-3.5" />, label: "Recruiting Snapshot" },
          ].map(({ type, icon, label }) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              onClick={() => generateSummary(type)}
              disabled={!!generating}
              className="flex items-center justify-start gap-1.5 text-xs h-9"
              data-testid={`button-generate-${type}`}
            >
              {generating === type ? <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" /> : icon}
              <span className="truncate">{label}</span>
            </Button>
          ))}
        </div>
        {generating && (
          <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            Generating {generating === "notes" ? "notes summary" : generating === "pr_progress" ? "PR progress analysis" : generating === "player_report" ? "player report" : "recruiting snapshot"}…
          </div>
        )}
      </Card>

      {/* Tab Bar — 6 tabs */}
      <div className="flex items-stretch border rounded-xl overflow-hidden mb-3">
        <TabBtn id="summary" active={activeTab === "summary"} onClick={setActiveTab} icon={<Brain className="h-3.5 w-3.5" />} label="Summaries" badge={summaries.filter((s) => s.status === "draft").length} />
        <TabBtn id="public" active={activeTab === "public"} onClick={setActiveTab} icon={<User className="h-3.5 w-3.5" />} label="Profile" badge={pendingProfiles} />
        <TabBtn id="stats" active={activeTab === "stats"} onClick={setActiveTab} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Stats" badge={pendingStats} />
        <TabBtn id="media" active={activeTab === "media"} onClick={setActiveTab} icon={<Play className="h-3.5 w-3.5" />} label="Media" badge={pendingMedia} />
        <TabBtn id="recruiting" active={activeTab === "recruiting"} onClick={setActiveTab} icon={<Target className="h-3.5 w-3.5" />} label="Recruiting" />
        <TabBtn id="jobs" active={activeTab === "jobs"} onClick={setActiveTab} icon={<Search className="h-3.5 w-3.5" />} label="Research" badge={runningJobs.length} />
      </div>

      {/* ── Tab: AI Summaries ─────────────────────────────────────────────── */}
      {activeTab === "summary" && (
        <div className="space-y-2">
          {summariesQ.isLoading ? (
            <><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></>
          ) : summaries.length === 0 ? (
            <EmptyState icon={<Sparkles className="h-8 w-8" />} title="No summaries yet" subtitle="Use the buttons above to generate your first AI summary." />
          ) : (
            summaries.map((s) => (
              <SummaryCard key={s.id} summary={s} athleteUserId={athleteUserId} orgToken={orgToken} onUpdated={() => invalidate("ai/summaries")} />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Public Profile ───────────────────────────────────────────── */}
      {activeTab === "public" && (
        <div className="space-y-2">
          <RunningJobBanner count={runningJobs.length} />
          <PendingBanner count={pendingProfiles} what="public profile result(s)" />
          {profilesQ.isLoading ? (
            <><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></>
          ) : profiles.length === 0 ? (
            <EmptyState icon={<User className="h-8 w-8" />} title="No public profiles found" subtitle="Use the Research tab to search for this athlete on public sports sites." />
          ) : (
            profiles.map((p) => (
              <PublicProfileCard key={p.id} profile={p} athleteUserId={athleteUserId} orgToken={orgToken} onUpdated={() => invalidate("public-profiles")} />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Stats ────────────────────────────────────────────────────── */}
      {activeTab === "stats" && (
        <div className="space-y-2">
          <RunningJobBanner count={runningJobs.length} />
          <PendingBanner count={pendingStats} what="stats/roster result(s)" />
          {assetsQ.isLoading ? (
            <><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></>
          ) : statsAssets.length === 0 ? (
            <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="No stats found" subtitle="Research may return MaxPreps stats pages, roster data, and recruiting profiles here." />
          ) : (
            statsAssets.map((a) => (
              <ExternalAssetCard key={a.id} asset={a} athleteUserId={athleteUserId} orgToken={orgToken} onUpdated={() => invalidate("external-assets")} />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Highlight Media ──────────────────────────────────────────── */}
      {activeTab === "media" && (
        <div className="space-y-2">
          <RunningJobBanner count={runningJobs.length} />
          <PendingBanner count={pendingMedia} what="media result(s)" />
          {assetsQ.isLoading ? (
            <><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></>
          ) : mediaAssets.length === 0 ? (
            <EmptyState icon={<Video className="h-8 w-8" />} title="No highlight media found" subtitle="Research may return Hudl highlight reels, YouTube game film, and public images here." />
          ) : (
            mediaAssets.map((a) => (
              <ExternalAssetCard key={a.id} asset={a} athleteUserId={athleteUserId} orgToken={orgToken} onUpdated={() => invalidate("external-assets")} />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Recruiting Snapshot ──────────────────────────────────────── */}
      {activeTab === "recruiting" && (
        <div className="space-y-2">
          {recruitingSnaps.length === 0 ? (
            <>
              <EmptyState icon={<Target className="h-8 w-8" />} title="No recruiting snapshot yet" subtitle='Click "Recruiting Snapshot" above to generate an AI-assisted recruiting-style profile using internal data and approved public info.' />
              <div className="flex items-center gap-2 p-3 rounded-xl border border-dashed text-xs text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                <span>Tip: Approve public profile and stats data first to get a richer recruiting snapshot with verified external context.</span>
              </div>
            </>
          ) : (
            recruitingSnaps.map((s) => (
              <SummaryCard key={s.id} summary={s} athleteUserId={athleteUserId} orgToken={orgToken} onUpdated={() => invalidate("ai/summaries")} />
            ))
          )}
        </div>
      )}

      {/* ── Tab: Research Jobs ────────────────────────────────────────────── */}
      {activeTab === "jobs" && (
        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search className="h-4 w-4 text-blue-500" />
              <p className="text-sm font-semibold">Find Public Athlete Information</p>
            </div>
            <ResearchForm
              athleteUserId={athleteUserId}
              orgToken={orgToken}
              athleteName={athleteName}
              onJobStarted={() => {
                setPollingResearch(true);
                invalidate("ai/research-jobs");
                setActiveTab("public");
              }}
            />
          </Card>

          {jobs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Searches</p>
              {jobs.slice(0, 8).map((job) => (
                <Card key={job.id} className="p-3 flex items-center gap-3" data-testid={`job-card-${job.id}`}>
                  <div className="flex-shrink-0">
                    {(job.status === "running" || job.status === "pending") ? (
                      <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    ) : job.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {(job.query as any)?.athleteName || "Search"}
                      {(job.query as any)?.sport ? ` · ${(job.query as any).sport}` : ""}
                      {(job.query as any)?.school ? ` · ${(job.query as any).school}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {job.status === "running" || job.status === "pending"
                        ? "Searching public sources…"
                        : job.status === "completed"
                        ? `Completed ${safeFmt(job.completedAt, "MMM d, h:mm a")} · ${((job.result as any)?.publicProfiles?.length || 0) + ((job.result as any)?.externalAssets?.length || 0)} results`
                        : `Failed: ${job.errorMessage || "unknown error"}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{job.status}</Badge>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
