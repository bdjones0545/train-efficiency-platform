import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  CalendarCheck,
  Users,
  Clock,
  Sparkles,
  ChevronLeft,
  Loader2,
  Calendar,
  Search,
  BarChart3,
  UserX,
  RefreshCw,
  PlusCircle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Info,
  Zap,
  DollarSign,
  ListOrdered,
  Settings,
  MessageSquare,
  Activity,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders } from "@/lib/authToken";

interface Message {
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

interface OpsDigest {
  generatedAt: string;
  weekRange: string;
  totalBookingsThisWeek: number;
  openSlotsThisWeek: number;
  estimatedOpenRevenue: number;
  inactiveClientsCount: number;
  waitlistCount: number;
  coaches: CoachDigest[];
  insights: OpsInsight[];
  recentCancellations: {
    id: string;
    clientName: string;
    coachName: string;
    time: string;
    service: string;
  }[];
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

const QUICK_ACTIONS = [
  { label: "This Week's Schedule", icon: Calendar, prompt: "Show me this week's full schedule", color: "text-blue-500" },
  { label: "Operations Summary", icon: Activity, prompt: "Give me an operations summary for this week", color: "text-orange-500" },
  { label: "Book a Session", icon: PlusCircle, prompt: "I need to book a session for a client", color: "text-primary" },
  { label: "Find Open Slots", icon: Search, prompt: "Find open slots in the schedule", color: "text-green-500" },
  { label: "Missing Clients", icon: UserX, prompt: "Who hasn't booked this week?", color: "text-red-500" },
  { label: "Coach Utilization", icon: BarChart3, prompt: "Show me coach utilization for this week", color: "text-purple-500" },
];

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
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={i} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushList();
      nodes.push(<div key={keyIndex++} className="h-2" />);
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls = level === 1 ? "text-base font-bold mt-2 mb-1" : level === 2 ? "text-sm font-semibold mt-2 mb-1 text-foreground/90" : "text-sm font-medium mt-1 text-foreground/80";
      nodes.push(<div key={keyIndex++} className={cls}>{renderInline(content)}</div>);
      continue;
    }
    const listMatch = line.match(/^[\-\*]\s+(.+)/);
    if (listMatch) {
      inList = true;
      listItems.push(<li key={keyIndex++} className="text-sm leading-relaxed">{renderInline(listMatch[1])}</li>);
      continue;
    }
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      flushList();
      nodes.push(<div key={keyIndex++} className="flex gap-2 text-sm leading-relaxed my-0.5"><span className="font-semibold text-primary shrink-0">{numMatch[1]}.</span><span>{renderInline(numMatch[2])}</span></div>);
      continue;
    }
    const hrMatch = line.match(/^---/);
    if (hrMatch) {
      flushList();
      nodes.push(<Separator key={keyIndex++} className="my-2" />);
      continue;
    }
    flushList();
    nodes.push(<p key={keyIndex++} className="text-sm leading-relaxed">{renderInline(line)}</p>);
  }
  flushList();
  return nodes;
}

