import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusinessAgentVoice } from "@/hooks/use-business-agent-voice";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient as qc } from "@/lib/queryClient";
import {
  Bot,
  Send,
  User,
  Clock,
  Sparkles,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  Calendar,
  BarChart3,
  UserX,
  RefreshCw,
  PlusCircle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Zap,
  DollarSign,
  ListOrdered,
  Settings,
  MessageSquare,
  Activity,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Users2,
  Package,
  Target,
  X,
  Mail,
  Building2,
} from "lucide-react";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/authToken";
import { useAuth } from "@/hooks/use-auth";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

interface OpsInsight {
  type: "info" | "warning" | "opportunity" | "action";
  category: string;
  title: string;
  description: string;
  metric?: string;
  priority: "high" | "medium" | "low";
  actionLabel?: string;
  actionPrompt?: string;
}

interface CoachDigest {
  coachId: string;
  coachName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  openSlots: number;
  todayBookings: number;
  weekSessionCount: number;
  statusLabel?: "overloaded" | "high_load" | "healthy" | "underbooked" | "no_availability" | "active_no_schedule";
  statusMessage?: string;
  recommendation?: string;
}

export interface OpsDigest {
  generatedAt: string;
  weekRange: string;
  totalBookingsThisWeek: number;
  openSlotsThisWeek: number;
  estimatedOpenRevenue: number;
  inactiveClientsCount: number;
  waitlistCount: number;
  coaches: CoachDigest[];
  insights: OpsInsight[];
  recentCancellations: { id: string; clientName: string; coachName: string; time: string; service: string }[];
}

interface WaitlistEntry {
  id: string;
  clientId: string;
  organizationId: string;
  coachId: string | null;
  sessionType: string | null;
  notes: string | null;
  createdAt: string | null;
  client?: { id: string; firstName: string | null; lastName: string | null; email: string | null };
}

interface RevenueSummary {
  generatedAt: string;
  totalRevenueCents: number;
  last30dRevenueCents: number;
  prior30dRevenueCents: number;
  revenueGrowthPct: number;
  mrr: number;
  activeSubscribers: number;
  avgLtvCents: number;
  avgRevenuePerSessionCents: number;
  totalSessions: number;
  sessionsLast30d: number;
  churnRiskCount: number;
  sessionPackageAlertCount: number;
  upsellOpportunityCount: number;
  coachRevenues: { coachId: string; coachName: string; totalRevenueCents: number; sessionCount: number; avgRevenuePerSessionCents: number; activeClients: number }[];
  timeBlockRevenues: { hour: number; label: string; totalRevenueCents: number; sessionCount: number }[];
  topClients: { clientId: string; clientName: string; totalRevenueCents: number; sessionCount: number }[];
  topClientsByScheduledRevenue?: { clientId: string; clientName: string; scheduledRevenueCents: number; scheduledSessionCount: number }[];
  topClientsByRedeemedRevenue?: { clientId: string; clientName: string; redeemedRevenueCents: number; redeemedSessionCount: number }[];
  timezone?: string;
  b2cRevenueCents?: number;
  b2bPipelineRevenueCents?: number;
  totalPipelineRevenueCents?: number;
  unclassifiedLeadsCount?: number;
  revenueSummaryDegraded?: boolean;
  _error?: string;
}

interface ChurnRisk {
  clientId: string;
  clientName: string;
  email: string | null;
  riskLevel: "high" | "medium";
  signals: string[];
  lastBookingDate: string | null;
  daysSinceLastBooking: number;
  suggestedAction: string;
}

interface UpsellOpportunity {
  clientId: string;
  clientName: string;
  currentPattern: string;
  opportunity: string;
  estimatedRevenueLiftCents: number;
  reasoning: string;
  priority: "high" | "medium";
}

interface SessionPackageAlert {
  clientId: string;
  clientName: string;
  email: string | null;
  planName: string;
  sessionsRemaining: number;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  urgency: "critical" | "warning";
}

export type SourcePage = "schedule" | "clients" | "revenue" | "settings" | "dashboard" | "media";

interface AgentAlert {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  title: string;
  reason: string;
  urgency: "high" | "medium";
  actionLabel: string;
  actionTab: "chat" | "ops" | "revenue";
  actionPrompt: string;
}

function getTopAgentAlerts(
  digest: OpsDigest | undefined | null,
  revenueSummary: RevenueSummary | undefined | null
): AgentAlert[] {
  const alerts: AgentAlert[] = [];

  if (digest) {
    for (const ins of digest.insights.filter(i => i.priority === "high")) {
      alerts.push({
        id: `insight-${ins.category}-${ins.title.slice(0, 20)}`,
        icon: AlertTriangle,
        iconColor: "text-red-500",
        title: ins.title,
        reason: ins.description,
        urgency: "high",
        actionLabel: ins.actionLabel ?? "View",
        actionTab: "chat",
        actionPrompt: ins.actionPrompt ?? ins.title,
      });
    }
    if (digest.openSlotsThisWeek > 0) {
      alerts.push({
        id: "open-slots",
        icon: Calendar,
        iconColor: "text-orange-500",
        title: `${digest.openSlotsThisWeek} open slots this week`,
        reason: `~$${digest.estimatedOpenRevenue.toLocaleString()} in potential revenue`,
        urgency: "medium",
        actionLabel: "Fill Slots",
        actionTab: "ops",
        actionPrompt: "Find open slots and suggest clients to fill them",
      });
    }
    if (digest.inactiveClientsCount > 0) {
      alerts.push({
        id: "inactive-clients",
        icon: UserX,
        iconColor: "text-amber-500",
        title: `${digest.inactiveClientsCount} clients haven't booked recently`,
        reason: "Consider a follow-up or booking offer",
        urgency: "medium",
        actionLabel: "View",
        actionTab: "chat",
        actionPrompt: "Who are our at-risk clients?",
      });
    }
  }

  if ((revenueSummary?.churnRiskCount ?? 0) > 0) {
    alerts.push({
      id: "churn-risks",
      icon: TrendingDown,
      iconColor: "text-red-500",
      title: `${revenueSummary!.churnRiskCount} client${revenueSummary!.churnRiskCount > 1 ? "s" : ""} at churn risk`,
      reason: "Recent drop in session activity detected",
      urgency: "high",
      actionLabel: "View",
      actionTab: "revenue",
      actionPrompt: "Show me clients at churn risk",
    });
  }

  if ((revenueSummary?.sessionPackageAlertCount ?? 0) > 0) {
    alerts.push({
      id: "session-packages",
      icon: Package,
      iconColor: "text-amber-500",
      title: `${revenueSummary!.sessionPackageAlertCount} session package${revenueSummary!.sessionPackageAlertCount > 1 ? "s" : ""} expiring`,
      reason: "Clients may need renewal soon",
      urgency: "medium",
      actionLabel: "View",
      actionTab: "revenue",
      actionPrompt: "Show session package alerts",
    });
  }

  return alerts.sort((a, b) => (a.urgency === "high" && b.urgency !== "high" ? -1 : b.urgency === "high" && a.urgency !== "high" ? 1 : 0));
}

export interface AgentContext {
  sourcePage: SourcePage;
  sourcePath: string;
  openedAt: number;
}

export interface CoachSchedulingAgentPanelProps {
  mode: "full" | "overlay";
  context?: AgentContext;
  onClose?: () => void;
}

const STAFF_QUICK_ACTIONS = [
  { label: "What Needs Attention", icon: Target, prompt: "What needs my attention today?", color: "text-primary", desc: "Today's priority items" },
  { label: "Revenue", icon: DollarSign, prompt: "Show me our revenue summary", color: "text-green-500", desc: "This week vs last week" },
  { label: "Growth", icon: TrendingUp, prompt: "What are our growth opportunities?", color: "text-orange-500", desc: "Top opportunity" },
  { label: "Retention Risks", icon: AlertTriangle, prompt: "Who are our at-risk clients?", color: "text-red-500", desc: "At-risk clients" },
  { label: "Schedule", icon: Calendar, prompt: "Show me this week's full schedule", color: "text-blue-500", desc: "Today / this week" },
  { label: "Book a Session", icon: PlusCircle, prompt: "I need to book a session for a client", color: "text-primary", desc: "Add a new booking" },
  { label: "Ops Summary", icon: Activity, prompt: "Give me an operations summary for this week", color: "text-purple-500", desc: "What needs attention" },
  { label: "Find Team Leads", icon: Users2, prompt: "Find me some team training leads near us", color: "text-cyan-500", desc: "Research local teams" },
  { label: "Team Pipeline", icon: Building2, prompt: "Show team revenue pipeline", color: "text-teal-500", desc: "B2B prospect pipeline" },
  { label: "Draft Team Outreach", icon: Mail, prompt: "Draft team outreach for our top prospects", color: "text-indigo-500", desc: "Generate team emails" },
  { label: "Follow Up Today", icon: MessageSquare, prompt: "Who should I follow up with today?", color: "text-violet-500", desc: "Replies & contacts" },
  { label: "Warmest Prospects", icon: Zap, prompt: "Show me my warmest prospects right now — who has the highest engagement and is most likely to convert?", color: "text-amber-500", desc: "Highest engagement leads" },
  { label: "Best Next Action", icon: ArrowUpRight, prompt: "What is the single best action I should take right now for team training revenue? Consider all prospects and deals.", color: "text-emerald-500", desc: "Top priority action" },
  { label: "Deal to Close", icon: CheckCircle2, prompt: "Which deal in my pipeline is most likely to close this week, and what should I do to advance it?", color: "text-green-500", desc: "Highest close probability" },
  { label: "Who to Stop", icon: XCircle, prompt: "Which prospects should I stop contacting — those with no engagement, wrong contact info, or who have opted out?", color: "text-muted-foreground", desc: "Remove from outreach" },
  { label: "High-Value Safe", icon: TrendingUp, prompt: "Find me the highest-value prospect that is safe to contact right now — not in cooldown, not DNC, and with a strong fit score.", color: "text-teal-500", desc: "Best value + low risk" },
];

const CLIENT_QUICK_ACTIONS = [
  { label: "Book a Session", icon: PlusCircle, prompt: "I'd like to book a training session", color: "text-primary", desc: "Add a new booking" },
  { label: "Available Times", icon: Clock, prompt: "What times are available this week?", color: "text-blue-500", desc: "Open slots this week" },
  { label: "My Bookings", icon: Calendar, prompt: "Show me my upcoming bookings", color: "text-purple-500", desc: "Your upcoming sessions" },
  { label: "Browse Coaches", icon: Users, prompt: "Show me the coaches available", color: "text-orange-500", desc: "View all coaches" },
  { label: "Cancel a Booking", icon: XCircle, prompt: "I need to cancel one of my bookings", color: "text-red-500", desc: "Manage your bookings" },
  { label: "Get Help", icon: MessageSquare, prompt: "I have a question about scheduling", color: "text-muted-foreground", desc: "Ask any question" },
];

