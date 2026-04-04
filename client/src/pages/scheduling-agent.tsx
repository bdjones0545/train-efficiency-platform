import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Send,
  User,
  CalendarCheck,
  Users,
  Clock,
  MapPin,
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
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders } from "@/lib/authToken";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_ACTIONS = [
  {
    label: "This Week's Schedule",
    icon: Calendar,
    prompt: "Show me this week's full schedule",
    color: "text-blue-500",
  },
  {
    label: "Find Open Slots",
    icon: Search,
    prompt: "Find open slots in the schedule",
    color: "text-green-500",
  },
  {
    label: "Book a Session",
    icon: PlusCircle,
    prompt: "I need to book a session for a client",
    color: "text-primary",
  },
  {
    label: "Reschedule",
    icon: RefreshCw,
    prompt: "I need to reschedule a booking",
    color: "text-orange-500",
  },
  {
    label: "Missing Clients",
    icon: UserX,
    prompt: "Who hasn't booked this week?",
    color: "text-red-500",
  },
  {
    label: "Coach Utilization",
    icon: BarChart3,
    prompt: "Show me coach utilization for this week",
    color: "text-purple-500",
  },
];

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    const isNumbered = /^\d+\.\s/.test(line.trim());
    const isBullet = /^[-•*]\s/.test(line.trim());

    const formatInline = (str: string) => {
      const parts = str.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((p, idx) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={idx}>{p.slice(2, -2)}</strong>;
        }
        return p;
      });
    };

    if (isNumbered) {
      elements.push(
        <div key={key++} className="flex gap-2 my-0.5">
          <span className="shrink-0 font-semibold text-primary min-w-[1.25rem]">
            {line.trim().match(/^\d+/)?.[0]}.
          </span>
          <span>{formatInline(line.trim().replace(/^\d+\.\s/, ""))}</span>
        </div>
      );
    } else if (isBullet) {
      elements.push(
        <div key={key++} className="flex gap-2 my-0.5">
          <span className="shrink-0 text-muted-foreground mt-0.5">•</span>
          <span>{formatInline(line.trim().replace(/^[-•*]\s/, ""))}</span>
        </div>
      );
    } else if (line.startsWith("## ") || line.startsWith("# ")) {
      elements.push(
        <p key={key++} className="font-semibold mt-1">
          {formatInline(line.replace(/^#+\s/, ""))}
        </p>
      );
    } else {
      elements.push(<p key={key++}>{formatInline(line)}</p>);
    }
  }

  return elements;
}

function needsConfirmation(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    (lower.includes("which") && (lower.includes("option") || lower.includes("time") || lower.includes("works"))) ||
    lower.includes("want me to") ||
    lower.includes("shall i") ||
    lower.includes("shall we") ||
    lower.includes("go ahead") ||
    lower.includes("confirm to proceed") ||
    lower.includes("reply with") ||
    lower.includes("type 'yes'") ||
    lower.includes("type \"yes\"") ||
    (lower.includes("book") && lower.includes("?") && (lower.includes("1.") || lower.includes("2.")))
  );
}

