import { useState, useRef, useEffect, Component } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Send, User, Brain, AlertTriangle, CheckCircle2, XCircle,
  Loader2, MessageSquare, Inbox, Mail, Clock, RefreshCw,
  PauseCircle, ChevronRight, ExternalLink, History, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { getAuthHeaders } from "@/lib/authToken";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "chat" | "inbox";

interface NavSuggestion {
  type: "navigation_suggestion";
  intent: string;
  label: string;
  route: string;
  reason: string;
}

interface MessageBlocks {
  navigation?: NavSuggestion[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  blocks?: MessageBlocks;
}

// ─── Streaming bubble (preserved) ─────────────────────────────────────────────

function StreamingBubble({ content, isStreaming, showThinking }: {
  content: string; isStreaming: boolean; showThinking: boolean;
}) {
  const prevLenRef = useRef(0);
  const chunksRef = useRef<{ text: string; key: number }[]>([]);
  const keyRef = useRef(0);

  if (content.length > prevLenRef.current) {
    const newText = content.slice(prevLenRef.current);
    chunksRef.current = [...chunksRef.current, { text: newText, key: keyRef.current++ }];
    prevLenRef.current = content.length;
  }

  if (!content && !showThinking && isStreaming)
    return <span className="chat-cursor" aria-hidden="true" />;

  if (!content && showThinking)
    return (
      <span className="text-zinc-400 text-xs italic">
        Thinking…{isStreaming && <span className="chat-cursor ml-1" aria-hidden="true" />}
      </span>
    );

  return (
    <>
      {chunksRef.current.map(chunk => (
        <span key={chunk.key} className="chat-token">{chunk.text}</span>
      ))}
      {isStreaming && <span className="chat-cursor" aria-hidden="true" />}
    </>
  );
}

// ─── Portal error boundary — hard containment, never reaches PageErrorBoundary ─

class BrainPortalErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message ?? "unknown" };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[BrainPortalErrorBoundary] caught:", error.message);
    console.error(info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      // Render null — the portal DOM is orphaned from the page tree,
      // so this can NEVER propagate to PageErrorBoundary.
      return null;
    }
    return this.props.children;
  }
}

// ─── Navigation suggestion buttons (server-approved routes only) ──────────────