const PAGE_QUICK_PROMPTS: Record<SourcePage, { label: string; icon: any; prompt: string; color: string; desc: string }[]> = {
  schedule: [
    { label: "What needs attention today?", icon: Target, prompt: "What needs attention today?", color: "text-primary", desc: "Priority items" },
    { label: "Where do I have openings?", icon: Calendar, prompt: "Where do I have openings this week?", color: "text-blue-500", desc: "Open time slots" },
    { label: "Who should I text to fill open slots?", icon: MessageSquare, prompt: "Who should I reach out to fill my open slots?", color: "text-orange-500", desc: "Fill schedule gaps" },
    { label: "Book a session", icon: PlusCircle, prompt: "I need to book a session for a client", color: "text-green-500", desc: "Add a new booking" },
  ],
  clients: [
    { label: "Who is at risk of dropping off?", icon: AlertTriangle, prompt: "Who is at risk of dropping off?", color: "text-red-500", desc: "Churn risk clients" },
    { label: "Who should I follow up with?", icon: MessageSquare, prompt: "Who should I follow up with today?", color: "text-primary", desc: "Outreach priority" },
    { label: "Show inactive clients", icon: UserX, prompt: "Show me my inactive clients", color: "text-orange-500", desc: "Recently inactive" },
    { label: "Draft client outreach", icon: Send, prompt: "Draft outreach messages for my at-risk clients", color: "text-blue-500", desc: "Re-engagement messages" },
  ],
  revenue: [
    { label: "Am I on track this week?", icon: Target, prompt: "Am I on track to hit my revenue goal this week?", color: "text-primary", desc: "Goal progress" },
    { label: "What did I make this week?", icon: DollarSign, prompt: "What did I make this week?", color: "text-green-500", desc: "This week's revenue" },
    { label: "What do I need to hit my goal?", icon: TrendingUp, prompt: "What do I need to do to hit my revenue goal?", color: "text-orange-500", desc: "Gap to goal" },
    { label: "Where can I make more money?", icon: Zap, prompt: "Where can I make more money this week?", color: "text-yellow-500", desc: "Revenue opportunities" },
  ],
  settings: [
    { label: "What automation mode is active?", icon: Settings, prompt: "What automation mode is currently active?", color: "text-primary", desc: "Current mode" },
    { label: "What will you do automatically?", icon: Bot, prompt: "What actions will you take automatically?", color: "text-blue-500", desc: "Automated actions" },
    { label: "Show active campaigns", icon: Activity, prompt: "Show me my active outreach campaigns", color: "text-purple-500", desc: "Running campaigns" },
    { label: "Show agent performance", icon: BarChart3, prompt: "Show me the agent's performance summary", color: "text-green-500", desc: "Agent metrics" },
  ],
  dashboard: [
    { label: "What should I do today?", icon: Target, prompt: "What should I do today?", color: "text-primary", desc: "Today's priorities" },
    { label: "Show my weekly progress", icon: TrendingUp, prompt: "Show my weekly business progress", color: "text-green-500", desc: "Progress summary" },
    { label: "Give me my weekly business recap", icon: BarChart3, prompt: "Give me my weekly business recap", color: "text-blue-500", desc: "Full recap" },
    { label: "Draft my top outreach messages", icon: MessageSquare, prompt: "Draft my top outreach messages for this week", color: "text-orange-500", desc: "Top messages" },
  ],
  media: [
    { label: "Help me build my landing page", icon: Target, prompt: "Help me build a high-converting landing page. What should I upload first?", color: "text-primary", desc: "Landing page guide" },
    { label: "What media should I add next?", icon: TrendingUp, prompt: "Based on my current media, what should I upload next to improve my landing page?", color: "text-green-500", desc: "Next best action" },
    { label: "What makes a strong hero video?", icon: Activity, prompt: "What makes a strong hero video for a strength coach landing page?", color: "text-blue-500", desc: "Hero best practices" },
    { label: "How does media affect bookings?", icon: BarChart3, prompt: "How much does landing page media impact client bookings and conversions?", color: "text-orange-500", desc: "Media ROI" },
  ],
};

const CLIENT_PAGE_PROMPTS: Partial<Record<SourcePage, { label: string; icon: any; prompt: string; color: string; desc: string }[]>> = {
  dashboard: [
    { label: "Book a Session", icon: PlusCircle, prompt: "I'd like to book a training session", color: "text-primary", desc: "Add a new booking" },
    { label: "My Upcoming Sessions", icon: Calendar, prompt: "Show me my upcoming bookings", color: "text-blue-500", desc: "Your upcoming sessions" },
    { label: "Available Times", icon: Clock, prompt: "What times are available this week?", color: "text-green-500", desc: "Open slots this week" },
    { label: "Reschedule", icon: RefreshCw, prompt: "I need to reschedule my next session", color: "text-orange-500", desc: "Move a booking" },
  ],
  schedule: [
    { label: "What's Available?", icon: Clock, prompt: "What times are available this week?", color: "text-blue-500", desc: "Open slots" },
    { label: "Reschedule My Session", icon: RefreshCw, prompt: "I need to reschedule my next session", color: "text-orange-500", desc: "Move a booking" },
    { label: "Cancel a Booking", icon: XCircle, prompt: "I need to cancel one of my bookings", color: "text-red-500", desc: "Cancel a session" },
    { label: "Book a Session", icon: PlusCircle, prompt: "I'd like to book a new training session", color: "text-primary", desc: "Add a new booking" },
  ],
  settings: [
    { label: "My Upcoming Sessions", icon: Calendar, prompt: "Show me my upcoming bookings", color: "text-blue-500", desc: "Your upcoming sessions" },
    { label: "Reschedule My Session", icon: RefreshCw, prompt: "I need to reschedule my next session", color: "text-orange-500", desc: "Move a booking" },
    { label: "Available Times", icon: Clock, prompt: "What times are available this week?", color: "text-green-500", desc: "Open slots this week" },
    { label: "Cancel a Booking", icon: XCircle, prompt: "I need to cancel one of my bookings", color: "text-red-500", desc: "Cancel a session" },
  ],
};

const DEMO_OPS_DIGEST: OpsDigest = {
  generatedAt: new Date().toISOString(),
  weekRange: "Sample Week",
  totalBookingsThisWeek: 18,
  openSlotsThisWeek: 12,
  estimatedOpenRevenue: 840,
  inactiveClientsCount: 3,
  waitlistCount: 3,
  coaches: [
    { coachId: "demo-1", coachName: "Coach Alex", bookedMinutes: 480, availableMinutes: 600, utilizationPct: 80, openSlots: 4, todayBookings: 5, weekSessionCount: 8, statusLabel: "high_load", statusMessage: "At 80% capacity — healthy but limited room for additions", recommendation: "Accept new bookings with caution." },
    { coachId: "demo-2", coachName: "Coach Riley", bookedMinutes: 300, availableMinutes: 600, utilizationPct: 50, openSlots: 8, todayBookings: 3, weekSessionCount: 5, statusLabel: "healthy", statusMessage: "At 50% — good balance of bookings and flexibility", recommendation: "Room to add 1–2 new clients." },
  ],
  insights: [
    { type: "opportunity", category: "open-slots", title: "12 open slots this week", description: "Fill available time to capture ~$840 in revenue.", priority: "high", actionLabel: "View opportunities", actionPrompt: "How can I fill my open slots?" },
    { type: "warning", category: "churn", title: "2 at-risk clients", description: "Sample Client A and Sample Client B haven't booked recently.", priority: "medium", actionLabel: "View risks", actionPrompt: "Who are my at-risk clients?" },
  ],
  recentCancellations: [],
};

const DEMO_REVENUE_SUMMARY: RevenueSummary = {
  generatedAt: new Date().toISOString(),
  totalRevenueCents: 425000,
  last30dRevenueCents: 425000,
  prior30dRevenueCents: 390000,
  revenueGrowthPct: 8.97,
  mrr: 60000,
  activeSubscribers: 12,
  avgLtvCents: 125000,
  avgRevenuePerSessionCents: 6500,
  totalSessions: 65,
  sessionsLast30d: 65,
  churnRiskCount: 2,
  sessionPackageAlertCount: 1,
  upsellOpportunityCount: 4,
  coachRevenues: [
    { coachId: "demo-1", coachName: "Coach Alex", totalRevenueCents: 260000, sessionCount: 40, avgRevenuePerSessionCents: 6500, activeClients: 8 },
    { coachId: "demo-2", coachName: "Coach Riley", totalRevenueCents: 165000, sessionCount: 25, avgRevenuePerSessionCents: 6600, activeClients: 6 },
  ],
  timeBlockRevenues: [
    { hour: 7, label: "7 AM", totalRevenueCents: 80000, sessionCount: 12 },
    { hour: 9, label: "9 AM", totalRevenueCents: 130000, sessionCount: 20 },
    { hour: 12, label: "12 PM", totalRevenueCents: 90000, sessionCount: 14 },
    { hour: 17, label: "5 PM", totalRevenueCents: 125000, sessionCount: 19 },
  ],
  topClients: [
    { clientId: "demo-c1", clientName: "Sample Client A", totalRevenueCents: 78000, sessionCount: 12 },
    { clientId: "demo-c2", clientName: "Sample Client B", totalRevenueCents: 65000, sessionCount: 10 },
    { clientId: "demo-c3", clientName: "Sample Client C", totalRevenueCents: 52000, sessionCount: 8 },
  ],
};

const DEMO_CHURN_RISKS: ChurnRisk[] = [
  { clientId: "demo-c1", clientName: "Sample Client A", email: null, riskLevel: "high", signals: ["No booking in 30 days"], lastBookingDate: null, daysSinceLastBooking: 30, suggestedAction: "Send a re-engagement message" },
  { clientId: "demo-c2", clientName: "Sample Client B", email: null, riskLevel: "medium", signals: ["Booking frequency dropped"], lastBookingDate: null, daysSinceLastBooking: 21, suggestedAction: "Offer a check-in call" },
];

const DEMO_UPSELL_OPPS: UpsellOpportunity[] = [
  { clientId: "demo-c3", clientName: "Sample Client C", currentPattern: "1x/week", opportunity: "Move to 2x/week package", estimatedRevenueLiftCents: 26000, reasoning: "Strong attendance history", priority: "high" },
  { clientId: "demo-c4", clientName: "Sample Client D", currentPattern: "Drop-in", opportunity: "Monthly subscription", estimatedRevenueLiftCents: 18000, reasoning: "Books consistently", priority: "medium" },
];

const DEMO_WAITLIST: WaitlistEntry[] = [
  { id: "demo-w1", clientId: "demo-c5", organizationId: "demo", coachId: null, sessionType: "Strength Training", notes: "Flexible on timing", createdAt: null, client: { id: "demo-c5", firstName: "Sample", lastName: "Waitlist A", email: null } },
  { id: "demo-w2", clientId: "demo-c6", organizationId: "demo", coachId: null, sessionType: "Speed Training", notes: null, createdAt: null, client: { id: "demo-c6", firstName: "Sample", lastName: "Waitlist B", email: null } },
  { id: "demo-w3", clientId: "demo-c7", organizationId: "demo", coachId: null, sessionType: null, notes: null, createdAt: null, client: { id: "demo-c7", firstName: "Sample", lastName: "Waitlist C", email: null } },
];

const DEMO_PACKAGE_ALERTS: SessionPackageAlert[] = [
  { clientId: "demo-c8", clientName: "Sample Client E", email: null, planName: "10-Session Pack", sessionsRemaining: 1, subscriptionStatus: "active", cancelAtPeriodEnd: false, urgency: "critical" },
];

function renderMarkdown(text: string): React.ReactNode[] {
  if (text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed.requiresConfirmation) {
        const summary = parsed.summary ? `\n\n${parsed.summary}` : "";
        text = `I need your confirmation before I can proceed.${summary}\n\nUse the **Confirm** button below to execute, or **Cancel** to abort.`;
      }
    } catch {
      // not JSON — fall through to normal markdown rendering
    }
  }
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let keyIndex = 0;
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      nodes.push(<ul key={`ul-${keyIndex++}`} className="list-disc pl-5 space-y-1 my-2">{listItems}</ul>);
      listItems = [];
      inList = false;
    }
  };

  const renderInline = (raw: string): React.ReactNode => {
    const parts = raw.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
      return part;
    });
  };

  for (const line of lines) {
    if (!line.trim()) { flushList(); nodes.push(<div key={keyIndex++} className="h-2" />); continue; }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const cls = level === 1 ? "text-base font-bold mt-2 mb-1" : level === 2 ? "text-sm font-semibold mt-2 mb-1" : "text-sm font-medium mt-1 text-foreground/80";
      nodes.push(<div key={keyIndex++} className={cls}>{renderInline(headingMatch[2])}</div>);
      continue;
    }
    const listMatch = line.match(/^[\-\*]\s+(.+)/);
    if (listMatch) { inList = true; listItems.push(<li key={keyIndex++} className="text-sm leading-relaxed">{renderInline(listMatch[1])}</li>); continue; }
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      flushList();
      nodes.push(<div key={keyIndex++} className="flex gap-2 text-sm leading-relaxed my-0.5"><span className="font-semibold text-primary shrink-0">{numMatch[1]}.</span><span>{renderInline(numMatch[2])}</span></div>);
      continue;
    }
    if (line.match(/^---/)) { flushList(); nodes.push(<Separator key={keyIndex++} className="my-2" />); continue; }
    flushList();
    nodes.push(<p key={keyIndex++} className="text-sm leading-relaxed">{renderInline(line)}</p>);
  }
  flushList();
  return nodes;
}

