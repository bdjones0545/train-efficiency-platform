import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  Activity, BarChart2, Zap, Settings2, CheckCircle2, Ban, Copy, UserX,
  Sparkles, RotateCcw
} from "lucide-react";
import type { TeamTrainingProspect, TeamTrainingOutreachDraft } from "@shared/schema";

const AI_CHIPS = [
  "Make this more personal",
  "Offer a free training demo",
  "Mention speed and agility",
  "Shorten the email",
  "Make it more professional",
  "Make it more conversational",
  "Add social proof",
  "Mention local training",
  "Focus on injury prevention",
  "Add a stronger CTA",
  "Mention team performance",
  "Mention athlete development",
];

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
type ContactQualityLabel = "Decision Maker" | "Role Email" | "General Email" | "Inferred Email" | "Needs Contact";

function getClientQuality(prospect: TeamTrainingProspect): { label: ContactQualityLabel; className: string; score: number; hasEmail: boolean; isInferred: boolean } {
  const quality = prospect.contactQuality as string | null;
  const verStatus = (prospect as any).verificationStatus as string | null;
  const dmEmail = (prospect.decisionMakerEmail || "").trim();
  const contactEmail = (prospect.contactEmail || "").trim();
  const hasEmail = !!(dmEmail || contactEmail);
  const isInferred = verStatus === "inferred" || (prospect as any).contactSourceType === "inferred";

  if (quality === "decision_maker") {
    return { label: "Decision Maker", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", score: prospect.contactConfidence || 85, hasEmail: true, isInferred: false };
  }
  if (quality === "role_based") {
    if (isInferred) {
      return { label: "Inferred Email", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", score: prospect.contactConfidence || 45, hasEmail: true, isInferred: true };
    }
    return { label: "Role Email", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", score: prospect.contactConfidence || 60, hasEmail: true, isInferred: false };
  }
  if (quality === "general") {
    if (isInferred) {
      return { label: "Inferred Email", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", score: prospect.contactConfidence || 30, hasEmail: true, isInferred: true };
    }
    return { label: "General Email", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", score: prospect.contactConfidence || 35, hasEmail: true, isInferred: false };
  }
  // Legacy fallback: if contactEmail exists but contactQuality wasn't set
  if (hasEmail) {
    return { label: "General Email", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", score: 30, hasEmail: true, isInferred: false };
  }
  return { label: "Needs Contact", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", score: 0, hasEmail: false, isInferred: false };
}

// ─── Contact Source Badge ────────────────────────────────────────────────────
function ContactSourceBadge({ sourceType, verificationStatus }: { sourceType?: string | null; verificationStatus?: string | null }) {
  if (!sourceType || sourceType === "unverified") return null;
  const configs: Record<string, { label: string; className: string }> = {
    verified: { label: "Verified", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" },
    scraped: { label: "Website", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
    social: { label: "Social", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800" },
    inferred: { label: "Inferred", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-200 dark:border-orange-800" },
    manual: { label: "Manual", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700" },
  };
  const cfg = configs[sourceType] || configs.inferred;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
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
  onEnrichContact,
  enrichingId,
}: {
  prospect: TeamTrainingProspect;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (p: TeamTrainingProspect) => void;
  onGenerateEmail: (p: TeamTrainingProspect) => void;
  onDelete: (id: string) => void;
  onMarkReplied: (id: string) => void;
  onDoNotContact: (id: string) => void;
  onEnrichContact: (id: string) => void;
  enrichingId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const stage = getClientStage(prospect);
  const quality = getClientQuality(prospect);
  const isEnriching = enrichingId === prospect.id;

  const displayEmail = prospect.decisionMakerEmail || prospect.contactEmail;

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
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${quality.className}`}
            data-testid={`badge-quality-${prospect.id}`}
            title={quality.hasEmail ? `Contact confidence: ${quality.score}/100` : "No usable email — enrichment needed"}
          >
            {quality.label}
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
        {quality.hasEmail ? (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onGenerateEmail(prospect)} data-testid={`button-generate-email-${prospect.id}`}>
              <Mail className="h-3 w-3 mr-1" /> Generate Email
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => onEnrichContact(prospect.id)}
              disabled={isEnriching}
              data-testid={`button-rerun-discovery-${prospect.id}`}
            >
              {isEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Re-run Discovery
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            onClick={() => onEnrichContact(prospect.id)}
            disabled={isEnriching}
            data-testid={`button-find-email-contact-${prospect.id}`}
          >
            {isEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
            Find Email Contact
          </Button>
        )}
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
          {/* Decision-maker contact block */}
          <div className="rounded-md bg-muted/40 border p-2 space-y-2">
            <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Contact Discovery</p>

            {/* Quality + source badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${quality.className}`}>
                {quality.label}
              </span>
              <ContactSourceBadge
                sourceType={(prospect as any).contactSourceType}
                verificationStatus={(prospect as any).verificationStatus}
              />
              {quality.score > 0 && (
                <span className="text-muted-foreground text-[10px]">Confidence: {quality.score}%</span>
              )}
            </div>

            {/* Inferred warning */}
            {quality.isInferred && prospect.decisionMakerEmail && (
              <div className="flex items-start gap-1.5 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-2 py-1.5">
                <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                <p className="text-orange-700 dark:text-orange-400 text-[10px] leading-tight">
                  This email is <strong>inferred</strong> — not confirmed. Verify before sending. Outreach is still allowed.
                </p>
              </div>
            )}

            {/* Primary contact details */}
            {(prospect.decisionMakerName || prospect.decisionMakerEmail) ? (
              <div className="space-y-0.5">
                {prospect.decisionMakerName && (
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{prospect.decisionMakerName}</span></p>
                )}
                {prospect.decisionMakerTitle && (
                  <p><span className="text-muted-foreground">Title:</span> {prospect.decisionMakerTitle}</p>
                )}
                {prospect.decisionMakerEmail && (
                  <p className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-muted-foreground">Email:</span>
                    <span className="font-mono text-[11px]">{prospect.decisionMakerEmail}</span>
                  </p>
                )}
              </div>
            ) : !quality.hasEmail ? (
              <p className="italic text-muted-foreground">No contact found yet — run pipeline below.</p>
            ) : null}

            {/* AI Explanation */}
            {(prospect as any).enrichmentExplanation && (
              <div className="rounded bg-muted/60 px-2 py-1.5 border-l-2 border-primary/30">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Why this contact</p>
                <p className="text-muted-foreground leading-relaxed">{(prospect as any).enrichmentExplanation}</p>
              </div>
            )}

            {/* Alternative contacts */}
            {(() => {
              let alts: Array<{ email: string; label: string; sourceType: string; name?: string | null }> = [];
              try {
                const raw = (prospect as any).alternativeContacts;
                if (raw) alts = JSON.parse(raw);
              } catch {}
              if (alts.length === 0) return null;
              return (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Alternative Contacts</p>
                  <div className="space-y-0.5">
                    {alts.map((alt, i) => (
                      <div key={i} className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[11px] text-foreground/80">{alt.email}</span>
                        <ContactSourceBadge sourceType={alt.sourceType} verificationStatus={null} />
                        <span className="text-muted-foreground text-[10px]">{alt.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Source URL */}
            {prospect.contactSourceUrl && (
              <a href={prospect.contactSourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5 text-[10px]">
                <ExternalLink className="h-3 w-3" /> Verify contact source
              </a>
            )}

            {/* Run enrichment button */}
            <Button
              size="sm"
              variant="outline"
              className={`h-7 text-xs mt-0.5 ${!quality.hasEmail ? "border-amber-400 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
              onClick={() => onEnrichContact(prospect.id)}
              disabled={isEnriching}
              data-testid={`button-enrich-expanded-${prospect.id}`}
            >
              {isEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
              {quality.hasEmail ? "Re-run Discovery" : "Find Email Contact"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Contact:</span> {prospect.contactName}</div>
            <div><span className="text-muted-foreground">Role:</span> {prospect.contactRole}</div>
            <div><span className="text-muted-foreground">Email:</span> {displayEmail || <span className="italic text-muted-foreground">not set</span>}</div>
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
        {draft.sentAt && draft.prospectId && (
          <Link href={`/admin/trigger-audit?prospect_id=${draft.prospectId}`}>
            <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-view-trigger-${draft.id}`}>
              <Activity className="h-3 w-3 mr-1" /> View Trigger
            </Button>
          </Link>
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
  const [researchLocation, setResearchLocation] = useState("");
  const [researchLocationTouched, setResearchLocationTouched] = useState(false);
  const [researchSport, setResearchSport] = useState("all");
  const [researchLimit, setResearchLimit] = useState("8");
  const [researchRadius, setResearchRadius] = useState("25");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    defaultLocation: "",
    radiusMiles: "25",
    recurringEnabled: false,
    recurringFrequency: "weekly",
    recurringLimit: "8",
    recurringSport: "all",
    recurringTime: "08:00",
  });
  const [editProspect, setEditProspect] = useState<TeamTrainingProspect | null>(null);
  const [editDraft, setEditDraft] = useState<DraftWithProspect | null>(null);
  const [researchSummary, setResearchSummary] = useState<{
    total: number; saved: number; needsContact: number;
    rejectedLowQuality: number; duplicatesSkipped: number;
    rejected: { name: string; reason: string; score: number }[];
    duplicates: { name: string }[];
  } | null>(null);
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

  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: savedSettings } = useQuery<{
    defaultLocation: string; radiusMiles: number; recurringEnabled: boolean;
    recurringFrequency: string; recurringLimit: number; recurringSport: string; recurringTime: string;
    lastRunAt: string | null; nextRunAt: string | null; nextRunLabel: string | null; preferredTimeLabel: string;
  }>({
    queryKey: ["/api/team-training-leads/settings"],
  });

  // Pre-fill modal location + radius from saved settings
  useEffect(() => {
    if (savedSettings) {
      if (savedSettings.defaultLocation) setResearchLocation(savedSettings.defaultLocation);
      if (savedSettings.radiusMiles) setResearchRadius(String(savedSettings.radiusMiles));
      setSettingsForm({
        defaultLocation: savedSettings.defaultLocation || "",
        radiusMiles: String(savedSettings.radiusMiles ?? 25),
        recurringEnabled: savedSettings.recurringEnabled ?? false,
        recurringFrequency: savedSettings.recurringFrequency || "weekly",
        recurringLimit: String(savedSettings.recurringLimit ?? 8),
        recurringSport: savedSettings.recurringSport || "all",
        recurringTime: savedSettings.recurringTime || "08:00",
      });
    }
  }, [savedSettings]);

  const researchMutation = useMutation({
    mutationFn: async (data: { sport?: string; limit: number; location: string; radiusMiles: number }) => {
      const res = await apiRequest("POST", "/api/admin/team-training/research", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Unknown error");
      return json;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-training-leads/settings"] });
      setResearchDialogOpen(false);
      setResearchLocationTouched(false);
      if (data.summary) {
        setResearchSummary(data.summary);
      } else {
        toast({ title: `Found ${data.count} new leads`, description: "Prospects added to your pipeline." });
      }
    },
    onError: (err: Error) => {
      const msg = err.message;
      let description = "Couldn't research leads. Please try again.";
      if (msg === "AI research is not configured") {
        description = "Lead research is not configured yet. Add your OpenAI API key on the server.";
      } else if (msg === "Location required") {
        description = "Enter a location before researching leads.";
      }
      toast({ title: "Research failed", description, variant: "destructive" });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: async (data: typeof settingsForm) => {
      const res = await apiRequest("PATCH", "/api/team-training-leads/settings", {
        defaultLocation: data.defaultLocation,
        radiusMiles: parseInt(data.radiusMiles),
        recurringEnabled: data.recurringEnabled,
        recurringFrequency: data.recurringFrequency,
        recurringLimit: parseInt(data.recurringLimit),
        recurringSport: data.recurringSport,
        recurringTime: data.recurringTime,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save settings");
      return json;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-training-leads/settings"] });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 4000);
      if (result.recurringEnabled) {
        const freq = result.recurringFrequency || settingsForm.recurringFrequency;
        const timeLabel = result.preferredTimeLabel || settingsForm.recurringTime;
        const limit = result.recurringLimit ?? settingsForm.recurringLimit;
        const sport = (result.recurringSport || settingsForm.recurringSport) === "all" ? "leads" : `${result.recurringSport || settingsForm.recurringSport} leads`;
        toast({
          title: "Lead research scheduled.",
          description: `TrainEfficiency will look for ${limit} new ${sport} ${freq} at ${timeLabel}.`,
        });
      } else {
        toast({ title: "Settings saved.", description: "Recurring research is off." });
      }
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
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
      closeDraftEditor();
      toast({ title: "Draft updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const refineDraftMutation = useMutation({
    mutationFn: async ({ id, instructions, currentSubject, currentBody }: { id: string; instructions: string; currentSubject: string; currentBody: string }) => {
      const res = await apiRequest("POST", `/api/admin/team-training/drafts/${id}/refine`, { instructions, currentSubject, currentBody });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Refinement failed");
      return json as { subject: string; body: string; explanation: string };
    },
    onSuccess: (data) => {
      setEditDraftForm({ subject: data.subject, body: data.body });
      setIsAiRefined(true);
      setAiExplanation(data.explanation || "");
      setIsRefining(false);
      toast({ title: "Draft refined", description: data.explanation });
    },
    onError: (err: Error) => {
      setIsRefining(false);
      toast({ title: "Refinement failed", description: err.message, variant: "destructive" });
    },
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

  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const enrichContactMutation = useMutation({
    mutationFn: async (id: string) => {
      setEnrichingId(id);
      const res = await apiRequest("POST", `/api/team-training-leads/${id}/enrich-contact`, {});
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.message || "Enrichment failed");
        (err as any).reason = json.reason;
        (err as any).enrichmentAttempted = json.enrichmentAttempted;
        throw err;
      }
      return json;
    },
    onSuccess: (data) => {
      setEnrichingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      const q = data.enriched?.contactQuality;
      const name = data.enriched?.decisionMakerName;
      const email = data.enriched?.decisionMakerEmail;
      const isInferred = data.enriched?.verificationStatus === "inferred";
      const qualityLabel = q === "decision_maker" ? "Decision Maker" : q === "role_based" ? "Role Email" : "General Email";
      toast({
        title: isInferred ? "Email contact found (inferred)" : "Email contact found",
        description: name ? `${name} — ${qualityLabel}` : email ? `${qualityLabel}: ${email}` : qualityLabel,
      });
    },
    onError: (err: Error) => {
      setEnrichingId(null);
      const reason = (err as any).reason;
      if (reason === "email_required") {
        toast({
          title: "No email found yet",
          description: "Try adding a website URL or source URL to this lead, then re-run discovery.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Discovery failed",
        description: err.message || "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    },
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
  const [aiInstruction, setAiInstruction] = useState("");
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [originalDraftForm, setOriginalDraftForm] = useState<{ subject: string; body: string } | null>(null);
  const [isAiRefined, setIsAiRefined] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  const openEditDraft = (d: DraftWithProspect) => {
    setEditDraft(d);
    setEditDraftForm({ subject: d.subject, body: d.body });
    setAiInstruction("");
    setSelectedChips([]);
    setOriginalDraftForm(null);
    setIsAiRefined(false);
    setShowComparison(false);
    setAiExplanation("");
    setIsRefining(false);
  };

  const closeDraftEditor = () => {
    setEditDraft(null);
    setAiInstruction("");
    setSelectedChips([]);
    setOriginalDraftForm(null);
    setIsAiRefined(false);
    setShowComparison(false);
    setAiExplanation("");
    setIsRefining(false);
  };

  const handleAiRefine = () => {
    if (!editDraft || !aiInstruction.trim()) return;
    if (!originalDraftForm) {
      setOriginalDraftForm({ ...editDraftForm });
    }
    setIsRefining(true);
    refineDraftMutation.mutate({
      id: editDraft.id,
      instructions: aiInstruction,
      currentSubject: editDraftForm.subject,
      currentBody: editDraftForm.body,
    });
  };

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) => {
      const isSelected = prev.includes(chip);
      if (isSelected) {
        return prev.filter((c) => c !== chip);
      } else {
        setAiInstruction((ins) => ins ? `${ins}, ${chip.toLowerCase()}` : chip);
        return [...prev, chip];
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Team Training Leads</h1>
          <p className="text-muted-foreground mt-1 text-sm">Research and reach out to local sports organizations for team training partnerships.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsDialogOpen(true)} data-testid="button-lead-settings">
            <Settings2 className="h-4 w-4 mr-2" /> Lead Settings
          </Button>
          <Button onClick={() => setResearchDialogOpen(true)} data-testid="button-research-leads">
            <Search className="h-4 w-4 mr-2" /> Research New Leads
          </Button>
        </div>
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
                  onEnrichContact={(id) => enrichContactMutation.mutate(id)}
                  enrichingId={enrichingId}
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
      <Dialog open={researchDialogOpen} onOpenChange={(open) => { setResearchDialogOpen(open); if (!open) { setResearchLocationTouched(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Research New Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Find local sports organizations to target for team training.</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Location <span className="text-destructive">*</span></label>
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Bluffton, SC"
                value={researchLocation}
                onChange={(e) => setResearchLocation(e.target.value)}
                onBlur={() => setResearchLocationTouched(true)}
                data-testid="input-research-location"
              />
              {researchLocationTouched && !researchLocation.trim() && (
                <p className="text-xs text-destructive">Enter a city and state to research local teams.</p>
              )}
              <p className="text-xs text-muted-foreground">Saved for this organization after each successful search.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Radius</label>
              <Select value={researchRadius} onValueChange={setResearchRadius}>
                <SelectTrigger data-testid="select-research-radius">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["10", "25", "50", "75", "100"].map((n) => <SelectItem key={n} value={n}>{n} miles</SelectItem>)}
                </SelectContent>
              </Select>
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
                onClick={() => {
                  setResearchLocationTouched(true);
                  if (!researchLocation.trim()) return;
                  researchMutation.mutate({ sport: researchSport === "all" ? undefined : researchSport, limit: parseInt(researchLimit), location: researchLocation.trim(), radiusMiles: parseInt(researchRadius) });
                }}
                disabled={researchMutation.isPending || !researchLocation.trim()}
                data-testid="button-confirm-research"
              >
                {researchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Find Leads
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lead Research Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Default Location</label>
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Bluffton, SC"
                value={settingsForm.defaultLocation}
                onChange={(e) => setSettingsForm(f => ({ ...f, defaultLocation: e.target.value }))}
                data-testid="input-settings-location"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Radius</label>
              <Select value={settingsForm.radiusMiles} onValueChange={(v) => setSettingsForm(f => ({ ...f, radiusMiles: v }))}>
                <SelectTrigger data-testid="select-settings-radius">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["10", "25", "50", "75", "100"].map((n) => <SelectItem key={n} value={n}>{n} miles</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Recurring Research</p>
                <p className="text-xs text-muted-foreground">Automatically find new leads on a schedule</p>
              </div>
              <Switch
                checked={settingsForm.recurringEnabled}
                onCheckedChange={(v) => setSettingsForm(f => ({ ...f, recurringEnabled: v }))}
                data-testid="switch-recurring-enabled"
              />
            </div>
            {settingsForm.recurringEnabled && (
              <div className="space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground">TrainEfficiency will automatically research new team training leads using these settings.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Frequency</label>
                  <Select value={settingsForm.recurringFrequency} onValueChange={(v) => setSettingsForm(f => ({ ...f, recurringFrequency: v }))}>
                    <SelectTrigger data-testid="select-settings-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Sport</label>
                  <Select value={settingsForm.recurringSport} onValueChange={(v) => setSettingsForm(f => ({ ...f, recurringSport: v }))}>
                    <SelectTrigger data-testid="select-settings-sport">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sports</SelectItem>
                      {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Leads per run</label>
                  <Select value={settingsForm.recurringLimit} onValueChange={(v) => setSettingsForm(f => ({ ...f, recurringLimit: v }))}>
                    <SelectTrigger data-testid="select-settings-limit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["5", "8", "10", "15", "20", "25"].map((n) => <SelectItem key={n} value={n}>{n} leads</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Preferred time</label>
                  <input
                    type="time"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={settingsForm.recurringTime}
                    onChange={(e) => setSettingsForm(f => ({ ...f, recurringTime: e.target.value }))}
                    data-testid="input-settings-time"
                  />
                </div>
              </div>
            )}

            {/* Schedule status block */}
            <div className={`rounded-lg border p-3 text-sm space-y-1 ${settingsForm.recurringEnabled ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" : "bg-muted/40"}`}>
              {settingsForm.recurringEnabled ? (
                <>
                  <p className="font-medium text-green-700 dark:text-green-400">Recurring research: On</p>
                  <p className="text-muted-foreground">
                    Scheduled time: {(() => {
                      const [hStr, mStr] = (settingsForm.recurringTime || "08:00").split(":");
                      const h = parseInt(hStr, 10) || 8;
                      const m = parseInt(mStr, 10) || 0;
                      const suffix = h >= 12 ? "PM" : "AM";
                      const h12 = h % 12 || 12;
                      return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
                    })()}
                  </p>
                  <p className="text-muted-foreground capitalize">Frequency: {settingsForm.recurringFrequency}</p>
                  {savedSettings?.nextRunLabel && savedSettings.recurringEnabled && (
                    <p className="text-muted-foreground">Next scheduled run: {savedSettings.nextRunLabel}</p>
                  )}
                  {savedSettings?.lastRunAt && (
                    <p className="text-xs text-muted-foreground">Last run: {new Date(savedSettings.lastRunAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium text-muted-foreground">Recurring research is off</p>
                  <p className="text-xs text-muted-foreground">Turn this on to automatically find new leads.</p>
                </>
              )}
            </div>

            {settingsForm.recurringEnabled && !settingsForm.defaultLocation.trim() && (
              <p className="text-xs text-destructive">A default location is required to enable recurring research.</p>
            )}

            {settingsSaved && (
              <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 px-3 py-2 text-sm text-green-700 dark:text-green-400 font-medium" data-testid="status-settings-saved">
                Settings saved successfully.
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setSettingsDialogOpen(false); setSettingsSaved(false); }}>Close</Button>
              <Button
                onClick={() => settingsMutation.mutate(settingsForm)}
                disabled={settingsMutation.isPending || (settingsForm.recurringEnabled && !settingsForm.defaultLocation.trim())}
                data-testid="button-save-settings"
              >
                {settingsMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Settings"}
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

      {/* Edit Draft Dialog — AI-Assisted */}
      {editDraft && (
        <Dialog open={!!editDraft} onOpenChange={closeDraftEditor}>
          <DialogContent className="max-w-2xl w-full flex flex-col p-0 max-h-[92dvh] sm:max-h-[88vh]">
            <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                Edit Draft
                {isAiRefined && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs px-2 py-0.5 font-medium">
                    <Sparkles className="h-3 w-3" /> AI Improved
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* Subject */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</label>
                <Input
                  value={editDraftForm.subject}
                  onChange={(e) => setEditDraftForm((f) => ({ ...f, subject: e.target.value }))}
                  className="mt-1.5 h-9 text-sm"
                  data-testid="input-edit-draft-subject"
                />
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</label>
                  {isAiRefined && originalDraftForm && (
                    <button
                      className="text-xs text-primary underline underline-offset-2"
                      onClick={() => setShowComparison((v) => !v)}
                      data-testid="button-toggle-comparison"
                    >
                      {showComparison ? "Hide comparison" : "Compare changes"}
                    </button>
                  )}
                </div>

                {showComparison && originalDraftForm ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Original</p>
                      <div className="text-xs bg-muted/60 rounded-md border p-2.5 whitespace-pre-wrap font-mono h-52 overflow-y-auto leading-relaxed">
                        {originalDraftForm.body}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">AI Improved</p>
                      <div className="text-xs bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md p-2.5 whitespace-pre-wrap font-mono h-52 overflow-y-auto leading-relaxed">
                        {editDraftForm.body}
                      </div>
                    </div>
                  </div>
                ) : isRefining ? (
                  <div className="space-y-2 mt-1">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-3.5 w-4/6" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-3/6" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-4/6" />
                    <Skeleton className="h-3.5 w-2/6" />
                  </div>
                ) : (
                  <Textarea
                    value={editDraftForm.body}
                    onChange={(e) => setEditDraftForm((f) => ({ ...f, body: e.target.value }))}
                    className="mt-0.5 text-sm font-mono min-h-[200px] resize-y leading-relaxed"
                    rows={10}
                    data-testid="input-edit-draft-body"
                  />
                )}
              </div>

              {/* AI explanation banner */}
              {aiExplanation && isAiRefined && (
                <div className="flex items-start gap-2 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 px-3 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-purple-700 dark:text-purple-300 leading-relaxed">{aiExplanation}</p>
                </div>
              )}

              {/* ── Edit With AI ── */}
              <div className="rounded-lg border bg-muted/20 p-3.5 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold">Edit With AI</p>
                </div>

                {/* Quick action chips */}
                <div className="flex flex-wrap gap-1.5" data-testid="ai-chips-container">
                  {AI_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => toggleChip(chip)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        selectedChips.includes(chip)
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background border-border hover:border-primary hover:text-primary"
                      }`}
                      data-testid={`chip-ai-${chip.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Instruction textarea */}
                <Textarea
                  placeholder="Describe how you want to improve this email... (e.g. 'Make it warmer and mention we work with local high school teams')"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  className="text-sm min-h-[80px] resize-none"
                  rows={3}
                  data-testid="textarea-ai-instruction"
                />

                {/* Refine + Revert buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleAiRefine}
                    disabled={isRefining || !aiInstruction.trim()}
                    className="flex-1 sm:flex-none"
                    data-testid="button-ai-refine"
                  >
                    {isRefining ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refining…</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Refine with AI</>
                    )}
                  </Button>

                  {isAiRefined && originalDraftForm && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditDraftForm(originalDraftForm);
                        setIsAiRefined(false);
                        setShowComparison(false);
                        setAiExplanation("");
                      }}
                      data-testid="button-revert-original"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Revert to Original
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="flex gap-2 justify-end px-4 py-3 border-t bg-background shrink-0">
              <Button variant="outline" onClick={closeDraftEditor} data-testid="button-cancel-draft">
                Cancel
              </Button>
              <Button
                onClick={() => updateDraftMutation.mutate({ id: editDraft.id, data: editDraftForm })}
                disabled={updateDraftMutation.isPending}
                data-testid="button-save-draft"
              >
                {updateDraftMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Draft
              </Button>
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
              {(() => {
                const q = getClientQuality(generateEmailForProspect);
                if (!q.hasEmail) {
                  return (
                    <>
                      <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          Contact needed before outreach
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                          <strong>{generateEmailForProspect.prospectName}</strong> has no usable email address. Find a decision-maker contact before generating an email.
                        </p>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setGenerateEmailForProspect(null)}>Cancel</Button>
                        <Button
                          className="bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => {
                            setGenerateEmailForProspect(null);
                            enrichContactMutation.mutate(generateEmailForProspect.id);
                          }}
                          disabled={enrichContactMutation.isPending}
                          data-testid="button-find-dm-from-dialog"
                        >
                          {enrichContactMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                          Find Email Contact
                        </Button>
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Generate a personalized outreach email for <strong>{generateEmailForProspect.prospectName}</strong>. It will be added to your Drafts for review before sending.
                    </p>
                    {q.label === "General Email" && (
                      <div className="rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30 p-2 text-xs text-yellow-800 dark:text-yellow-300">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        This lead has a general email only. Consider finding a decision-maker contact for better outreach.
                      </div>
                    )}
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
                  </>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Research Summary Dialog */}
      <Dialog open={!!researchSummary} onOpenChange={(open) => { if (!open) setResearchSummary(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-primary" />
              Research Results
            </DialogTitle>
          </DialogHeader>
          {researchSummary && (
            <div className="space-y-4">
              {/* Summary stat tiles */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400" data-testid="summary-saved">{researchSummary.saved}</div>
                  <div className="text-xs text-emerald-600 dark:text-emerald-500 font-medium flex items-center justify-center gap-1 mt-1">
                    <CheckCircle2 className="h-3 w-3" /> Saved to Pipeline
                  </div>
                </div>
                <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-3 text-center">
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400" data-testid="summary-needs-contact">{researchSummary.needsContact}</div>
                  <div className="text-xs text-amber-600 dark:text-amber-500 font-medium flex items-center justify-center gap-1 mt-1">
                    <UserX className="h-3 w-3" /> Needs Contact
                  </div>
                </div>
                <div className="rounded-lg border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 p-3 text-center">
                  <div className="text-2xl font-bold text-red-700 dark:text-red-400" data-testid="summary-rejected">{researchSummary.rejectedLowQuality}</div>
                  <div className="text-xs text-red-600 dark:text-red-500 font-medium flex items-center justify-center gap-1 mt-1">
                    <Ban className="h-3 w-3" /> Rejected (Low Quality)
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 p-3 text-center">
                  <div className="text-2xl font-bold text-slate-600 dark:text-slate-400" data-testid="summary-duplicates">{researchSummary.duplicatesSkipped}</div>
                  <div className="text-xs text-slate-500 font-medium flex items-center justify-center gap-1 mt-1">
                    <Copy className="h-3 w-3" /> Duplicates Skipped
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Analyzed {researchSummary.total} candidate{researchSummary.total !== 1 ? "s" : ""} from AI research
              </p>

              {/* Rejected leads detail */}
              {researchSummary.rejected.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Why leads were rejected</p>
                  <div className="rounded-md border divide-y max-h-44 overflow-y-auto">
                    {researchSummary.rejected.map((r, i) => (
                      <div key={i} className="px-3 py-2 text-xs" data-testid={`rejected-lead-${i}`}>
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground ml-1">· score {r.score}</span>
                        <p className="text-red-600 dark:text-red-400 mt-0.5">{r.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Duplicate leads detail */}
              {researchSummary.duplicates.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Duplicates skipped</p>
                  <div className="rounded-md border divide-y max-h-28 overflow-y-auto">
                    {researchSummary.duplicates.map((d, i) => (
                      <div key={i} className="px-3 py-2 text-xs text-muted-foreground" data-testid={`duplicate-lead-${i}`}>
                        {d.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={() => setResearchSummary(null)} data-testid="button-close-summary">
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
