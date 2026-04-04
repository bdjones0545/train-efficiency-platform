import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "Show me all upcoming bookings this week",
  "Which coaches are available tomorrow?",
  "Find open slots for 1-on-1 sessions next week",
  "Create a booking for a client",
  "Show me today's schedule",
  "List all active coaches",
];

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`message-${message.role}`}>
      <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
        isUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted border"
      }`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-muted rounded-bl-sm"
      }`}>
        {message.content}
      </div>
    </div>
  );
}

function ContextCard({ title, value, icon: Icon }: { title: string; value: string | number; icon: any }) {
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

  const sendMessage = async (content: string) => {
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
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`,
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
          updated[updated.length - 1] = { role: "assistant", content: "I'm sorry, I couldn't generate a response. Please try again." };
          return updated;
        });
      }
    } catch (error: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        };
        return updated;
      });
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const clearConversation = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-h-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/scheduling">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back-to-scheduling">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold" data-testid="text-agent-title">Scheduling Agent</h1>
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                AI-Powered
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Your intelligent assistant for managing schedules and bookings
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearConversation} data-testid="button-clear-chat">
            Clear Chat
          </Button>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Main Chat */}
        <div className="flex flex-col flex-1 min-w-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6 text-center py-8">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Scheduling Agent</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mt-1">
                      I can help you manage bookings, check coach availability, find open time slots, and more — all scoped to your organization.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                    {SUGGESTED_PROMPTS.map(prompt => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        className="text-xs h-auto py-2 px-3 text-left justify-start whitespace-normal"
                        onClick={() => handleSuggestedPrompt(prompt)}
                        data-testid={`button-suggested-${prompt.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <MessageBubble key={idx} message={msg} />
                  ))}
                  {isStreaming && messages[messages.length - 1]?.content === "" && (
                    <div className="flex gap-3">
                      <div className="shrink-0 h-8 w-8 rounded-full bg-muted border flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                      <div className="bg-muted rounded-xl rounded-bl-sm px-4 py-3">
                        <div className="flex gap-1">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
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
                  placeholder="Ask about bookings, availability, coaches..."
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
                All data is scoped to your organization only
              </p>
            </div>
          </Card>
        </div>

        {/* Context Sidebar */}
        <div className="hidden md:flex flex-col gap-3 w-48 shrink-0">
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
                    value={context.services.filter(s => s.active).length}
                    icon={CalendarCheck}
                  />
                  <ContextCard
                    title="Locations"
                    value={context.locations.filter(l => l.active).length}
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
                Capabilities
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1.5">
              {[
                { icon: CalendarCheck, label: "Find open slots" },
                { icon: Users, label: "View coach schedule" },
                { icon: Clock, label: "Manage availability" },
                { icon: Bot, label: "Create bookings" },
                { icon: MapPin, label: "Location-aware" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
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
              <p className="text-xs font-medium">{user?.firstName} {user?.lastName}</p>
              <Badge variant="outline" className="text-xs mt-1">
                {profile?.role || "..."}
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