function InsightCard({ insight, onAction }: { insight: OpsInsight; onAction: (prompt: string) => void }) {
  const iconMap = {
    info: <Info className="h-4 w-4" />,
    warning: <AlertTriangle className="h-4 w-4" />,
    opportunity: <TrendingUp className="h-4 w-4" />,
    action: <Zap className="h-4 w-4" />,
  };
  const colorMap = {
    info: "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30",
    warning: "border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/30",
    opportunity: "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30",
    action: "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/30",
  };
  const iconColorMap = {
    info: "text-blue-500",
    warning: "text-yellow-500",
    opportunity: "text-green-500",
    action: "text-orange-500",
  };
  const priorityBadge = {
    high: <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">High</Badge>,
    medium: <Badge className="text-[10px] px-1.5 py-0 h-4 bg-yellow-500">Medium</Badge>,
    low: <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Low</Badge>,
  };

  return (
    <div className={`rounded-lg border p-3 ${colorMap[insight.type]}`} data-testid={`insight-card-${insight.category}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${iconColorMap[insight.type]}`}>{iconMap[insight.type]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium leading-tight">{insight.title}</span>
            {priorityBadge[insight.priority]}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
          {insight.metric && (
            <span className="inline-block mt-1 text-xs font-mono font-semibold text-foreground/70">{insight.metric}</span>
          )}
          {insight.actionLabel && insight.actionPrompt && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 text-xs px-2 hover:bg-background/80"
              data-testid={`insight-action-${insight.category}`}
              onClick={() => onAction(insight.actionPrompt!)}
            >
              <MessageSquare className="h-3 w-3 mr-1" />
              {insight.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CoachBar({ coach }: { coach: CoachDigest }) {
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

export default function SchedulingAgentPage() {
  const [activeTab, setActiveTab] = useState<"chat" | "ops" | "settings">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [automationLevel, setAutomationLevel] = useState<number>(1);
  const [savingLevel, setSavingLevel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: digest, isLoading: digestLoading, refetch: refetchDigest } = useQuery<OpsDigest>({
    queryKey: ["/api/scheduling/operations-digest"],
    enabled: activeTab === "ops",
    staleTime: 60 * 1000,
  });

  const { data: waitlist, isLoading: waitlistLoading, refetch: refetchWaitlist } = useQuery<WaitlistEntry[]>({
    queryKey: ["/api/scheduling/waitlist"],
    staleTime: 30 * 1000,
  });

  const { data: actionLog, isLoading: actionLogLoading } = useQuery<any[]>({
    queryKey: ["/api/scheduling/agent-action-log"],
    enabled: activeTab === "ops",
    staleTime: 30 * 1000,
  });

  const { data: automationData } = useQuery<{ level: number }>({
    queryKey: ["/api/scheduling/automation-level"],
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (automationData?.level) setAutomationLevel(automationData.level);
  }, [automationData]);

  const removeFromWaitlist = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/scheduling/waitlist/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/scheduling/waitlist"] });
      toast({ title: "Removed from waitlist" });
    },
  });

  const saveAutomationLevel = async (level: number) => {
    setSavingLevel(true);
    try {
      await apiRequest("PATCH", "/api/scheduling/automation-level", { level });
      setAutomationLevel(level);
      qc.invalidateQueries({ queryKey: ["/api/scheduling/automation-level"] });
      toast({ title: "Automation level updated" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSavingLevel(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setMessages(m => m.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, isLoading, toast]);

  const handleOpsAction = (prompt: string) => {
    setActiveTab("chat");
    setTimeout(() => sendMessage(prompt), 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const tabs = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "ops", label: "Operations Feed", icon: Activity },
    { id: "settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href="/scheduling">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="back-to-scheduling">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight">TrainEfficiency Scheduling Agent</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              Ops Intelligence Engine Active
            </div>
          </div>
        </div>
        {waitlist && waitlist.length > 0 && (
          <Badge variant="secondary" className="text-xs" data-testid="waitlist-badge">
            <ListOrdered className="h-3 w-3 mr-1" />
            {waitlist.length} waitlist
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b bg-background shrink-0">
        <div className="flex px-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">

        {/* ===== CHAT TAB ===== */}
        {activeTab === "chat" && (
          <div className="flex flex-col h-full">
            <ScrollArea className="flex-1 px-4 py-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-6 py-6">
                  <div className="text-center space-y-1">
                    <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                      <Sparkles className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="font-semibold text-base">Scheduling Agent</h3>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Your intelligent co-pilot for scheduling, backfill, and ops insights.
                    </p>
                  </div>
                  {showQuickActions && (
                    <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                      {QUICK_ACTIONS.map((action) => (
                        <button
                          key={action.label}
                          data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                          className="flex items-center gap-2 p-3 rounded-xl border bg-card hover:bg-accent transition-colors text-left"
                          onClick={() => sendMessage(action.prompt)}
                        >
                          <action.icon className={`h-4 w-4 shrink-0 ${action.color}`} />
                          <span className="text-xs font-medium leading-tight">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {messages.map((message, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${message.role}-${i}`}
                  >
                    {message.role === "assistant" && (
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm"
                      }`}
                    >
                      {message.role === "assistant"
                        ? <div className="space-y-1">{renderMarkdown(message.content)}</div>
                        : <p className="text-sm leading-relaxed">{message.content}</p>
                      }
                    </div>
                    {message.role === "user" && (
                      <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                        <User className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
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
            </ScrollArea>

            <div className="border-t bg-background p-3 shrink-0">
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  data-testid="chat-input"
                  placeholder="Ask about schedules, clients, or ops..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button
                  data-testid="send-message"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  size="icon"
                  className="shrink-0"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ===== OPERATIONS FEED TAB ===== */}
        {activeTab === "ops" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-5 max-w-2xl mx-auto">

              {digestLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : digest ? (
                <>
                  {/* Hero metrics row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card className="border-0 shadow-sm" data-testid="metric-bookings">
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground mb-1">Booked This Week</div>
                        <div className="text-2xl font-bold">{digest.totalBookingsThisWeek}</div>
                        <div className="text-xs text-muted-foreground">{digest.weekRange}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm" data-testid="metric-open-slots">
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground mb-1">Open Slots</div>
                        <div className="text-2xl font-bold text-orange-500">{digest.openSlotsThisWeek}</div>
                        <div className="text-xs text-muted-foreground">this week</div>
                      </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm" data-testid="metric-revenue">
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground mb-1">Open Revenue Est.</div>
                        <div className="text-2xl font-bold text-green-600">${digest.estimatedOpenRevenue.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">fillable</div>
                      </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm" data-testid="metric-waitlist">
                      <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground mb-1">Waitlist</div>
                        <div className="text-2xl font-bold text-blue-500">{digest.waitlistCount}</div>
                        <div className="text-xs text-muted-foreground">clients waiting</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Insights */}
                  {digest.insights.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm flex items-center gap-1.5">
                          <Zap className="h-4 w-4 text-orange-500" />
                          Insights & Actions
                        </h3>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => refetchDigest()} data-testid="refresh-digest">
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

                  {/* Coach utilization bars */}
                  {digest.coaches.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                        <BarChart3 className="h-4 w-4 text-purple-500" />
                        Coach Utilization
                      </h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          {digest.coaches.map(coach => (
                            <CoachBar key={coach.coachId} coach={coach} />
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Recent cancellations */}
                  {digest.recentCancellations.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                        <XCircle className="h-4 w-4 text-red-500" />
                        Recent Cancellations
                      </h3>
                      <div className="space-y-2">
                        {digest.recentCancellations.map(c => (
                          <Card key={c.id} className="border-red-100 dark:border-red-900/30">
                            <CardContent className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{c.clientName}</div>
                                <div className="text-xs text-muted-foreground">{c.time} · {c.service} with {c.coachName}</div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs shrink-0"
                                data-testid={`backfill-${c.id}`}
                                onClick={() => handleOpsAction(`Find waitlist clients to backfill this slot: ${c.service} with ${c.coachName} at ${c.time}`)}
                              >
                                Backfill
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              {/* Waitlist section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5">
                    <ListOrdered className="h-4 w-4 text-blue-500" />
                    Scheduling Waitlist
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => refetchWaitlist()}
                    data-testid="refresh-waitlist"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />Refresh
                  </Button>
                </div>
                {waitlistLoading ? (
                  <Skeleton className="h-16 w-full rounded-xl" />
                ) : !waitlist || waitlist.length === 0 ? (
                  <Card>
                    <CardContent className="p-4 text-center text-sm text-muted-foreground">
                      No clients on the waitlist
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {waitlist.map(entry => (
                      <Card key={entry.id} data-testid={`waitlist-entry-${entry.id}`}>
                        <CardContent className="p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              {entry.client
                                ? `${entry.client.firstName ?? ""} ${entry.client.lastName ?? ""}`.trim() || entry.client.email
                                : entry.clientId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {entry.sessionType && <span>{entry.sessionType} · </span>}
                              {entry.notes || "No preferences noted"}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            data-testid={`remove-waitlist-${entry.id}`}
                            onClick={() => removeFromWaitlist.mutate(entry.id)}
                            disabled={removeFromWaitlist.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Agent action log */}
              {actionLog && actionLog.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-gray-500" />
                    Agent Activity Log
                  </h3>
                  <div className="space-y-1">
                    {actionLog.slice(0, 10).map((entry: any) => (
                      <div key={entry.id} className="flex items-start gap-2 text-xs py-1.5 border-b last:border-0" data-testid={`log-entry-${entry.id}`}>
                        <span className="text-muted-foreground shrink-0 mt-0.5 font-mono">
                          {entry.executedAt ? new Date(entry.executedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                        <span className={`flex-1 leading-relaxed ${entry.undone ? "line-through text-muted-foreground" : ""}`}>
                          {entry.description}
                        </span>
                        {entry.undone && <Badge variant="outline" className="text-[10px] h-4">Undone</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ===== SETTINGS TAB ===== */}
        {activeTab === "settings" && (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-6 max-w-xl mx-auto">

              <div>
                <h3 className="font-semibold text-sm mb-1">Automation Level</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Controls how proactively the agent operates. Higher levels allow more autonomous action; lower levels require confirmation for all changes.
                </p>

                <div className="space-y-3">
                  {[
                    {
                      level: 1,
                      label: "Co-Pilot (Suggest Only)",
                      description: "The agent suggests all actions and waits for explicit confirmation before executing any booking or schedule change.",
                      icon: <MessageSquare className="h-4 w-4 text-blue-500" />,
                    },
                    {
                      level: 2,
                      label: "Assisted (Auto-Inform)",
                      description: "The agent can execute low-risk actions (like schedule reads and waitlist adds) automatically and notifies you. Booking changes still require confirmation.",
                      icon: <Zap className="h-4 w-4 text-yellow-500" />,
                    },
                    {
                      level: 3,
                      label: "Autonomous (Full Auto)",
                      description: "The agent executes all routine scheduling actions automatically. Ideal for high-trust environments. Actions are logged and reviewable.",
                      icon: <Bot className="h-4 w-4 text-green-500" />,
                    },
                  ].map(option => (
                    <button
                      key={option.level}
                      data-testid={`automation-level-${option.level}`}
                      className={`w-full text-left rounded-xl border p-4 transition-colors ${
                        automationLevel === option.level
                          ? "border-primary bg-primary/5"
                          : "hover:bg-accent"
                      }`}
                      onClick={() => setAutomationLevel(option.level)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {option.icon}
                        <span className="font-medium text-sm">{option.label}</span>
                        {automationLevel === option.level && (
                          <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{option.description}</p>
                    </button>
                  ))}
                </div>

                <Button
                  className="mt-4 w-full"
                  data-testid="save-automation-level"
                  onClick={() => saveAutomationLevel(automationLevel)}
                  disabled={savingLevel}
                >
                  {savingLevel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save Automation Level
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold text-sm mb-1">Ops Intelligence Engine</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  The Operations Feed tab automatically analyzes your schedule and surfaces insights about utilization, revenue opportunity, inactive clients, and waitlist matches.
                </p>
                <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>Coach utilization tracking</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>Revenue opportunity estimation</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>Inactive client detection</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>Waitlist &amp; backfill matching</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>Agent action logging</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold text-sm mb-1">New Tools Available</h3>
                <p className="text-xs text-muted-foreground mb-3">The following tools have been added to the scheduling agent:</p>
                <div className="space-y-2">
                  {[
                    { name: "get_operations_digest", desc: "Full ops summary: utilization, gaps, revenue, clients" },
                    { name: "get_waitlist", desc: "View all clients on the scheduling waitlist" },
                    { name: "add_to_waitlist", desc: "Add a client to the waitlist when no slot works" },
                    { name: "suggest_backfill", desc: "Match waitlist clients to open cancellation slots" },
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
