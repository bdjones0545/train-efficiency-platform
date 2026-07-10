import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/query-error-state";
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
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import {
  Search, Plus, Loader2, RefreshCw, Mail, CheckCircle, XCircle,
  ExternalLink, Edit2, ChevronDown, ChevronUp, Target, TrendingUp,
  Users, SendHorizonal, AlertCircle, FileText, Trash2, Filter,
  MessageSquare, PhoneOff, ShieldCheck, ShieldAlert, ShieldX,
  Activity, BarChart2, Zap, Settings2, CheckCircle2, Ban, Copy, UserX,
  Sparkles, RotateCcw, Clock, MapPin, FileSearch, Minimize2, X as XIcon,
  Upload, Download, Briefcase, Building2, ArrowUpDown, Flame, DollarSign,
  Brain, TrendingDown, Calendar,
} from "lucide-react";
import { useLocation } from "wouter";
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

// ─── Urgency Helpers ──────────────────────────────────────────────────────────
function daysSinceContact(p: TeamTrainingProspect): number | null {
  const ts = p.lastContactedAt;
  if (!ts) return null;
  return Math.floor((Date.now() - (ts instanceof Date ? ts : new Date(ts as unknown as string)).getTime()) / (1000 * 60 * 60 * 24));
}

type UrgencyLevel = "hot" | "warm" | "cold" | "stalled" | "dnc";

function getUrgencyLevel(p: TeamTrainingProspect): UrgencyLevel {
  if (p.outreachStatus === "Do Not Contact" || p.outreachStatus === "Not Interested") return "dnc";
  if (p.outreachStatus === "Replied") return "hot";
  if (p.outreachStatus === "Contacted") {
    const days = daysSinceContact(p);
    if (days === null || days <= 7) return "warm";
    if (days <= 30) return "cold";
    return "stalled";
  }
  return "cold";
}

function urgencyBorderClass(level: UrgencyLevel): string {
  if (level === "hot") return "border-l-4 border-l-emerald-500";
  if (level === "warm") return "border-l-4 border-l-blue-400";
  if (level === "stalled") return "border-l-4 border-l-red-400";
  if (level === "dnc") return "border-l-4 border-l-slate-300 dark:border-l-slate-600";
  return "border-l-4 border-l-transparent";
}

// ─── Enriched Prospect State Types ────────────────────────────────────────────
interface ProspectEnrichedState {
  hasDraft: boolean;
  draftId: string | null;
  draftApproved: boolean;
  draftSentAt: string | null;
  draftSubject: string | null;
  outreachCount: number;
  lastOutreachAt: string | null;
}

// ─── TT Revenue Ops Data Shape ────────────────────────────────────────────────
interface TTRevenueOpsData {
  stageDistribution: Array<{ stage: string; count: number }>;
  bottleneckStage: string | null;
  sourceConversion: Array<{ source: string; total: number; converted: number; rate: number }>;
  outreachMetrics: {
    totalSent: number; totalReplied: number; totalBooked: number; totalConverted: number;
    replyRate: number; bookingRate: number; avgDaysToReply: number | null;
  };
  pipelineValueCents: number;
  stalledValueCents: number;
}

// ─── Scraped Lead Readiness ────────────────────────────────────────────────────
type ReadinessState =
  | "ready_for_outreach" | "needs_research" | "needs_contact"
  | "draft_ready" | "awaiting_approval" | "awaiting_reply" | "replied" | "in_pipeline";

function getReadinessState(
  prospect: TeamTrainingProspect,
  enriched?: ProspectEnrichedState | null,
): ReadinessState {
  const p = prospect as any;
  const hasEmail = !!(prospect.decisionMakerEmail || prospect.contactEmail);
  const hasContact = !!(prospect.decisionMakerName || prospect.contactName && prospect.contactName !== "unknown");
  const hasOrgInfo = !!(prospect.websiteUrl || (prospect.organizationType && prospect.organizationType !== "unknown"));
  if (prospect.outreachStatus === "Replied") return "replied";
  if (prospect.outreachStatus === "Contacted" && enriched?.draftSentAt) return "awaiting_reply";
  if (enriched?.draftApproved && !enriched.draftSentAt) return "awaiting_approval";
  if (enriched?.hasDraft && !enriched.draftApproved) return "draft_ready";
  if (!hasEmail) return "needs_contact";
  if (!hasOrgInfo) return "needs_research";
  return "ready_for_outreach";
}