function MessageBubble({
  message,
  onQuickReply,
  isLast,
}: {
  message: Message;
  onQuickReply?: (text: string) => void;
  isLast: boolean;
}) {
  const isUser = message.role === "user";
  const showConfirmation = !isUser && isLast && needsConfirmation(message.content) && onQuickReply;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`message-${message.role}`}>
      <div
        className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted border"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="flex flex-col gap-2 max-w-[78%]">
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted rounded-bl-sm"
          }`}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <div className="space-y-0.5">{renderMarkdown(message.content)}</div>
          )}
        </div>
        {showConfirmation && (
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1.5"
              onClick={() => onQuickReply?.("Yes, go ahead and confirm")}
              data-testid="button-confirm-action"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Yes, confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => onQuickReply?.("No, cancel that")}
              data-testid="button-cancel-action"
            >
              <XCircle className="h-3.5 w-3.5" />
              No, thanks
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{title}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function SchedulingAgentPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: context } = useQuery<{
    coaches: any[];
    services: any[];
    locations: any[];
  }>({
    queryKey: ["/api/scheduling-agent/context"],
  });

  const { data: profile } = useQuery<{ role?: string }>({
    queryKey: ["/api/profile"],
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const userMessage: Message = { role: "user", content: content.trim() };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setIsStreaming(true);

      const assistantMessage: Message = { role: "assistant", content: "" };
      setMessages(prev => [...prev, assistantMessage]);

      try {
        const response = await fetch("/api/scheduling-agent/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ messages: updatedMessages }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Request failed");
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("No response body");

        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: accumulated };
            return updated;
          });
        }

        if (!accumulated) {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: "I couldn't generate a response. Please try again.",
            };
            return updated;
          });
        }
      } catch (error: any) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Something went wrong: ${error.message}. Please try again.`,
          };
          return updated;
        });
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } finally {
        setIsStreaming(false);
        inputRef.current?.focus();
      }
    },
    [messages, isStreaming, toast]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearConversation = () => setMessages([]);

  const isStaff = profile?.role === "COACH" || profile?.role === "ADMIN" || profile?.role === "STAFF";

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-h-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/scheduling">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              data-testid="button-back-to-scheduling"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold" data-testid="text-agent-title">
                Scheduling Agent
              </h1>
              <Badge
                variant="secondary"
                className="text-xs flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                AI Co-Pilot
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Intelligent scheduling — suggest, confirm, execute
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearConversation}
            data-testid="button-clear-chat"
          >
            Clear Chat
          </Button>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Main Chat */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Quick Actions Bar — visible only when chat is empty */}
          {messages.length === 0 && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                Quick Actions
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {QUICK_ACTIONS.map(action => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="h-auto py-2.5 px-3 flex items-center gap-2 justify-start text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    onClick={() => sendMessage(action.prompt)}
                    data-testid={`button-quick-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <action.icon className={`h-4 w-4 shrink-0 ${action.color}`} />
                    <span className="text-xs font-medium leading-tight">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Card className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[240px] gap-4 text-center py-6">
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-7 w-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">How can I help?</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mt-1">
                      Ask me anything about your schedule — bookings, availability,
                      open slots, client activity, or coach capacity.
                    </p>
                  </div>
                  {isStaff && (
                    <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                      {[
                        "Find open times tomorrow",
                        "Who hasn't booked this week?",
                        "Show today's bookings",
                        "Check coach utilization",
                      ].map(prompt => (
                        <button
                          key={prompt}
                          onClick={() => sendMessage(prompt)}
                          className="text-xs px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground"
                          data-testid={`button-suggested-${prompt.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <MessageBubble
                      key={idx}
                      message={msg}
                      isLast={idx === messages.length - 1}
                      onQuickReply={sendMessage}
                    />
                  ))}
                  {isStreaming && messages[messages.length - 1]?.content === "" && (
                    <div className="flex gap-3">
                      <div className="shrink-0 h-8 w-8 rounded-full bg-muted border flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                      <div className="bg-muted rounded-xl rounded-bl-sm px-4 py-3">
                        <div className="flex gap-1 items-center">
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask about schedule, availability, bookings, clients..."
                  disabled={isStreaming}
                  className="flex-1"
                  data-testid="input-agent-message"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isStreaming || !input.trim()}
                  data-testid="button-agent-send"
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Suggestions only — you confirm before anything is executed
              </p>
            </div>
          </Card>
        </div>

        {/* Context Sidebar */}
        <div className="hidden md:flex flex-col gap-3 w-52 shrink-0">
          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Org Context
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              {context ? (
                <>
                  <ContextCard
                    title="Coaches"
                    value={context.coaches.length}
                    icon={Users}
                  />
                  <ContextCard
                    title="Services"
                    value={context.services.filter((s: any) => s.active).length}
                    icon={CalendarCheck}
                  />
                  <ContextCard
                    title="Locations"
                    value={context.locations.filter((l: any) => l.active).length}
                    icon={MapPin}
                  />
                </>
              ) : (
                <>
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                What I Can Do
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1.5">
              {[
                { icon: Calendar, label: "Show schedule" },
                { icon: Search, label: "Find open slots" },
                { icon: PlusCircle, label: "Book sessions" },
                { icon: RefreshCw, label: "Reschedule" },
                { icon: UserX, label: "Inactive clients" },
                { icon: TrendingUp, label: "Coach utilization" },
              ].map(item => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  <span>{item.label}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Signed in as
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <p className="text-xs font-medium">
                {user?.firstName} {user?.lastName}
              </p>
              <Badge variant="outline" className="text-xs mt-1">
                {profile?.role || "..."}
              </Badge>
            </CardContent>
          </Card>

          <Separator />

          <div className="px-1">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              The agent suggests actions before executing. You always confirm first.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