function InsightCard({ insight, onAction }: { insight: OpsInsight; onAction: (p: string) => void }) {
  const iconMap = { info: <Info className="h-4 w-4" />, warning: <AlertTriangle className="h-4 w-4" />, opportunity: <TrendingUp className="h-4 w-4" />, action: <Zap className="h-4 w-4" /> };
  const colorMap = { info: "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30", warning: "border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/30", opportunity: "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30", action: "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/30" };
  const iconColorMap = { info: "text-blue-500", warning: "text-yellow-500", opportunity: "text-green-500", action: "text-orange-500" };
  const priorityBadge = { high: <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">High</Badge>, medium: <Badge className="text-[10px] px-1.5 py-0 h-4 bg-yellow-500">Medium</Badge>, low: <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Low</Badge> };
  return (
    <div className={`rounded-lg border p-3 ${colorMap[insight.type]}`} data-testid={`insight-card-${insight.category}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${iconColorMap[insight.type]}`}>{iconMap[insight.type]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1"><span className="text-sm font-medium">{insight.title}</span>{priorityBadge[insight.priority]}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
          {insight.metric && <span className="inline-block mt-1 text-xs font-mono font-semibold text-foreground/70">{insight.metric}</span>}
          {insight.actionLabel && insight.actionPrompt && (
            <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs px-2" onClick={() => onAction(insight.actionPrompt!)} data-testid={`insight-action-${insight.category}`}>
              <MessageSquare className="h-3 w-3 mr-1" />{insight.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TopActionCard({ insight, onAction }: { insight: OpsInsight; onAction: (p: string) => void }) {
  const urgencyColor = { high: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800", medium: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800", low: "bg-muted/40 border-border" };
  const urgencyBadge = { high: <Badge variant="destructive" className="text-[10px] px-1.5 h-4">Urgent</Badge>, medium: <Badge className="text-[10px] px-1.5 h-4 bg-yellow-500">Medium</Badge>, low: <Badge variant="secondary" className="text-[10px] px-1.5 h-4">Low</Badge> };
  const defaultPrompt = insight.actionPrompt || insight.title;
  return (
    <div className={`rounded-xl border p-3 ${urgencyColor[insight.priority]}`} data-testid={`top-action-${insight.category}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold leading-tight">{insight.title}</span>
        {urgencyBadge[insight.priority]}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-2">{insight.description}</p>
      {insight.metric && <p className="text-xs font-semibold text-foreground/80 mb-2">{insight.metric}</p>}
      {insight.actionLabel && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAction(defaultPrompt)} data-testid={`top-action-btn-${insight.category}`}>
          <MessageSquare className="h-3 w-3 mr-1" />{insight.actionLabel}
        </Button>
      )}
    </div>
  );
}

function CollapsibleSection({ title, icon, preview, children, defaultOpen = false }: { title: string; icon: React.ReactNode; preview: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-card overflow-hidden" data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <button className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors" onClick={() => setOpen(o => !o)}>
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {!open && <div className="text-xs text-muted-foreground truncate">{preview}</div>}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="border-t px-3 pb-3 pt-2">{children}</div>}
    </div>
  );
}

function CoachBar({ coach, maxRevenue }: { coach: RevenueSummary["coachRevenues"][0]; maxRevenue: number }) {
  const pct = maxRevenue > 0 ? (coach.totalRevenueCents / maxRevenue) * 100 : 0;
  return (
    <div className="flex items-center gap-3" data-testid={`revenue-coach-${coach.coachId}`}>
      <span className="text-sm font-medium w-28 truncate shrink-0">{coach.coachName}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-16 text-right shrink-0">${(coach.totalRevenueCents / 100).toFixed(0)}</span>
      <span className="text-xs text-muted-foreground w-14 text-right shrink-0">{coach.sessionCount} sessions</span>
    </div>
  );
}

function UtilizationBar({ coach }: { coach: CoachDigest }) {
  const status = coach.statusLabel;

  // Case 3: active deliveries but no availability schedule configured
  if (status === "active_no_schedule") {
    return (
      <div className="flex flex-col gap-0.5" data-testid={`coach-bar-${coach.coachId}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate">{coach.coachName}</span>
          <span className="text-xs font-semibold text-blue-500 shrink-0">Active</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {coach.weekSessionCount} session{coach.weekSessionCount !== 1 ? "s" : ""} this week · Availability not configured
        </div>
      </div>
    );
  }

  // Case 4: no availability blocks and no sessions
  if (status === "no_availability") {
    return (
      <div className="flex items-center justify-between gap-3" data-testid={`coach-bar-${coach.coachId}`}>
        <span className="text-sm font-medium w-28 truncate shrink-0">{coach.coachName}</span>
        <span className="text-xs text-muted-foreground italic">No Availability Set</span>
      </div>
    );
  }

  // Case 1 & 2: availability blocks exist — show bar + open slots
  const pct = coach.utilizationPct;
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-3" data-testid={`coach-bar-${coach.coachId}`}>
      <span className="text-sm font-medium w-28 truncate shrink-0">{coach.coachName}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right shrink-0">{pct}%</span>
      <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{coach.openSlots} open</span>
    </div>
  );
}

function TimeBlockBar({ block, maxRevenue }: { block: RevenueSummary["timeBlockRevenues"][0]; maxRevenue: number }) {
  const pct = maxRevenue > 0 ? (block.totalRevenueCents / maxRevenue) * 100 : 0;
  const isTop = pct >= 70;
  return (
    <div className="flex items-center gap-2" data-testid={`time-block-${block.hour}`}>
      <span className="text-xs text-muted-foreground w-10 shrink-0 text-right">{block.label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${isTop ? "bg-green-500" : "bg-blue-400"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-12 text-right shrink-0">${(block.totalRevenueCents / 100).toFixed(0)}</span>
    </div>
  );
}

interface PendingConfirmation {
  pendingActionId: string;
  actionType: string;
  summary: string;
  expiresAt: string;
  phone?: string;
  smsBody?: string;
  recipient?: string;
  emailSubject?: string;
  emailBody?: string;
}

const ACTION_SUCCESS_PATTERNS = [
  /\b(booking confirmed|successfully booked|session booked)\b/i,
  /\b(booking has been cancelled|booking cancelled|successfully cancelled)\b/i,
  /\b(successfully rescheduled|booking rescheduled|has been rescheduled)\b/i,
  /\b(session has been created|session created successfully|sessions? have been created)\b/i,
  /\b(inquiry has been sent|inquiry sent successfully)\b/i,
  /\b(recurring sessions? created|sessions? scheduled successfully)\b/i,
];

const CONFIRM_MARKER_RE = /\n?<!--CONFIRM:(\{[\s\S]+?\})-->/;

function stripConfirmMarker(text: string): string {
  return text.replace(CONFIRM_MARKER_RE, "").trim();
}

export function CoachSchedulingAgentPanel({ mode, context, onClose }: CoachSchedulingAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "ops" | "revenue" | "settings">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [automationLevel, setAutomationLevel] = useState<number>(1);
  const [savingLevel, setSavingLevel] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [alertDropdownOpen, setAlertDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const alertDropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { user, isLoading: authLoading } = useAuth();
  const isAuthenticated = !!user;

  const { data: profile, isLoading: profileLoading } = useQuery<{ role?: string }>({ queryKey: ["/api/profile"] });
  const userRole = profile?.role || "CLIENT";
  const isStaff = isAuthenticated && (userRole === "COACH" || userRole === "ADMIN" || userRole === "STAFF");
  const isAdmin = isAuthenticated && userRole === "ADMIN";
  const isDemo = !isAuthenticated && !authLoading;

  const contextPrompts = context ? PAGE_QUICK_PROMPTS[context.sourcePage] : null;
  const clientContextPrompts = !isStaff && mode === "overlay" && context ? CLIENT_PAGE_PROMPTS[context.sourcePage] ?? null : null;
  const QUICK_ACTIONS = isStaff
    ? (mode === "overlay" && contextPrompts ? contextPrompts : STAFF_QUICK_ACTIONS)
    : (clientContextPrompts ?? CLIENT_QUICK_ACTIONS);

  const { data: digest, isLoading: digestLoading, refetch: refetchDigest } = useQuery<OpsDigest>({
    queryKey: ["/api/scheduling/operations-digest"],
    enabled: isAuthenticated && isStaff,
    staleTime: 60 * 1000,
  });

  const { data: revenueSummary, isLoading: revenueLoading, isError: revenueError, refetch: refetchRevenue } = useQuery<RevenueSummary>({
    queryKey: ["/api/scheduling/revenue-summary"],
    enabled: isAuthenticated && isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: churnRisks, isLoading: churnLoading } = useQuery<ChurnRisk[]>({
    queryKey: ["/api/scheduling/churn-risks"],
    enabled: isAuthenticated && isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: upsellOpps, isLoading: upsellLoading } = useQuery<UpsellOpportunity[]>({
    queryKey: ["/api/scheduling/upsell-opportunities"],
    enabled: isAuthenticated && isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: packageAlerts, isLoading: packagesLoading } = useQuery<SessionPackageAlert[]>({
    queryKey: ["/api/scheduling/session-packages"],
    enabled: isAuthenticated && isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: waitlist, isLoading: waitlistLoading, refetch: refetchWaitlist } = useQuery<WaitlistEntry[]>({
    queryKey: ["/api/scheduling/waitlist"],
    enabled: isAuthenticated && isStaff,
    staleTime: 30 * 1000,
  });

  const { data: actionLog } = useQuery<any[]>({
    queryKey: ["/api/scheduling/agent-action-log"],
    enabled: isAuthenticated && isStaff && activeTab === "ops",
    staleTime: 30 * 1000,
  });

  const { data: automationData } = useQuery<{ level: number }>({
    queryKey: ["/api/scheduling/automation-level"],
    enabled: isAuthenticated && isStaff,
    staleTime: 60 * 1000,
  });

  const { data: teamPipeline, isLoading: teamPipelineLoading } = useQuery<{
    totalProspects: number;
    newLeads: number;
    highConfidenceLeads: number;
    draftsAwaitingApproval: number;
    repliesNeedingFollowUp: number;
    activePipelineCount: number;
    estimatedPipelineValueCents: number;
  }>({
    queryKey: ["/api/scheduling/team-pipeline-summary"],
    enabled: isAuthenticated && isStaff,
    staleTime: 60 * 1000,
  });

  useEffect(() => { if (automationData?.level) setAutomationLevel(automationData.level); }, [automationData]);

  useEffect(() => {
    if (!isAuthenticated && !authLoading) {
      qc.removeQueries({ queryKey: ["/api/scheduling/operations-digest"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/revenue-summary"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/churn-risks"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/upsell-opportunities"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/session-packages"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/waitlist"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/agent-action-log"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/automation-level"] });
      qc.removeQueries({ queryKey: ["/api/scheduling/team-pipeline-summary"] });
    }
  }, [isAuthenticated, authLoading]);

  const removeFromWaitlist = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/scheduling/waitlist/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/scheduling/waitlist"] }); toast({ title: "Removed from waitlist" }); },
  });

  const saveAutomationLevel = async (level: number) => {
    setSavingLevel(true);
    try {
      await apiRequest("PATCH", "/api/scheduling/automation-level", { level });
      setAutomationLevel(level);
      qc.invalidateQueries({ queryKey: ["/api/scheduling/automation-level"] });
      toast({ title: "Automation level updated" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSavingLevel(false); }
  };

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const resetScroll = () => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = 0;
    };
    resetScroll();
    const raf = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!alertDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (alertDropdownRef.current && !alertDropdownRef.current.contains(e.target as Node)) {
        setAlertDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [alertDropdownOpen]);

  // Rehydrate active pending actions when the panel mounts (survives page refresh)
  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    fetch("/api/agent/pending-actions/active", { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.actions?.length) return;
        // Show the most recent active pending action
        const latest = data.actions[data.actions.length - 1];
        const meta = latest.displayMeta ?? {};
        if (latest.status === "pending" && new Date(latest.expiresAt) > new Date()) {
          setPendingConfirmation({
            pendingActionId: latest.id,
            actionType: latest.actionType,
            summary: (meta.summary as string) || `Pending: ${latest.actionType}`,
            expiresAt: latest.expiresAt,
            recipient: meta.recipient as string | undefined,
            phone: meta.phone as string | undefined,
            smsBody: meta.smsBody as string | undefined,
            emailSubject: meta.emailSubject as string | undefined,
            emailBody: meta.emailBody as string | undefined,
          });
        }
      })
      .catch(() => {});
  }, [isAuthenticated, authLoading]);

  const submitBusinessAgentMessage = useCallback(async ({
    message,
    source,
  }: {
    message: string;
    source: "typed" | "enter" | "quick-action" | "tap-to-dictate" | "push-to-talk";
  }) => {
    const content = message.trim();
    if (!content || isLoading) return;
    if (isDemo) return;

    const profileState = qc.getQueryState(["/api/profile"]);
    const organizationId = (profileState?.data as any)?.organizationId ?? "unknown";

    console.log("[TrainEfficiency Voice Agent Submit]", {
      source,
      message: content,
      organizationId,
      activeTab,
      route: "/api/scheduling-agent/chat",
      mode,
    });

    setInput("");
    setShowQuickActions(false);
    setPendingConfirmation(null);
    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setIsLoading(true);
    try {
      const response = await fetch("/api/scheduling-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ messages: newMessages }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message);
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages([...newMessages, { role: "assistant", content: stripConfirmMarker(full) }]);
        }
        full += decoder.decode();
      } else {
        full = await response.text();
      }

      const confirmMatch = full.match(CONFIRM_MARKER_RE);
      if (confirmMatch) {
        try {
          const confirmData = JSON.parse(confirmMatch[1]) as PendingConfirmation;
          setPendingConfirmation(confirmData);
        } catch {}
      }
      const displayFull = stripConfirmMarker(full);
      setMessages([...newMessages, { role: "assistant", content: displayFull }]);

      const actionDetected = ACTION_SUCCESS_PATTERNS.some(p => p.test(full));
      if (actionDetected) {
        qc.invalidateQueries({ queryKey: ["/api/bookings"] });
        qc.invalidateQueries({ queryKey: ["/api/sessions/open"] });
        qc.invalidateQueries({ queryKey: ["/api/coaches"] });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that request. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, isLoading, toast, isDemo, activeTab, mode]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;
    await submitBusinessAgentMessage({ message: content, source: text ? "quick-action" : "typed" });
  }, [input, submitBusinessAgentMessage]);

  const {
    voiceState,
    voiceError,
    transcript,
    isSupported: voiceSupported,
    handleMicClick,
    handleMicPointerDown,
    handleMicPointerUp,
    handleMicPointerLeave,
    stopListening,
  } = useBusinessAgentVoice({
    onSubmit: (text) => {
      stopListening();
      submitBusinessAgentMessage({ message: text, source: voiceState === "push-to-talk" ? "push-to-talk" : "tap-to-dictate" });
    },
    isAgentResponding: isLoading,
    disabled: isDemo,
  });

  useEffect(() => {
    if (isLoading) stopListening();
  }, [isLoading, stopListening]);

  const handleOpsAction = (prompt: string) => {
    setActiveTab("chat");
    setTimeout(() => submitBusinessAgentMessage({ message: prompt, source: "quick-action" }), 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const content = input.trim();
      if (content) submitBusinessAgentMessage({ message: content, source: "enter" });
    }
  };

  const tabs = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    ...(isStaff || isDemo ? [
      { id: "ops", label: isDemo ? "Ops (Demo)" : "Ops", icon: Activity },
      { id: "revenue", label: isDemo ? "Revenue (Demo)" : "Revenue", icon: DollarSign },
    ] : []),
    ...(isStaff ? [
      { id: "settings", label: "Settings", icon: Settings },
    ] : []),
  ] as const;

  const activeRevenueSummary = isDemo ? DEMO_REVENUE_SUMMARY : revenueSummary;
  const activeDigest = isDemo ? DEMO_OPS_DIGEST : digest;
  const activeChurnRisks = isDemo ? DEMO_CHURN_RISKS : churnRisks;
  const activeUpsellOpps = isDemo ? DEMO_UPSELL_OPPS : upsellOpps;
  const activePackageAlerts = isDemo ? DEMO_PACKAGE_ALERTS : packageAlerts;
  const activeWaitlist = isDemo ? DEMO_WAITLIST : waitlist;

  // Normalize revenue — guarantees coachRevenues / topClients / timeBlockRevenues are always arrays
  // even when the API returns a partial or malformed response. This prevents .map() / .length crashes
  // that would blank the entire panel, not just the Revenue tab.
  const safeRevenue = activeRevenueSummary ? {
    ...activeRevenueSummary,
    coachRevenues: activeRevenueSummary.coachRevenues ?? [],
    timeBlockRevenues: activeRevenueSummary.timeBlockRevenues ?? [],
    topClients: activeRevenueSummary.topClients ?? [],
    churnRiskCount: activeRevenueSummary.churnRiskCount ?? 0,
    sessionPackageAlertCount: activeRevenueSummary.sessionPackageAlertCount ?? 0,
    upsellOpportunityCount: activeRevenueSummary.upsellOpportunityCount ?? 0,
    last30dRevenueCents: activeRevenueSummary.last30dRevenueCents ?? 0,
    revenueGrowthPct: activeRevenueSummary.revenueGrowthPct ?? 0,
    mrr: activeRevenueSummary.mrr ?? 0,
    activeSubscribers: activeRevenueSummary.activeSubscribers ?? 0,
    avgRevenuePerSessionCents: activeRevenueSummary.avgRevenuePerSessionCents ?? 0,
    sessionsLast30d: activeRevenueSummary.sessionsLast30d ?? 0,
    b2cRevenueCents: activeRevenueSummary.b2cRevenueCents ?? 0,
    b2bPipelineRevenueCents: activeRevenueSummary.b2bPipelineRevenueCents ?? 0,
    totalPipelineRevenueCents: activeRevenueSummary.totalPipelineRevenueCents ?? 0,
    unclassifiedLeadsCount: activeRevenueSummary.unclassifiedLeadsCount ?? 0,
    revenueSummaryDegraded: activeRevenueSummary.revenueSummaryDegraded ?? false,
    topClientsByScheduledRevenue: activeRevenueSummary.topClientsByScheduledRevenue ?? [],
    topClientsByRedeemedRevenue: activeRevenueSummary.topClientsByRedeemedRevenue ?? [],
  } : null;

  const maxCoachRevenue = safeRevenue && safeRevenue.coachRevenues.length > 0
    ? Math.max(...safeRevenue.coachRevenues.map(c => c.totalRevenueCents), 1)
    : 1;
  const maxTimeBlockRevenue = safeRevenue && safeRevenue.timeBlockRevenues.length > 0
    ? Math.max(...safeRevenue.timeBlockRevenues.map(t => t.totalRevenueCents), 1)
    : 1;

  const highPriorityInsights = activeDigest?.insights.filter(i => i.priority === "high") ?? [];
  const topActions = activeDigest?.insights.slice(0, 3) ?? [];
  const topAgentAlerts = getTopAgentAlerts(activeDigest, safeRevenue ?? undefined);

  function getPrimaryHeadline(): string {
    if (isDemo) return "12 open slots worth ~$840 (Demo)";
    if (!digest && !revenueSummary) return "Ask what needs attention today.";
    if (digest && digest.openSlotsThisWeek > 0) {
      return `${digest.openSlotsThisWeek} open slots worth ~$${digest.estimatedOpenRevenue.toLocaleString()}`;
    }
    if (digest && highPriorityInsights.length > 0) {
      return `${highPriorityInsights.length} high-priority action${highPriorityInsights.length > 1 ? "s" : ""} today`;
    }
    if (digest && digest.inactiveClientsCount > 0) {
      return `${digest.inactiveClientsCount} clients need follow-up`;
    }
    return "Ask what needs attention today.";
  }

  const pageLabel: Record<SourcePage, string> = {
    schedule: "Schedule",
    clients: "Clients",
    revenue: "Revenue",
    settings: "Settings",
    dashboard: "Dashboard",
    media: "Media Library",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="coach-agent-panel">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur px-3 py-2 flex items-center gap-2 shrink-0 z-10">
        {mode === "full" ? (
          <Link href="/scheduling">
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="back-to-scheduling">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
        ) : null}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">
              {mode === "overlay" && context
                ? `Agent · ${pageLabel[context.sourcePage]}`
                : "TrainEfficiency Scheduling Agent"}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block shrink-0" />
              {isStaff ? (
                <span className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium text-[11px]">Revenue Intelligence Active</span>
                  <span className="text-muted-foreground hidden sm:inline">· Goal-Driven Operator</span>
                </span>
              ) : "Book sessions, check availability, manage your schedule"}
            </div>
          </div>
        </div>
        {isDemo && (
          <Badge variant="secondary" className="text-[11px] px-2 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-700 shrink-0" data-testid="demo-mode-badge">
            Demo Mode
          </Badge>
        )}
        {isStaff && (
          <div className="flex items-center gap-1.5 shrink-0">
            {activeWaitlist && activeWaitlist.length > 0 && (
              <Badge variant="secondary" className="text-[11px] px-1.5" data-testid="waitlist-badge">
                <ListOrdered className="h-3 w-3 mr-1" />{activeWaitlist.length}
              </Badge>
            )}
            {topAgentAlerts.length > 0 && (
              <div className="relative" ref={alertDropdownRef}>
                <button
                  aria-label="View high-priority alerts"
                  data-testid="alert-badge-button"
                  onClick={() => setAlertDropdownOpen(prev => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {topAgentAlerts.length}
                </button>

                {alertDropdownOpen && (
                  <div
                    className="absolute right-0 top-full mt-1.5 w-72 sm:w-80 rounded-xl border border-border bg-background shadow-lg z-50 overflow-hidden"
                    data-testid="alert-dropdown"
                  >
                    <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">High-Priority Alerts</span>
                      <button
                        onClick={() => setAlertDropdownOpen(false)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Close alerts"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="divide-y divide-border">
                      {topAgentAlerts.slice(0, 3).map(alert => {
                        const Icon = alert.icon;
                        return (
                          <div
                            key={alert.id}
                            className="px-3 py-2.5 flex items-start gap-2.5"
                            data-testid={`alert-row-${alert.id}`}
                          >
                            <div className={`mt-0.5 shrink-0 ${alert.iconColor}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-1.5">
                                <p className="text-xs font-medium text-foreground leading-tight">{alert.title}</p>
                                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${alert.urgency === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}>
                                  {alert.urgency === "high" ? "Urgent" : "Watch"}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{alert.reason}</p>
                              <button
                                className="mt-1.5 text-[11px] font-medium text-primary hover:underline flex items-center gap-0.5"
                                data-testid={`alert-action-${alert.id}`}
                                onClick={() => {
                                  setAlertDropdownOpen(false);
                                  setActiveTab(alert.actionTab);
                                  setTimeout(() => sendMessage(alert.actionPrompt), 100);
                                }}
                              >
                                {alert.actionLabel} <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {topAgentAlerts.length === 0 && (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                        No high-priority alerts right now.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {mode === "overlay" && onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 ml-1" onClick={onClose} data-testid="agent-overlay-close">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Tabs — horizontally scrollable on mobile */}
      <div className="border-b bg-background shrink-0 overflow-x-auto scrollbar-hide">
        <div className="flex px-2 min-w-max">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as "chat" | "ops" | "revenue" | "settings")} data-testid={`tab-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <tab.icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ===== CHAT TAB ===== */}
        {activeTab === "chat" && (
          <div className="flex flex-col h-full min-h-0">
            <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
              <div className="px-3 py-3">
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-3">
                    {profileLoading ? (
                      <div className="flex flex-col gap-3 pt-2" data-testid="role-loading-skeleton">
                        <Skeleton className="h-24 w-full rounded-2xl" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                      </div>
                    ) : isStaff || isDemo ? (
                      <>
                        {/* Demo Mode sign-in prompt */}
                        {isDemo && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3 flex items-start gap-2.5" data-testid="demo-signin-prompt">
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Demo Mode — Sample Data Only</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Sign in to view your real scheduling and revenue metrics. No real client, coach, or business data is shown here.</p>
                              <Link href="/auth">
                                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400" data-testid="demo-signin-button">
                                  Sign in to get started
                                </Button>
                              </Link>
                            </div>
                          </div>
                        )}

                        {/* Command Center Card — only in full mode or when no context */}
                        {(mode === "full" || !context) && (
                          <div className="rounded-2xl border bg-primary/5 p-4" data-testid="command-center-card">
                            <div className="flex items-center gap-2 mb-3">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" />
                              <div>
                                <div className="text-xs font-semibold text-primary">{isDemo ? "Sample Business Command Center" : "Today's Business Command Center"}</div>
                                <div className="text-[11px] text-muted-foreground">{isDemo ? "Sign in to see your real metrics." : "Your highest-impact actions, ranked by goal and revenue."}</div>
                              </div>
                            </div>
                            {digestLoading ? (
                              <div className="space-y-2">
                                <Skeleton className="h-6 w-3/4 rounded" />
                                <Skeleton className="h-4 w-1/2 rounded" />
                                <Skeleton className="h-9 w-full rounded-lg mt-2" />
                              </div>
                            ) : (
                              <>
                                <h2 className="text-lg font-bold leading-tight mb-1" data-testid="command-center-headline">
                                  {getPrimaryHeadline()}
                                </h2>
                                <Button className="w-full mt-3" data-testid="view-today-actions" onClick={() => sendMessage("What are my highest priority actions today?")}>
                                  View Today's Actions
                                </Button>
                              </>
                            )}
                          </div>
                        )}

                        {/* Overlay compact headline */}
                        {mode === "overlay" && context && (activeDigest || isDemo) && !digestLoading && (
                          <div className="rounded-xl border bg-primary/5 px-3 py-2.5 flex items-center gap-2" data-testid="overlay-headline">
                            <Sparkles className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-medium text-primary leading-tight">{getPrimaryHeadline()}</span>
                          </div>
                        )}

                        {/* Top 3 Actions — only in full mode */}
                        {mode === "full" && (digestLoading || topActions.length > 0) && (
                          <div data-testid="top-actions-section">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                                <Zap className="h-3.5 w-3.5 text-orange-500" />Top Actions Today
                              </h3>
                              {!digestLoading && (
                                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => refetchDigest()}>
                                  <RefreshCw className="h-3 w-3 mr-1" />Refresh
                                </Button>
                              )}
                            </div>
                            {digestLoading ? (
                              <div className="space-y-2">
                                <Skeleton className="h-20 w-full rounded-xl" />
                                <Skeleton className="h-20 w-full rounded-xl" />
                                <Skeleton className="h-20 w-full rounded-xl" />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {topActions.map((insight, i) => (
                                  <TopActionCard key={i} insight={insight} onAction={sendMessage} />
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Quick Actions */}
                        {showQuickActions && (
                          <>
                            {mode === "overlay" && context && (
                              <div className="mb-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5 mb-2">Quick Actions</p>
                              </div>
                            )}
                            {/* Mobile vertical stack */}
                            <div className={`${mode === "full" ? "sm:hidden" : ""} space-y-1.5`} data-testid="mobile-quick-actions">
                              {QUICK_ACTIONS.map(action => (
                                <button key={action.label}
                                  data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                                  className="flex items-center gap-3 w-full p-3 rounded-xl border bg-card hover:bg-accent transition-colors text-left"
                                  onClick={() => sendMessage(action.prompt)}>
                                  <action.icon className={`h-5 w-5 shrink-0 ${action.color}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium">{action.label}</div>
                                    <div className="text-xs text-muted-foreground truncate">{action.desc}</div>
                                  </div>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                </button>
                              ))}
                            </div>

                            {/* Desktop 2x3 grid — only in full mode */}
                            {mode === "full" && (
                              <div className="hidden sm:grid grid-cols-2 gap-2 mt-1 max-w-md" data-testid="desktop-quick-actions">
                                {QUICK_ACTIONS.map(action => (
                                  <button key={action.label}
                                    data-testid={`quick-action-desktop-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                                    className="flex items-center gap-2 p-3 rounded-xl border bg-card hover:bg-accent transition-colors text-left"
                                    onClick={() => sendMessage(action.prompt)}>
                                    <action.icon className={`h-4 w-4 shrink-0 ${action.color}`} />
                                    <span className="text-xs font-medium leading-tight">{action.label}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}

                        {/* Collapsible sections — only in full mode */}
                        {mode === "full" && activeDigest && (
                          <div className="space-y-2 mt-1" data-testid="collapsible-sections">
                            <CollapsibleSection
                              title="Revenue"
                              icon={<DollarSign className="h-4 w-4 text-green-500" />}
                              preview={`~$${activeDigest.estimatedOpenRevenue.toLocaleString()} open revenue this week`}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="text-xs text-muted-foreground">Open slot revenue potential this week</div>
                                <div className="text-2xl font-bold text-green-600">${activeDigest.estimatedOpenRevenue.toLocaleString()}</div>
                                {!isDemo && (
                                  <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Show me our revenue summary")}>
                                    Full Revenue Summary
                                  </Button>
                                )}
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Growth"
                              icon={<TrendingUp className="h-4 w-4 text-orange-500" />}
                              preview={activeDigest.insights.find(i => i.type === "opportunity")?.title ?? "View growth opportunities"}
                            >
                              <div className="space-y-2 pt-1">
                                {activeDigest.insights.filter(i => i.type === "opportunity").length > 0
                                  ? activeDigest.insights.filter(i => i.type === "opportunity").map((ins, i) => (
                                    <div key={i} className="text-xs">
                                      <div className="font-medium">{ins.title}</div>
                                      <div className="text-muted-foreground">{ins.description}</div>
                                    </div>
                                  ))
                                  : <div className="text-xs text-muted-foreground">No growth signals detected yet.</div>
                                }
                                {!isDemo && (
                                  <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("What are our growth opportunities?")}>
                                    Ask Agent
                                  </Button>
                                )}
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Retention Risks"
                              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                              preview={activeDigest.inactiveClientsCount > 0 ? `${activeDigest.inactiveClientsCount} inactive clients` : "No at-risk clients detected"}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="text-xs text-muted-foreground">
                                  {activeDigest.inactiveClientsCount > 0
                                    ? `${activeDigest.inactiveClientsCount} clients have not booked recently.`
                                    : "Retention looks healthy — no churn signals detected."}
                                </div>
                                {!isDemo && (
                                  <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Who are our at-risk clients?")}>
                                    View At-Risk Clients
                                  </Button>
                                )}
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Schedule"
                              icon={<Calendar className="h-4 w-4 text-blue-500" />}
                              preview={`${activeDigest.totalBookingsThisWeek} bookings · ${activeDigest.openSlotsThisWeek} open slots`}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="rounded-lg border p-2 text-center">
                                    <div className="text-lg font-bold">{activeDigest.totalBookingsThisWeek}</div>
                                    <div className="text-[11px] text-muted-foreground">Bookings</div>
                                  </div>
                                  <div className="rounded-lg border p-2 text-center">
                                    <div className="text-lg font-bold text-orange-500">{activeDigest.openSlotsThisWeek}</div>
                                    <div className="text-[11px] text-muted-foreground">Open Slots</div>
                                  </div>
                                </div>
                                {!isDemo && (
                                  <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Show me this week's full schedule")}>
                                    Full Schedule
                                  </Button>
                                )}
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Ops Summary"
                              icon={<Activity className="h-4 w-4 text-purple-500" />}
                              preview={activeDigest.insights.length > 0 ? `${activeDigest.insights.length} insight${activeDigest.insights.length > 1 ? "s" : ""} available` : "Operations on track"}
                            >
                              <div className="space-y-2 pt-1">
                                {activeDigest.insights.slice(0, 2).map((ins, i) => (
                                  <div key={i} className="text-xs">
                                    <div className="font-medium">{ins.title}</div>
                                    <div className="text-muted-foreground leading-relaxed">{ins.description}</div>
                                  </div>
                                ))}
                                {!isDemo && (
                                  <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Give me an operations summary for this week")}>
                                    Full Ops Summary
                                  </Button>
                                )}
                              </div>
                            </CollapsibleSection>

                            {/* Team Training Pipeline Banner */}
                            {isStaff && !isDemo && (
                              <CollapsibleSection
                                title="Team Training Pipeline"
                                icon={<Building2 className="h-4 w-4 text-teal-500" />}
                                preview={
                                  teamPipelineLoading
                                    ? "Loading pipeline..."
                                    : teamPipeline && teamPipeline.totalProspects > 0
                                      ? `${teamPipeline.activePipelineCount} active leads · ~$${(teamPipeline.estimatedPipelineValueCents / 100).toLocaleString()} potential`
                                      : "No team leads yet — ask me to find some"
                                }
                              >
                                <div className="space-y-3 pt-1">
                                  {teamPipelineLoading ? (
                                    <Skeleton className="h-12 w-full rounded" />
                                  ) : teamPipeline && teamPipeline.totalProspects > 0 ? (
                                    <>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="rounded-lg border p-2 text-center">
                                          <div className="text-lg font-bold text-teal-600">{teamPipeline.activePipelineCount}</div>
                                          <div className="text-[11px] text-muted-foreground">Active Leads</div>
                                        </div>
                                        <div className="rounded-lg border p-2 text-center">
                                          <div className="text-lg font-bold text-green-600">${(teamPipeline.estimatedPipelineValueCents / 100).toLocaleString()}</div>
                                          <div className="text-[11px] text-muted-foreground">Est. Potential*</div>
                                        </div>
                                      </div>
                                      {(teamPipeline.repliesNeedingFollowUp > 0 || teamPipeline.draftsAwaitingApproval > 0) && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {teamPipeline.repliesNeedingFollowUp > 0 && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 font-medium">
                                              {teamPipeline.repliesNeedingFollowUp} replied
                                            </span>
                                          )}
                                          {teamPipeline.draftsAwaitingApproval > 0 && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400 font-medium">
                                              {teamPipeline.draftsAwaitingApproval} draft{teamPipeline.draftsAwaitingApproval > 1 ? "s" : ""} pending
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <p className="text-[10px] text-muted-foreground italic">*Estimated potential — not booked revenue</p>
                                    </>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">No team prospects yet. Ask me to find local teams to pitch.</div>
                                  )}
                                  <div className="flex gap-1.5">
                                    <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => sendMessage("Show team revenue pipeline")} data-testid="team-pipeline-summary-btn">
                                      View Pipeline
                                    </Button>
                                    <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => sendMessage("Find me some team training leads near us")} data-testid="find-team-leads-btn">
                                      Find Leads
                                    </Button>
                                  </div>
                                </div>
                              </CollapsibleSection>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      /* Client empty state */
                      <div className="flex flex-col items-center gap-5 py-4">
                        <div className="text-center space-y-1">
                          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                            <Sparkles className="h-6 w-6 text-primary" />
                          </div>
                          <h3 className="font-semibold text-base">Scheduling Assistant</h3>
                          <p className="text-sm text-muted-foreground max-w-xs">Book sessions, check availability, or ask anything about your schedule.</p>
                        </div>
                        {showQuickActions && (
                          <>
                            <div className="w-full space-y-1.5">
                              {QUICK_ACTIONS.map(action => (
                                <button key={action.label}
                                  data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                                  className="flex items-center gap-3 w-full p-3 rounded-xl border bg-card hover:bg-accent transition-colors text-left"
                                  onClick={() => sendMessage(action.prompt)}>
                                  <action.icon className={`h-5 w-5 shrink-0 ${action.color}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium">{action.label}</div>
                                    <div className="text-xs text-muted-foreground truncate">{action.desc}</div>
                                  </div>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Messages */}
                <div className="space-y-4 mt-2">
                  {messages.map((message, i) => (
                    <div key={i} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`} data-testid={`message-${message.role}-${i}`}>
                      {message.role === "assistant" && (
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                        {message.role === "assistant" ? <div className="space-y-1">{renderMarkdown(message.content)}</div> : <p className="text-sm leading-relaxed">{message.content}</p>}
                      </div>
                      {message.role === "user" && <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1"><User className="h-3.5 w-3.5" /></div>}
                    </div>
                  ))}

                  {/* Confirmation card — shown after assistant requests confirmation */}
                  {pendingConfirmation && !isLoading && (
                    <div className="flex gap-3 justify-start" data-testid="confirmation-card">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-start gap-2 mb-3">
                          <CheckCircle2 className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="min-w-0 w-full">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-0.5 uppercase tracking-wide">
                              {pendingConfirmation.actionType === "send_drafted_outreach_sms" ? "Confirm SMS" : "Confirm Action"}
                            </p>
                            <p className="text-sm text-foreground leading-relaxed">{pendingConfirmation.summary}</p>

                            {/* SMS-specific preview block */}
                            {pendingConfirmation.actionType === "send_drafted_outreach_sms" && (
                              <div className="mt-2 space-y-1.5">
                                {pendingConfirmation.phone && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <MessageSquare className="h-3 w-3 shrink-0" />
                                    <span>To: <span className="font-medium text-foreground">{pendingConfirmation.recipient}</span> · {pendingConfirmation.phone}</span>
                                  </div>
                                )}
                                {pendingConfirmation.smsBody && (
                                  <div className="mt-1.5 bg-white dark:bg-black/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                                    <p className="text-xs text-muted-foreground mb-0.5 font-medium">Message preview</p>
                                    <p className="text-sm text-foreground leading-relaxed">{pendingConfirmation.smsBody}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Email-specific preview block */}
                            {(pendingConfirmation.actionType === "send_drafted_outreach_email" || pendingConfirmation.actionType === "send_team_outreach_email") && (
                              <div className="mt-2 space-y-1.5">
                                {pendingConfirmation.recipient && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <MessageSquare className="h-3 w-3 shrink-0" />
                                    <span>To: <span className="font-medium text-foreground">{pendingConfirmation.recipient}</span></span>
                                  </div>
                                )}
                                {pendingConfirmation.emailSubject && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="font-medium">Subject:</span>
                                    <span className="text-foreground">{pendingConfirmation.emailSubject}</span>
                                  </div>
                                )}
                                {pendingConfirmation.emailBody && (
                                  <div className="mt-1.5 bg-white dark:bg-black/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                                    <p className="text-xs text-muted-foreground mb-0.5 font-medium">Email preview</p>
                                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line line-clamp-4">{pendingConfirmation.emailBody}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {pendingConfirmation.expiresAt && (
                              <p className="text-xs text-muted-foreground mt-1.5">
                                Expires at {new Date(pendingConfirmation.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            data-testid="button-confirm-action"
                            disabled={isConfirming}
                            onClick={async () => {
                              const id = pendingConfirmation.pendingActionId;
                              setPendingConfirmation(null);
                              setIsConfirming(true);
                              try {
                                const resp = await fetch(`/api/agent/pending-actions/${id}/confirm`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                                });
                                const data = await resp.json();
                                if (!resp.ok) {
                                  const errMsg = data.error || data.result?.error || "Action failed.";
                                  setMessages(prev => [...prev, { role: "assistant" as const, content: `Could not complete: ${errMsg}` }]);
                                  toast({ title: "Action failed", description: errMsg, variant: "destructive" });
                                } else {
                                  const r = data.result ?? {};
                                  const successText = r.message
                                    ? r.message
                                    : r.sentTo
                                    ? `Sent to ${r.sentTo}.`
                                    : "Done! Action completed successfully.";
                                  setMessages(prev => [...prev, { role: "assistant" as const, content: successText }]);
                                  toast({ title: "Done", description: successText });
                                  qc.invalidateQueries({ queryKey: ["/api/bookings"] });
                                  qc.invalidateQueries({ queryKey: ["/api/sessions/open"] });
                                  qc.invalidateQueries({ queryKey: ["/api/coaches"] });
                                }
                              } catch (err: any) {
                                const msg = err?.message || "Network error.";
                                setMessages(prev => [...prev, { role: "assistant" as const, content: `Error: ${msg}` }]);
                                toast({ title: "Error", description: msg, variant: "destructive" });
                              } finally {
                                setIsConfirming(false);
                              }
                            }}
                          >
                            {isConfirming ? (
                              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Sending…</>
                            ) : pendingConfirmation.actionType === "send_drafted_outreach_sms" ? "Send SMS"
                              : pendingConfirmation.actionType === "send_drafted_outreach_email" ? "Send Email"
                              : pendingConfirmation.actionType === "send_team_outreach_email" ? "Send Email"
                              : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid="button-edit-message"
                            onClick={() => {
                              setPendingConfirmation(null);
                              if (pendingConfirmation.actionType === "send_drafted_outreach_sms") {
                                sendMessage("Edit the SMS message before sending");
                              }
                            }}
                            style={{ display: pendingConfirmation.actionType === "send_drafted_outreach_sms" ? undefined : "none" }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            data-testid="button-cancel-action"
                            disabled={isConfirming}
                            onClick={async () => {
                              const id = pendingConfirmation.pendingActionId;
                              setPendingConfirmation(null);
                              try {
                                await fetch(`/api/agent/pending-actions/${id}/cancel`, {
                                  method: "POST",
                                  headers: getAuthHeaders(),
                                });
                              } catch {}
                              setMessages(prev => [...prev, { role: "assistant" as const, content: "Action cancelled." }]);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isLoading && (
                    <div className="flex gap-3 justify-start">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1"><Bot className="h-3.5 w-3.5 text-primary" /></div>
                      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                        <div className="flex gap-1 items-center h-5">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="h-4" />
              </div>
            </div>

            {/* Sticky chat input at the bottom */}
            <div className="border-t bg-background px-3 py-2 shrink-0" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
              {/* Voice status strip */}
              {!isDemo && (voiceState === "listening" || voiceState === "push-to-talk" || voiceState === "error") && (
                <div
                  className={`mb-1.5 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 transition-all ${
                    voiceState === "error"
                      ? "bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-400"
                      : "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-700 dark:text-green-400"
                  }`}
                  data-testid="voice-status-strip"
                >
                  {voiceState === "listening" && (
                    <>
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                      <span className="font-medium">Listening…</span>
                      {transcript && <span className="truncate text-green-600 dark:text-green-300 ml-1 flex-1">{transcript}</span>}
                    </>
                  )}
                  {voiceState === "push-to-talk" && (
                    <>
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                      <span className="font-medium">Release to command</span>
                      {transcript && <span className="truncate text-green-600 dark:text-green-300 ml-1 flex-1">{transcript}</span>}
                    </>
                  )}
                  {voiceState === "error" && (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{voiceError ?? "Voice error"}</span>
                    </>
                  )}
                </div>
              )}

              {isDemo ? (
                <div className="flex items-center gap-2 py-1" data-testid="demo-chat-blocked">
                  <div className="flex-1 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    Sign in to use the AI scheduling assistant
                  </div>
                  <Link href="/auth">
                    <Button size="sm" className="h-8 text-xs shrink-0" data-testid="demo-chat-signin">Sign In</Button>
                  </Link>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <Input
                    data-testid="chat-input"
                    placeholder={
                      voiceState === "listening"
                        ? "Listening…"
                        : voiceState === "push-to-talk"
                        ? "Release to command"
                        : isStaff
                        ? "Ask about revenue, retention, schedule, or growth..."
                        : "Ask about your schedule or bookings..."
                    }
                    value={voiceState === "listening" || voiceState === "push-to-talk" ? transcript : input}
                    onChange={e => {
                      if (voiceState === "idle" || voiceState === "error") setInput(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    className="flex-1"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  {voiceSupported && (
                    <Button
                      data-testid="voice-mic-button"
                      size="icon"
                      variant="ghost"
                      className={`shrink-0 transition-all select-none touch-none ${
                        voiceState === "push-to-talk"
                          ? "text-green-600 shadow-[0_0_0_3px_rgba(34,197,94,0.35)] bg-green-50 dark:bg-green-950/40"
                          : voiceState === "listening"
                          ? "text-green-500 shadow-[0_0_0_2px_rgba(34,197,94,0.25)] bg-green-50 dark:bg-green-950/30"
                          : voiceState === "error"
                          ? "text-amber-500"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      disabled={isLoading}
                      onClick={handleMicClick}
                      onPointerDown={handleMicPointerDown}
                      onPointerUp={handleMicPointerUp}
                      onPointerLeave={handleMicPointerLeave}
                      aria-label={
                        voiceState === "listening"
                          ? "Stop listening"
                          : voiceState === "push-to-talk"
                          ? "Release to send"
                          : "Start voice input"
                      }
                    >
                      <Mic className={`h-4 w-4 ${voiceState === "listening" || voiceState === "push-to-talk" ? "animate-pulse" : ""}`} />
                    </Button>
                  )}
                  <Button
                    data-testid="send-message"
                    onClick={() => {
                      const content = input.trim();
                      if (content) submitBusinessAgentMessage({ message: content, source: "typed" });
                    }}
                    disabled={isLoading || (!input.trim() && voiceState === "idle")}
                    size="icon"
                    className="shrink-0"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== OPERATIONS TAB ===== */}
        {activeTab === "ops" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 max-w-2xl mx-auto">
              {isDemo && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-2" data-testid="ops-demo-banner">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Demo Mode </span>
                    <span className="text-xs text-muted-foreground">— Sample data only. Sign in to view your real operations metrics.</span>
                  </div>
                </div>
              )}
              {digestLoading && !isDemo ? (
                <div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /></div>
              ) : activeDigest ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Booked This Week", value: activeDigest.totalBookingsThisWeek, sub: activeDigest.weekRange, id: "metric-bookings", color: "" },
                      { label: "Open Slots", value: activeDigest.openSlotsThisWeek, sub: "this week", id: "metric-open-slots", color: "text-orange-500" },
                      { label: "Open Revenue Est.", value: `$${activeDigest.estimatedOpenRevenue.toLocaleString()}`, sub: "fillable", id: "metric-revenue", color: "text-green-600" },
                      { label: "Waitlist", value: activeDigest.waitlistCount, sub: "clients waiting", id: "metric-waitlist", color: "text-blue-500" },
                    ].map(m => (
                      <Card key={m.id} className="border-0 shadow-sm" data-testid={m.id}>
                        <CardContent className="p-3">
                          <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                          <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                          <div className="text-xs text-muted-foreground">{m.sub}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {activeDigest.insights.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Zap className="h-4 w-4 text-orange-500" />Insights & Actions</h3>
                        {!isDemo && (
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => refetchDigest()} data-testid="refresh-digest">
                            <RefreshCw className="h-3 w-3 mr-1" />Refresh
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {activeDigest.insights.map((insight, i) => (
                          <InsightCard key={i} insight={insight} onAction={isDemo ? () => {} : handleOpsAction} />
                        ))}
                      </div>
                    </div>
                  )}
                  {activeDigest.coaches.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-blue-500" />Coach Utilization</h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          {activeDigest.coaches.map(c => <UtilizationBar key={c.coachId} coach={c} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                  {activeDigest.recentCancellations.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><XCircle className="h-4 w-4 text-red-400" />Recent Cancellations</h3>
                      <div className="space-y-2">
                        {activeDigest.recentCancellations.map(c => (
                          <Card key={c.id} data-testid={`cancellation-${c.id}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{c.clientName}</div>
                                <div className="text-xs text-muted-foreground">{c.coachName} · {c.service} · {new Date(c.time).toLocaleDateString()}</div>
                              </div>
                              <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" data-testid={`backfill-${c.id}`}
                                onClick={() => handleOpsAction(`Help me backfill the cancelled session from ${c.clientName} with ${c.coachName} for ${c.service}`)}>
                                <RefreshCw className="h-3 w-3 mr-1" />Backfill
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><ListOrdered className="h-4 w-4 text-blue-500" />Waitlist ({activeWaitlist?.length ?? 0})</h3>
                      {!isDemo && (
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => refetchWaitlist()} data-testid="refresh-waitlist">
                          <RefreshCw className="h-3 w-3 mr-1" />Refresh
                        </Button>
                      )}
                    </div>
                    {waitlistLoading && !isDemo ? <Skeleton className="h-16 w-full rounded-xl" /> : !activeWaitlist || activeWaitlist.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />No clients on the waitlist</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {activeWaitlist.map(entry => (
                          <Card key={entry.id} data-testid={`waitlist-entry-${entry.id}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{entry.client ? `${entry.client.firstName} ${entry.client.lastName}` : "Unknown"}</div>
                                {entry.sessionType && <div className="text-xs text-muted-foreground">{entry.sessionType}</div>}
                                {entry.notes && <div className="text-xs text-muted-foreground italic">{entry.notes}</div>}
                              </div>
                              {!isDemo && (
                                <div className="flex gap-1.5 shrink-0">
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid={`book-waitlist-${entry.id}`}
                                    onClick={() => handleOpsAction(`Book a session for ${entry.client ? `${entry.client.firstName} ${entry.client.lastName}` : "this client"} from the waitlist`)}>
                                    <Calendar className="h-3 w-3 mr-1" />Book
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`remove-waitlist-${entry.id}`}
                                    onClick={() => removeFromWaitlist.mutate(entry.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                  {actionLog && actionLog.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Activity className="h-4 w-4 text-purple-500" />Recent Agent Actions</h3>
                      <div className="space-y-2">
                        {actionLog.slice(0, 10).map((action: any, i: number) => (
                          <Card key={i} data-testid={`action-log-${i}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">{action.actionType}</div>
                                  {action.description && <div className="text-xs text-muted-foreground">{action.description}</div>}
                                </div>
                                <Badge variant={action.status === "completed" ? "default" : action.status === "failed" ? "destructive" : "secondary"} className="text-[10px] h-4 shrink-0">
                                  {action.status}
                                </Badge>
                              </div>
                              {action.createdAt && <div className="text-xs text-muted-foreground mt-1">{new Date(action.createdAt).toLocaleString()}</div>}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Team Growth section */}
                  {!isDemo && isStaff && (
                    <div data-testid="team-growth-section">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-teal-500" />Team Growth
                        </h3>
                        <Link href="/admin/team-training">
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-teal-600 dark:text-teal-400" data-testid="view-team-leads-link">
                            View Leads <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                      {teamPipelineLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-20 w-full rounded-xl" />
                          <Skeleton className="h-16 w-full rounded-xl" />
                        </div>
                      ) : teamPipeline ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                              { label: "Total Prospects", value: teamPipeline.totalProspects, color: "", id: "team-metric-total" },
                              { label: "High Confidence", value: teamPipeline.highConfidenceLeads, color: "text-teal-600", id: "team-metric-high" },
                              { label: "Drafts Pending", value: teamPipeline.draftsAwaitingApproval, color: "text-amber-500", id: "team-metric-drafts" },
                              { label: "Replied", value: teamPipeline.repliesNeedingFollowUp, color: "text-green-600", id: "team-metric-replies" },
                            ].map(m => (
                              <Card key={m.id} className="border-0 shadow-sm" data-testid={m.id}>
                                <CardContent className="p-3">
                                  <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                                  <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                          <Card className="border border-teal-200/60 bg-teal-50/40 dark:border-teal-800/40 dark:bg-teal-950/10">
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-teal-700 dark:text-teal-400">Estimated Pipeline Potential</div>
                                <div className="text-xl font-bold text-teal-600 dark:text-teal-400">${(teamPipeline.estimatedPipelineValueCents / 100).toLocaleString()}</div>
                                <div className="text-[10px] text-muted-foreground italic">Estimated value only — not booked revenue</div>
                              </div>
                              <Button size="sm" variant="outline" className="shrink-0 h-8 text-xs border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-400" data-testid="ops-team-pipeline-btn"
                                onClick={() => { setActiveTab("chat"); sendMessage("Show team revenue pipeline"); }}>
                                Ask Agent
                              </Button>
                            </CardContent>
                          </Card>
                          {teamPipeline.repliesNeedingFollowUp > 0 && (
                            <Card className="border border-green-200/60 bg-green-50/40 dark:border-green-800/40 dark:bg-green-950/10">
                              <CardContent className="p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                    <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                                      {teamPipeline.repliesNeedingFollowUp} prospect{teamPipeline.repliesNeedingFollowUp > 1 ? "s" : ""} replied
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">Schedule a consult call to convert</div>
                                </div>
                                <Button size="sm" variant="outline" className="shrink-0 h-8 text-xs" data-testid="ops-follow-up-btn"
                                  onClick={() => { setActiveTab("chat"); sendMessage("Who should I follow up with today? Show me replied team prospects first."); }}>
                                  Follow Up
                                </Button>
                              </CardContent>
                            </Card>
                          )}
                          {teamPipeline.draftsAwaitingApproval > 0 && (
                            <Card className="border border-amber-200/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/10">
                              <CardContent className="p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <Mail className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                                      {teamPipeline.draftsAwaitingApproval} outreach draft{teamPipeline.draftsAwaitingApproval > 1 ? "s" : ""} awaiting approval
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">Review and send to advance pipeline</div>
                                </div>
                                <Button size="sm" variant="outline" className="shrink-0 h-8 text-xs" data-testid="ops-review-drafts-btn"
                                  onClick={() => { setActiveTab("chat"); sendMessage("Review pending team outreach drafts"); }}>
                                  Review
                                </Button>
                              </CardContent>
                            </Card>
                          )}
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" data-testid="ops-find-team-leads-btn"
                              onClick={() => { setActiveTab("chat"); sendMessage("Find me some team training leads near us"); }}>
                              <Users2 className="h-3 w-3 mr-1" />Find Leads
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" data-testid="ops-draft-outreach-btn"
                              onClick={() => { setActiveTab("chat"); sendMessage("Draft team outreach for our top prospects"); }}>
                              <Mail className="h-3 w-3 mr-1" />Draft Outreach
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Card>
                          <CardContent className="p-4 text-center">
                            <Building2 className="h-6 w-6 mx-auto mb-2 text-teal-400 opacity-60" />
                            <p className="text-sm text-muted-foreground mb-2">No team training prospects yet.</p>
                            <Button size="sm" className="h-8 text-xs" onClick={() => { setActiveTab("chat"); sendMessage("Find me some team training leads near us"); }} data-testid="ops-start-team-leads-btn">
                              Find Team Leads
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No ops data available yet.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ===== REVENUE TAB ===== */}
        {activeTab === "revenue" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 max-w-2xl mx-auto">
              {isDemo && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-2" data-testid="revenue-demo-banner">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Demo Mode </span>
                    <span className="text-xs text-muted-foreground">— Sample data only. Sign in to view your real revenue metrics.</span>
                  </div>
                </div>
              )}
              {revenueLoading && !isDemo ? (
                <div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>
              ) : revenueError ? (
                <Card data-testid="revenue-error-state">
                  <CardContent className="p-6 text-center space-y-2">
                    <AlertTriangle className="h-6 w-6 text-orange-400 mx-auto" />
                    <p className="text-sm font-medium">Revenue data unavailable</p>
                    <p className="text-xs text-muted-foreground">Please refresh or check server logs.</p>
                    <button className="text-xs text-primary underline mt-1" onClick={() => refetchRevenue()}>Try again</button>
                  </CardContent>
                </Card>
              ) : safeRevenue ? (
                <>
                  {import.meta.env.DEV && safeRevenue.revenueSummaryDegraded && (
                    <div className="rounded-lg border border-yellow-300 bg-yellow-50/70 dark:border-yellow-700 dark:bg-yellow-950/20 px-3 py-2 flex items-start gap-2" data-testid="revenue-degraded-warning">
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-yellow-700 dark:text-yellow-400">
                        <span className="font-semibold">Dev:</span> Revenue summary loaded in fallback mode — compute failed. Check server logs for the full error.
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Last 30d Revenue", value: `$${(safeRevenue.last30dRevenueCents / 100).toLocaleString()}`, sub: safeRevenue.revenueGrowthPct >= 0 ? `+${safeRevenue.revenueGrowthPct.toFixed(1)}% vs prior 30d` : `${safeRevenue.revenueGrowthPct.toFixed(1)}% vs prior 30d`, id: "rev-last30", color: "text-green-600", subColor: safeRevenue.revenueGrowthPct >= 0 ? "text-green-500" : "text-red-500" },
                      { label: "MRR", value: `$${(safeRevenue.mrr / 100).toLocaleString()}`, sub: `${safeRevenue.activeSubscribers} active subscribers`, id: "rev-mrr", color: "", subColor: "" },
                      { label: "Avg Session Value", value: `$${(safeRevenue.avgRevenuePerSessionCents / 100).toFixed(0)}`, sub: `${safeRevenue.sessionsLast30d} sessions last 30d`, id: "rev-session-val", color: "", subColor: "" },
                    ].map(m => (
                      <Card key={m.id} className="border-0 shadow-sm" data-testid={m.id}>
                        <CardContent className="p-3">
                          <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                          <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                          <div className={`text-xs ${m.subColor || "text-muted-foreground"}`}>{m.sub}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {(safeRevenue.b2bPipelineRevenueCents > 0 || safeRevenue.totalPipelineRevenueCents > 0) && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-blue-500" />Pipeline Breakdown</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <Card className="border-0 shadow-sm" data-testid="rev-b2c">
                          <CardContent className="p-3">
                            <div className="text-xs text-muted-foreground mb-1">B2C Revenue (30d)</div>
                            <div className="text-xl font-bold text-green-600">${(safeRevenue.b2cRevenueCents / 100).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">Individual sessions</div>
                          </CardContent>
                        </Card>
                        <Card className="border-0 shadow-sm" data-testid="rev-b2b-pipeline">
                          <CardContent className="p-3">
                            <div className="text-xs text-muted-foreground mb-1">B2B Pipeline Value</div>
                            <div className="text-xl font-bold text-blue-600">${(safeRevenue.b2bPipelineRevenueCents / 100).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">Team training prospects</div>
                          </CardContent>
                        </Card>
                      </div>
                      {safeRevenue.unclassifiedLeadsCount > 0 && (
                        <p className="text-xs text-muted-foreground mt-1.5" data-testid="rev-unclassified-leads">
                          {safeRevenue.unclassifiedLeadsCount} unclassified lead{safeRevenue.unclassifiedLeadsCount !== 1 ? "s" : ""} — pipeline type not yet set
                        </p>
                      )}
                    </div>
                  )}

                  {(safeRevenue.churnRiskCount > 0 || safeRevenue.sessionPackageAlertCount > 0 || safeRevenue.upsellOpportunityCount > 0) && (
                    <>
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-orange-500" />Revenue Alerts</h3>
                      <div className="flex flex-wrap gap-2">
                        {safeRevenue.churnRiskCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 hover:opacity-80 transition-opacity"
                            data-testid="churn-pill" onClick={() => document.getElementById("churn-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <AlertTriangle className="h-3 w-3" />{safeRevenue.churnRiskCount} churn risk{safeRevenue.churnRiskCount > 1 ? "s" : ""}
                          </button>
                        )}
                        {safeRevenue.sessionPackageAlertCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400 hover:opacity-80 transition-opacity"
                            data-testid="packages-pill" onClick={() => document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <Package className="h-3 w-3" />{safeRevenue.sessionPackageAlertCount} package alert{safeRevenue.sessionPackageAlertCount > 1 ? "s" : ""}
                          </button>
                        )}
                        {safeRevenue.upsellOpportunityCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 hover:opacity-80 transition-opacity"
                            data-testid="upsell-pill" onClick={() => document.getElementById("upsell-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <TrendingUp className="h-3 w-3" />{safeRevenue.upsellOpportunityCount} upsell opportunity{safeRevenue.upsellOpportunityCount > 1 ? "s" : ""}
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {safeRevenue.coachRevenues.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-green-500" />Revenue by Coach</h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          {safeRevenue.coachRevenues.map(c => <CoachBar key={c.coachId} coach={c} maxRevenue={maxCoachRevenue} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  <div>
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Users className="h-4 w-4 text-blue-400" />Top Clients by Scheduled Revenue</h3>
                    {safeRevenue.topClientsByScheduledRevenue.length > 0 ? (
                      <div className="space-y-2">
                        {safeRevenue.topClientsByScheduledRevenue.map((c, i) => (
                          <Card key={c.clientId} data-testid={`top-client-scheduled-${i}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                                <span className="text-sm font-medium truncate">{c.clientName}</span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-muted-foreground">{c.scheduledSessionCount} scheduled</span>
                                <span className="text-sm font-semibold text-blue-500">${(c.scheduledRevenueCents / 100).toLocaleString()}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Card><CardContent className="p-3 text-xs text-muted-foreground">No upcoming scheduled sessions.</CardContent></Card>
                    )}
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Users className="h-4 w-4 text-green-500" />Top Clients by Redeemed Revenue</h3>
                    {safeRevenue.topClientsByRedeemedRevenue.length > 0 ? (
                      <div className="space-y-2">
                        {safeRevenue.topClientsByRedeemedRevenue.map((c, i) => (
                          <Card key={c.clientId} data-testid={`top-client-redeemed-${i}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                                <span className="text-sm font-medium truncate">{c.clientName}</span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-muted-foreground">{c.redeemedSessionCount} redeemed</span>
                                <span className="text-sm font-semibold text-green-600">${(c.redeemedRevenueCents / 100).toLocaleString()}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Card data-testid="no-redeemed-sessions"><CardContent className="p-3 text-xs text-muted-foreground">No redeemed sessions yet.</CardContent></Card>
                    )}
                  </div>

                  {safeRevenue.timeBlockRevenues.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><Clock className="h-4 w-4 text-purple-500" />Revenue by Time Block (Last 30d)</h3>
                      {safeRevenue.timezone && (
                        <p className="text-xs text-muted-foreground mb-2" data-testid="time-block-timezone-label">Times shown in org timezone: {safeRevenue.timezone}</p>
                      )}
                      <Card>
                        <CardContent className="p-4 space-y-2">
                          {safeRevenue.timeBlockRevenues
                            .sort((a, b) => a.hour - b.hour)
                            .map(tb => <TimeBlockBar key={tb.hour} block={tb} maxRevenue={maxTimeBlockRevenue} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  <div id="churn-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Retention Risks</h3>
                    {churnLoading && !isDemo ? <Skeleton className="h-20 w-full rounded-xl" /> : !activeChurnRisks || activeChurnRisks.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />No clients flagged as at-risk — great retention!</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {activeChurnRisks.slice(0, 6).map(risk => (
                          <Card key={risk.clientId} data-testid={`churn-risk-${risk.clientId}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium">{risk.clientName}</span>
                                    <Badge variant={risk.riskLevel === "high" ? "destructive" : "secondary"} className="text-[10px] h-4">{risk.riskLevel} risk</Badge>
                                  </div>
                                  <div className="space-y-0.5">
                                    {risk.signals.map((s, i) => <p key={i} className="text-xs text-muted-foreground">• {s}</p>)}
                                  </div>
                                  <p className="text-xs text-primary mt-1.5 font-medium">{risk.suggestedAction}</p>
                                </div>
                                {!isDemo && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" data-testid={`churn-action-${risk.clientId}`}
                                    onClick={() => handleOpsAction(risk.suggestedAction)}>
                                    <MessageSquare className="h-3 w-3 mr-1" />Ask agent
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div id="packages-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Package className="h-4 w-4 text-orange-500" />Session Package Alerts</h3>
                    {packagesLoading && !isDemo ? <Skeleton className="h-16 w-full rounded-xl" /> : !activePackageAlerts || activePackageAlerts.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />All clients have healthy session balances</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {activePackageAlerts.map(alert => (
                          <Card key={alert.clientId} data-testid={`package-alert-${alert.clientId}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-sm font-medium">{alert.clientName}</span>
                                  <Badge variant={alert.urgency === "critical" ? "destructive" : "secondary"} className="text-[10px] h-4">{alert.urgency}</Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {alert.planName} · {alert.sessionsRemaining} session{alert.sessionsRemaining === 1 ? "" : "s"} remaining
                                  {alert.cancelAtPeriodEnd && " · Cancelling at period end"}
                                </div>
                              </div>
                              {!isDemo && (
                                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" data-testid={`package-action-${alert.clientId}`}
                                  onClick={() => handleOpsAction(`Help me reach out to ${alert.clientName} about renewing their session package (${alert.sessionsRemaining} sessions remaining)`)}>
                                  <MessageSquare className="h-3 w-3 mr-1" />Reach out
                                </Button>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div id="upsell-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-green-500" />Upsell Opportunities</h3>
                    {upsellLoading && !isDemo ? <Skeleton className="h-16 w-full rounded-xl" /> : !activeUpsellOpps || activeUpsellOpps.length === 0 ? (
                      <Card><CardContent className="p-4 text-sm text-muted-foreground">No upsell opportunities detected from current booking patterns.</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {activeUpsellOpps.map(opp => (
                          <Card key={`${opp.clientId}-${opp.opportunity}`} data-testid={`upsell-${opp.clientId}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium">{opp.clientName}</span>
                                    <Badge variant={opp.priority === "high" ? "default" : "secondary"} className="text-[10px] h-4">{opp.priority}</Badge>
                                    <span className="text-xs font-semibold text-green-600 ml-auto">+${(opp.estimatedRevenueLiftCents / 100).toFixed(0)}/mo</span>
                                  </div>
                                  <p className="text-xs font-medium text-foreground/80">{opp.opportunity}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opp.reasoning}</p>
                                </div>
                                {!isDemo && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0 mt-0.5" data-testid={`upsell-action-${opp.clientId}`}
                                    onClick={() => handleOpsAction(opp.reasoning)}>
                                    <MessageSquare className="h-3 w-3 mr-1" />Ask agent
                                  </Button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Team Training Pipeline section in Revenue tab */}
                  {!isDemo && isStaff && (
                    <div data-testid="revenue-team-pipeline-section">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-teal-500" />Team Training Pipeline
                          <Badge variant="secondary" className="text-[10px] ml-1 px-1.5 bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-teal-200 dark:border-teal-800">B2B</Badge>
                        </h3>
                        <Link href="/admin/team-training">
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-teal-600 dark:text-teal-400" data-testid="revenue-view-team-leads-link">
                            Manage <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                      {teamPipelineLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-20 w-full rounded-xl" />
                        </div>
                      ) : teamPipeline ? (
                        <div className="space-y-3">
                          <Card className="border border-teal-200/60 dark:border-teal-800/40">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Estimated Pipeline Value</div>
                                  <div className="text-3xl font-bold text-teal-600 dark:text-teal-400">
                                    ${(teamPipeline.estimatedPipelineValueCents / 100).toLocaleString()}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground italic mt-0.5">Potential only — not booked revenue</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-muted-foreground mb-0.5">{teamPipeline.activePipelineCount} active leads</div>
                                  <div className="text-xs text-muted-foreground">{teamPipeline.highConfidenceLeads} high confidence</div>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-lg border bg-background p-2 text-center">
                                  <div className="text-base font-bold">{teamPipeline.newLeads}</div>
                                  <div className="text-[10px] text-muted-foreground">New</div>
                                </div>
                                <div className="rounded-lg border bg-background p-2 text-center">
                                  <div className={`text-base font-bold ${teamPipeline.draftsAwaitingApproval > 0 ? "text-amber-500" : ""}`}>{teamPipeline.draftsAwaitingApproval}</div>
                                  <div className="text-[10px] text-muted-foreground">Drafts</div>
                                </div>
                                <div className="rounded-lg border bg-background p-2 text-center">
                                  <div className={`text-base font-bold ${teamPipeline.repliesNeedingFollowUp > 0 ? "text-green-600" : ""}`}>{teamPipeline.repliesNeedingFollowUp}</div>
                                  <div className="text-[10px] text-muted-foreground">Replied</div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" data-testid="revenue-team-pipeline-btn"
                              onClick={() => { setActiveTab("chat"); sendMessage("Show team revenue pipeline"); }}>
                              Pipeline Summary
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" data-testid="revenue-find-leads-btn"
                              onClick={() => { setActiveTab("chat"); sendMessage("Find me some team training leads near us"); }}>
                              Find More Leads
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Card>
                          <CardContent className="p-4 text-center">
                            <Building2 className="h-6 w-6 mx-auto mb-2 text-teal-400 opacity-60" />
                            <p className="text-sm text-muted-foreground mb-2">No team prospects in pipeline yet.</p>
                            <p className="text-xs text-muted-foreground mb-3">Team training contracts can be a significant source of recurring B2B revenue.</p>
                            <Button size="sm" className="h-8 text-xs" onClick={() => { setActiveTab("chat"); sendMessage("Find me some team training leads near us"); }} data-testid="revenue-start-team-leads-btn">
                              Start Building Pipeline
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </ScrollArea>
        )}

        {/* ===== SETTINGS TAB ===== */}
        {activeTab === "settings" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-6 max-w-xl mx-auto">
              <div>
                <h3 className="font-semibold text-sm mb-1">Automation Level</h3>
                <p className="text-xs text-muted-foreground mb-4">Controls how proactively the agent operates for scheduling and revenue actions.</p>
                <div className={`space-y-3 ${!isAdmin ? "opacity-50 pointer-events-none" : ""}`}>
                  {[
                    { level: 1, label: "Co-Pilot (Suggest Only)", description: "All actions require your explicit confirmation. Insights are surfaced on demand.", icon: <MessageSquare className="h-4 w-4 text-blue-500" /> },
                    { level: 2, label: "Assisted (Auto-Inform)", description: "Low-risk actions (waitlist adds, package alerts) run automatically with notifications. Bookings still require confirmation.", icon: <Zap className="h-4 w-4 text-yellow-500" /> },
                    { level: 3, label: "Autonomous (Full Auto)", description: "All routine scheduling and revenue actions execute automatically. Everything is logged and reviewable.", icon: <Bot className="h-4 w-4 text-green-500" /> },
                  ].map(option => (
                    <button key={option.level} data-testid={`automation-level-${option.level}`}
                      className={`w-full text-left rounded-xl border p-4 transition-colors ${automationLevel === option.level ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                      onClick={() => setAutomationLevel(option.level)}>
                      <div className="flex items-center gap-2 mb-1">
                        {option.icon}<span className="font-medium text-sm">{option.label}</span>
                        {automationLevel === option.level && <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{option.description}</p>
                    </button>
                  ))}
                </div>
                {isAdmin ? (
                  <Button className="mt-4 w-full" data-testid="save-automation-level" onClick={() => saveAutomationLevel(automationLevel)} disabled={savingLevel}>
                    {savingLevel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save Automation Level
                  </Button>
                ) : (
                  <p className="mt-4 text-xs text-muted-foreground text-center" data-testid="automation-level-readonly">Only admins can change this setting.</p>
                )}
              </div>
              <Separator />
              <div>
                <h3 className="font-semibold text-sm mb-1">Revenue Intelligence Engine</h3>
                <p className="text-xs text-muted-foreground mb-3">Full business intelligence powered by your booking and subscription data.</p>
                <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                  {[
                    "Client LTV & total revenue tracking",
                    "MRR calculation from active subscriptions",
                    "Churn risk detection (frequency drop, inactivity)",
                    "Session package balance alerts",
                    "Upsell opportunity identification",
                    "Revenue by coach and time block",
                    "Month-over-month growth tracking",
                  ].map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /><span>{f}</span></div>
                  ))}
                </div>
              </div>
              <Separator />
              <div>
                <h3 className="font-semibold text-sm mb-1">Agent Tools</h3>
                <div className="space-y-2">
                  {[
                    { name: "get_revenue_summary", desc: "Total revenue, MRR, LTV, growth trend, top coaches & clients" },
                    { name: "get_churn_risks", desc: "At-risk clients with booking frequency signals and suggested actions" },
                    { name: "get_upsell_opportunities", desc: "Clients ready for more sessions or service upgrades" },
                    { name: "get_client_value", desc: "Full LTV breakdown for all clients in the org" },
                    { name: "get_session_packages", desc: "Low-balance subscription clients needing renewal outreach" },
                  ].map(tool => (
                    <div key={tool.name} className="rounded-lg border p-3">
                      <div className="font-mono text-xs font-semibold text-primary mb-0.5">{tool.name}</div>
                      <div className="text-xs text-muted-foreground">{tool.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