const READINESS_CONFIG: Record<ReadinessState, { label: string; className: string }> = {
  ready_for_outreach: { label: "Ready for Outreach", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  needs_research: { label: "Needs Research", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  needs_contact: { label: "Needs Contact", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  draft_ready: { label: "Draft Ready", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
  awaiting_approval: { label: "Awaiting Approval", className: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400" },
  awaiting_reply: { label: "Awaiting Reply", className: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400" },
  replied: { label: "Replied", className: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400" },
  in_pipeline: { label: "In Pipeline", className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400" },
};

function ScrapedLeadReadiness({ prospect, enriched }: { prospect: TeamTrainingProspect; enriched?: ProspectEnrichedState | null }) {
  const state = getReadinessState(prospect, enriched);
  const cfg = READINESS_CONFIG[state];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.className}`} data-testid={`badge-readiness-${prospect.id}`}>
      {cfg.label}
    </span>
  );
}

// ─── TT Draft Ready Badge ─────────────────────────────────────────────────────
function TTDraftReadyBadge({ enriched }: { enriched?: ProspectEnrichedState | null }) {
  if (!enriched?.hasDraft) return null;
  if (enriched.draftSentAt) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400">
      <CheckCircle className="h-2.5 w-2.5" /> Sent
    </span>
  );
  if (enriched.draftApproved) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400">
      <CheckCircle className="h-2.5 w-2.5" /> Approved
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
      <Zap className="h-2.5 w-2.5" /> Draft Ready
    </span>
  );
}

// ─── TT Draft Modal ───────────────────────────────────────────────────────────
function TTDraftModal({ prospect, onClose, onSent }: {
  prospect: TeamTrainingProspect;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftApproved, setDraftApproved] = useState(false);
  const [draftSentAt, setDraftSentAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const displayEmail = prospect.decisionMakerEmail || prospect.contactEmail;
  const displayName = prospect.decisionMakerName || prospect.contactName;

  const { isLoading: draftLoading, error: draftError } = useQuery<any>({
    queryKey: [`/api/admin/team-training/prospects/${prospect.id}/draft`],
    refetchOnWindowFocus: false,
    retry: false,
    // @ts-ignore
    select: (data: any) => {
      if (data?.draft && !loaded) {
        setDraftId(data.draft.id);
        setSubject(data.draft.subject || "");
        setBody(data.draft.body || "");
        setDraftApproved(!!data.draft.approved);
        setDraftSentAt(data.draft.sentAt || null);
        setLoaded(true);
      }
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("No draft ID");
      const res = await apiRequest("POST", `/api/admin/team-training/drafts/${draftId}/approve`, {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Approve failed");
      return json;
    },
    onSuccess: () => {
      setDraftApproved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects/enriched"] });
      toast({ title: "Draft approved", description: "Ready to send." });
    },
    onError: (err: Error) => toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("No draft ID");
      const patchRes = await apiRequest("PATCH", `/api/admin/team-training/drafts/${draftId}`, { subject: subject.trim(), body: body.trim() });
      if (!patchRes.ok) { const j = await patchRes.json(); throw new Error(j.message || "Save failed"); }
      const res = await apiRequest("POST", `/api/admin/team-training/drafts/${draftId}/send`, {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Send failed");
      return json;
    },
    onSuccess: () => {
      setDraftSentAt(new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects/enriched"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
      toast({ title: "Email sent", description: `Sent to ${displayEmail} via governed send path.` });
      onSent?.();
    },
    onError: (err: Error) => {
      const isPolicy = err.message.toLowerCase().includes("pause") || err.message.toLowerCase().includes("cooldown") || err.message.toLowerCase().includes("opted out");
      toast({ title: isPolicy ? "Send blocked by policy" : "Send failed", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/team-training/prospects/${prospect.id}/generate-email`, {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Generate failed");
      return json;
    },
    onSuccess: (data: any) => {
      setDraftId(data.id);
      setSubject(data.subject || "");
      setBody(data.body || "");
      setDraftApproved(false);
      setDraftSentAt(null);
      setLoaded(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects/enriched"] });
      toast({ title: "Draft generated", description: "Review and edit before sending." });
    },
    onError: (err: Error) => toast({ title: "Generate failed", description: err.message, variant: "destructive" }),
  });

  const isSent = !!draftSentAt;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-500" />
            AgentMail Draft — {prospect.prospectName}
          </DialogTitle>
        </DialogHeader>

        {draftLoading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading draft…</span>
          </div>
        )}

        {!draftLoading && draftError && !loaded && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-amber-600 py-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No draft exists yet for this prospect.
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-draft-modal"
            >
              {generateMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Zap className="h-3.5 w-3.5" /> Generate AI Draft</>}
            </Button>
          </div>
        )}

        {isSent && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 text-center space-y-2">
            <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">Email sent!</p>
            <p className="text-xs text-muted-foreground">Sent to {displayEmail}. Draft logged in outreach history.</p>
            <Button size="sm" variant="outline" onClick={onClose} className="mt-2">Close</Button>
          </div>
        )}

        {!draftLoading && loaded && !isSent && (
          <div className="space-y-4">
            {draftApproved && (
              <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 rounded px-2.5 py-1.5 border border-purple-200 dark:border-purple-800">
                <CheckCircle className="h-3 w-3 shrink-0" />
                Draft approved — ready to send. Edits saved before send.
              </div>
            )}
            {!draftApproved && (
              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded px-2.5 py-1.5 border border-blue-200 dark:border-blue-800">
                <Zap className="h-3 w-3 shrink-0" />
                AI draft loaded — review and edit before approving and sending.
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">To</p>
              <div className="text-sm bg-muted/40 border rounded px-3 py-2 font-mono text-muted-foreground">
                {displayEmail || <span className="italic text-red-500">No email — add contact first</span>}
                {displayName && <span className="ml-2 text-[11px] text-muted-foreground/70">({displayName})</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm h-9" data-testid="input-tt-draft-subject" />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="text-sm min-h-[160px] resize-none font-mono text-xs"
                data-testid="textarea-tt-draft-body"
              />
            </div>

            <div className="flex gap-2 flex-wrap pt-1 border-t">
              {!draftApproved ? (
                <Button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || !subject.trim() || !body.trim()}
                  className="flex-1 gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                  data-testid="button-approve-tt-draft"
                >
                  {approveMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Approving…</> : <><CheckCircle className="h-3.5 w-3.5" /> Approve Draft</>}
                </Button>
              ) : (
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending || !displayEmail || !subject.trim() || !body.trim()}
                  className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-send-tt-draft"
                >
                  {sendMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><SendHorizonal className="h-3.5 w-3.5" /> Send via AgentMail</>}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || sendMutation.isPending}
                className="gap-1.5"
                data-testid="button-regenerate-tt-draft"
              >
                {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Regenerate
              </Button>
              <Link href="/admin/ai-approvals">
                <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground" onClick={onClose} data-testid="link-all-tt-drafts">
                  <ExternalLink className="h-3 w-3" /> All Drafts
                </Button>
              </Link>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Send is governed — checks emergency pause, DNC list, opt-out, and 7-day cooldown before delivering.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── TT Revenue Ops Panel ─────────────────────────────────────────────────────
function TTRevenueOpsPanel({ data }: { data: TTRevenueOpsData }) {
  const fmtDollars = (cents: number) => cents >= 100000
    ? `$${(cents / 100000).toFixed(1)}k`
    : `$${Math.round(cents / 100).toLocaleString()}`;

  const STAGE_LABELS: Record<string, string> = {
    new_lead: "New Lead", qualified: "Qualified", outreached: "Contacted",
    replied: "Replied", closed: "Closed", lost: "Lost",
  };

  const maxCount = Math.max(...data.stageDistribution.map((s) => s.count), 1);

  return (
    <Card className="p-4 mb-4 space-y-4 border-l-4 border-l-emerald-500" data-testid="card-tt-revenue-ops">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <p className="text-sm font-semibold">B2B Revenue Operations</p>
        </div>
        <div className="flex gap-3 text-xs">
          {data.bottleneckStage && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              Bottleneck: {STAGE_LABELS[data.bottleneckStage] || data.bottleneckStage}
            </span>
          )}
          {data.pipelineValueCents > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {fmtDollars(data.pipelineValueCents)} pipeline
            </span>
          )}
          {data.stalledValueCents > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {fmtDollars(data.stalledValueCents)} stalled
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Stage Distribution</p>
          <div className="space-y-1">
            {data.stageDistribution.filter((s) => s.count > 0).map((s) => (
              <div key={s.stage} className="flex items-center gap-2">
                <span className={`text-[10px] w-20 shrink-0 ${s.stage === data.bottleneckStage ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
                  {STAGE_LABELS[s.stage] || s.stage}{s.stage === data.bottleneckStage && " ⚠"}
                </span>
                <div className="flex-1 bg-muted/40 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${s.stage === "lost" ? "bg-red-400" : s.stage === data.bottleneckStage ? "bg-amber-400" : "bg-emerald-500"}`}
                    style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-4 text-right">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Outreach Metrics</p>
          {data.outreachMetrics.totalSent === 0 ? (
            <p className="text-xs text-muted-foreground italic">No outreach sent yet</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded border p-1.5 text-center bg-muted/20">
                <p className="text-sm font-bold">{data.outreachMetrics.totalSent}</p>
                <p className="text-[10px] text-muted-foreground">Sent</p>
              </div>
              <div className={`rounded border p-1.5 text-center ${data.outreachMetrics.replyRate >= 20 ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-muted/20"}`}>
                <p className={`text-sm font-bold ${data.outreachMetrics.replyRate >= 20 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{data.outreachMetrics.replyRate}%</p>
                <p className="text-[10px] text-muted-foreground">Reply Rate</p>
              </div>
              <div className="rounded border p-1.5 text-center bg-muted/20">
                <p className="text-sm font-bold">{data.outreachMetrics.totalReplied}</p>
                <p className="text-[10px] text-muted-foreground">Replied</p>
              </div>
              {data.outreachMetrics.avgDaysToReply !== null && (
                <div className="rounded border p-1.5 text-center bg-muted/20">
                  <p className="text-sm font-bold">{data.outreachMetrics.avgDaysToReply}d</p>
                  <p className="text-[10px] text-muted-foreground">Avg to Reply</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {data.sourceConversion.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Research Source Performance</p>
          <div className="flex flex-wrap gap-1.5">
            {data.sourceConversion.map((s) => (
              <span key={s.source} className="text-[10px] bg-muted/40 border rounded px-2 py-0.5 text-muted-foreground">
                {s.source} <span className="font-medium text-foreground">{s.total}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── B2B Lifecycle Bar ────────────────────────────────────────────────────────
const B2B_STAGES = [
  { key: "captured", label: "Captured" },
  { key: "researched", label: "Researched" },
  { key: "qualified", label: "Qualified" },
  { key: "prepared", label: "Prepared" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "pipeline", label: "In Pipeline" },
  { key: "active", label: "Active" },
];

function getB2BStep(
  prospect: TeamTrainingProspect,
  hasDeal: boolean,
  enriched?: ProspectEnrichedState | null,
): number {
  if (hasDeal) return 6;
  if (prospect.outreachStatus === "Replied") return 5;
  if (enriched?.draftSentAt || prospect.outreachStatus === "Contacted") return 4;
  if (enriched?.hasDraft || prospect.outreachStatus === "Approved") return 3;
  const hasOrgInfo = !!(prospect.websiteUrl || (prospect.organizationType && prospect.organizationType !== "unknown"));
  const hasContact = !!(prospect.decisionMakerEmail || prospect.contactEmail || prospect.decisionMakerName);
  if (hasContact) return 2;
  if (hasOrgInfo) return 1;
  return 0;
}

function B2BLifecycleBar({
  prospect,
  hasDeal,
  enriched,
}: {
  prospect: TeamTrainingProspect;
  hasDeal: boolean;
  enriched?: ProspectEnrichedState | null;
}) {
  const outreachStatus = prospect.outreachStatus;
  const isDnc = outreachStatus === "Do Not Contact" || outreachStatus === "Not Interested";
  const currentStep = getB2BStep(prospect, hasDeal, enriched);

  if (isDnc) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        <span className="text-[10px] text-muted-foreground/60 shrink-0">Closed</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {B2B_STAGES.map((stage, i) => {
        const isDone = i < currentStep;
        const isCurrent = i === currentStep;
        return (
          <div key={stage.key} className="flex items-center gap-0.5 flex-1 min-w-0" title={stage.label}>
            <div
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                isDone ? "bg-emerald-500" : isCurrent ? "bg-blue-500" : "bg-muted/60"
              }`}
            />
          </div>
        );
      })}
      <span className="text-[10px] text-muted-foreground shrink-0 ml-1.5">
        {B2B_STAGES[currentStep]?.label ?? "Active"}
      </span>
    </div>
  );
}

function ProspectCard({
  prospect,
  onStatusChange,
  onEdit,
  onGenerateEmail,
  onOpenDraftModal,
  onDelete,
  onMarkReplied,
  onDoNotContact,
  onEnrichContact,
  onCreateDeal,
  enrichingId,
  existingDealProspectIds,
  enriched,
}: {
  prospect: TeamTrainingProspect;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (p: TeamTrainingProspect) => void;
  onGenerateEmail: (p: TeamTrainingProspect) => void;
  onOpenDraftModal: (p: TeamTrainingProspect) => void;
  onDelete: (id: string) => void;
  onMarkReplied: (id: string) => void;
  onDoNotContact: (id: string) => void;
  onEnrichContact: (id: string) => void;
  onCreateDeal: (p: TeamTrainingProspect) => void;
  enrichingId: string | null;
  existingDealProspectIds: Set<string>;
  enriched?: ProspectEnrichedState | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const stage = getClientStage(prospect);
  const quality = getClientQuality(prospect);
  const isEnriching = enrichingId === prospect.id;
  const hasDeal = existingDealProspectIds.has(prospect.id);

  const displayEmail = prospect.decisionMakerEmail || prospect.contactEmail;
  const urgency = getUrgencyLevel(prospect);
  const daysAgo = daysSinceContact(prospect);

  return (
    <Card className={`p-4 space-y-3 ${urgencyBorderClass(urgency)}`} data-testid={`card-prospect-${prospect.id}`}>
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
            {urgency === "stalled" && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 shrink-0" data-testid={`badge-stalled-${prospect.id}`}>
                <Flame className="h-2.5 w-2.5" /> Stalled
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{prospect.organizationType} · {prospect.sport} · {prospect.city}, {prospect.state}</span>
            {daysAgo !== null && prospect.outreachStatus === "Contacted" && (
              <span className={`inline-flex items-center gap-0.5 font-medium ${daysAgo > 30 ? "text-red-500 dark:text-red-400" : daysAgo > 7 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`text-days-ago-${prospect.id}`}>
                <Clock className="h-2.5 w-2.5" />{daysAgo}d ago
              </span>
            )}
            {prospect.estimatedValue ? (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium" data-testid={`text-est-value-${prospect.id}`}>
                <DollarSign className="h-2.5 w-2.5" />{prospect.estimatedValue.toLocaleString()}
              </span>
            ) : null}
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
      <B2BLifecycleBar prospect={prospect} hasDeal={hasDeal} enriched={enriched} />

      {/* Readiness + draft state row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ScrapedLeadReadiness prospect={prospect} enriched={enriched} />
        <TTDraftReadyBadge enriched={enriched} />
        {enriched?.outreachCount ? (
          <span className="text-[10px] text-muted-foreground">{enriched.outreachCount} outreach event{enriched.outreachCount !== 1 ? "s" : ""}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {quality.hasEmail ? (
          <>
            {enriched?.hasDraft ? (
              <Button
                size="sm"
                variant="outline"
                className={`h-7 text-xs ${enriched.draftApproved ? "border-purple-400 text-purple-700 dark:text-purple-400" : "border-blue-400 text-blue-700 dark:text-blue-400"}`}
                onClick={() => onOpenDraftModal(prospect)}
                data-testid={`button-view-draft-${prospect.id}`}
              >
                <Mail className="h-3 w-3 mr-1" />
                {enriched.draftSentAt ? "View Sent" : enriched.draftApproved ? "Ready to Send" : "Review Draft"}
              </Button>
            ) : (
              (() => {
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
                    onClick={() => onOpenDraftModal(prospect)}
                    disabled={!canGenerate}
                    title={!canGenerate ? "Contact confidence too low. Re-run discovery or enter manually." : undefined}
                    data-testid={`button-generate-email-${prospect.id}`}
                  >
                    <Mail className="h-3 w-3 mr-1" /> Draft Email
                  </Button>
                );
              })()
            )}
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
        <Button
          size="sm"
          variant={hasDeal ? "ghost" : "outline"}
          className={`h-7 text-xs ${hasDeal ? "text-muted-foreground" : "border-emerald-500 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"}`}
          onClick={() => onCreateDeal(prospect)}
          data-testid={`button-create-deal-${prospect.id}`}
          title={hasDeal ? "A deal already exists for this lead" : "Add this lead to the Deal Pipeline"}
        >
          <Briefcase className="h-3 w-3 mr-1" />
          {hasDeal ? "In Pipeline" : "Create Deal"}
        </Button>
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
          onClick={() => { if (window.confirm(`Delete "${prospect.prospectName}"? This cannot be undone.`)) onDelete(prospect.id); }}
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

function DraftCard({ draft, onApprove, onSend, onEdit, onDelete }: {
  draft: DraftWithProspect;
  onApprove: (id: string) => void;
  onSend: (id: string) => void;
  onEdit: (draft: DraftWithProspect) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className="p-4 space-y-3" data-testid={`card-draft-${draft.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{draft.prospect?.prospectName || <span className="text-muted-foreground italic">Prospect removed</span>}</p>
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
      <div className="flex gap-2 flex-wrap items-center">
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
        {/* Delete — confirm on first tap, execute on second */}
        {confirmDelete ? (
          <div className="flex gap-1 ml-auto">
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => { onDelete(draft.id); setConfirmDelete(false); }} data-testid={`button-confirm-delete-draft-${draft.id}`}>
              Confirm Delete
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmDelete(false)} data-testid={`button-cancel-delete-draft-${draft.id}`}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-auto text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)} data-testid={`button-delete-draft-${draft.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
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
          <h2 className="font-semibold text-sm">Outreach Center Health Audit</h2>
          <p className="text-xs text-muted-foreground">Verify your outreach system is configured correctly and performing well.</p>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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

type SearchAngle = { category: string; location: string };

type ResearchProgressState = {
  status: "idle" | "running" | "done" | "error";
  location: string;
  steps: ResearchStep[];
  result?: {
    saved: number;
    rejected: number;
    duplicates: number;
    allDuplicates?: boolean;
    primarySearchAngle?: SearchAngle;
    fallbackSearchAngle?: SearchAngle | null;
    searchAttempt?: "primary" | "fallback";
    diversified?: boolean;
  };
  currentAngle?: SearchAngle;
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
  onFindDifferent,
}: {
  progress: ResearchProgressState;
  onMinimize: () => void;
  onDismiss: () => void;
  onFindDifferent: () => void;
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

          {/* Active Search Angle — shown while running and when done */}
          {progress.currentAngle && !isDone && (
            <>
              <div className="mt-2 pt-2 border-t border-border/50">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-600 dark:text-cyan-400 mb-1">Search Angle</p>
                <p className="text-[11px] text-cyan-700 dark:text-cyan-300 font-medium leading-snug" data-testid="text-search-angle-running">
                  {progress.currentAngle.category}
                  <span className="text-cyan-500 dark:text-cyan-500 mx-1">•</span>
                  {progress.currentAngle.location}
                </p>
              </div>
            </>
          )}

          {/* Result line */}
          {isDone && progress.result && (
            <>
              <div className="my-1.5 border-t" />

              {/* Search angle result summary */}
              {progress.result.primarySearchAngle && (
                <div className="mb-1.5" data-testid="section-search-angle-done">
                  {progress.result.fallbackSearchAngle ? (
                    <div className="space-y-1">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Primary Search</p>
                      <p className="text-[11px] text-muted-foreground leading-snug line-through opacity-60">
                        {progress.result.primarySearchAngle.category}
                        <span className="mx-1">•</span>
                        {progress.result.primarySearchAngle.location}
                      </p>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-600 dark:text-cyan-400">Expanded Search</p>
                      <p className="text-[11px] text-cyan-700 dark:text-cyan-300 font-medium leading-snug" data-testid="text-fallback-angle">
                        {progress.result.fallbackSearchAngle.category}
                        <span className="text-cyan-500 mx-1">•</span>
                        {progress.result.fallbackSearchAngle.location}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-600 dark:text-cyan-400 mb-0.5">Search Angle</p>
                      <p className="text-[11px] text-cyan-700 dark:text-cyan-300 font-medium leading-snug" data-testid="text-primary-angle">
                        {progress.result.primarySearchAngle.category}
                        <span className="text-cyan-500 mx-1">•</span>
                        {progress.result.primarySearchAngle.location}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-border/50 pt-1.5 space-y-1">
                {progress.result.allDuplicates ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="h-3.5 w-3.5 shrink-0 flex items-center justify-center mt-0.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      </div>
                      <span className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed" data-testid="text-all-duplicates">
                        We found only organizations already in your pipeline. Next search rotation will automatically move to a new category and nearby market.
                      </span>
                    </div>
                    <button
                      className="w-full text-xs text-primary underline underline-offset-2 text-left hover:opacity-80 transition-opacity"
                      onClick={onFindDifferent}
                      data-testid="button-find-different"
                    >
                      Find different leads now →
                    </button>
                  </div>
                ) : (
                  <>
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
              </div>
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

// ─── Intelligence Tab Component ───────────────────────────────────────────────
type AnalyticsRec = { icon: string; title: string; text: string };

function IntelligenceTab({ analyticsData, revenueActions }: { analyticsData: any; revenueActions: any[] | undefined }) {
  const { data: recs, isLoading: recsLoading, refetch: refetchRecs, isFetching: recsFetching } = useQuery<{ recommendations: AnalyticsRec[]; generatedAt: string; dataPoints: number }>({
    queryKey: ["/api/admin/team-training/analytics/recommendations"],
    staleTime: 300000,
    enabled: false,
  });

  const { data: brief, refetch: refetchBrief, isFetching: briefFetching } = useQuery<any>({
    queryKey: ["/api/admin/team-training/revenue-agent/brief"],
    staleTime: 120000,
    enabled: false,
  });

  const runAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/team-training/revenue-agent/run", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/revenue-agent/actions"] });
      refetchBrief();
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/execute`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/revenue-agent/actions"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/team-training/revenue-agent/actions/${id}/dismiss`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/revenue-agent/actions"] });
    },
  });

  const summary = analyticsData?.summary;
  const stageFunnel: { label: string; count: number }[] = analyticsData?.stageFunnel || [];
  const pendingActions = (revenueActions || []).filter((a: any) => a.status === "pending");

  return (
    <div className="space-y-5" data-testid="intelligence-tab-content">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" /> Revenue Intelligence
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Real pipeline metrics and AI actions from your deal data.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runAgentMutation.mutate()}
          disabled={runAgentMutation.isPending}
          data-testid="button-run-revenue-agent"
        >
          {runAgentMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
          Run Revenue Agent
        </Button>
      </div>

      {/* Pipeline Metrics */}
      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 text-center" data-testid="card-intel-win-rate">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary.winRate ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Win Rate</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-intel-reply-rate">
            <p className="text-2xl font-bold">{summary.replyRate ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Reply Rate</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-intel-avg-close">
            <p className="text-2xl font-bold">{summary.avgDaysToClose ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Avg Days to Close</p>
          </Card>
          <Card className="p-3 text-center" data-testid="card-intel-won-revenue">
            <p className="text-2xl font-bold text-primary">${(summary.totalWonRevenue ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Won Revenue</p>
          </Card>
        </div>
      ) : (
        <Card className="p-4 text-center text-muted-foreground text-xs">
          No pipeline data yet — create deals to unlock analytics.
        </Card>
      )}

      {/* Stage Funnel */}
      {stageFunnel.length > 0 && (
        <Card className="p-4">
          <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Deal Stage Funnel
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            {stageFunnel.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-1 min-w-[52px]">
                <span className="text-xs font-bold">{s.count}</span>
                <div
                  className="w-10 rounded-t bg-primary/70 dark:bg-primary/50"
                  style={{ height: `${Math.max(8, (s.count / Math.max(1, stageFunnel[0].count)) * 48)}px` }}
                />
                <span className="text-[10px] text-muted-foreground text-center leading-tight max-w-[64px] truncate" title={s.label}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Recommendations */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> AI Recommendations
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => refetchRecs()}
          disabled={recsFetching}
          data-testid="button-fetch-recs"
        >
          {recsFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {recs ? "Refresh" : "Generate"}
        </Button>
      </div>

      {recsLoading || recsFetching ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : recs ? (
        <div className="space-y-2">
          {recs.recommendations.map((r, i) => (
            <Card key={i} className="p-3 border-l-4 border-l-primary/40" data-testid={`card-rec-${i}`}>
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0">{r.icon}</span>
                <div>
                  <p className="text-xs font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.text}</p>
                </div>
              </div>
            </Card>
          ))}
          {recs.generatedAt && (
            <p className="text-[10px] text-muted-foreground text-right">
              Generated {new Date(recs.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {recs.dataPoints} deals analyzed
            </p>
          )}
        </div>
      ) : (
        <Card className="p-6 text-center text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">Click Generate to get AI recommendations</p>
          <p className="text-xs mt-1">Based on your real deal data — no fabrication.</p>
        </Card>
      )}

      {/* Revenue Agent Brief */}
      <div className="flex items-center justify-between pt-2 border-t">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" /> Revenue Agent Daily Brief
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => refetchBrief()}
          disabled={briefFetching}
          data-testid="button-fetch-brief"
        >
          {briefFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          {brief ? "Refresh" : "Load Brief"}
        </Button>
      </div>

      {brief && (
        <Card className="p-4 space-y-3">
          {brief.summary && <p className="text-xs text-muted-foreground leading-relaxed">{brief.summary}</p>}
          {Array.isArray(brief.highlights) && brief.highlights.length > 0 && (
            <ul className="space-y-1.5">
              {brief.highlights.map((h: string, i: number) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <span className="text-primary shrink-0 mt-0.5 font-bold">→</span>
                  {h}
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(brief.urgentDeals) && brief.urgentDeals.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1.5">Urgent Deals</p>
              <div className="space-y-1">
                {brief.urgentDeals.map((d: any, i: number) => (
                  <div key={i} className="text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <Flame className="h-3 w-3 shrink-0" />
                    <span>{d.name || d.dealName} — {d.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Priority Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5" /> Priority Actions
          {pendingActions.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-medium">
              {pendingActions.length} pending
            </span>
          )}
        </p>
      </div>

      {!revenueActions ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : pendingActions.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No pending priority actions</p>
          <p className="text-xs mt-1">Run the Revenue Agent to generate actions from your deal pipeline.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {pendingActions.slice(0, 10).map((action: any) => (
            <Card key={action.id} className="p-3" data-testid={`card-action-${action.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 capitalize">
                      {(action.actionType || "").replace(/_/g, " ")}
                    </span>
                    {action.estimatedValue ? (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                        <DollarSign className="h-2.5 w-2.5" />{Number(action.estimatedValue).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">{action.reason}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2"
                    onClick={() => executeMutation.mutate(action.id)}
                    disabled={executeMutation.isPending}
                    data-testid={`button-execute-action-${action.id}`}
                  >
                    Execute
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2 text-muted-foreground"
                    onClick={() => dismissMutation.mutate(action.id)}
                    disabled={dismissMutation.isPending}
                    data-testid={`button-dismiss-action-${action.id}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {(revenueActions || []).filter((a: any) => a.status !== "pending").length > 0 && (
            <p className="text-[10px] text-muted-foreground text-right">
              + {(revenueActions || []).filter((a: any) => a.status !== "pending").length} completed/dismissed
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
  const [sortBy, setSortBy] = useState<"confidence" | "last_contact" | "status" | "value" | "name">("confidence");
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
  const [draftModalProspect, setDraftModalProspect] = useState<TeamTrainingProspect | null>(null);
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

  const { data: enrichedMap } = useQuery<{ enriched: Record<string, ProspectEnrichedState> }>({
    queryKey: ["/api/admin/team-training/prospects/enriched"],
    staleTime: 30000,
  });

  const { data: ttRevenueOps } = useQuery<TTRevenueOpsData>({
    queryKey: ["/api/admin/team-training/prospects/revenue-ops"],
    staleTime: 60000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{ newLeads: number; pendingApproval: number; sentThisWeek: number; replies: number }>({
    queryKey: ["/api/admin/team-training/stats"],
  });

  const { data: analyticsData } = useQuery<any>({
    queryKey: ["/api/admin/team-training/analytics"],
    staleTime: 60000,
  });

  const { data: revenueActions } = useQuery<any[]>({
    queryKey: ["/api/admin/team-training/revenue-agent/actions"],
    staleTime: 60000,
  });

  const { data: pipelineCounts } = useQuery<{
    teamTrainingProspects: { b2b: number; b2c: number; unclassified: number; total: number };
    athleteIntakeLeads: { total: number };
  }>({
    queryKey: ["/api/admin/pipeline-segment-counts"],
  });

  const { data: prospects, isLoading: prospectsLoading, isError: prospectsError, refetch: refetchProspects } = useQuery<TeamTrainingProspect[]>({
    queryKey: ["/api/admin/team-training/prospects"],
  });

  const { data: drafts, isLoading: draftsLoading } = useQuery<DraftWithProspect[]>({
    queryKey: ["/api/admin/team-training/drafts"],
  });

  const { data: existingDeals = [] } = useQuery<{ prospectId: string }[]>({
    queryKey: ["/api/admin/team-training/deals"],
  });
  const existingDealProspectIds = new Set((existingDeals as any[]).map((d: any) => d.prospectId));

  const [, navigate] = useLocation();

  const createDealMutation = useMutation({
    mutationFn: async (prospect: TeamTrainingProspect) => {
      const res = await apiRequest("POST", "/api/admin/team-training/deals", {
        prospectId: prospect.id,
        status: "new",
        estimatedValue: prospect.estimatedValue ?? 0,
        probability: 40,
        nextAction: "",
        notes: "",
      });
      const json = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(json.message || "Failed to create deal");
      return { json, isExisting: res.status === 409 };
    },
    onSuccess: ({ json, isExisting }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/deals"] });
      if (isExisting) {
        toast({ title: "Already in pipeline", description: "This lead already has a deal in the pipeline.", duration: 3000 });
      } else {
        toast({
          title: "Deal created!",
          description: "Lead added to Deal Pipeline under 'New'.",
          duration: 4000,
        });
      }
      navigate("/admin/team-training-deals");
    },
    onError: (err: Error) => toast({ title: "Failed to create deal", description: err.message, variant: "destructive" }),
  });

  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: savedSettings } = useQuery<{
    defaultLocation: string; radiusMiles: number; recurringEnabled: boolean;
    recurringFrequency: string; recurringLimit: number; recurringSport: string; recurringTime: string;
    lastRunAt: string | null; nextRunAt: string | null; nextRunLabel: string | null; preferredTimeLabel: string;
    nextSearchAngle: { category: string; location: string } | null;
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
    mutationFn: async (data: { sport?: string; limit: number; location: string; radiusMiles: number; forceDiversify?: boolean }) => {
      // Close dialog + launch progress panel immediately
      setResearchDialogOpen(false);
      setResearchLocationTouched(false);
      setResearchProgress({
        status: "running",
        location: data.location,
        steps: makeSteps("search"),
        minimized: false,
        currentAngle: savedSettings?.nextSearchAngle ?? undefined,
      });
      startProgressSteps(data.location);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);
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
      const allDuplicates = data.summary?.allDuplicates ?? false;
      const primarySearchAngle = data.summary?.primarySearchAngle ?? null;
      const fallbackSearchAngle = data.summary?.fallbackSearchAngle ?? null;
      const searchAttempt = data.summary?.searchAttempt ?? "primary";
      const diversified = data.summary?.diversified ?? false;

      setResearchProgress((prev) => ({
        ...prev,
        status: "done",
        steps: STEP_DEFINITIONS.map((s) => ({ ...s, state: "done" as const })),
        currentAngle: undefined,
        result: {
          saved, rejected, duplicates, allDuplicates,
          primarySearchAngle: primarySearchAngle ?? undefined,
          fallbackSearchAngle,
          searchAttempt,
          diversified,
        },
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

  const deleteDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/team-training/drafts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/drafts"] });
      toast({ title: "Draft deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
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
        // Server returns { prospect } on email found, { success: false, reason, prospect } on partial/miss
        const hasEmail = !!json.prospect?.decisionMakerEmail;
        const hasPartial = json.reason === "partial_contact_found";
        if (hasEmail || hasPartial) found++;
        if (json.prospect) {
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
          setEditProspectForm((prev) => ({
            ...prev,
            ...updatedLead,
            // Map decisionMaker fields into the basic contact fields shown in the form
            contactName: prev.contactName || updatedLead.contactName || (updatedLead as any).decisionMakerName || undefined,
            contactRole: prev.contactRole || updatedLead.contactRole || (updatedLead as any).decisionMakerTitle || undefined,
            contactEmail: prev.contactEmail || updatedLead.contactEmail || (updatedLead as any).decisionMakerEmail || undefined,
            contactPhone: prev.contactPhone || updatedLead.contactPhone || undefined,
            websiteUrl: prev.websiteUrl || updatedLead.websiteUrl || (updatedLead as any).contactSourceUrl || undefined,
            sourceUrl: prev.sourceUrl || updatedLead.sourceUrl || (updatedLead as any).discoverySourceUrl || undefined,
          }));
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

  const STATUS_SORT_ORDER = ["Replied", "Contacted", "Approved", "New", "Needs Review", "Not Interested", "Do Not Contact"];

  const filteredProspects = (prospects || [])
    .filter((p) => {
      if (filterSport && filterSport !== "all" && p.sport?.toLowerCase() !== filterSport.toLowerCase()) return false;
      if (filterStatus && filterStatus !== "all" && p.outreachStatus !== filterStatus) return false;
      if (filterCity && !p.city?.toLowerCase().includes(filterCity.toLowerCase())) return false;
      if (searchText && !p.prospectName.toLowerCase().includes(searchText.toLowerCase()) && !p.contactName?.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "confidence") return (b.confidenceScore || 0) - (a.confidenceScore || 0);
      if (sortBy === "last_contact") {
        const ta = a.lastContactedAt ? (a.lastContactedAt instanceof Date ? a.lastContactedAt : new Date(a.lastContactedAt as unknown as string)).getTime() : 0;
        const tb = b.lastContactedAt ? (b.lastContactedAt instanceof Date ? b.lastContactedAt : new Date(b.lastContactedAt as unknown as string)).getTime() : 0;
        return tb - ta;
      }
      if (sortBy === "value") return (b.estimatedValue || 0) - (a.estimatedValue || 0);
      if (sortBy === "name") return a.prospectName.localeCompare(b.prospectName);
      if (sortBy === "status") {
        return STATUS_SORT_ORDER.indexOf(a.outreachStatus || "New") - STATUS_SORT_ORDER.indexOf(b.outreachStatus || "New");
      }
      return 0;
    });

  const pipelineValue = (prospects || [])
    .filter((p) => !["Do Not Contact", "Not Interested"].includes(p.outreachStatus || ""))
    .reduce((sum, p) => sum + (p.estimatedValue || parseInt(estimatedValue) || 500), 0);

  const [editProspectForm, setEditProspectForm] = useState<Partial<TeamTrainingProspect>>({});
  const [editEnriching, setEditEnriching] = useState(false);

  const openEditProspect = (p: TeamTrainingProspect) => {
    setEditProspect(p);
    // Merge decisionMaker fields into the basic contact fields so Deep Search results show up
    setEditProspectForm({
      ...p,
      contactName: p.contactName || (p as any).decisionMakerName || undefined,
      contactRole: p.contactRole || (p as any).decisionMakerTitle || undefined,
      contactEmail: p.contactEmail || (p as any).decisionMakerEmail || undefined,
      contactPhone: p.contactPhone || undefined,
      websiteUrl: p.websiteUrl || (p as any).contactSourceUrl || undefined,
      sourceUrl: p.sourceUrl || (p as any).discoverySourceUrl || undefined,
    });
  };

  const runEditEnrichment = async () => {
    if (!editProspect) return;
    setEditEnriching(true);
    try {
      const res = await apiRequest("POST", `/api/team-training-leads/${editProspect.id}/enrich-contact`, {});
      const json = await res.json();
      // Merge whatever was found — email-found path returns { prospect }, partial path returns { success:false, prospect, partialData }
      const p = json.prospect;
      const partial = json.partialData;
      if (p || partial) {
        setEditProspectForm((prev) => ({
          ...prev,
          contactName: prev.contactName || p?.contactName || p?.decisionMakerName || partial?.contactName || undefined,
          contactRole: prev.contactRole || p?.contactRole || p?.decisionMakerTitle || partial?.contactRole || undefined,
          contactEmail: prev.contactEmail || p?.contactEmail || p?.decisionMakerEmail || undefined,
          contactPhone: prev.contactPhone || p?.contactPhone || partial?.contactPhone || undefined,
          websiteUrl: prev.websiteUrl || p?.websiteUrl || p?.contactSourceUrl || undefined,
          sourceUrl: prev.sourceUrl || p?.sourceUrl || p?.discoverySourceUrl || undefined,
        }));
      }
    } catch {}
    setEditEnriching(false);
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
      {/* ── System-type navigation banner ── */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">CRM System:</span>
          </div>
          <Link href="/admin/team-training-leads">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground shadow-sm"
              data-testid="nav-b2b-partnerships-active"
            >
              <Building2 className="h-3.5 w-3.5" />
              Team Partnerships
              <span className="ml-1 opacity-80">B2B</span>
            </button>
          </Link>
          <Link href="/admin/athlete-leads">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-colors"
              data-testid="nav-athlete-leads"
            >
              <Users className="h-3.5 w-3.5" />
              Athlete Intake Pipeline
              <span className="ml-1 opacity-60">B2C</span>
            </button>
          </Link>
          <p className="text-[11px] text-muted-foreground ml-auto hidden sm:block">
            Schools · clubs · facilities · organizations
          </p>
        </div>
      </div>

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

      {/* Pipeline segmentation debug counts */}
      {pipelineCounts && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-1.5 rounded-md bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-xs text-muted-foreground" data-testid="pipeline-segment-counts">
          <span className="font-semibold text-slate-600 dark:text-slate-400">Pipeline Segments:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium" data-testid="count-b2b">
            B2B Partnerships: {pipelineCounts.teamTrainingProspects.b2b}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium" data-testid="count-athlete-intake">
            Athlete Intake: {pipelineCounts.athleteIntakeLeads.total}
          </span>
          {pipelineCounts.teamTrainingProspects.unclassified > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-medium" data-testid="count-unclassified">
              Unclassified: {pipelineCounts.teamTrainingProspects.unclassified}
            </span>
          )}
          {pipelineCounts.teamTrainingProspects.unclassified > 0 && (
            <button
              onClick={async () => {
                try {
                  const data = await authenticatedFetch("/api/admin/team-training/prospects/backfill-lead-types", { method: "POST", headers: { "Content-Type": "application/json" } });
                  queryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline-segment-counts"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/prospects"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/stats"] });
                  console.log("[backfill-result]", data);
                } catch (e) { console.error(e); }
              }}
              className="underline text-yellow-700 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-200"
              data-testid="button-run-backfill"
            >
              Run backfill
            </button>
          )}
        </div>
      )}

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
          <TabsTrigger value="intelligence" data-testid="tab-intelligence">
            Intelligence
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
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="h-8 text-xs w-40" data-testid="select-sort-by">
                  <ArrowUpDown className="h-3 w-3 mr-1 shrink-0" />
                  <SelectValue placeholder="Sort by…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confidence">Sort: Confidence</SelectItem>
                  <SelectItem value="last_contact">Sort: Last Contacted</SelectItem>
                  <SelectItem value="status">Sort: Stage</SelectItem>
                  <SelectItem value="value">Sort: Est. Value</SelectItem>
                  <SelectItem value="name">Sort: Name</SelectItem>
                </SelectContent>
              </Select>
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

          {ttRevenueOps && <TTRevenueOpsPanel data={ttRevenueOps} />}

          {prospectsError ? (
            <QueryErrorState
              title="Unable to load leads"
              message="There was a problem fetching team training prospects. Please try again."
              onRetry={() => refetchProspects()}
            />
          ) : prospectsLoading ? (
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
                  onOpenDraftModal={(p) => setDraftModalProspect(p)}
                  onDelete={(id) => deleteProspectMutation.mutate(id)}
                  onMarkReplied={(id) => markRepliedMutation.mutate(id)}
                  onDoNotContact={(id) => doNotContactMutation.mutate(id)}
                  onEnrichContact={(id) => enrichContactMutation.mutate(id)}
                  onCreateDeal={(p) => createDealMutation.mutate(p)}
                  enrichingId={enrichingId}
                  existingDealProspectIds={existingDealProspectIds}
                  enriched={enrichedMap?.enriched?.[p.id] ?? null}
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
                  onDelete={(id) => deleteDraftMutation.mutate(id)}
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

        <TabsContent value="intelligence" className="mt-4">
          <IntelligenceTab analyticsData={analyticsData} revenueActions={revenueActions} />
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
              {/* Contact fields header with auto-fill button */}
              {(() => {
                const searchableFields = ["contactName", "contactRole", "contactEmail", "contactPhone", "websiteUrl"] as const;
                const hasAnyEmpty = searchableFields.some((f) => !(editProspectForm as any)[f]);
                return hasAnyEmpty ? (
                  <div className="flex items-center justify-between pt-1 pb-0.5">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2 border-blue-400 text-blue-600 dark:text-blue-400"
                      onClick={runEditEnrichment}
                      disabled={editEnriching}
                      data-testid="button-autofill-contact"
                    >
                      {editEnriching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                      {editEnriching ? "Searching…" : "Auto-fill empty fields"}
                    </Button>
                  </div>
                ) : null;
              })()}
              {(["contactName", "contactRole", "contactEmail", "contactPhone", "websiteUrl", "sourceUrl"] as const).map((field) => {
                const placeholders: Record<string, string> = {
                  contactName: "e.g. John Smith",
                  contactRole: "e.g. Athletic Director",
                  contactEmail: "e.g. coach@org.com",
                  contactPhone: "e.g. (555) 123-4567",
                  websiteUrl: "https://",
                  sourceUrl: "https://",
                };
                const searchable = ["contactName", "contactRole", "contactEmail", "contactPhone", "websiteUrl"].includes(field);
                const isEmpty = !(editProspectForm as any)[field];
                return (
                  <div key={field}>
                    <label className="text-xs font-medium capitalize">{field.replace(/([A-Z])/g, " $1")}</label>
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        value={(editProspectForm as any)[field] ?? ""}
                        onChange={(e) => setEditProspectForm((f) => ({ ...f, [field]: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder={placeholders[field] ?? ""}
                        data-testid={`input-edit-${field}`}
                      />
                      {searchable && isEmpty && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                          onClick={runEditEnrichment}
                          disabled={editEnriching}
                          title={`Search for ${field.replace(/([A-Z])/g, " $1").toLowerCase()}`}
                          data-testid={`button-search-${field}`}
                        >
                          {editEnriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
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

      {/* TT Draft Modal — inline per-prospect AgentMail modal */}
      {draftModalProspect && (
        <TTDraftModal
          prospect={draftModalProspect}
          onClose={() => setDraftModalProspect(null)}
          onSent={() => setDraftModalProspect(null)}
        />
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
        onFindDifferent={() => {
          const loc = researchProgress.location || researchLocation.trim();
          if (!loc) return;
          setResearchProgress({ status: "idle", location: "", steps: makeSteps(), minimized: false });
          researchMutation.mutate({
            sport: researchSport === "all" ? undefined : researchSport,
            limit: parseInt(researchLimit),
            location: loc,
            radiusMiles: parseInt(researchRadius),
            forceDiversify: true,
          });
        }}
      />
    </div>
  );
}
