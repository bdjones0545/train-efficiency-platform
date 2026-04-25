import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Package,
  Target,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/authToken";

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

function renderMarkdown(text: string): React.ReactNode[] {
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

export function CoachSchedulingAgentPanel({ mode, context, onClose }: CoachSchedulingAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "ops" | "revenue" | "settings">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [automationLevel, setAutomationLevel] = useState<number>(1);
  const [savingLevel, setSavingLevel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: profile, isLoading: profileLoading } = useQuery<{ role?: string }>({ queryKey: ["/api/profile"] });
  const userRole = profile?.role || "CLIENT";
  const isStaff = userRole === "COACH" || userRole === "ADMIN" || userRole === "STAFF";

  const contextPrompts = context ? PAGE_QUICK_PROMPTS[context.sourcePage] : null;
  const QUICK_ACTIONS = isStaff
    ? (mode === "overlay" && contextPrompts ? contextPrompts : STAFF_QUICK_ACTIONS)
    : CLIENT_QUICK_ACTIONS;

  const { data: digest, isLoading: digestLoading, refetch: refetchDigest } = useQuery<OpsDigest>({
    queryKey: ["/api/scheduling/operations-digest"],
    enabled: isStaff,
    staleTime: 60 * 1000,
  });

  const { data: revenueSummary, isLoading: revenueLoading, refetch: refetchRevenue } = useQuery<RevenueSummary>({
    queryKey: ["/api/scheduling/revenue-summary"],
    enabled: isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: churnRisks, isLoading: churnLoading } = useQuery<ChurnRisk[]>({
    queryKey: ["/api/scheduling/churn-risks"],
    enabled: isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: upsellOpps, isLoading: upsellLoading } = useQuery<UpsellOpportunity[]>({
    queryKey: ["/api/scheduling/upsell-opportunities"],
    enabled: isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: packageAlerts, isLoading: packagesLoading } = useQuery<SessionPackageAlert[]>({
    queryKey: ["/api/scheduling/session-packages"],
    enabled: isStaff && activeTab === "revenue",
    staleTime: 60 * 1000,
  });

  const { data: waitlist, isLoading: waitlistLoading, refetch: refetchWaitlist } = useQuery<WaitlistEntry[]>({
    queryKey: ["/api/scheduling/waitlist"],
    enabled: isStaff,
    staleTime: 30 * 1000,
  });

  const { data: actionLog } = useQuery<any[]>({
    queryKey: ["/api/scheduling/agent-action-log"],
    enabled: isStaff && activeTab === "ops",
    staleTime: 30 * 1000,
  });

  const { data: automationData } = useQuery<{ level: number }>({
    queryKey: ["/api/scheduling/automation-level"],
    staleTime: 60 * 1000,
  });

  useEffect(() => { if (automationData?.level) setAutomationLevel(automationData.level); }, [automationData]);

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

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setInput("");
    setShowQuickActions(false);
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
          setMessages([...newMessages, { role: "assistant", content: full }]);
        }
        full += decoder.decode();
      } else {
        full = await response.text();
      }
      setMessages([...newMessages, { role: "assistant", content: full }]);
      qc.invalidateQueries({ queryKey: ["/api/bookings"] });
      qc.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      qc.invalidateQueries({ queryKey: ["/api/coaches"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that request. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, isLoading, toast]);

  const handleOpsAction = (prompt: string) => {
    setActiveTab("chat");
    setTimeout(() => sendMessage(prompt), 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const tabs = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    ...(isStaff ? [
      { id: "ops", label: "Ops", icon: Activity },
      { id: "revenue", label: "Revenue", icon: DollarSign },
      { id: "settings", label: "Settings", icon: Settings },
    ] : []),
  ] as const;

  const maxCoachRevenue = revenueSummary ? Math.max(...revenueSummary.coachRevenues.map(c => c.totalRevenueCents), 1) : 1;
  const maxTimeBlockRevenue = revenueSummary ? Math.max(...revenueSummary.timeBlockRevenues.map(t => t.totalRevenueCents), 1) : 1;

  const highPriorityInsights = digest?.insights.filter(i => i.priority === "high") ?? [];
  const topActions = digest?.insights.slice(0, 3) ?? [];

  function getPrimaryHeadline(): string {
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
        {isStaff && (
          <div className="flex items-center gap-1.5 shrink-0">
            {waitlist && waitlist.length > 0 && (
              <Badge variant="secondary" className="text-[11px] px-1.5" data-testid="waitlist-badge">
                <ListOrdered className="h-3 w-3 mr-1" />{waitlist.length}
              </Badge>
            )}
            {digest && digest.insights.filter(i => i.priority === "high").length > 0 && (
              <Badge variant="destructive" className="text-[11px] px-1.5" data-testid="churn-badge">
                <AlertTriangle className="h-3 w-3 mr-1" />{digest.insights.filter(i => i.priority === "high").length}
              </Badge>
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
                    ) : isStaff ? (
                      <>
                        {/* Command Center Card — only in full mode or when no context */}
                        {(mode === "full" || !context) && (
                          <div className="rounded-2xl border bg-primary/5 p-4" data-testid="command-center-card">
                            <div className="flex items-center gap-2 mb-3">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" />
                              <div>
                                <div className="text-xs font-semibold text-primary">Today's Business Command Center</div>
                                <div className="text-[11px] text-muted-foreground">Your highest-impact actions, ranked by goal and revenue.</div>
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
                        {mode === "overlay" && context && digest && !digestLoading && (
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
                        {mode === "full" && digest && (
                          <div className="space-y-2 mt-1" data-testid="collapsible-sections">
                            <CollapsibleSection
                              title="Revenue"
                              icon={<DollarSign className="h-4 w-4 text-green-500" />}
                              preview={digest ? `~$${digest.estimatedOpenRevenue.toLocaleString()} open revenue this week` : "Loading..."}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="text-xs text-muted-foreground">Open slot revenue potential this week</div>
                                <div className="text-2xl font-bold text-green-600">${digest.estimatedOpenRevenue.toLocaleString()}</div>
                                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Show me our revenue summary")}>
                                  Full Revenue Summary
                                </Button>
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Growth"
                              icon={<TrendingUp className="h-4 w-4 text-orange-500" />}
                              preview={digest.insights.find(i => i.type === "opportunity")?.title ?? "View growth opportunities"}
                            >
                              <div className="space-y-2 pt-1">
                                {digest.insights.filter(i => i.type === "opportunity").length > 0
                                  ? digest.insights.filter(i => i.type === "opportunity").map((ins, i) => (
                                    <div key={i} className="text-xs">
                                      <div className="font-medium">{ins.title}</div>
                                      <div className="text-muted-foreground">{ins.description}</div>
                                    </div>
                                  ))
                                  : <div className="text-xs text-muted-foreground">No growth signals detected yet.</div>
                                }
                                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("What are our growth opportunities?")}>
                                  Ask Agent
                                </Button>
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Retention Risks"
                              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                              preview={digest.inactiveClientsCount > 0 ? `${digest.inactiveClientsCount} inactive clients` : "No at-risk clients detected"}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="text-xs text-muted-foreground">
                                  {digest.inactiveClientsCount > 0
                                    ? `${digest.inactiveClientsCount} clients have not booked recently.`
                                    : "Retention looks healthy — no churn signals detected."}
                                </div>
                                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Who are our at-risk clients?")}>
                                  View At-Risk Clients
                                </Button>
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Schedule"
                              icon={<Calendar className="h-4 w-4 text-blue-500" />}
                              preview={`${digest.totalBookingsThisWeek} bookings · ${digest.openSlotsThisWeek} open slots`}
                            >
                              <div className="space-y-2 pt-1">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="rounded-lg border p-2 text-center">
                                    <div className="text-lg font-bold">{digest.totalBookingsThisWeek}</div>
                                    <div className="text-[11px] text-muted-foreground">Bookings</div>
                                  </div>
                                  <div className="rounded-lg border p-2 text-center">
                                    <div className="text-lg font-bold text-orange-500">{digest.openSlotsThisWeek}</div>
                                    <div className="text-[11px] text-muted-foreground">Open Slots</div>
                                  </div>
                                </div>
                                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Show me this week's full schedule")}>
                                  Full Schedule
                                </Button>
                              </div>
                            </CollapsibleSection>

                            <CollapsibleSection
                              title="Ops Summary"
                              icon={<Activity className="h-4 w-4 text-purple-500" />}
                              preview={digest.insights.length > 0 ? `${digest.insights.length} insight${digest.insights.length > 1 ? "s" : ""} available` : "Operations on track"}
                            >
                              <div className="space-y-2 pt-1">
                                {digest.insights.slice(0, 2).map((ins, i) => (
                                  <div key={i} className="text-xs">
                                    <div className="font-medium">{ins.title}</div>
                                    <div className="text-muted-foreground leading-relaxed">{ins.description}</div>
                                  </div>
                                ))}
                                <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => sendMessage("Give me an operations summary for this week")}>
                                  Full Ops Summary
                                </Button>
                              </div>
                            </CollapsibleSection>
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
              <div className="flex gap-2">
                <Input
                  data-testid="chat-input"
                  placeholder={isStaff ? "Ask about revenue, retention, schedule, or growth..." : "Ask about your schedule or bookings..."}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button data-testid="send-message" onClick={() => sendMessage()} disabled={isLoading || !input.trim()} size="icon" className="shrink-0">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ===== OPERATIONS TAB ===== */}
        {activeTab === "ops" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 max-w-2xl mx-auto">
              {digestLoading ? (
                <div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /></div>
              ) : digest ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Booked This Week", value: digest.totalBookingsThisWeek, sub: digest.weekRange, id: "metric-bookings", color: "" },
                      { label: "Open Slots", value: digest.openSlotsThisWeek, sub: "this week", id: "metric-open-slots", color: "text-orange-500" },
                      { label: "Open Revenue Est.", value: `$${digest.estimatedOpenRevenue.toLocaleString()}`, sub: "fillable", id: "metric-revenue", color: "text-green-600" },
                      { label: "Waitlist", value: digest.waitlistCount, sub: "clients waiting", id: "metric-waitlist", color: "text-blue-500" },
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
                  {digest.insights.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Zap className="h-4 w-4 text-orange-500" />Insights & Actions</h3>
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => refetchDigest()} data-testid="refresh-digest">
                          <RefreshCw className="h-3 w-3 mr-1" />Refresh
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {digest.insights.map((insight, i) => (
                          <InsightCard key={i} insight={insight} onAction={handleOpsAction} />
                        ))}
                      </div>
                    </div>
                  )}
                  {digest.coaches.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-blue-500" />Coach Utilization</h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          {digest.coaches.map(c => <UtilizationBar key={c.coachId} coach={c} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                  {digest.recentCancellations.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><XCircle className="h-4 w-4 text-red-400" />Recent Cancellations</h3>
                      <div className="space-y-2">
                        {digest.recentCancellations.map(c => (
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
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><ListOrdered className="h-4 w-4 text-blue-500" />Waitlist ({waitlist?.length ?? 0})</h3>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => refetchWaitlist()} data-testid="refresh-waitlist">
                        <RefreshCw className="h-3 w-3 mr-1" />Refresh
                      </Button>
                    </div>
                    {waitlistLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : !waitlist || waitlist.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />No clients on the waitlist</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {waitlist.map(entry => (
                          <Card key={entry.id} data-testid={`waitlist-entry-${entry.id}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{entry.client ? `${entry.client.firstName} ${entry.client.lastName}` : "Unknown"}</div>
                                {entry.sessionType && <div className="text-xs text-muted-foreground">{entry.sessionType}</div>}
                                {entry.notes && <div className="text-xs text-muted-foreground italic">{entry.notes}</div>}
                              </div>
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
              {revenueLoading ? (
                <div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>
              ) : revenueSummary ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Last 30d Revenue", value: `$${(revenueSummary.last30dRevenueCents / 100).toLocaleString()}`, sub: revenueSummary.revenueGrowthPct >= 0 ? `+${revenueSummary.revenueGrowthPct.toFixed(1)}% vs prior 30d` : `${revenueSummary.revenueGrowthPct.toFixed(1)}% vs prior 30d`, id: "rev-last30", color: "text-green-600", subColor: revenueSummary.revenueGrowthPct >= 0 ? "text-green-500" : "text-red-500" },
                      { label: "MRR", value: `$${(revenueSummary.mrr / 100).toLocaleString()}`, sub: `${revenueSummary.activeSubscribers} active subscribers`, id: "rev-mrr", color: "", subColor: "" },
                      { label: "Avg Session Value", value: `$${(revenueSummary.avgRevenuePerSessionCents / 100).toFixed(0)}`, sub: `${revenueSummary.sessionsLast30d} sessions last 30d`, id: "rev-session-val", color: "", subColor: "" },
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

                  {(revenueSummary.churnRiskCount > 0 || revenueSummary.sessionPackageAlertCount > 0 || revenueSummary.upsellOpportunityCount > 0) && (
                    <>
                      <h3 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-orange-500" />Revenue Alerts</h3>
                      <div className="flex flex-wrap gap-2">
                        {revenueSummary.churnRiskCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 hover:opacity-80 transition-opacity"
                            data-testid="churn-pill" onClick={() => document.getElementById("churn-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <AlertTriangle className="h-3 w-3" />{revenueSummary.churnRiskCount} churn risk{revenueSummary.churnRiskCount > 1 ? "s" : ""}
                          </button>
                        )}
                        {revenueSummary.sessionPackageAlertCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400 hover:opacity-80 transition-opacity"
                            data-testid="packages-pill" onClick={() => document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <Package className="h-3 w-3" />{revenueSummary.sessionPackageAlertCount} package alert{revenueSummary.sessionPackageAlertCount > 1 ? "s" : ""}
                          </button>
                        )}
                        {revenueSummary.upsellOpportunityCount > 0 && (
                          <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 hover:opacity-80 transition-opacity"
                            data-testid="upsell-pill" onClick={() => document.getElementById("upsell-section")?.scrollIntoView({ behavior: "smooth" })}>
                            <TrendingUp className="h-3 w-3" />{revenueSummary.upsellOpportunityCount} upsell opportunity{revenueSummary.upsellOpportunityCount > 1 ? "s" : ""}
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {revenueSummary.coachRevenues.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-green-500" />Revenue by Coach</h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          {revenueSummary.coachRevenues.map(c => <CoachBar key={c.coachId} coach={c} maxRevenue={maxCoachRevenue} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {revenueSummary.topClients.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Users className="h-4 w-4 text-blue-500" />Top Clients by Revenue</h3>
                      <div className="space-y-2">
                        {revenueSummary.topClients.map((c, i) => (
                          <Card key={c.clientId} data-testid={`top-client-${i}`}>
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                                <span className="text-sm font-medium truncate">{c.clientName}</span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-muted-foreground">{c.sessionCount} sessions</span>
                                <span className="text-sm font-semibold text-green-600">${(c.totalRevenueCents / 100).toLocaleString()}</span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {revenueSummary.timeBlockRevenues.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Clock className="h-4 w-4 text-purple-500" />Revenue by Time Block (Last 30d)</h3>
                      <Card>
                        <CardContent className="p-4 space-y-2">
                          {revenueSummary.timeBlockRevenues
                            .sort((a, b) => a.hour - b.hour)
                            .map(tb => <TimeBlockBar key={tb.hour} block={tb} maxRevenue={maxTimeBlockRevenue} />)}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  <div id="churn-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Retention Risks</h3>
                    {churnLoading ? <Skeleton className="h-20 w-full rounded-xl" /> : !churnRisks || churnRisks.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />No clients flagged as at-risk — great retention!</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {churnRisks.slice(0, 6).map(risk => (
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
                                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" data-testid={`churn-action-${risk.clientId}`}
                                  onClick={() => handleOpsAction(risk.suggestedAction)}>
                                  <MessageSquare className="h-3 w-3 mr-1" />Ask agent
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div id="packages-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><Package className="h-4 w-4 text-orange-500" />Session Package Alerts</h3>
                    {packagesLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : !packageAlerts || packageAlerts.length === 0 ? (
                      <Card><CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-500" />All clients have healthy session balances</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {packageAlerts.map(alert => (
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
                              <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" data-testid={`package-action-${alert.clientId}`}
                                onClick={() => handleOpsAction(`Help me reach out to ${alert.clientName} about renewing their session package (${alert.sessionsRemaining} sessions remaining)`)}>
                                <MessageSquare className="h-3 w-3 mr-1" />Reach out
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <div id="upsell-section">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-green-500" />Upsell Opportunities</h3>
                    {upsellLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : !upsellOpps || upsellOpps.length === 0 ? (
                      <Card><CardContent className="p-4 text-sm text-muted-foreground">No upsell opportunities detected from current booking patterns.</CardContent></Card>
                    ) : (
                      <div className="space-y-2">
                        {upsellOpps.map(opp => (
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
                                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0 mt-0.5" data-testid={`upsell-action-${opp.clientId}`}
                                  onClick={() => handleOpsAction(opp.reasoning)}>
                                  <MessageSquare className="h-3 w-3 mr-1" />Ask agent
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
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
                <div className="space-y-3">
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
                <Button className="mt-4 w-full" data-testid="save-automation-level" onClick={() => saveAutomationLevel(automationLevel)} disabled={savingLevel}>
                  {savingLevel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save Automation Level
                </Button>
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
