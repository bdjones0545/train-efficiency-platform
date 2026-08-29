import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Check,
  ExternalLink,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders } from "@/lib/authToken";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavSuggestion = {
  type: "navigation_suggestion";
  intent: string;
  label: string;
  route: string;
  reason: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  blocks?: { navigation?: NavSuggestion[] };
  isStreaming?: boolean;
};

type Profile = {
  firstName?: string | null;
  role?: string | null;
  organizationId?: string | null;
};

type Organization = {
  name?: string | null;
};

const PROMPTS = [
  {
    title: "Start with today",
    prompt: "What should I focus on today?",
  },
  {
    title: "Find opportunities",
    prompt: "Which leads are most likely to convert?",
  },
  {
    title: "Check capacity",
    prompt: "Any open coaching slots this week?",
  },
  {
    title: "Prepare outreach",
    prompt: "Draft a follow-up for my newest lead",
  },
];

function formatRole(role?: string | null) {
  if (!role) return "Organization team";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function AssistantAvatar({ small = false }: { small?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
        small ? "h-7 w-7" : "h-9 w-9",
      )}
      aria-hidden="true"
    >
      <Brain className={small ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} />
    </div>
  );
}

function NavigationCards({ suggestions }: { suggestions: NavSuggestion[] }) {
  if (!suggestions?.length) return null;

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Kevin suggested destinations">
      {suggestions.map((suggestion) => (
        <button
          key={`${suggestion.intent}-${suggestion.route}`}
          type="button"
          onClick={() => window.location.assign(suggestion.route)}
          className="group flex min-h-[76px] items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid={`button-kevin-home-nav-${suggestion.intent}`}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {suggestion.label}
              <Check className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {suggestion.reason}
            </span>
          </span>
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function AssistantMessage({
  message,
  onRetry,
  canRetry,
}: {
  message: Message;
  onRetry?: () => void;
  canRetry?: boolean;
}) {
  const isError = message.content.startsWith("Something went wrong:");

  return (
    <div className="flex items-start gap-3" data-testid="kevin-home-assistant-message">
      <AssistantAvatar />
      <div className="min-w-0 max-w-3xl flex-1">
        <div
          className={cn(
            "rounded-2xl rounded-tl-md border px-4 py-3 text-sm leading-7 whitespace-pre-wrap",
            isError
              ? "border-destructive/30 bg-destructive/[0.05] text-destructive"
              : "border-border/80 bg-card text-card-foreground",
          )}
          aria-live={message.isStreaming ? "polite" : undefined}
        >
          {message.content || (
            <span className="inline-flex items-center gap-2 text-muted-foreground" role="status">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </span>
              Thinking…
            </span>
          )}
          {message.isStreaming && message.content && (
            <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-primary align-[-2px]" aria-hidden="true" />
          )}
        </div>
        {isError && canRetry && onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="mt-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            data-testid="button-kevin-home-retry"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Try again
          </Button>
        )}
        {!message.isStreaming && !isError && message.blocks?.navigation && (
          <NavigationCards suggestions={message.blocks.navigation} />
        )}
      </div>
    </div>
  );
}

export default function KevinHomeWorkspace() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [errorIndex, setErrorIndex] = useState<number | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: profile } = useQuery<Profile>({
    queryKey: ["/api/profile"],
  });
  const { data: organization } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", profile?.organizationId],
    queryFn: async () => {
      const response = await fetch(`/api/organizations/by-id/${profile?.organizationId}`);
      if (!response.ok) throw new Error("Failed to load organization");
      return response.json();
    },
    enabled: !!profile?.organizationId,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    };
  }, []);

  const resetThinking = () => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setThinking(false);
  };

  const sendMessage = async (value = input, retryIndex?: number) => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;

    let assistantIndex: number;
    let conversation: Message[];
    if (retryIndex !== undefined) {
      assistantIndex = retryIndex;
      conversation = messages.slice(0, retryIndex);
      setMessages((current) => {
        const next = [...current];
        next[assistantIndex] = { role: "assistant", content: "", isStreaming: true };
        return next;
      });
    } else {
      const userMessage: Message = { role: "user", content: trimmed };
      assistantIndex = messages.length + 1;
      conversation = [...messages, userMessage];
      setMessages([...conversation, { role: "assistant", content: "", isStreaming: true }]);
      setInput("");
    }

    setIsLoading(true);
    setErrorIndex(null);
    setThinking(false);
    thinkingTimerRef.current = setTimeout(() => setThinking(true), 700);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          messages: conversation.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Kevin could not answer right now.");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Kevin did not return a response stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let blocks: Message["blocks"];

      const consumeLine = (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith("data: ")) return;
        const data = trimmedLine.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.blocks) {
            blocks = { ...(blocks ?? {}), ...parsed.blocks };
          }
          if (typeof parsed.content === "string") accumulated += parsed.content;
          setMessages((current) => {
            const next = [...current];
            next[assistantIndex] = {
              role: "assistant",
              content: accumulated,
              blocks,
              isStreaming: true,
            };
            return next;
          });
        } catch {
          // Ignore malformed SSE frames; the stream can continue with later frames.
        }
      };

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consumeLine);
      }
      if (buffer) consumeLine(buffer);

      setMessages((current) => {
        const next = [...current];
        next[assistantIndex] = {
          role: "assistant",
          content: accumulated || "I couldn't process that. Please try again.",
          blocks,
          isStreaming: false,
        };
        return next;
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please try again.";
      setMessages((current) => {
        const next = [...current];
        next[assistantIndex] = {
          role: "assistant",
          content: `Something went wrong: ${message}`,
          isStreaming: false,
        };
        return next;
      });
      setErrorIndex(assistantIndex);
    } finally {
      resetThinking();
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    if (isLoading) return;
    setMessages([]);
    setErrorIndex(null);
    setInput("");
    inputRef.current?.focus();
  };

  const firstName = profile?.firstName || user?.firstName || "there";
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="kevin-home-workspace">
      <div className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between gap-4 border-b px-4 py-4 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <AssistantAvatar />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">Kevin</h1>
              <span className="hidden items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline-flex">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Ready to help
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {organization?.name || "Your organization"} · {formatRole(profile?.role)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startNewChat}
          disabled={!hasMessages || isLoading}
          className="shrink-0 gap-1.5"
          data-testid="button-kevin-home-new-chat"
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span className="hidden sm:inline">New conversation</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-8 md:px-8 md:py-12">
          {!hasMessages ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-8 ring-primary/[0.03]">
                <Brain className="h-8 w-8" aria-hidden="true" />
              </div>
              <p className="mb-2 text-sm font-medium text-primary">Good to see you, {firstName}</p>
              <h2 className="max-w-xl text-2xl font-semibold tracking-tight md:text-3xl">
                What would you like to move forward today?
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                Ask Kevin about your business, leads, scheduling, or retention. I’ll use your organization’s live context and point you to the right place when action is needed.
              </p>
              <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                {PROMPTS.map((item) => (
                  <button
                    key={item.prompt}
                    type="button"
                    onClick={() => {
                      setInput(item.prompt);
                      inputRef.current?.focus();
                    }}
                    className="rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    data-testid={`button-kevin-home-prompt-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span className="font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6" aria-label="Kevin conversation">
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <div key={index} className="flex items-start justify-end gap-3" data-testid="kevin-home-user-message">
                    <div className="max-w-3xl rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-7 text-primary-foreground whitespace-pre-wrap">
                      {message.content}
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                ) : (
                  <AssistantMessage
                    key={index}
                    message={{ ...message, ...(message.isStreaming && thinking && !message.content ? { content: "" } : {}) }}
                    onRetry={() => sendMessage(messages[index - 1]?.content || "", index)}
                    canRetry={errorIndex === index}
                  />
                ),
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-4 py-4 md:px-8 md:py-5">
        <div className="mx-auto w-full max-w-4xl">
          {isLoading && (
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Kevin is thinking…
            </div>
          )}
          <div
            className={cn(
              "flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow",
              composerFocused ? "border-primary/60 ring-2 ring-primary/10" : "border-border",
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask Kevin anything about your organization…"
              aria-label="Message Kevin"
              rows={1}
              disabled={isLoading}
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="input-kevin-home-message"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              aria-label="Send message to Kevin"
              className="h-10 w-10 shrink-0 rounded-xl"
              data-testid="button-kevin-home-send"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
            Kevin uses your organization context. Review suggested destinations before opening them.
          </p>
        </div>
      </div>
    </div>
  );
}