function NavSuggestionButtons({ suggestions }: { suggestions: NavSuggestion[] }) {
  if (!suggestions?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-1 ml-9 max-w-[78%]">
      {suggestions.map(s => (
        <button
          key={s.intent + s.route}
          type="button"
          onClick={() => {
            // Full navigation is portal-safe (no setLocation inside the portal).
            window.location.assign(s.route);
          }}
          className="flex items-center justify-between gap-2 rounded-lg bg-green-950/40 border border-green-800/50 hover:border-green-600/70 px-3 py-2 text-left transition-all"
          data-testid={`button-kevin-nav-${s.intent}`}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-green-300 truncate">{s.label}</p>
            {s.reason && <p className="text-[10px] text-zinc-500 truncate">{s.reason}</p>}
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-green-500 shrink-0" />
        </button>
      ))}
    </div>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => { if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current); }, []);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    const userMsg: Message = { role: "user", content: trimmed };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsLoading(true);
    setShowThinking(false);

    const idx = updated.length;
    setMessages(prev => [...prev, { role: "assistant", content: "", isStreaming: true }]);
    setStreamingIndex(idx);
    thinkingTimerRef.current = setTimeout(() => setShowThinking(true), 700);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ messages: updated.map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Error");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let accumulated = ""; let buffer = ""; let hasStarted = false;
      let blocks: MessageBlocks | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data: ")) continue;
          const data = t.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.blocks) {
              blocks = { ...(blocks ?? {}), ...parsed.blocks };
              setMessages(prev => { const u = [...prev]; u[idx] = { ...u[idx], blocks }; return u; });
            }
            if (parsed.content) {
              if (!hasStarted) {
                hasStarted = true;
                if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
                setShowThinking(false);
              }
              accumulated += parsed.content;
              setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: accumulated, isStreaming: true, blocks }; return u; });
            }
          } catch {}
        }
      }
      setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: accumulated || "I couldn't process that. Please try again.", isStreaming: false, blocks }; return u; });
    } catch (err: any) {
      if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
      setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: `Something went wrong: ${err.message}`, isStreaming: false }; return u; });
    } finally {
      setIsLoading(false);
      setStreamingIndex(null);
      setShowThinking(false);
    }
  };

  const PROMPTS = [
    "What should I focus on today?",
    "Which leads are most likely to convert?",
    "Any open coaching slots this week?",
    "Draft a follow-up for my newest lead",
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-3 gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
              <Brain className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200 mb-1">Kevin</p>
              <p className="text-xs text-zinc-500">Ask about your business, leads, scheduling, or retention — or ask Kevin to draft outreach for your review.</p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full mt-1">
              {PROMPTS.map(p => (
                <button key={p} onClick={() => { setInput(p); inputRef.current?.focus(); }}
                  className="text-left text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-lg px-3 py-2 transition-all">
                  "{p}"
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          const isActive = msg.isStreaming && streamingIndex === i;
          return (
            <div key={i}>
              <div className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-message-${msg.role}-${i}`}>
                {msg.role === "assistant" && (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-green-600 flex items-center justify-center mt-0.5">
                    <Brain className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className={`max-w-[78%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                  msg.role === "user" ? "bg-green-600 text-white" : isActive ? "bg-zinc-800 text-zinc-100 chat-bubble-streaming" : "bg-zinc-800 text-zinc-100"
                }`}>
                  {msg.role === "assistant" ? (
                    isActive ? <StreamingBubble content={msg.content} isStreaming showThinking={showThinking} /> : (msg.content || <span className="text-zinc-500 italic text-xs">—</span>)
                  ) : msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center mt-0.5">
                    <User className="h-4 w-4 text-zinc-400" />
                  </div>
                )}
              </div>
              {msg.role === "assistant" && !isActive && msg.blocks?.navigation && (
                <NavSuggestionButtons suggestions={msg.blocks.navigation} />
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-zinc-700/60">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Kevin…"
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-500/50 min-h-[38px] max-h-[100px]"
            rows={1}
            disabled={isLoading}
            data-testid="input-chat-message"
          />
          <Button size="icon" onClick={sendMessage} disabled={!input.trim() || isLoading}
            className="h-9 w-9 bg-green-600 hover:bg-green-700 text-white shrink-0" data-testid="button-send-chat">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {isLoading && <p className="text-[10px] text-zinc-600 mt-1.5 tracking-wide">Kevin is thinking…</p>}
      </div>
    </div>
  );
}

// ─── Inbox Tab — org AI communication center ──────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  executed: "text-green-400 bg-green-500/15",
  auto_executed: "text-green-400 bg-green-500/15",
  sent: "text-green-400 bg-green-500/15",
  failed: "text-red-400 bg-red-500/15",
  rejected: "text-zinc-400 bg-zinc-700/60",
  dismissed: "text-zinc-400 bg-zinc-700/60",
  cancelled: "text-zinc-400 bg-zinc-700/60",
  skipped: "text-zinc-400 bg-zinc-700/60",
};

function timeAgo(dt: string | null | undefined): string {
  if (!dt) return "—";
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (m < 60) return `${m}m ${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${suffix}`;
  return `${Math.floor(h / 24)}d ${suffix}`;
}

// ─── Thread item for Kevin's AgentMail inbox ──────────────────────────────────

function ThreadItem({ thread }: { thread: any }) {
  const isUnread = thread.isRead === false;
  return (
    <div className={`rounded-lg border px-3 py-2.5 mb-1.5 ${isUnread ? "bg-zinc-800 border-zinc-600" : "bg-zinc-800/40 border-zinc-700/50"}`}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isUnread && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" />}
            <p className={`text-xs truncate leading-tight ${isUnread ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
              {thread.subject}
            </p>
          </div>
          {thread.from && (
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
              From: {thread.fromName ? `${thread.fromName} <${thread.from}>` : thread.from}
            </p>
          )}
          {thread.snippet && (
            <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-relaxed">{thread.snippet}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {thread.date && <p className="text-[9px] text-zinc-600">{timeAgo(thread.date)}</p>}
          {thread.messageCount > 1 && (
            <span className="text-[9px] bg-zinc-700 text-zinc-400 px-1 py-0.5 rounded">{thread.messageCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxTab({ onOpenRoute }: { onOpenRoute: (route: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/kevin/inbox"],
    queryFn: () => fetchJson("/api/kevin/inbox"),
    refetchInterval: 20000,
    retry: 1,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/kevin/inbox"] });
    qc.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
    qc.invalidateQueries({ queryKey: ["/api/ai-approvals/metrics"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/ai-approvals/${id}/approve`, {}),
    onSuccess: () => { toast({ title: "Approved — email will be sent" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error approving", description: e?.message, variant: "destructive" }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/ai-approvals/${id}/reject`, { reason: "Rejected via Kevin Inbox" }),
    onSuccess: () => { toast({ title: "Rejected" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error rejecting", description: e?.message, variant: "destructive" }),
  });
  const approveFollowupMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/approve`, {}),
    onSuccess: () => { toast({ title: "Follow-up approved" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error approving follow-up", description: e?.message, variant: "destructive" }),
  });
  const cancelFollowupMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/agentmail/followups/${id}/cancel`, {}),
    onSuccess: () => { toast({ title: "Follow-up cancelled" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error cancelling", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="flex-1 p-4 space-y-2">
      {[1, 2, 3].map(i => <div key={i} className="h-20 bg-zinc-800/60 rounded-lg animate-pulse" />)}
    </div>
  );

  if (isError) return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm text-zinc-300">Couldn't load your inbox</p>
      <Button size="sm" onClick={() => refetch()} className="bg-green-600 hover:bg-green-700 text-white">
        <RefreshCw className="h-3 w-3 mr-1" /> Retry
      </Button>
    </div>
  );

  const kevinInbox = data?.kevinInbox ?? {};
  const orgLabel = data?.orgLabel ?? null;
  const kevinThreads: any[] = Array.isArray(kevinInbox.threads) ? kevinInbox.threads : [];
  const approvals: any[] = Array.isArray(data?.approvals) ? data.approvals : [];
  const followups: any[] = Array.isArray(data?.followups) ? data.followups : [];
  const recent: any[] = Array.isArray(data?.recentActivity) ? data.recentActivity : [];
  const automations = data?.automations ?? {};
  const sequences: any[] = Array.isArray(automations.sequences) ? automations.sequences : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Emergency pause banner */}
      {automations.emergencyPaused && (
        <div className="rounded-lg bg-amber-950/40 border border-amber-700/50 p-3 flex items-start gap-2">
          <PauseCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-300">All AI communication is paused</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Nothing will send until automation is resumed in AI Workforce Settings.</p>
          </div>
        </div>
      )}

      {/* Kevin's AgentMail inbox */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold text-green-400 uppercase tracking-widest flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Kevin's Inbox
          </p>
          <span className="text-[9px] text-zinc-600 font-mono">kevin@trainefficiency.com</span>
        </div>

        {/* Org label badge — truthful status only */}
        {orgLabel && (
          <div className="flex items-center justify-between gap-2 mb-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider shrink-0">Your label:</span>
              <span className="text-[11px] font-mono font-semibold text-green-300 truncate">{orgLabel.labelName}</span>
            </div>
            {orgLabel.syncStatus === "created" ? (
              <span className="text-[9px] font-semibold text-green-400 bg-green-500/15 px-1.5 py-0.5 rounded-full shrink-0">Created</span>
            ) : orgLabel.syncStatus === "failed" ? (
              <span className="text-[9px] font-semibold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full shrink-0">Failed</span>
            ) : (
              <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full shrink-0">Pending VM</span>
            )}
          </div>
        )}

        {!kevinInbox.configured ? (
          <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 p-3 text-center">
            <p className="text-xs text-amber-400 font-medium">AgentMail not configured</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Add AGENTMAIL_API_KEY to connect Kevin's inbox</p>
          </div>
        ) : kevinThreads.length === 0 ? (
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3 text-center">
            <p className="text-xs text-zinc-500">Kevin's inbox is empty</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">Inbound emails to kevin@trainefficiency.com will appear here</p>
          </div>
        ) : (
          <>
            {kevinThreads.slice(0, 8).map((t: any) => (
              <ThreadItem key={t.id} thread={t} />
            ))}
            {kevinThreads.length > 8 && (
              <button type="button" onClick={() => onOpenRoute("/admin/agentmail")}
                className="w-full text-center text-[11px] text-green-400 hover:text-green-300 py-1.5">
                View all {kevinInbox.threadCount} threads →
              </button>
            )}
          </>
        )}
      </div>

      {/* Pending approval drafts */}
      <div>
        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Mail className="h-3 w-3" /> Emails awaiting your approval ({approvals.length})
        </p>
        {approvals.length === 0 ? (
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3 text-center">
            <p className="text-xs text-zinc-500">No emails waiting for review</p>
          </div>
        ) : approvals.slice(0, 8).map(item => (
          <div key={item.id} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 space-y-2 mb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-200 truncate">{item.subject || item.actionType || "Draft email"}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                  To: {item.recipientEmail || "—"}{item.riskLevel && ` · ${item.riskLevel} risk`}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>
            </div>
            {item.bodyPreview && (
              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">{item.bodyPreview}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white flex-1"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate(item.id)}
                data-testid={`button-kevin-approve-${item.id}`}>
                {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-red-800/50 text-red-400 hover:bg-red-950/30 flex-1"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(item.id)}
                data-testid={`button-kevin-reject-${item.id}`}>
                <XCircle className="h-3 w-3 mr-1" /> Reject
              </Button>
            </div>
          </div>
        ))}
        {approvals.length > 8 && (
          <button type="button" onClick={() => onOpenRoute("/admin/ai-approvals")}
            className="w-full text-center text-[11px] text-green-400 hover:text-green-300 py-1.5">
            View all {approvals.length} in AI Approvals →
          </button>
        )}
      </div>

      {/* Scheduled follow-ups */}
      <div>
        <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> Scheduled follow-ups ({followups.length})
        </p>
        {followups.length === 0 ? (
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3 text-center">
            <p className="text-xs text-zinc-500">No follow-ups scheduled</p>
          </div>
        ) : followups.slice(0, 6).map(f => (
          <div key={f.id} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 mb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{f.subject}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                  To: {f.recipientName || f.recipientEmail} · Step {f.sequenceStep} · {timeAgo(f.scheduledFor)}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                f.approvalStatus === "approved" ? "text-green-400 bg-green-500/15" : "text-amber-400 bg-amber-500/15"
              }`}>{f.approvalStatus === "approved" ? "Approved" : "Needs review"}</span>
            </div>
            <div className="flex gap-2 pt-2">
              {f.approvalStatus !== "approved" && (
                <Button size="sm" className="h-6 text-[11px] bg-green-600 hover:bg-green-700 text-white flex-1"
                  disabled={approveFollowupMutation.isPending}
                  onClick={() => approveFollowupMutation.mutate(f.id)}
                  data-testid={`button-kevin-followup-approve-${f.id}`}>
                  Approve
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-6 text-[11px] border-zinc-700 text-zinc-400 hover:text-zinc-200 flex-1"
                disabled={cancelFollowupMutation.isPending}
                onClick={() => cancelFollowupMutation.mutate(f.id)}
                data-testid={`button-kevin-followup-cancel-${f.id}`}>
                Cancel
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Active automations */}
      <div>
        <p className="text-[10px] font-semibold text-green-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Zap className="h-3 w-3" /> Active automations
        </p>
        {sequences.length === 0 ? (
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3 text-center">
            <p className="text-xs text-zinc-500">No active email sequences</p>
          </div>
        ) : sequences.map((s: any) => (
          <div key={s.sequenceName} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{s.sequenceName}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {s.scheduledSteps} step{s.scheduledSteps !== 1 ? "s" : ""} queued
                {s.nextScheduledFor ? ` · next ${timeAgo(s.nextScheduledFor)}` : ""}
              </p>
            </div>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
              automations.emergencyPaused ? "text-amber-400 bg-amber-500/15" : "text-green-400 bg-green-500/15"
            }`}>{automations.emergencyPaused ? "Paused" : "Active"}</span>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div>
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <History className="h-3 w-3" /> Recent activity
        </p>
        {recent.length === 0 ? (
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3 text-center">
            <p className="text-xs text-zinc-500">No recent email activity</p>
          </div>
        ) : recent.slice(0, 10).map((r: any) => (
          <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-2 py-1.5 border-b border-zinc-800/80 last:border-0">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-300 truncate">{r.subject || "(no subject)"}</p>
              <p className="text-[10px] text-zinc-600 truncate">
                {r.recipientEmail || "—"} · {timeAgo(r.at)}
                {r.errorMessage ? ` · ${r.errorMessage}` : ""}
              </p>
            </div>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[r.status] ?? "text-zinc-400 bg-zinc-700/60"}`}>
              {r.status}
            </span>
          </div>
        ))}
      </div>

      {/* Deep links */}
      <div className="space-y-1.5 pb-1">
        {[
          { label: "Full AI Approvals Inbox", route: "/admin/ai-approvals" },
          { label: "AgentMail Follow-Ups", route: "/admin/agentmail" },
          { label: "Lead Pipeline", route: "/admin/lead-pipeline" },
        ].map(link => (
          <button key={link.route} type="button" onClick={() => onOpenRoute(link.route)}
            className="w-full flex items-center justify-between gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-500/80 px-3 py-2.5 transition-all text-left">
            <span className="text-xs text-zinc-300">{link.label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Local error boundary for the Kevin panel ─────────────────────────────────

interface ChatWidgetBoundaryState { hasError: boolean }

class ChatWidgetErrorBoundary extends Component<
  { children: React.ReactNode; onClose: () => void },
  ChatWidgetBoundaryState
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): ChatWidgetBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ChatWidget] Panel render error:", error.message, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-zinc-200">Kevin failed to load</p>
            <p className="text-xs text-zinc-500 mt-1">A rendering error occurred. Try retrying or closing the panel.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => this.setState({ hasError: false })}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
            <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
              onClick={() => this.props.onClose()}>
              <X className="h-3 w-3 mr-1" /> Close
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Tab navigation config ────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "chat",  label: "Kevin Chat",  icon: MessageSquare },
  { id: "inbox", label: "Kevin Inbox", icon: Inbox },
];

// ─── Main Widget — Kevin launcher (Chat + Inbox only) ─────────────────────────

export function ChatWidget() {
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // isClosing: true from the moment X is pressed until the panel fully exits.
  // While true, ALL tab content (and their queries) is replaced with an empty
  // spacer so nothing can throw during the 300ms slide-out animation.
  const [isClosing, setIsClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  // Role gate — Kevin is only for ADMIN and COACH roles.
  const { data: profile, isLoading: profileLoading } = useQuery<{ role?: string }>({
    queryKey: ["/api/profile"],
    staleTime: 5 * 60_000,
  });
  const userRole = profile?.role ?? null;
  const isAllowed = userRole === "ADMIN" || userRole === "COACH";

  const { data: approvalMetrics } = useQuery<any>({
    queryKey: ["/api/ai-approvals/metrics"],
    queryFn: () => fetchJson("/api/ai-approvals/metrics"),
    refetchInterval: 30000,
    enabled: isAllowed && isMounted && !isClosing,
  });

  const pendingCount = approvalMetrics?.pending ?? 0;

  const handleOpen = () => {
    setIsClosing(false);
    setIsMounted(true);
    requestAnimationFrame(() => setIsOpen(true));
  };

  const handleClose = () => {
    // Drop tab content immediately — prevents ANY query-powered tab component
    // from rendering (and potentially crashing) during the slide-out animation.
    setIsClosing(true);
    setIsOpen(false);
  };

  // Portal-safe deep navigation: full page navigation, never setLocation.
  const handleOpenRoute = (route: string) => {
    window.location.assign(route);
  };

  // Only unmount once the panel's OWN transform transition ends.
  const handlePanelTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.currentTarget !== (e.target as Element)) return;
    if (e.propertyName !== "transform") return;
    if (isOpen) return;
    setIsMounted(false);
    setIsClosing(false);
  };

  // Hide entirely for non-admin/coach roles. Wait for profile to load first
  // so there is no flash for regular users. Return null after all hooks.
  if (profileLoading || !isAllowed) return null;

  return createPortal(
    <BrainPortalErrorBoundary>
      {/* Backdrop */}
      {isMounted && (
        <div
          aria-hidden="true"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          className="fixed inset-0 z-[9990] bg-black/50 transition-opacity duration-300"
          style={{ opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none" }}
        />
      )}

      {/* Right-side drawer panel */}
      {isMounted && (
        <div
          data-testid="chat-widget-panel"
          className={[
            "fixed top-0 right-0 z-[9995] flex flex-col",
            "h-[100dvh] w-full sm:w-[420px]",
            "bg-zinc-900 border-l border-zinc-700",
            "shadow-[-8px_0_40px_rgba(0,0,0,0.5)]",
            "sm:rounded-l-2xl overflow-hidden",
            "transition-transform duration-300 ease-out",
            isOpen ? "translate-x-0" : "translate-x-full",
          ].join(" ")}
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
          onTransitionEnd={handlePanelTransitionEnd}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-700/60 bg-zinc-900/95 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center shrink-0">
                <Brain className="text-white" style={{ width: 18, height: 18 }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white leading-none">Kevin</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Your AI operations assistant</p>
              </div>
            </div>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-zinc-500 hover:text-zinc-300 no-default-hover-elevate shrink-0"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClose(); }}
              data-testid="button-close-chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Tab content — fully unmounted while isClosing to prevent any
              query-powered component from rendering during the slide-out. */}
          {isClosing ? (
            <div className="flex-1" aria-hidden="true" />
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <ChatWidgetErrorBoundary key={String(isMounted)} onClose={handleClose}>
                {activeTab === "chat"  && <ChatTab />}
                {activeTab === "inbox" && <InboxTab onOpenRoute={handleOpenRoute} />}
              </ChatWidgetErrorBoundary>
            </div>
          )}

          {/* Bottom tab bar */}
          <div
            className="shrink-0 border-t border-zinc-700/60 bg-zinc-900/95 flex"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showBadge = tab.id === "inbox" && pendingCount > 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`tab-kevin-${tab.id}`}
                  className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors relative ${
                    isActive ? "text-green-400" : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  <div className="relative">
                    <Icon className="h-4 w-4" />
                    {showBadge && (
                      <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center bg-red-500 text-white text-[8px] font-bold rounded-full px-0.5">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                  {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-green-400 rounded-full" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating action button — only shown when drawer is closed */}
      {!isOpen && (
        <button
          type="button"
          className="fixed right-5 z-[9999] flex items-center justify-center h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-green-600 text-white shadow-[0_4px_24px_rgba(34,197,94,0.4)] hover:scale-105 active:scale-95 transition-transform"
          style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleOpen(); }}
          aria-label="Open Kevin"
          data-testid="button-toggle-chat"
        >
          <Brain className="h-6 w-6 sm:h-7 sm:w-7" />
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </button>
      )}
    </BrainPortalErrorBoundary>,
    document.body
  );
}
