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
  MessageSquare, PhoneOff, ShieldCheck, ShieldAlert, ShieldX,
  Activity, BarChart2, Zap
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

type DraftWithProspect = TeamTrainingOutreachDraft & { prospect?: TeamTrainingProspect };

// ─── Client-side Stage Computation ─────────────────────────────────────────
function getClientStage(prospect: TeamTrainingProspect): { label: string; className: string } {
  const status = prospect.outreachStatus || "New";
  if (status === "Do Not Contact") return { label: "Do Not Contact", className: "bg-red-200 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
  if (status === "Not Interested") return { label: "Lost", className: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" };
  if (status === "Replied") return { label: "Interested", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  if (status === "Contacted") return { label: "Contacted", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
  return { label: "Cold", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
}

// ─── Client-side Contact Quality Computation ───────────────────────────────
function getClientQuality(prospect: TeamTrainingProspect): { label: string; className: string; score: number } {
  const email = (prospect.contactEmail || "").trim().toLowerCase();
  const role = (prospect.contactRole || "").toLowerCase();

  if (!email) return { label: "No Email", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", score: 0 };
  if (!email.includes("@")) return { label: "Invalid", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", score: 0 };

  const coachRoles = ["head coach", "coach", "assistant coach", "strength", "trainer"];
  if (coachRoles.some((r) => role.includes(r)) || email.includes("coach") || email.includes("trainer")) {
    return { label: "High Quality", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", score: 92 };
  }

  const adRoles = ["athletic director", "athletics director", "director of athletics"];
  if (adRoles.some((r) => role.includes(r)) || email.includes("athleticdirector") || email.split("@")[0] === "ad") {
    return { label: "High Quality", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", score: 80 };
  }

  if (email.includes("athletics@") || email.includes("sports@") || email.includes("athletic@")) {
    return { label: "Medium Quality", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", score: 62 };
  }

  const emailUser = email.split("@")[0];
  if (["info", "office", "admin", "contact", "hello", "general", "school", "main"].some((g) => emailUser === g || emailUser.startsWith(g + "."))) {
    return { label: "Low Quality", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", score: 38 };
  }

  return { label: "Medium Quality", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", score: 55 };
}

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
  const stage = getClientStage(prospect);
  const quality = getClientQuality(prospect);

  return (
    <Card className="p-4 space-y-3" data-testid={`card-prospect-${prospect.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate" data-testid={`text-prospect-name-${prospect.id}`}>{prospect.prospectName}</h3>
            <Badge className={`text-xs shrink-0 ${STATUS_COLORS[prospect.outreachStatus || "New"]}`} data-testid={`badge-status-${prospect.id}`}>
              {prospect.outreachStatus}
            </Badge>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${stage.className}`} data-testid={`badge-stage-${prospect.id}`}>
              {stage.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {prospect.organizationType} · {prospect.sport} · {prospect.city}, {prospect.state}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${quality.className}`} data-testid={`badge-quality-${prospect.id}`} title={`Email Quality Score: ${quality.score}/100`}>
            {quality.score > 0 ? `Q:${quality.score}` : quality.label}
          </span>
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
          {/* Stage-aware messaging guidance */}
          {stage.label !== "Cold" && (
            <div className="bg-muted/50 rounded p-2 border-l-2 border-primary/40">
              <p className="text-muted-foreground font-medium mb-0.5">Messaging Guidance — {stage.label}</p>
              <p className="text-muted-foreground">{getMessagingGuidance(stage.label)}</p>
            </div>
          )}
          {/* Contact quality detail */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${quality.className}`}>
              {quality.label}
            </span>
            <span className="text-muted-foreground">Score: {quality.score}/100</span>
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

function getMessagingGuidance(stageLabel: string): string {
  const map: Record<string, string> = {
    "Contacted": "Send a simple, friendly bump. Keep it brief — one paragraph, one ask.",
    "Interested": "Move toward a call or simple proposal. Be direct — they want to hear more.",
    "Lost": "Do not contact. Revisit in 6–12 months with a fresh approach if appropriate.",
    "Do Not Contact": "Outreach is blocked. Do not send any messages to this prospect.",
  };
  return map[stageLabel] || "Reference their prior engagement. Offer something specific.";
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

// ─── Audit Tab ─────────────────────────────────────────────────────────────
interface AuditCheck {
  name: string;
  pass: boolean;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
  suggestedFix: string;
}

interface AuditReport {
  status: "healthy" | "warning" | "critical";
  healthScore: number;
  checks: AuditCheck[];
  warnings: string[];
  recommendations: string[];
  generatedAt: string;
  contactQualityDistribution: { high: number; medium: number; low: number; missing: number; total: number };
  stageDistribution: Record<string, number>;
  autoExecMetrics: { successRate: number; engagementRate: number; revenuePerAction: number; todayCount: number; maxPerDay: number };
}

function AuditTab() {
  const { data: report, isLoading, refetch, isFetching } = useQuery<AuditReport>({
    queryKey: ["/api/email-agent/audit"],
    enabled: false,
  });

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedChecks = report ? [...report.checks].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]) : [];

  const severityBadge = (s: AuditCheck["severity"]) => {
    const map = {
      critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
      high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
      low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    };
    return map[s];
  };

  const statusColor = report
    ? report.status === "healthy" ? "text-emerald-600 dark:text-emerald-400"
    : report.status === "warning" ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400"
    : "";

  const StatusIcon = report
    ? report.status === "healthy" ? ShieldCheck
    : report.status === "warning" ? ShieldAlert
    : ShieldX
    : ShieldCheck;

  return (
    <div className="space-y-4" data-testid="audit-tab-content">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Email Agent Health Audit</h2>
          <p className="text-xs text-muted-foreground">Verify your email agent is configured correctly and performing well.</p>
        </div>
        <Button size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-run-audit">
          {isFetching ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          {report ? "Re-run Audit" : "Run Audit"}
        </Button>
      </div>

      {isLoading || isFetching ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : !report ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No audit data yet</p>
          <p className="text-xs mt-1">Click "Run Audit" to perform a full health check of your email agent.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Header Score */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusIcon className={`h-8 w-8 ${statusColor}`} />
                <div>
                  <p className={`text-2xl font-bold ${statusColor}`} data-testid="text-audit-score">{report.healthScore}</p>
                  <p className="text-xs text-muted-foreground">Health Score / 100</p>
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold capitalize ${
                  report.status === "healthy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : report.status === "warning" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                }`} data-testid="badge-audit-status">{report.status}</span>
                <p className="text-xs text-muted-foreground mt-1">{new Date(report.generatedAt).toLocaleTimeString()}</p>
              </div>
            </div>
          </Card>

          {/* Distribution Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Contact Quality Distribution */}
            <Card className="p-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Contact Quality</p>
              <div className="space-y-1">
                {[
                  { label: "High Quality", count: report.contactQualityDistribution.high, className: "bg-emerald-500" },
                  { label: "Medium Quality", count: report.contactQualityDistribution.medium, className: "bg-blue-500" },
                  { label: "Low Quality", count: report.contactQualityDistribution.low, className: "bg-yellow-500" },
                  { label: "Missing Email", count: report.contactQualityDistribution.missing, className: "bg-red-400" },
                ].map(({ label, count, className }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: `var(--${className})` }}>
                      <div className={`w-2 h-2 rounded-full ${className}`} />
                    </div>
                    <span className="text-muted-foreground flex-1">{label}</span>
                    <span className="font-medium" data-testid={`text-quality-${label.toLowerCase().replace(/ /g,"-")}`}>{count}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Stage Distribution */}
            <Card className="p-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1"><BarChart2 className="h-3.5 w-3.5" /> Stage Distribution</p>
              <div className="space-y-1">
                {Object.entries(report.stageDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([stage, count]) => (
                    <div key={stage} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground flex-1 capitalize">{stage.replace(/_/g, " ")}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>

          {/* Auto-Exec Metrics */}
          <Card className="p-3">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Zap className="h-3.5 w-3.5" /> Auto-Execution Performance</p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="text-center">
                <p className="text-lg font-bold text-primary" data-testid="text-audit-success-rate">{report.autoExecMetrics.successRate}%</p>
                <p className="text-muted-foreground">Success Rate</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400" data-testid="text-audit-engagement-rate">{report.autoExecMetrics.engagementRate}%</p>
                <p className="text-muted-foreground">Engagement Rate</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-audit-revenue-per-action">${report.autoExecMetrics.revenuePerAction}</p>
                <p className="text-muted-foreground">Revenue/Action</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>Today: {report.autoExecMetrics.todayCount}/{report.autoExecMetrics.maxPerDay} auto-actions</span>
            </div>
          </Card>

          {/* Warnings */}
          {report.warnings.length > 0 && (
            <Card className="p-3 border-yellow-200 dark:border-yellow-800">
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> Warnings ({report.warnings.length})
              </p>
              <ul className="space-y-1">
                {report.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-yellow-500 shrink-0 mt-0.5">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Checks */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Checks ({sortedChecks.filter(c => c.pass).length}/{sortedChecks.length} passing)
            </p>
            {sortedChecks.map((check) => (
              <Card key={check.name} className={`p-3 ${!check.pass && check.severity === "critical" ? "border-red-300 dark:border-red-800" : ""}`} data-testid={`card-audit-check-${check.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-start gap-2">
                  {check.pass
                    ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    : <XCircle className={`h-4 w-4 shrink-0 mt-0.5 ${check.severity === "critical" ? "text-red-500" : check.severity === "high" ? "text-orange-500" : "text-yellow-500"}`} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{check.name}</span>
                      {!check.pass && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium uppercase ${severityBadge(check.severity)}`}>
                          {check.severity}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{check.details}</p>
                    {!check.pass && check.suggestedFix && (
                      <p className="text-xs text-primary mt-1 font-medium">Fix: {check.suggestedFix}</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <Card className="p-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Recommendations</p>
              <ul className="space-y-1">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary shrink-0 mt-0.5">→</span>
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
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
          <TabsTrigger value="audit" data-testid="tab-audit">
            Audit
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
            </div>
          </Card>

          {prospectsLoading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : filteredProspects.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No leads found</p>
              <p className="text-xs mt-1">{prospects?.length === 0 ? "Click 'Research New Leads' to find local sports organizations." : "Try adjusting your filters."}</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredProspects.map((p) => (
                <ProspectCard
                  key={p.id}
                  prospect={p}
                  onStatusChange={(id, status) => updateProspectMutation.mutate({ id, data: { outreachStatus: status as TeamTrainingProspect["outreachStatus"] } })}
                  onEdit={openEditProspect}
                  onGenerateEmail={(p) => setGenerateEmailForProspect(p)}
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
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          ) : !drafts || drafts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No drafts yet</p>
              <p className="text-xs mt-1">Generate an email from a lead card to create your first draft.</p>
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

        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>

      {/* Research Dialog */}
      <Dialog open={researchDialogOpen} onOpenChange={setResearchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Research New Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Find local sports organizations to target for team training.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Sport (optional)</label>
              <Select value={researchSport} onValueChange={setResearchSport}>
                <SelectTrigger data-testid="select-research-sport">
                  <SelectValue placeholder="All Sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Number of leads to find</label>
              <Select value={researchLimit} onValueChange={setResearchLimit}>
                <SelectTrigger data-testid="select-research-limit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["5", "8", "10", "15", "20"].map((n) => <SelectItem key={n} value={n}>{n} leads</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setResearchDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => researchMutation.mutate({ sport: researchSport === "all" ? undefined : researchSport, limit: parseInt(researchLimit) })}
                disabled={researchMutation.isPending}
                data-testid="button-confirm-research"
              >
                {researchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Find Leads
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Prospect Dialog */}
      {editProspect && (
        <Dialog open={!!editProspect} onOpenChange={() => setEditProspect(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Prospect</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {(["prospectName", "organizationType", "sport", "city", "state"] as const).map((field) => (
                <div key={field}>
                  <label className="text-xs font-medium capitalize">{field.replace(/([A-Z])/g, " $1")}</label>
                  <Input
                    value={(editProspectForm as any)[field] || ""}
                    onChange={(e) => setEditProspectForm((f) => ({ ...f, [field]: e.target.value }))}
                    className="mt-1 h-8 text-sm"
                    data-testid={`input-edit-${field}`}
                  />
                </div>
              ))}
              {(["contactName", "contactRole", "contactEmail", "contactPhone", "websiteUrl", "sourceUrl"] as const).map((field) => (
                <div key={field}>
                  <label className="text-xs font-medium capitalize">{field.replace(/([A-Z])/g, " $1")}</label>
                  <Input
                    value={(editProspectForm as any)[field] || ""}
                    onChange={(e) => setEditProspectForm((f) => ({ ...f, [field]: e.target.value }))}
                    className="mt-1 h-8 text-sm"
                    data-testid={`input-edit-${field}`}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium">Notes</label>
                <Textarea
                  value={editProspectForm.notes || ""}
                  onChange={(e) => setEditProspectForm((f) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 text-sm"
                  rows={3}
                  data-testid="input-edit-notes"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setEditProspect(null)}>Cancel</Button>
                <Button
                  onClick={() => updateProspectMutation.mutate({ id: editProspect.id, data: editProspectForm })}
                  disabled={updateProspectMutation.isPending}
                  data-testid="button-save-prospect"
                >
                  {updateProspectMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Draft Dialog */}
      {editDraft && (
        <Dialog open={!!editDraft} onOpenChange={() => setEditDraft(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Draft</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Subject</label>
                <Input
                  value={editDraftForm.subject}
                  onChange={(e) => setEditDraftForm((f) => ({ ...f, subject: e.target.value }))}
                  className="mt-1 h-8 text-sm"
                  data-testid="input-edit-draft-subject"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Body</label>
                <Textarea
                  value={editDraftForm.body}
                  onChange={(e) => setEditDraftForm((f) => ({ ...f, body: e.target.value }))}
                  className="mt-1 text-sm font-mono"
                  rows={12}
                  data-testid="input-edit-draft-body"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditDraft(null)}>Cancel</Button>
                <Button
                  onClick={() => updateDraftMutation.mutate({ id: editDraft.id, data: editDraftForm })}
                  disabled={updateDraftMutation.isPending}
                  data-testid="button-save-draft"
                >
                  {updateDraftMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Draft
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Generate Email Confirmation */}
      {generateEmailForProspect && (
        <Dialog open={!!generateEmailForProspect} onOpenChange={() => setGenerateEmailForProspect(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Email Draft</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a personalized outreach email for <strong>{generateEmailForProspect.prospectName}</strong>. It will be added to your Drafts for review before sending.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setGenerateEmailForProspect(null)}>Cancel</Button>
                <Button
                  onClick={() => generateEmailMutation.mutate(generateEmailForProspect.id)}
                  disabled={generateEmailMutation.isPending}
                  data-testid="button-confirm-generate-email"
                >
                  {generateEmailMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                  Generate Email
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
