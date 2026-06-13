import { useState, useRef, useEffect, useCallback, Component } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  X, Send, Bot, User, Brain, Activity, CheckCircle2, AlertTriangle,
  Clock, Zap, Users, ListTodo, Bell, Settings, MessageSquare,
  TrendingUp, Flame, RefreshCw, ChevronRight, Shield, ToggleLeft,
  ToggleRight, XCircle, Loader2, Home, BarChart3, Target,
  Mail, CalendarCheck, Briefcase, BookOpen, FileText, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { getAuthHeaders } from "@/lib/authToken";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "ceo" | "chat" | "agents" | "tasks" | "approvals" | "settings";

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
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

// ─── Obsidian Status Card ─────────────────────────────────────────────────────

function ObsidianStatusCard() {
  const { data } = useQuery<any>({
    queryKey: ["/api/obsidian/status"],
    queryFn: () => fetchJson("/api/obsidian/status"),
    staleTime: 60_000,
    retry: false,
  });

  if (!data?.configured) return null;

  const connected = data?.connected ?? false;
  const lastSync = data?.lastSyncAt
    ? new Date(data.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3">
      <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <BookOpen className="h-3 w-3" /> Obsidian Memory
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {[
          { label: "Status",       value: connected ? "Connected" : "Offline",          color: connected ? "text-green-400" : "text-red-400" },
          { label: "Last Sync",    value: lastSync,                                      color: "text-zinc-300" },
          { label: "Notes Today",  value: data?.notesCreatedToday ?? 0,                 color: "text-purple-400" },
          { label: "Searches",     value: data?.searchesPerformed ?? 0,                 color: "text-blue-400" },
        ].map(row => (
          <div key={row.label} className="flex items-baseline gap-1.5 text-xs min-w-0">
            <span className="text-zinc-500 shrink-0">{row.label}:</span>
            <span className={`${row.color} truncate font-medium`}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CEO Home Tab ─────────────────────────────────────────────────────────────

function CeoHomeTab({ onSwitchTab }: { onSwitchTab: (t: Tab) => void }) {
  const { data: heartbeat } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/status"],
    queryFn: () => fetchJson("/api/admin/ceo-heartbeat/status"),
    refetchInterval: 30000,
  });
  const { data: prioritiesData } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/priorities"],
    queryFn: () => fetchJson("/api/admin/ceo-heartbeat/priorities"),
  });
  const { data: agents } = useQuery<any>({
    queryKey: ["/api/workforce/agents"],
    queryFn: () => fetchJson("/api/workforce/agents"),
  });
  const { data: approvalMetrics } = useQuery<any>({
    queryKey: ["/api/ai-approvals/metrics"],
    queryFn: () => fetchJson("/api/ai-approvals/metrics"),
  });

  const agentsList: any[] = Array.isArray(agents) ? agents : [];
  const activeAgents = agentsList.filter(a => a.enabled).length;
  const totalAgents = agentsList.length;
  const pendingApprovals = approvalMetrics?.pending ?? 0;
  const lastRun = heartbeat?.lastRun;
  const nextRun = heartbeat?.nextRun;
  const successRate = heartbeat?.successRate ?? null;

  const rawPriorities: any[] = Array.isArray(prioritiesData?.priorities)
    ? prioritiesData.priorities
    : Array.isArray(prioritiesData)
      ? prioritiesData
      : [];
  const topPriorities = rawPriorities.slice(0, 3);

  const summaryItems = [
    pendingApprovals > 0 && `${pendingApprovals} approval${pendingApprovals !== 1 ? "s" : ""} waiting for review.`,
    activeAgents > 0 && `${activeAgents} of ${totalAgents} agents active.`,
    successRate != null && `Heartbeat success rate: ${successRate}%.`,
  ].filter(Boolean) as string[];

  // Compute the single best action for today
  const bestAction: { title: string; description: string; cta: string; tab?: Tab } = (() => {
    if (pendingApprovals > 0) {
      return {
        title: `Review ${pendingApprovals} pending approval${pendingApprovals !== 1 ? "s" : ""}`,
        description: "AI agents are waiting for your sign-off before sending outreach or taking action.",
        cta: "Open Approvals",
        tab: "approvals",
      };
    }
    const top = topPriorities[0];
    if (top) {
      return {
        title: top.title || top.action || "Review top priority",
        description: top.description || top.reason || "Your highest-priority item needs attention.",
        cta: "View Details",
      };
    }
    if (totalAgents > 0 && activeAgents === 0) {
      return {
        title: "Activate your AI workforce",
        description: "No agents are currently running. Enable agents to start automating outreach and follow-ups.",
        cta: "View Agents",
        tab: "agents",
      };
    }
    if (activeAgents < totalAgents) {
      return {
        title: `${totalAgents - activeAgents} agent${totalAgents - activeAgents !== 1 ? "s" : ""} available but idle`,
        description: "Review and enable additional agents to expand your automation coverage.",
        cta: "View Agents",
        tab: "agents",
      };
    }
    return {
      title: "Operations look good",
      description: `${activeAgents} agent${activeAgents !== 1 ? "s" : ""} running, no pending approvals. Check heartbeat for any background risks.`,
      cta: "Ask CEO Agent",
      tab: "chat",
    };
  })();

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Best Action Today */}
      <div className="rounded-xl bg-gradient-to-br from-green-950/60 to-green-900/30 border border-green-700/50 p-4">
        <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Zap className="h-3 w-3" /> Best Action Today
        </p>
        <p className="text-sm font-semibold text-white leading-snug">{bestAction.title}</p>
        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{bestAction.description}</p>
        <button
          onClick={() => bestAction.tab && onSwitchTab(bestAction.tab)}
          className="mt-3 w-full py-2 rounded-lg bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-xs font-semibold transition-colors"
          data-testid="button-best-action-today"
        >
          {bestAction.cta}
        </button>
      </div>

      {/* Workforce status */}
      <div>
        <p className="text-[10px] font-semibold text-green-400 uppercase tracking-widest mb-2">AI Workforce Status</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Active Agents", value: activeAgents, icon: Users, color: "text-green-400" },
            { label: "Total Agents", value: totalAgents, icon: Bot, color: "text-zinc-400" },
            { label: "Pending Approvals", value: pendingApprovals, icon: Bell, color: pendingApprovals > 0 ? "text-amber-400" : "text-zinc-500",
              action: pendingApprovals > 0 ? () => onSwitchTab("approvals") : undefined },
            { label: "Heartbeat", value: successRate != null ? `${successRate}%` : "—", icon: Activity, color: "text-cyan-400" },
          ].map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                onClick={s.action}
                className={`rounded-lg bg-zinc-800/70 border border-zinc-700/60 p-3 text-left transition-all ${s.action ? "hover:border-zinc-500/80 cursor-pointer" : "cursor-default"}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`h-3 w-3 ${s.color}`} />
                  <span className="text-[10px] text-zinc-500">{s.label}</span>
                </div>
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Heartbeat status */}
      <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> Heartbeat
        </p>
        {[
          { label: "Last run", value: lastRun ? new Date(lastRun).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—" },
          { label: "Next run", value: nextRun ? new Date(nextRun).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Automatic" },
          { label: "Success rate", value: successRate != null ? `${successRate}%` : "—" },
        ].map(row => (
          <div key={row.label} className="flex items-baseline gap-1.5 text-xs min-w-0">
            <span className="text-zinc-500 shrink-0">{row.label}:</span>
            <span className="text-zinc-300 truncate">{row.value}</span>
          </div>
        ))}
      </div>

      {/* Obsidian Memory Status */}
      <ObsidianStatusCard />

      {/* Executive summary */}
      {summaryItems.length > 0 && (
        <div className="rounded-lg bg-green-950/30 border border-green-800/40 p-3">
          <p className="text-[10px] font-semibold text-green-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Brain className="h-3 w-3" /> CEO Summary
          </p>
          <ul className="space-y-1">
            {summaryItems.map((item, i) => (
              <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top priorities */}
      {topPriorities.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Flame className="h-3 w-3" /> Top Priorities
          </p>
          <div className="space-y-2">
            {topPriorities.map((p: any, i: number) => (
              <div key={i} className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-zinc-200 leading-snug">{p.title || p.action || "Priority item"}</p>
                  {p.priority && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                      p.priority === "critical" ? "bg-red-500/20 text-red-400" :
                      p.priority === "high" ? "bg-amber-500/20 text-amber-400" :
                      "bg-zinc-700 text-zinc-400"
                    }`}>{p.priority}</span>
                  )}
                </div>
                {(p.description || p.reason) && (
                  <p className="text-[11px] text-zinc-500 mt-1 leading-snug">{p.description || p.reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick nav buttons */}
      <div className="grid grid-cols-2 gap-2 pb-1">
        {([
          { label: "View Agents", tab: "agents" as Tab, icon: Users },
          { label: "Review Approvals", tab: "approvals" as Tab, icon: CheckCircle2 },
          { label: "Workforce Tasks", tab: "tasks" as Tab, icon: ListTodo },
          { label: "Ask CEO Agent", tab: "chat" as Tab, icon: MessageSquare },
        ]).map(btn => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.label}
              onClick={() => onSwitchTab(btn.tab)}
              className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 hover:border-green-700/50 hover:bg-zinc-800 p-3 flex items-center gap-2 text-left transition-all"
            >
              <Icon className="h-4 w-4 text-green-400 shrink-0" />
              <span className="text-xs text-zinc-300">{btn.label}</span>
            </button>
          );
        })}
      </div>
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
            if (parsed.content) {
              if (!hasStarted) {
                hasStarted = true;
                if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
                setShowThinking(false);
              }
              accumulated += parsed.content;
              setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: accumulated, isStreaming: true }; return u; });
            }
          } catch {}
        }
      }
      setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: accumulated || "I couldn't process that. Please try again.", isStreaming: false }; return u; });
    } catch (err: any) {
      if (thinkingTimerRef.current) { clearTimeout(thinkingTimerRef.current); thinkingTimerRef.current = null; }
      setMessages(prev => { const u = [...prev]; u[idx] = { role: "assistant", content: `Something went wrong: ${err.message}`, isStreaming: false }; return u; });
    } finally {
      setIsLoading(false);
      setStreamingIndex(null);
      setShowThinking(false);
    }
  };

  const PROMPTS = ["What should I focus on today?", "Which leads are most likely to convert?", "Any revenue risks?", "What did the heartbeat discover?"];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-3 gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
              <Brain className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200 mb-1">CEO Agent</p>
              <p className="text-xs text-zinc-500">Ask me about your business — revenue risks, lead conversion, coach capacity, retention, or anything else.</p>
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
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
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
            placeholder="Ask the CEO Agent…"
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
        {isLoading && <p className="text-[10px] text-zinc-600 mt-1.5 tracking-wide">CEO Agent thinking…</p>}
      </div>
    </div>
  );
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

