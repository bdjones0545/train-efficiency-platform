import { useState, useEffect, useRef, useCallback } from "react";
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
import { getAuthHeaders } from "@/lib/authToken";
import {
  Search, Plus, Loader2, RefreshCw, Mail, CheckCircle, XCircle,
  ExternalLink, Edit2, ChevronDown, ChevronUp, Target, TrendingUp,
  Users, SendHorizonal, AlertCircle, FileText, Trash2, Filter,
  MessageSquare, PhoneOff, ShieldCheck, ShieldAlert, ShieldX,
  Activity, BarChart2, Zap, Settings2, CheckCircle2, Ban, Copy, UserX,
  Sparkles, RotateCcw, Clock, MapPin, FileSearch, Minimize2, X as XIcon,
  Upload, Download
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
type ContactQualityLabel = "Decision Maker" | "Role Email" | "General Email" | "Needs Contact";

function getClientQuality(prospect: TeamTrainingProspect): { label: ContactQualityLabel; className: string; score: number; hasEmail: boolean } {
  const quality = prospect.contactQuality as string | null;
  const dmEmail = (prospect.decisionMakerEmail || "").trim();
  const contactEmail = (prospect.contactEmail || "").trim();
  const hasEmail = !!(dmEmail || contactEmail);

  if (quality === "decision_maker" && hasEmail) {
    return { label: "Decision Maker", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300", score: prospect.contactConfidence || 85, hasEmail: true };
  }
  if (quality === "role_based" && hasEmail) {
    return { label: "Role Email", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", score: prospect.contactConfidence || 60, hasEmail: true };
  }
  if (quality === "general" && hasEmail) {
    return { label: "General Email", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", score: prospect.contactConfidence || 35, hasEmail: true };
  }
  if (hasEmail) {
    return { label: "General Email", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", score: 30, hasEmail: true };
  }
  return { label: "Needs Contact", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", score: 0, hasEmail: false };
}

// ─── Contact Source Badge ────────────────────────────────────────────────────
function ContactSourceBadge({ sourceType, verificationStatus }: { sourceType?: string | null; verificationStatus?: string | null }) {
  if (!sourceType || sourceType === "unverified" || sourceType === "inferred" || sourceType === "manual") return null;
  const configs: Record<string, { label: string; className: string }> = {
    verified: { label: "Verified", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" },
    scraped: { label: "Website", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
    website: { label: "Website", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
    social: { label: "Social", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800" },
    directory: { label: "Directory", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800" },
    search_result: { label: "Search", className: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border border-teal-200 dark:border-teal-800" },
  };
  const cfg = configs[sourceType];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ─── Discovery Method Label ──────────────────────────────────────────────────
function formatDiscoveryMethod(method?: string | null): string {
  const labels: Record<string, string> = {
    website_contact_page: "Website Contact Page",
    website_staff_page: "Website Staff Page",
    athletics_page: "Athletics Page",
    directory_listing: "Directory Listing",
    social_profile: "Social Profile",
    search_result: "Search Result",
    manual: "Manual Entry",
  };
  return method ? (labels[method] ?? method.replace(/_/g, " ")) : "Unknown";
}

// ─── Contact Evidence Panel ──────────────────────────────────────────────────
function ContactEvidencePanel({ prospect }: { prospect: TeamTrainingProspect }) {
  const p = prospect as any;
  const sourceUrl: string | null = p.contactSourceUrl || null;
  const sourceTitle: string | null = p.contactSourceTitle || null;
  const sourceSnippet: string | null = p.contactSourceSnippet || null;
  const discoveryMethod: string | null = p.contactDiscoveryMethod || null;
  const confidenceScore: number | null = p.contactConfidenceScore ?? null;
  const discoveredAt: string | null = p.contactDiscoveredAt || null;

  if (!p.decisionMakerEmail) return null;

  const confidencePct = confidenceScore !== null ? Math.round(confidenceScore * 100) : null;
  const confidenceColor =
    confidencePct === null ? "text-muted-foreground" :
    confidencePct >= 85 ? "text-emerald-600 dark:text-emerald-400" :
    confidencePct >= 65 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-500 dark:text-red-400";
  const confidenceBg =
    confidencePct === null ? "bg-muted/60" :
    confidencePct >= 85 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" :
    confidencePct >= 65 ? "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800" :
    "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";

  // Stale detection — 90 days
  const isStale = discoveredAt ? (Date.now() - new Date(discoveredAt).getTime()) > 90 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="rounded-md border bg-card p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <FileSearch className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Contact Evidence</p>
        {confidencePct !== null && (
          <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBg} ${confidenceColor}`}>
            {confidencePct}% Confidence
          </span>
        )}
      </div>

      {isStale && (
        <div className="flex items-start gap-1.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-2 py-1.5">
          <Clock className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-amber-700 dark:text-amber-400 text-[10px] leading-tight">
            Contact may be outdated. Re-run discovery to refresh.
          </p>
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        {sourceUrl && (
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Found On</p>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 break-all text-[11px] inline-flex items-center gap-0.5"
                data-testid={`link-evidence-source-${prospect.id}`}
              >
                {sourceUrl.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            </div>
          </div>
        )}

        {sourceTitle && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Page</p>
            <p className="text-foreground/80 leading-tight">{sourceTitle}</p>
          </div>
        )}

        {sourceSnippet && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Snippet</p>
            <blockquote className="border-l-2 border-primary/30 pl-2 text-muted-foreground italic leading-relaxed">
              &ldquo;{sourceSnippet}&rdquo;
            </blockquote>
          </div>
        )}

        {discoveryMethod && (
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Method</p>
            <span className="text-foreground/80">{formatDiscoveryMethod(discoveryMethod)}</span>
          </div>
        )}

        {discoveredAt && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              Discovered {new Date(discoveredAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead Validation Status Badge ───────────────────────────────────────────
function LeadValidationBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cfg: Record<string, { label: string; className: string }> = {
    verified:     { label: "Verified",      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" },
    likely_valid: { label: "Likely Valid",  className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800" },
    weak:         { label: "Weak",          className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-800 border border-yellow-200 dark:border-yellow-700" },
    stale:        { label: "Stale",         className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800" },
    rejected:     { label: "Rejected",      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800" },
  };
  const c = cfg[status] || { label: status, className: "bg-muted text-muted-foreground border border-border" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

// ─── Lead Discovery Evidence Panel ──────────────────────────────────────────
function LeadDiscoveryEvidencePanel({ prospect }: { prospect: TeamTrainingProspect }) {
  const p = prospect as any;
  const sourceUrl: string | null = p.discoverySourceUrl || null;
  const sourceTitle: string | null = p.discoverySourceTitle || null;
  const sourceSnippet: string | null = p.discoverySourceSnippet || null;
  const discoveryMethod: string | null = p.discoveryMethod || null;
  const discoveryQuery: string | null = p.discoveryQuery || null;
  const confidenceScore: number | null = p.discoveryConfidenceScore ?? null;
  const discoveredAt: string | null = p.discoveredAt || null;
  const validationStatus: string | null = p.leadValidationStatus || null;

  if (!sourceUrl && !sourceSnippet && !validationStatus) return null;

  const confidencePct = confidenceScore !== null ? Math.round(confidenceScore * 100) : null;
  const confidenceColor =
    confidencePct === null ? "text-muted-foreground" :
    confidencePct >= 85 ? "text-emerald-600 dark:text-emerald-400" :
    confidencePct >= 65 ? "text-yellow-600 dark:text-yellow-400" :
    "text-red-500 dark:text-red-400";
  const confidenceBg =
    confidencePct === null ? "bg-muted/60 border-border" :
    confidencePct >= 85 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" :
    confidencePct >= 65 ? "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800" :
    "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";

  const isStale = discoveredAt ? (Date.now() - new Date(discoveredAt).getTime()) > 90 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="rounded-md border bg-card p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <FileSearch className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
        <p className="font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">Lead Discovery Evidence</p>
        <div className="flex items-center gap-1 ml-auto flex-wrap">
          {validationStatus && <LeadValidationBadge status={validationStatus} />}
          {confidencePct !== null && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBg} ${confidenceColor}`}>
              {confidencePct}% Confidence
            </span>
          )}
        </div>
      </div>

      {isStale && (
        <div className="flex items-start gap-1.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-2 py-1.5">
          <Clock className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-amber-700 dark:text-amber-400 text-[10px] leading-tight">
            Discovery data may be outdated (90+ days old). Consider re-researching this lead.
          </p>
        </div>
      )}

      <div className="space-y-1.5 text-xs">
        {sourceUrl && (
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Discovered On</p>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 break-all text-[11px] inline-flex items-center gap-0.5"
                data-testid={`link-discovery-source-${prospect.id}`}
              >
                {sourceUrl.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
            </div>
          </div>
        )}

        {sourceTitle && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Page Title</p>
            <p className="text-foreground/80 leading-tight">{sourceTitle}</p>
          </div>
        )}

        {sourceSnippet && (
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Evidence Snippet</p>
            <blockquote className="border-l-2 border-indigo-400/50 pl-2 text-muted-foreground italic leading-relaxed">
              &ldquo;{sourceSnippet}&rdquo;
            </blockquote>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap text-[10px] text-muted-foreground pt-0.5">
          {discoveryMethod && (
            <span><span className="font-medium uppercase tracking-wide">Method:</span> {discoveryMethod.replace(/_/g, " ")}</span>
          )}
          {discoveryQuery && (
            <span className="truncate max-w-xs"><span className="font-medium uppercase tracking-wide">Query:</span> {discoveryQuery}</span>
          )}
          {discoveredAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {new Date(discoveredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      </div>
    </div>
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
            <LeadValidationBadge status={(prospect as any).leadValidationStatus} />
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
            {(() => {
              const p = prospect as any;
              const score: number | null = p.contactConfidenceScore ?? null;
              const isVerified = p.verificationStatus === "verified";
              const isManual = p.contactSourceType === "manual";
              const passesConfidence = score === null || score >= 0.65;
              const canGenerate = passesConfidence || isVerified || isManual;
              return (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onGenerateEmail(prospect)}
                  disabled={!canGenerate}
                  title={!canGenerate ? "Contact confidence too low. Re-run discovery or enter manually." : undefined}
                  data-testid={`button-generate-email-${prospect.id}`}
                >
                  <Mail className="h-3 w-3 mr-1" /> Generate Email
                </Button>
              );
            })()}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => onEnrichContact(prospect.id)}
              disabled={isEnriching}
              data-testid={`button-rerun-discovery-${prospect.id}`}
            >
              {isEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Deep Search
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            onClick={() => onEnrichContact(prospect.id)}
            disabled={isEnriching}
            data-testid={`button-find-real-email-${prospect.id}`}
          >
            {isEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
            Deep Search
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
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
          onClick={() => { if (window.confirm(`Delete "${prospect.orgName}"? This cannot be undone.`)) onDelete(prospect.id); }}
          data-testid={`button-delete-${prospect.id}`}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete
        </Button>
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

            {/* Source-backed email confirmation */}
            {prospect.decisionMakerEmail && (prospect as any).verificationStatus === "verified" && (
              <div className="flex items-start gap-1.5 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-2 py-1.5">
                <AlertCircle className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                <p className="text-emerald-700 dark:text-emerald-400 text-[10px] leading-tight">
                  This email was <strong>found from a real source</strong> and is ready for outreach.
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

            {/* Contact Evidence Panel */}
            <ContactEvidencePanel prospect={prospect} />

            {/* Lead Discovery Evidence Panel */}
            <LeadDiscoveryEvidencePanel prospect={prospect} />

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
              {quality.hasEmail ? "Deep Search" : "Deep Search"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Contact:</span> {prospect.contactName || <span className="italic text-muted-foreground/60">—</span>}</div>
            <div><span className="text-muted-foreground">Role:</span> {prospect.contactRole || <span className="italic text-muted-foreground/60">—</span>}</div>
            <div><span className="text-muted-foreground">Email:</span> {displayEmail || <span className="italic text-muted-foreground/60">Run contact research ↑</span>}</div>
            <div><span className="text-muted-foreground">Phone:</span> {prospect.contactPhone || <span className="italic text-muted-foreground/60">—</span>}</div>
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

// ─── Discovery Log Tab ───────────────────────────────────────────────────────
type DiscoveryLogEntry = {
  id: string;
  orgId: string;
  prospectId: string | null;
  prospectName: string | null;
  attemptedAt: string | null;
  query: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  result: string | null;
  action: string | null;
  notes: string | null;
};

function DiscoveryLogTab() {
  const { data: log, isLoading } = useQuery<DiscoveryLogEntry[]>({
    queryKey: ["/api/admin/team-training/discovery-log"],
  });

  const resultColor = (result: string | null) => {
    if (result === "created") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    if (result === "rejected") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    if (result === "duplicate") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
    return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
  };

  if (isLoading) return (
    <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  );

  if (!log || log.length === 0) return (
    <Card className="p-8 text-center text-muted-foreground">
      <FileSearch className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">No discovery log entries yet</p>
      <p className="text-xs mt-1">Discovery attempts will appear here once you run lead research.</p>
    </Card>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <FileSearch className="h-4 w-4 text-indigo-500" />
        <p className="text-sm font-semibold">Discovery Log</p>
        <span className="text-xs text-muted-foreground ml-auto">{log.length} entries</span>
      </div>
      {log.map((entry) => (
        <Card key={entry.id} className="p-3" data-testid={`card-discovery-log-${entry.id}`}>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium truncate" data-testid={`text-discovery-prospect-${entry.id}`}>
                  {entry.prospectName || "Unknown Prospect"}
                </p>
                {entry.result && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${resultColor(entry.result)}`}
                    data-testid={`badge-discovery-result-${entry.id}`}>
                    {entry.result}
                  </span>
                )}
                {entry.action && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted">
                    {entry.action.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              {entry.query && (
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  <span className="font-medium">Query:</span> {entry.query}
                </p>
              )}
              {entry.notes && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{entry.notes}</p>
              )}
            </div>
            <div className="text-right shrink-0 space-y-0.5">
              {entry.confidence !== null && entry.confidence !== undefined && (
                <p className={`text-xs font-semibold ${
                  entry.confidence >= 0.85 ? "text-emerald-600 dark:text-emerald-400" :
                  entry.confidence >= 0.65 ? "text-yellow-600 dark:text-yellow-400" :
                  "text-red-500 dark:text-red-400"
                }`} data-testid={`text-discovery-confidence-${entry.id}`}>
                  {Math.round(entry.confidence * 100)}% conf
                </p>
              )}
              {entry.attemptedAt && (
                <p className="text-[10px] text-muted-foreground">
                  {new Date(entry.attemptedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              )}
            </div>
          </div>
          {entry.sourceUrl && (
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1 text-[10px] text-primary underline underline-offset-2 truncate"
              data-testid={`link-discovery-source-log-${entry.id}`}
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              {entry.sourceUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── Research Progress Panel ─────────────────────────────────────────────────
type ResearchStep = {
  id: string;
  label: string;
  state: "pending" | "active" | "done";
};

type ResearchProgressState = {
  status: "idle" | "running" | "done" | "error";
  location: string;
  steps: ResearchStep[];
  result?: { saved: number; rejected: number; duplicates: number };
  error?: string;
  minimized: boolean;
};

const STEP_DEFINITIONS = [
  { id: "search",    label: "Search results analyzed" },
  { id: "validate",  label: "Websites validated" },
  { id: "contacts",  label: "Contact pages scanned" },
  { id: "score",     label: "Confidence scored" },
];

function makeSteps(activeId?: string): ResearchStep[] {
  if (!activeId) return STEP_DEFINITIONS.map((s) => ({ ...s, state: "pending" as const }));
  let foundActive = false;
  return STEP_DEFINITIONS.map((s) => {
    if (foundActive) return { ...s, state: "pending" as const };
    if (s.id === activeId) { foundActive = true; return { ...s, state: "active" as const }; }
    return { ...s, state: "done" as const };
  });
}

function ResearchProgressPanel({
  progress,
  onMinimize,
  onDismiss,
}: {
  progress: ResearchProgressState;
  onMinimize: () => void;
  onDismiss: () => void;
}) {
  if (progress.status === "idle") return null;

  const isDone = progress.status === "done";
  const isError = progress.status === "error";

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-72 rounded-xl border bg-card shadow-2xl overflow-hidden transition-all"
      data-testid="panel-research-progress"
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 ${isDone ? "bg-emerald-600 dark:bg-emerald-700" : isError ? "bg-red-600 dark:bg-red-700" : "bg-primary"}`}>
        {isDone ? (
          <CheckCircle className="h-4 w-4 text-white shrink-0" />
        ) : isError ? (
          <XCircle className="h-4 w-4 text-white shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 text-white shrink-0 animate-spin" />
        )}
        <p className="text-sm font-semibold text-white flex-1 truncate">
          {isDone ? "Research Complete" : isError ? "Research Failed" : `Researching ${progress.location}…`}
        </p>
        <button
          className="text-white/70 hover:text-white transition-colors"
          onClick={onMinimize}
          aria-label="Minimize"
          data-testid="button-progress-minimize"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
        {(isDone || isError) && (
          <button
            className="text-white/70 hover:text-white transition-colors ml-0.5"
            onClick={onDismiss}
            aria-label="Dismiss"
            data-testid="button-progress-dismiss"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      {!progress.minimized && (
        <div className="px-3 py-3 space-y-1.5">
          {/* Steps */}
          {progress.steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2" data-testid={`step-${step.id}`}>
              {step.state === "done" ? (
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              ) : step.state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 text-primary shrink-0 animate-spin" />
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
              )}
              <span className={`text-xs ${step.state === "done" ? "text-foreground" : step.state === "active" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
          ))}

          {/* Result line */}
          {isDone && progress.result && (
            <>
              <div className="my-1.5 border-t" />
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400" data-testid="text-progress-saved">
                  {progress.result.saved} lead{progress.result.saved !== 1 ? "s" : ""} added
                </span>
              </div>
              {progress.result.rejected > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground" data-testid="text-progress-rejected">
                    {progress.result.rejected} rejected
                  </span>
                </div>
              )}
              {progress.result.duplicates > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {progress.result.duplicates} duplicate{progress.result.duplicates !== 1 ? "s" : ""} skipped
                  </span>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {isError && progress.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{progress.error}</p>
          )}

          {/* Footer note when still running */}
          {!isDone && !isError && (
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              You can browse the page while this runs. Results appear in the Leads tab.
            </p>
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
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvError, setCsvError] = useState("");
  const csvFileRef = useRef<HTMLInputElement>(null);
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

  // ─── Research Progress Panel state ───────────────────────────────────────
  const [researchProgress, setResearchProgress] = useState<ResearchProgressState>({
    status: "idle", location: "", steps: makeSteps(), minimized: false,
  });
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearStepTimers = useCallback(() => {
    stepTimers.current.forEach(clearTimeout);
    stepTimers.current = [];
  }, []);

  const startProgressSteps = useCallback((location: string) => {
    clearStepTimers();
    // Step timing schedule (approximate for a 30–60 s web-search call)
    const schedule: Array<{ delay: number; activeId: string }> = [
      { delay: 0,     activeId: "search" },
      { delay: 5000,  activeId: "validate" },
      { delay: 13000, activeId: "contacts" },
      { delay: 22000, activeId: "score" },
    ];
    schedule.forEach(({ delay, activeId }) => {
      const t = setTimeout(() => {
        setResearchProgress((prev) => {
          if (prev.status !== "running") return prev;
          return { ...prev, steps: makeSteps(activeId) };
        });
      }, delay);
      stepTimers.current.push(t);
    });
  }, [clearStepTimers]);

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
      // Close dialog + launch progress panel immediately
      setResearchDialogOpen(false);
      setResearchLocationTouched(false);
      setResearchProgress({
        status: "running",
        location: data.location,
        steps: makeSteps("search"),
        minimized: false,
      });
      startProgressSteps(data.location);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      let res: Response;
      try {
        res = await fetch("/api/admin/team-training/research", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          credentials: "include",
          body: JSON.stringify(data),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") throw new Error("Request timed out");
        throw new Error("Network error — check your connection and try again.");
      } finally {
        clearTimeout(timeoutId);
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Unknown error");
      return json;
    },
    onSuccess: (data) => {
      clearStepTimers();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team-training-leads/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/discovery-log"] });

      const saved = data.summary?.saved ?? data.count ?? 0;
      const rejected = data.summary?.rejectedLowQuality ?? 0;
      const duplicates = data.summary?.duplicatesSkipped ?? 0;

      setResearchProgress((prev) => ({
        ...prev,
        status: "done",
        steps: STEP_DEFINITIONS.map((s) => ({ ...s, state: "done" as const })),
        result: { saved, rejected, duplicates },
      }));

      if (data.summary) setResearchSummary(data.summary);

      // Auto-dismiss after 12 s
      const t = setTimeout(() => {
        setResearchProgress((prev) => prev.status === "done" ? { ...prev, status: "idle" } : prev);
      }, 12000);
      stepTimers.current.push(t);
    },
    onError: (err: Error) => {
      clearStepTimers();
      const msg = err.message || "";
      let friendly = "Research failed. Please try again.";
      if (msg === "AI research is not configured") {
        friendly = "Lead research is not configured yet. Add your OpenAI API key on the server.";
      } else if (msg === "Location required") {
        friendly = "Enter a location before researching leads.";
      } else if (msg === "Request timed out") {
        friendly = "Research took too long to respond. Please try again.";
      } else if (msg.startsWith("Network error")) {
        friendly = "Network error — check your connection and try again.";
      } else if (msg && msg !== "Unknown error") {
        friendly = msg;
      }
      setResearchProgress((prev) => ({
        ...prev,
        status: "error",
        steps: STEP_DEFINITIONS.map((s) => ({ ...s, state: "done" as const })),
        error: friendly,
      }));
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
  const [deepSearch, setDeepSearch] = useState<{ running: boolean; current: number; total: number; found: number; currentName: string } | null>(null);

  const runDeepSearch = async () => {
    const missing = (prospects || []).filter((p) => !p.decisionMakerEmail && p.contactQuality === "missing");
    if (missing.length === 0) return;
    setDeepSearch({ running: true, current: 0, total: missing.length, found: 0, currentName: "" });
    let found = 0;
    for (let i = 0; i < missing.length; i++) {
      const p = missing[i];
      setDeepSearch({ running: true, current: i + 1, total: missing.length, found, currentName: p.prospectName });
      try {
        const res = await apiRequest("POST", `/api/team-training-leads/${p.id}/enrich-contact`, {});
        const json = await res.json();
        if (json.success && json.prospect) {
          found++;
          queryClient.setQueryData(["/api/admin/team-training/prospects"], (old: any) => {
            if (!old) return old;
            if (Array.isArray(old)) return old.map((l: any) => l.id === json.prospect.id ? { ...l, ...json.prospect } : l);
            return old;
          });
        }
      } catch {}
    }
    setDeepSearch({ running: false, current: missing.length, total: missing.length, found, currentName: "" });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
    setTimeout(() => setDeepSearch(null), 6000);
  };
  const [enrichFailData, setEnrichFailData] = useState<{
    hasPartial: boolean;
    partialData: { contactPhone?: string | null; contactFormUrl?: string | null; contactName?: string | null; contactRole?: string | null } | null;
    explanation?: string | null;
    links: { google: string; linkedin: string; maxpreps: string; website: string | null } | null;
  } | null>(null);

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

      // If the backend found no real email, show actionable failure with manual research links
      if (data.success === false) {
        // If partial data was found (phone/name), still refresh the lead card
        if (data.prospect) {
          queryClient.setQueryData(["/api/admin/team-training/prospects"], (old: any) => {
            if (!old) return old;
            if (Array.isArray(old)) return old.map((l: TeamTrainingProspect) => l.id === data.prospect.id ? { ...l, ...data.prospect } : l);
            if (Array.isArray(old?.prospects)) return { ...old, prospects: old.prospects.map((l: TeamTrainingProspect) => l.id === data.prospect.id ? { ...l, ...data.prospect } : l) };
            return old;
          });
        }

        const links = data.manualResearchLinks;
        const hasPartial = data.reason === "partial_contact_found";

        // Show enrichment failure dialog
        setEnrichFailData({
          hasPartial,
          partialData: data.partialData,
          explanation: data.enrichmentExplanation,
          links,
        });
        return;
      }

      // Extract the full updated lead returned by the backend
      const updatedLead: TeamTrainingProspect | null = data.prospect ?? data.lead ?? null;

      // Immediately patch the React Query cache so the card reflects the new email
      if (updatedLead) {
        queryClient.setQueryData(["/api/admin/team-training/prospects"], (old: any) => {
          if (!old) return old;
          if (Array.isArray(old)) {
            return old.map((lead: TeamTrainingProspect) =>
              lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead
            );
          }
          if (Array.isArray(old?.prospects)) {
            return { ...old, prospects: old.prospects.map((lead: TeamTrainingProspect) =>
              lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead
            )};
          }
          return old;
        });

        // Sync the edit modal if it's open for this lead
        if (editProspect?.id === updatedLead.id) {
          setEditProspect((prev) => prev ? { ...prev, ...updatedLead } : prev);
          setEditProspectForm((prev) => ({ ...prev, ...updatedLead }));
        }
      }

      // Always invalidate to ensure eventual consistency
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });

      const q = updatedLead?.contactQuality ?? data.enriched?.contactQuality;
      const name = updatedLead?.decisionMakerName ?? data.enriched?.decisionMakerName;
      const email = updatedLead?.decisionMakerEmail ?? data.enriched?.decisionMakerEmail;
      const qualityLabel = q === "decision_maker" ? "Decision Maker" : q === "role_based" ? "Role Email" : "General Email";
      toast({
        title: "Real email found",
        description: name ? `${name} — ${qualityLabel}` : email ? `${qualityLabel}: ${email}` : qualityLabel,
      });
    },
    onError: (err: Error) => {
      setEnrichingId(null);
      toast({
        title: "Discovery failed",
        description: err.message || "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: async (rows: Record<string, string>[]) => {
      const res = await apiRequest("POST", "/api/admin/team-training/prospects/csv-import", { rows });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Import failed");
      return json as { imported: number; skipped: number; errors: string[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({
        title: `${data.imported} lead${data.imported !== 1 ? "s" : ""} imported`,
        description: data.skipped > 0 ? `${data.skipped} row${data.skipped !== 1 ? "s" : ""} skipped (missing name).` : undefined,
      });
      setCsvDialogOpen(false);
      setCsvRows([]);
      setCsvFileName("");
      setCsvError("");
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  function parseCSV(text: string): Record<string, string>[] {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").trim());
    return lines.slice(1).map((line) => {
      const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = (values[i] || "").replace(/^"|"$/g, "").trim();
      });
      return row;
    });
  }

  const CSV_FIELD_MAP: Record<string, string> = {
    "name": "prospectName",
    "prospect name": "prospectName",
    "organization": "prospectName",
    "team name": "prospectName",
    "school": "prospectName",
    "org type": "organizationType",
    "organization type": "organizationType",
    "type": "organizationType",
    "sport": "sport",
    "city": "city",
    "state": "state",
    "website": "websiteUrl",
    "website url": "websiteUrl",
    "url": "websiteUrl",
    "contact": "contactName",
    "contact name": "contactName",
    "coach": "contactName",
    "role": "contactRole",
    "contact role": "contactRole",
    "title": "contactRole",
    "email": "contactEmail",
    "contact email": "contactEmail",
    "phone": "contactPhone",
    "contact phone": "contactPhone",
    "notes": "notes",
  };

  function normalizeCSVRows(raw: Record<string, string>[]): Record<string, string>[] {
    return raw.map((row) => {
      const normalized: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        const mapped = CSV_FIELD_MAP[key.toLowerCase()] || key;
        normalized[mapped] = val;
      }
      return normalized;
    });
  }

  function handleCSVFile(file: File) {
    setCsvError("");
    if (!file.name.endsWith(".csv")) {
      setCsvError("Please upload a .csv file.");
      return;
    }
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const raw = parseCSV(text);
      if (raw.length === 0) {
        setCsvError("No data rows found. Make sure the CSV has a header row and at least one data row.");
        return;
      }
      const normalized = normalizeCSVRows(raw);
      setCsvRows(normalized);
    };
    reader.readAsText(file);
  }

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
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setSettingsDialogOpen(true)} data-testid="button-lead-settings">
            <Settings2 className="h-4 w-4 mr-2" /> Lead Settings
          </Button>
          <Button
            variant="outline"
            onClick={() => { setCsvRows([]); setCsvFileName(""); setCsvError(""); setCsvDialogOpen(true); }}
            data-testid="button-upload-csv"
          >
            <Upload className="h-4 w-4 mr-2" /> Upload CSV
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
          <TabsTrigger value="discovery" data-testid="tab-discovery">
            Discovery Log
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
              {(() => {
                const missingCount = (prospects || []).filter((p) => !p.decisionMakerEmail && p.contactQuality === "missing").length;
                if (missingCount === 0) return null;
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs ml-auto border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                    onClick={runDeepSearch}
                    disabled={deepSearch?.running}
                    data-testid="button-deep-search"
                  >
                    {deepSearch?.running ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Search className="h-3 w-3 mr-1.5" />}
                    Deep Search ({missingCount})
                  </Button>
                );
              })()}
            </div>
          </Card>

          {/* Deep search progress banner */}
          {deepSearch && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {deepSearch.running ? (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    {deepSearch.running ? "Deep Search Running…" : "Deep Search Complete"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {deepSearch.current}/{deepSearch.total} searched · {deepSearch.found} contact{deepSearch.found !== 1 ? "s" : ""} found
                </span>
              </div>
              <div className="w-full bg-blue-100 dark:bg-blue-900 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${deepSearch.total > 0 ? (deepSearch.current / deepSearch.total) * 100 : 0}%` }}
                />
              </div>
              {deepSearch.running && deepSearch.currentName && (
                <p className="text-xs text-muted-foreground mt-1.5 truncate">Searching: {deepSearch.currentName}</p>
              )}
            </div>
          )}

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

        <TabsContent value="discovery" className="mt-4">
          <DiscoveryLogTab />
        </TabsContent>
      </Tabs>

      {/* CSV Upload Dialog */}
      <Dialog open={csvDialogOpen} onOpenChange={(open) => { setCsvDialogOpen(open); if (!open) { setCsvRows([]); setCsvFileName(""); setCsvError(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Upload Leads from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-y-auto">
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Upload a CSV file with your existing leads. The first row must be a header row.</p>
              <p className="text-xs">Supported columns: <span className="font-mono text-foreground">name, sport, city, state, email, phone, website, contact name, role, notes, org type</span></p>
            </div>

            {/* Download template */}
            <a
              href="data:text/csv;charset=utf-8,name,sport,city,state,email,phone,website,contact name,role,org type,notes"
              download="leads-template.csv"
              className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
              data-testid="link-download-template"
            >
              <Download className="h-3 w-3" /> Download template CSV
            </a>

            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${csvFileName ? "border-primary/50 bg-primary/5" : "border-muted-foreground/30 hover:border-primary/40 hover:bg-muted/30"}`}
              onClick={() => csvFileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleCSVFile(file); }}
              data-testid="dropzone-csv"
            >
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleCSVFile(file); }}
                data-testid="input-csv-file"
              />
              {csvFileName ? (
                <div className="space-y-1">
                  <CheckCircle className="h-8 w-8 mx-auto text-primary" />
                  <p className="text-sm font-medium">{csvFileName}</p>
                  <p className="text-xs text-muted-foreground">{csvRows.length} row{csvRows.length !== 1 ? "s" : ""} ready to import</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
                  <p className="text-xs text-muted-foreground">.csv files only</p>
                </div>
              )}
            </div>

            {csvError && (
              <p className="text-sm text-destructive flex items-center gap-1.5" data-testid="text-csv-error">
                <AlertCircle className="h-4 w-4 shrink-0" /> {csvError}
              </p>
            )}

            {/* Preview table */}
            {csvRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview (first 5 rows)</p>
                <div className="overflow-x-auto rounded border">
                  <table className="text-xs w-full">
                    <thead className="bg-muted/60">
                      <tr>
                        {["prospectName", "sport", "city", "state", "contactEmail", "contactName"].map((col) => (
                          <th key={col} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                            {col === "prospectName" ? "Name" : col === "contactEmail" ? "Email" : col === "contactName" ? "Contact" : col.charAt(0).toUpperCase() + col.slice(1)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1 max-w-[140px] truncate" data-testid={`csv-preview-name-${i}`}>{row.prospectName || <span className="text-destructive italic">missing</span>}</td>
                          <td className="px-2 py-1">{row.sport || "—"}</td>
                          <td className="px-2 py-1">{row.city || "—"}</td>
                          <td className="px-2 py-1">{row.state || "—"}</td>
                          <td className="px-2 py-1 max-w-[140px] truncate">{row.contactEmail || "—"}</td>
                          <td className="px-2 py-1">{row.contactName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvRows.length > 5 && (
                  <p className="text-xs text-muted-foreground">… and {csvRows.length - 5} more row{csvRows.length - 5 !== 1 ? "s" : ""}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t mt-2">
            <Button variant="outline" onClick={() => setCsvDialogOpen(false)} data-testid="button-csv-cancel">Cancel</Button>
            <Button
              onClick={() => csvImportMutation.mutate(csvRows)}
              disabled={csvRows.length === 0 || csvImportMutation.isPending}
              data-testid="button-csv-import"
            >
              {csvImportMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import {csvRows.length > 0 ? `${csvRows.length} Lead${csvRows.length !== 1 ? "s" : ""}` : "Leads"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                disabled={!researchLocation.trim()}
                data-testid="button-confirm-research"
              >
                <Search className="h-4 w-4 mr-2" />
                Find Leads
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Lead Research Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
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
              {(["contactName", "contactRole", "contactEmail", "contactPhone", "websiteUrl", "sourceUrl"] as const).map((field) => {
                const placeholders: Record<string, string> = {
                  contactName: "e.g. John Smith",
                  contactRole: "e.g. Athletic Director",
                  contactEmail: "e.g. coach@org.com",
                  contactPhone: "e.g. (555) 123-4567",
                  websiteUrl: "https://",
                  sourceUrl: "https://",
                };
                return (
                  <div key={field}>
                    <label className="text-xs font-medium capitalize">{field.replace(/([A-Z])/g, " $1")}</label>
                    <Input
                      value={(editProspectForm as any)[field] ?? ""}
                      onChange={(e) => setEditProspectForm((f) => ({ ...f, [field]: e.target.value }))}
                      className="mt-1 h-8 text-sm"
                      placeholder={placeholders[field] ?? ""}
                      data-testid={`input-edit-${field}`}
                    />
                  </div>
                );
              })}
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

      {/* Enrich Contact Failure Dialog */}
      {enrichFailData && (
        <Dialog open={!!enrichFailData} onOpenChange={() => setEnrichFailData(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {enrichFailData.hasPartial ? (
                  <><span className="text-amber-500">⚡</span> Partial Info Found</>
                ) : (
                  <><span className="text-muted-foreground">🔍</span> No Email Found</>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {enrichFailData.hasPartial && enrichFailData.partialData && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
                  <p className="font-medium text-amber-800 dark:text-amber-300 text-xs uppercase tracking-wide">Saved to lead</p>
                  {enrichFailData.partialData.contactName && <p><span className="text-muted-foreground">Name:</span> {enrichFailData.partialData.contactName}</p>}
                  {enrichFailData.partialData.contactRole && <p><span className="text-muted-foreground">Role:</span> {enrichFailData.partialData.contactRole}</p>}
                  {enrichFailData.partialData.contactPhone && <p><span className="text-muted-foreground">Phone:</span> {enrichFailData.partialData.contactPhone}</p>}
                  {enrichFailData.partialData.contactFormUrl && (
                    <p><span className="text-muted-foreground">Contact form:</span>{" "}
                      <a href={enrichFailData.partialData.contactFormUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate inline-block max-w-[200px] align-bottom">
                        {enrichFailData.partialData.contactFormUrl}
                      </a>
                    </p>
                  )}
                </div>
              )}
              {!enrichFailData.hasPartial && (
                <p className="text-muted-foreground">No email or phone number was found for this organization across the website, Facebook, MaxPreps, LinkedIn, and sports directories.</p>
              )}
              {enrichFailData.explanation && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">{enrichFailData.explanation}</p>
              )}
              <div>
                <p className="font-medium mb-2">Search manually:</p>
                <div className="space-y-2">
                  {enrichFailData.links?.google && (
                    <a href={enrichFailData.links.google} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary hover:underline text-xs" data-testid="link-manual-google">
                      <span>🔍</span> Google Search
                    </a>
                  )}
                  {enrichFailData.links?.linkedin && (
                    <a href={enrichFailData.links.linkedin} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary hover:underline text-xs" data-testid="link-manual-linkedin">
                      <span>💼</span> LinkedIn Search
                    </a>
                  )}
                  {enrichFailData.links?.maxpreps && (
                    <a href={enrichFailData.links.maxpreps} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary hover:underline text-xs" data-testid="link-manual-maxpreps">
                      <span>🏆</span> MaxPreps Directory
                    </a>
                  )}
                  {enrichFailData.links?.website && (
                    <a href={enrichFailData.links.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary hover:underline text-xs" data-testid="link-manual-website">
                      <span>🌐</span> Organization Website
                    </a>
                  )}
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setEnrichFailData(null)}>Close</Button>
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
                          Deep Search
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

      {/* Floating Research Progress Panel */}
      <ResearchProgressPanel
        progress={researchProgress}
        onMinimize={() => setResearchProgress((prev) => ({ ...prev, minimized: !prev.minimized }))}
        onDismiss={() => {
          clearStepTimers();
          setResearchProgress({ status: "idle", location: "", steps: makeSteps(), minimized: false });
        }}
      />
    </div>
  );
}
