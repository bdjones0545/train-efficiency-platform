import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Send, User, Sparkles, TrendingUp, Users,
  DollarSign, Calendar, RefreshCw, Lightbulb
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface HealthScore {
  score: number;
  label: string;
  summary: string;
  breakdown: {
    utilization: number;
    revenue: number;
    attendance: number;
    retention: number;
    waitlist: number;
  };
  metrics: {
    avgUtilization: number;
    revenueCapturePct: number;
    attendanceRate: number;
    cancelRate: number;
    waitlistCount: number;
    activeSessionsThisWeek: number;
  };
}

const SUGGESTED_QUESTIONS = [
  "Which sessions have the lowest fill rates this week?",
  "Who are my most at-risk clients for churning?",
  "What's my estimated revenue gap for open spots?",
  "Which coaches are underutilized right now?",
  "How can I improve my scheduling health score?",
  "What days should I add more sessions based on demand?",
];

function HealthScoreWidget() {
  const { data, isLoading } = useQuery<HealthScore>({
    queryKey: ["/api/scheduling/health-score"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling/health-score", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;

  const scoreColor = data.score >= 90 ? "text-green-600 dark:text-green-400" :
                     data.score >= 75 ? "text-blue-600 dark:text-blue-400" :
                     data.score >= 60 ? "text-yellow-600 dark:text-yellow-400" :
                     "text-red-600 dark:text-red-400";
  const scoreBg = data.score >= 90 ? "bg-green-500/10 border-green-500/20" :
                  data.score >= 75 ? "bg-blue-500/10 border-blue-500/20" :
                  data.score >= 60 ? "bg-yellow-500/10 border-yellow-500/20" :
                  "bg-red-500/10 border-red-500/20";

  const breakdown = [
    { label: "Utilization", value: data.breakdown.utilization, icon: TrendingUp },
    { label: "Revenue", value: data.breakdown.revenue, icon: DollarSign },
    { label: "Attendance", value: data.breakdown.attendance, icon: Users },
    { label: "Retention", value: data.breakdown.retention, icon: RefreshCw },
    { label: "Waitlist", value: data.breakdown.waitlist, icon: Calendar },
  ];

  return (
    <Card className={`p-4 border ${scoreBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scheduling Health</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-4xl font-bold ${scoreColor}`}>{data.score}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            <Badge className={`text-xs ${scoreBg} ${scoreColor} border`}>{data.label}</Badge>
          </div>
        </div>
        <Sparkles className={`h-8 w-8 ${scoreColor} opacity-60`} />
      </div>
      <p className="text-xs text-muted-foreground mb-3">{data.summary}</p>
      <div className="grid grid-cols-5 gap-1">
        {breakdown.map(b => {
          const barColor = b.value >= 80 ? "bg-green-500" : b.value >= 60 ? "bg-yellow-500" : "bg-red-500";
          return (
            <div key={b.label} className="space-y-1" data-testid={`health-factor-${b.label.toLowerCase()}`}>
              <p className="text-[10px] text-muted-foreground text-center leading-tight">{b.label}</p>
              <div className="bg-muted rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${b.value}%` }} />
              </div>
              <p className="text-[10px] text-center font-medium">{b.value}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`} data-testid={`message-${message.role}`}>
      <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isUser ? "bg-primary text-primary-foreground" : "bg-violet-500/20 text-violet-600 dark:text-violet-400"}`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
          {message.content}
        </div>
        <p className="text-[10px] text-muted-foreground px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

export default function AdminSchedulingCopilotPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm your Scheduling Intelligence Copilot. I have access to your live scheduling data — sessions, coach utilization, client activity, and revenue metrics. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res = await apiRequest("POST", "/api/scheduling/copilot", {
        question,
        conversationHistory: history,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? "I couldn't generate a response.",
          timestamp: new Date(),
        },
      ]);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not reach the AI copilot.", variant: "destructive" });
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
        },
      ]);
    },
  });

  const handleSend = (text?: string) => {
    const question = (text ?? input).trim();
    if (!question) return;
    setMessages(prev => [...prev, { role: "user", content: question, timestamp: new Date() }]);
    setInput("");
    askMutation.mutate(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <Bot className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          Scheduling AI Copilot
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask questions about sessions, utilization, revenue, and client trends — powered by live data
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left panel — health + suggestions */}
        <div className="space-y-4">
          <HealthScoreWidget />

          <Card className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" />
              Suggested Questions
            </p>
            <div className="space-y-1.5">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(q)}
                  disabled={askMutation.isPending}
                  className="w-full text-left text-xs p-2.5 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors leading-relaxed"
                  data-testid={`button-suggested-${i}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Chat panel */}
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[600px]">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
              {askMutation.isPending && (
                <div className="flex gap-3">
                  <div className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-violet-500/20 text-violet-600 dark:text-violet-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">Thinking</span>
                    <span className="flex gap-0.5 ml-1">
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about sessions, revenue gaps, utilization, client retention…"
                  className="resize-none min-h-[44px] max-h-[120px] text-sm"
                  rows={1}
                  disabled={askMutation.isPending}
                  data-testid="input-copilot-question"
                />
                <Button
                  size="icon"
                  className="h-11 w-11 shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || askMutation.isPending}
                  data-testid="button-send-copilot"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                Press Enter to send · Shift+Enter for new line · Powered by GPT-4o mini
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