const AGENT_ICON_MAP: Record<string, any> = {
  revenue: TrendingUp, growth: BarChart3, scheduling: CalendarCheck, retention: Users,
  client_success: Briefcase, outreach: Mail, team_training: Target, hiring: Users,
  operations: Settings, software_improvement: Zap,
};

function AgentsTab() {
  const { data: agentsRaw, isLoading } = useQuery<any>({
    queryKey: ["/api/workforce/agents"],
    queryFn: () => fetchJson("/api/workforce/agents"),
  });

  const agents: any[] = Array.isArray(agentsRaw) ? agentsRaw : [];

  if (isLoading) return (
    <div className="flex-1 p-4 space-y-2">
      {[1,2,3,4].map(i => <div key={i} className="h-16 bg-zinc-800/60 rounded-lg animate-pulse" />)}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">
        {agents.filter(a => a.enabled).length} of {agents.length} agents active
      </p>
      {agents.map(agent => {
        const Icon = AGENT_ICON_MAP[agent.agentType] || Bot;
        const sr = agent.successRate;
        return (
          <div key={agent.agentType} data-testid={`agent-card-${agent.agentType}`}
            className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${agent.enabled ? "bg-green-500/20" : "bg-zinc-700/60"}`}>
                  <Icon className={`h-3.5 w-3.5 ${agent.enabled ? "text-green-400" : "text-zinc-500"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-200 truncate">{agent.displayName || agent.agentType}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{agent.description || agent.role || ""}</p>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                agent.enabled ? "bg-green-500/20 text-green-400" : "bg-zinc-700 text-zinc-500"
              }`}>{agent.enabled ? "Active" : "Off"}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><Activity className="h-2.5 w-2.5" />{agent.recentActions ?? 0} actions</span>
              {sr != null && (
                <span className={`flex items-center gap-1 ${sr >= 80 ? "text-green-400" : sr >= 60 ? "text-amber-400" : "text-red-400"}`}>
                  <TrendingUp className="h-2.5 w-2.5" />{sr}% success
                </span>
              )}
              {agent.blockedActions > 0 && (
                <span className="flex items-center gap-1 text-amber-400">
                  <Shield className="h-2.5 w-2.5" />{agent.blockedActions} blocked
                </span>
              )}
            </div>
            {agent.disabledReason && (
              <p className="text-[10px] text-zinc-600 mt-1 italic">{agent.disabledReason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

function TasksTab() {
  const { data: runsRaw, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/ceo-heartbeat/runs"],
    queryFn: () => fetchJson("/api/admin/ceo-heartbeat/runs"),
  });
  const runs: any[] = Array.isArray(runsRaw?.runs)
    ? runsRaw.runs
    : Array.isArray(runsRaw)
      ? runsRaw
      : [];

  function timeAgo(dt: string) {
    const diff = Date.now() - new Date(dt).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  if (isLoading) return (
    <div className="flex-1 p-4 space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-14 bg-zinc-800/60 rounded-lg animate-pulse" />)}
    </div>
  );

  const grouped = {
    running: (runs ?? []).filter(r => r.status === "running"),
    completed: (runs ?? []).filter(r => r.status === "completed"),
    failed: (runs ?? []).filter(r => r.status === "failed"),
  };

  const statusCfg: Record<string, { color: string; icon: any; bg: string }> = {
    running:   { color: "text-cyan-400",    icon: Loader2, bg: "bg-cyan-500/15" },
    completed: { color: "text-green-400",   icon: CheckCircle2, bg: "bg-green-500/15" },
    failed:    { color: "text-red-400",     icon: XCircle, bg: "bg-red-500/15" },
  };

  const allRuns = [...grouped.running, ...grouped.completed, ...grouped.failed].slice(0, 20);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Running", count: grouped.running.length, color: "text-cyan-400" },
          { label: "Done", count: grouped.completed.length, color: "text-green-400" },
          { label: "Failed", count: grouped.failed.length, color: "text-red-400" },
        ].map(s => (
          <div key={s.label} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-center">
            <p className={`text-base font-bold ${s.color}`}>{s.count}</p>
            <p className="text-[10px] text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>

      {allRuns.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No heartbeat runs yet</p>
        </div>
      ) : allRuns.map(run => {
        const cfg = statusCfg[run.status] ?? statusCfg.completed;
        const Icon = cfg.icon;
        return (
          <div key={run.id} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3">
            <div className="flex items-start gap-2">
              <div className={`w-6 h-6 rounded-full ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon className={`h-3 w-3 ${cfg.color} ${run.status === "running" ? "animate-spin" : ""}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate">{run.runType || "Heartbeat cycle"}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {run.startedAt ? timeAgo(run.startedAt) : "—"}
                  {run.durationMs ? ` · ${run.durationMs}ms` : ""}
                </p>
                {run.summary && <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{run.summary}</p>}
              </div>
              <span className={`text-[10px] font-semibold shrink-0 ${cfg.color}`}>{run.status}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Approvals Tab ────────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: approvals, isLoading } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals"],
    queryFn: () => fetchJson("/api/ai-approvals?status=proposed&limit=20"),
    refetchInterval: 15000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/ai-approvals/${id}/approve`, {}),
    onSuccess: () => { toast({ title: "Approved" }); qc.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); },
    onError: () => toast({ title: "Error approving", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/ai-approvals/${id}/reject`, { reason: "Rejected via CEO Agent" }),
    onSuccess: () => { toast({ title: "Rejected" }); qc.invalidateQueries({ queryKey: ["/api/ai-approvals"] }); },
    onError: () => toast({ title: "Error rejecting", variant: "destructive" }),
  });

  // Normalize: API may return an object like { message: "Unauthorized" } on
  // 401, or { items: [...] } — neither is an array, so ?? [] would not help.
  // Always extract to a guaranteed array first.
  const approvalsList: any[] = Array.isArray(approvals)
    ? approvals
    : Array.isArray((approvals as any)?.items)
      ? (approvals as any).items
      : [];
  const pending = approvalsList.filter(a => a.status === "proposed" || a.approvalRequired);

  if (isLoading) return (
    <div className="flex-1 p-4 space-y-2">
      {[1,2].map(i => <div key={i} className="h-24 bg-zinc-800/60 rounded-lg animate-pulse" />)}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
        {pending.length} pending approval{pending.length !== 1 ? "s" : ""}
      </p>

      {pending.length === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40 text-green-500" />
          <p className="text-sm">All caught up — no approvals needed</p>
        </div>
      ) : pending.map(item => (
        <div key={item.id} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-200 truncate">{item.subject || item.actionType || "Action"}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                {item.recipientEmail || item.agentType || "—"}
                {item.riskLevel && ` · ${item.riskLevel} risk`}
              </p>
            </div>
            <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full shrink-0">Pending</span>
          </div>
          {item.bodyPreview && (
            <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">{item.bodyPreview}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white flex-1"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate(item.id)}
              data-testid={`button-ceo-approve-${item.id}`}
            >
              {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-red-800/50 text-red-400 hover:bg-red-950/30 flex-1"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate(item.id)}
              data-testid={`button-ceo-reject-${item.id}`}
            >
              <XCircle className="h-3 w-3 mr-1" /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ onClose }: { onClose: () => void }) {
  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/workforce/settings"],
    queryFn: () => fetchJson("/api/workforce/settings"),
  });

  const AUTOMATION_MODES = [
    { value: "co_pilot", label: "Co-Pilot", desc: "AI suggests, you decide everything" },
    { value: "assisted", label: "Assisted", desc: "AI acts on low-risk items automatically" },
    { value: "autonomous", label: "Autonomous", desc: "AI acts unless you intervene" },
  ];

  const currentMode = settings?.automationMode ?? "co_pilot";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Automation Mode</p>
        <div className="space-y-2">
          {AUTOMATION_MODES.map(mode => (
            <div key={mode.value}
              className={`rounded-lg border p-3 transition-all ${currentMode === mode.value ? "border-green-600/60 bg-green-950/20" : "border-zinc-700/60 bg-zinc-800/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-200">{mode.label}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{mode.desc}</p>
                </div>
                {currentMode === mode.value
                  ? <ToggleRight className="h-5 w-5 text-green-400 shrink-0" />
                  : <ToggleLeft className="h-5 w-5 text-zinc-600 shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Quick Links</p>
        <div className="space-y-1.5">
          {[
            { label: "Full AI Approvals Inbox", href: "/admin/ai-approvals" },
            { label: "CEO Heartbeat Dashboard", href: "/admin/ceo-heartbeat" },
            { label: "AI Workforce Operations", href: "/admin/ai-workforce-optimization" },
            { label: "Autonomy Controls", href: "/admin/autonomy-controls" },
            { label: "Email Audit & Debug", href: "/admin/email-audit" },
          ].map(link => (
            <button
              key={link.href}
              type="button"
              onClick={() => onClose()}
              className="w-full flex items-center justify-between gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-500/80 px-3 py-2.5 transition-all text-left"
            >
              <span className="text-xs text-zinc-300">{link.label}</span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {settings?.heartbeatFrequencyMinutes && (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">Heartbeat Frequency</p>
          <p className="text-sm font-semibold text-cyan-400">Every {settings.heartbeatFrequencyMinutes} min</p>
        </div>
      )}
    </div>
  );
}

// ─── Local error boundary for the Brain panel ────────────────────────────────

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
            <p className="text-sm font-semibold text-zinc-200">Assistant failed to load</p>
            <p className="text-xs text-zinc-500 mt-1">A rendering error occurred. Try retrying or closing the panel.</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => this.setState({ hasError: false })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
              onClick={() => this.props.onClose()}
            >
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
  { id: "ceo",       label: "CEO",       icon: Home },
  { id: "chat",      label: "Chat",      icon: MessageSquare },
  { id: "agents",    label: "Agents",    icon: Users },
  { id: "tasks",     label: "Tasks",     icon: ListTodo },
  { id: "approvals", label: "Approve",   icon: CheckCircle2 },
  { id: "settings",  label: "Settings",  icon: Settings },
];

// ─── Main Widget ──────────────────────────────────────────────────────────────

export function ChatWidget() {
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // isClosing: true from the moment X is pressed until the panel fully exits.
  // While true, ALL tab content (and their queries) is replaced with an empty
  // spacer so nothing can throw during the 300ms slide-out animation.
  const [isClosing, setIsClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("ceo");
  // READ-ONLY — never call setLocation inside the Brain sidebar.
  // Navigation from within the portal causes page-level side-effects.
  const [pathname] = useLocation();

  const { data: approvalMetrics } = useQuery<any>({
    queryKey: ["/api/ai-approvals/metrics"],
    queryFn: () => fetchJson("/api/ai-approvals/metrics"),
    refetchInterval: 30000,
    enabled: isMounted && !isClosing,
  });

  const pendingCount = approvalMetrics?.pending ?? 0;

  const handleOpen = () => {
    console.log("[BrainFAB:open] pathname =", pathname);
    setIsClosing(false);
    setIsMounted(true);
    requestAnimationFrame(() => setIsOpen(true));
  };

  const handleClose = () => {
    console.log("[BrainFAB:close] pathname =", pathname);
    // Drop tab content immediately — prevents ANY query-powered tab component
    // from rendering (and potentially crashing) during the slide-out animation.
    setIsClosing(true);
    setIsOpen(false);
  };

  // Only unmount once the panel's OWN transform transition ends.
  // Guards: (1) only the panel div itself, not child elements
  //         (2) only on the transform property, not opacity or others
  //         (3) only when already closed (isOpen false)
  const handlePanelTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.currentTarget !== (e.target as Element)) return;
    if (e.propertyName !== "transform") return;
    if (isOpen) return;
    console.log("[BrainFAB:unmounted] pathname =", pathname);
    setIsMounted(false);
    setIsClosing(false);
  };

  return createPortal(
    <BrainPortalErrorBoundary>
      {/* Backdrop */}
      {isMounted && (
        <div
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            console.log("[BrainFAB:backdrop-click] pathname =", pathname);
            handleClose();
          }}
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
                <p className="text-sm font-bold text-white leading-none">CEO Agent</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">AI Workforce Command Center</p>
              </div>
            </div>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-zinc-500 hover:text-zinc-300 no-default-hover-elevate shrink-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[BrainFAB:close] [header-X] pathname =", pathname);
                handleClose();
              }}
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
                {activeTab === "ceo"       && <CeoHomeTab onSwitchTab={setActiveTab} />}
                {activeTab === "chat"      && <ChatTab />}
                {activeTab === "agents"    && <AgentsTab />}
                {activeTab === "tasks"     && <TasksTab />}
                {activeTab === "approvals" && <ApprovalsTab />}
                {activeTab === "settings"  && <SettingsTab onClose={handleClose} />}
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
              const showBadge = tab.id === "approvals" && pendingCount > 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`tab-ceo-${tab.id}`}
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
                  <span className="text-[9px] font-medium leading-none">{tab.label}</span>
                  {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-green-400 rounded-full" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating action button — always on top */}
      <button
        type="button"
        className="fixed right-5 z-[9999] flex items-center justify-center h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-green-600 text-white shadow-[0_4px_24px_rgba(34,197,94,0.4)] hover:scale-105 active:scale-95 transition-transform"
        style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("[BrainFAB:click] isOpen=", isOpen, "pathname =", pathname);
          isOpen ? handleClose() : handleOpen();
        }}
        data-testid="button-toggle-chat"
      >
        {isOpen ? (
          <X className="h-6 w-6 sm:h-7 sm:w-7" />
        ) : (
          <Brain className="h-6 w-6 sm:h-7 sm:w-7" />
        )}
        {!isOpen && pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </button>
    </BrainPortalErrorBoundary>,
    document.body
  );
}
