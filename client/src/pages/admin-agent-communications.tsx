import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, MessageSquare, ChevronRight, Users, ArrowRightLeft,
  AlertTriangle, Megaphone, BarChart3, Send, RefreshCw, CheckCircle,
  Clock, X, Layers, Activity, Bot, Shield, TrendingUp, Star, CheckSquare,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type Convo = { id: string; type: string; status: string; priority: string; participants: string[]; subject: string; createdAt: string; updatedAt: string; messageCount: number };
type ConvoData = { conversations: Convo[]; open: number; acknowledged: number; completed: number; total: number; generatedAt: string };

type Message = { id: string; conversationId: string; senderAgentId: string; recipientAgentId: string; type: string; subject: string; content: string; createdAt: string };
type MessageData = { conversationId: string; conversation: Convo | null; messages: Message[]; messageCount: number; generatedAt: string };

type Handoff = { id: string; fromAgent: string; toAgent: string; taskType: string; context: string; priority: string; status: string; outcome: string | null; createdAt: string; completedAt: string | null };
type HandoffData = { handoffs: Handoff[]; completed: number; pending: number; failed: number; generatedAt: string };

type Escalation = { id: string; agent: string; escalatedTo: string; issue: string; status: string; resolution: string | null; priority: string; createdAt: string; resolvedAt: string | null };
type EscalationData = { escalations: Escalation[]; open: number; acknowledged: number; resolved: number; generatedAt: string };

type Announcement = { id: string; sender: string; audience: string; subject: string; message: string; priority: string; createdAt: string };
type AnnouncementData = { announcements: Announcement[]; total: number; generatedAt: string };

type TopCollaborator = { agent: string; score: number; messagesIn: number; messagesOut: number; handoffs: number };
type Metrics = { messagesSent: number; handoffsCompleted: number; escalations: number; escalationRate: number; avgResponseTimeMinutes: number; collaborationScore: number; activeAgents: number; topCollaborators: TopCollaborator[]; messagesByType: Record<string, number>; handoffsByStatus: Record<string, number>; weeklyTrend: { day: string; messages: number; handoffs: number }[]; generatedAt: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PriorityBadge({ p }: { p: string }) {
  const cfg: Record<string, string> = { critical: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", high: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[p] ?? "bg-muted text-muted-foreground"}`}>{p}</Badge>;
}

function StatusBadge({ s }: { s: string }) {
  const cfg: Record<string, string> = { open: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", acknowledged: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", archived: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400", pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", failed: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[s] ?? "bg-muted text-muted-foreground"}`}>{s}</Badge>;
}

function TypeBadge({ t }: { t: string }) {
  const cfg: Record<string, string> = { request: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", handoff: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", escalation: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", decision: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", announcement: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", update: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", response: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300", approval: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  return <Badge className={`text-[8px] px-1.5 py-0 h-4 ${cfg[t] ?? "bg-muted text-muted-foreground"}`}>{t}</Badge>;
}

function AgentAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const COLORS: Record<string, string> = { "AI COO": "bg-violet-500", "Revenue Agent": "bg-emerald-500", "Email Agent": "bg-blue-500", "Research Agent": "bg-amber-500", "Scheduling Agent": "bg-teal-500", "PAIL Engine": "bg-indigo-500", "CEO Heartbeat": "bg-primary", "Intelligence Engine": "bg-rose-500", "Platform Brain": "bg-orange-500", "Engineering Brain": "bg-cyan-500", "Autonomy Engine": "bg-pink-500" };
  const color = COLORS[name] ?? "bg-slate-500";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("");
  const sizeClass = size === "xs" ? "h-5 w-5 text-[8px]" : "h-7 w-7 text-[10px]";
  return <div className={`${sizeClass} ${color} rounded-full flex items-center justify-center text-white font-bold shrink-0`}>{initials}</div>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "conversations", label: "Conversations",  icon: MessageSquare  },
  { id: "messages",      label: "Messages",        icon: Send           },
  { id: "handoffs",      label: "Handoffs",        icon: ArrowRightLeft },
  { id: "escalations",   label: "Escalations",     icon: AlertTriangle  },
  { id: "announcements", label: "Announcements",   icon: Megaphone      },
  { id: "analytics",     label: "Analytics",       icon: BarChart3      },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Tab: Conversations ───────────────────────────────────────────────────────

function ConversationsTab({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, isLoading } = useQuery<ConvoData>({ queryKey: ["/api/agent-communications/conversations"], staleTime: 30_000 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter]     = useState("all");

  const filtered = (data?.conversations ?? []).filter(c => {
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    const matchType   = typeFilter   === "all" || c.type   === typeFilter;
    return matchStatus && matchType;
  });

  const TYPE_ICONS: Record<string, React.ReactNode> = {
    request:      <MessageSquare  className="h-3.5 w-3.5 text-blue-500"    />,
    handoff:      <ArrowRightLeft className="h-3.5 w-3.5 text-violet-500"  />,
    escalation:   <AlertTriangle  className="h-3.5 w-3.5 text-rose-500"    />,
    decision:     <CheckCircle    className="h-3.5 w-3.5 text-emerald-500" />,
    announcement: <Megaphone      className="h-3.5 w-3.5 text-amber-500"   />,
  };

  return (
    <div className="space-y-4" data-testid="tab-conversations">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open",         value: data.open,         color: "text-amber-600 dark:text-amber-400" },
            { label: "Acknowledged", value: data.acknowledged, color: "text-blue-600 dark:text-blue-400"   },
            { label: "Completed",    value: data.completed,    color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {["all", "open", "acknowledged", "completed"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-status-${s}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all", "request", "handoff", "escalation", "decision", "announcement"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} data-testid={`filter-type-${t}`}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {filtered.map(c => (
            <button key={c.id} onClick={() => onSelect(c.id)} className="w-full p-4 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left group" data-testid={`conv-${c.id}`}>
              <div className="flex items-start gap-3">
                <span className="shrink-0 mt-0.5">{TYPE_ICONS[c.type] ?? <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-bold truncate">{c.subject}</p>
                    <TypeBadge t={c.type} />
                    <StatusBadge s={c.status} />
                    <PriorityBadge p={c.priority} />
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                      {c.participants.slice(0, 3).map(p => <AgentAvatar key={p} name={p} size="xs" />)}
                      {c.participants.length > 3 && <span>+{c.participants.length - 3}</span>}
                    </div>
                    <span>{c.messageCount} message{c.messageCount !== 1 ? "s" : ""}</span>
                    <span>Updated {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}</span>
                    <ChevronRight className="h-3 w-3 ml-auto group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm" data-testid="conversations-empty">No conversations match the selected filters.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Messages (thread view) ─────────────────────────────────────────────

function MessagesTab({ selectedConvoId, setSelectedConvoId }: { selectedConvoId: string | null; setSelectedConvoId: (id: string | null) => void }) {
  const { data: convoData } = useQuery<ConvoData>({ queryKey: ["/api/agent-communications/conversations"], staleTime: 30_000 });
  const { data: threadData, isLoading } = useQuery<MessageData>({
    queryKey: ["/api/agent-communications/messages", selectedConvoId],
    queryFn: () => fetchJson(`/api/agent-communications/messages/${selectedConvoId}`),
    enabled: !!selectedConvoId,
    staleTime: 30_000,
  });
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-communications/message", { sender: "Human Admin", recipient: "AI COO", subject: "Admin instruction", content: reply, priority: "high" }),
    onSuccess: () => { toast({ title: "Message sent to AI COO" }); setReply(""); },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [threadData]);

  const MSG_COLORS: Record<string, string> = { request: "border-l-blue-400", update: "border-l-slate-300", response: "border-l-sky-400", approval: "border-l-emerald-400", escalation: "border-l-rose-400" };

  if (!selectedConvoId) {
    return (
      <div className="space-y-3" data-testid="tab-messages-list">
        <p className="text-xs text-muted-foreground">Select a conversation to view the full message thread.</p>
        <div className="space-y-2">
          {(convoData?.conversations ?? []).filter(c => c.messageCount > 0).map(c => (
            <button key={c.id} onClick={() => setSelectedConvoId(c.id)} className="w-full p-3.5 rounded-xl border bg-card hover:bg-muted/20 transition-colors text-left flex items-center gap-3 group" data-testid={`msg-select-${c.id}`}>
              <TypeBadge t={c.type} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{c.subject}</p>
                <p className="text-[9px] text-muted-foreground">{c.messageCount} messages · {c.participants.join(" → ")}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="tab-messages-thread">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-muted-foreground -ml-2" onClick={() => setSelectedConvoId(null)} data-testid="button-back-conversations">
          <ArrowLeft className="h-3.5 w-3.5" />Back
        </Button>
        {threadData?.conversation && (
          <>
            <TypeBadge t={threadData.conversation.type} />
            <p className="text-xs font-semibold truncate">{threadData.conversation.subject}</p>
          </>
        )}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ minHeight: "480px" }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (threadData?.messages ?? []).map(msg => (
            <div key={msg.id} className={`border-l-4 pl-3 py-2 ${MSG_COLORS[msg.type] ?? "border-l-slate-200"}`} data-testid={`msg-${msg.id}`}>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <AgentAvatar name={msg.senderAgentId} size="xs" />
                <span className="text-[10px] font-bold">{msg.senderAgentId}</span>
                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                <AgentAvatar name={msg.recipientAgentId} size="xs" />
                <span className="text-[10px] text-muted-foreground">{msg.recipientAgentId}</span>
                <TypeBadge t={msg.type} />
                <span className="text-[9px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}</span>
              </div>
              {msg.subject && <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{msg.subject}</p>}
              <p className="text-xs leading-relaxed">{msg.content}</p>
            </div>
          ))}
          {threadData?.messages.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-xs">No messages in this thread yet.</div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t bg-muted/10">
          <div className="flex gap-2">
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === "Enter") sendMutation.mutate(); }} placeholder="Send a directive to AI COO…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-reply-message" />
            <Button size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => sendMutation.mutate()} disabled={!reply.trim() || sendMutation.isPending} data-testid="button-send-message">
              {sendMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Handoffs ────────────────────────────────────────────────────────────

function HandoffsTab() {
  const { data, isLoading } = useQuery<HandoffData>({ queryKey: ["/api/agent-communications/handoffs"], staleTime: 30_000 });
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = statusFilter === "all" ? (data?.handoffs ?? []) : (data?.handoffs ?? []).filter(h => h.status === statusFilter);

  const PRIORITY_BORDER: Record<string, string> = { critical: "border-l-4 border-l-rose-400", high: "border-l-4 border-l-amber-400", medium: "", low: "" };

  return (
    <div className="space-y-4" data-testid="tab-handoffs">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Completed", value: data.completed, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Pending",   value: data.pending,   color: "text-amber-600 dark:text-amber-400"   },
            { label: "Failed",    value: data.failed,    color: "text-rose-500"                         },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {["all", "completed", "pending", "failed"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} data-testid={`handoff-filter-${s}`}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {s}
          </button>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {filtered.map(h => (
            <div key={h.id} className={`p-4 rounded-xl border bg-card ${PRIORITY_BORDER[h.priority] ?? ""}`} data-testid={`handoff-${h.id}`}>
              <div className="flex items-start gap-3">
                <ArrowRightLeft className={`h-4 w-4 shrink-0 mt-0.5 ${h.status === "completed" ? "text-emerald-500" : h.status === "failed" ? "text-rose-500" : "text-amber-500"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <p className="text-xs font-bold">{h.taskType}</p>
                    <StatusBadge s={h.status} />
                    <PriorityBadge p={h.priority} />
                  </div>
                  {/* From → To */}
                  <div className="flex items-center gap-2 mb-2">
                    <AgentAvatar name={h.fromAgent} size="xs" />
                    <span className="text-[9px] font-medium">{h.fromAgent}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <AgentAvatar name={h.toAgent} size="xs" />
                    <span className="text-[9px] font-medium">{h.toAgent}</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground mb-1.5 italic">"{h.context}"</p>
                  {h.outcome && (
                    <div className="flex items-start gap-1.5">
                      <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] text-emerald-600 dark:text-emerald-400">{h.outcome}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground">
                    <span>Created {formatDistanceToNow(new Date(h.createdAt), { addSuffix: true })}</span>
                    {h.completedAt && <span>· Completed {formatDistanceToNow(new Date(h.completedAt), { addSuffix: true })}</span>}
                    {h.status === "pending" && (
                      <Button size="sm" className="h-5 text-[8px] px-1.5 ml-auto" variant="outline" onClick={() => toast({ title: `Handoff "${h.taskType}" completed` })} data-testid={`button-complete-handoff-${h.id}`}>
                        Mark Complete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Escalations ─────────────────────────────────────────────────────────

function EscalationsTab() {
  const { data, isLoading } = useQuery<EscalationData>({ queryKey: ["/api/agent-communications/escalations"], staleTime: 30_000 });
  const { toast } = useToast();
  const [newEsc, setNewEsc] = useState({ agent: "", reason: "" });

  const escalateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-communications/escalate", { sourceAgent: newEsc.agent, targetManager: "AI COO", reason: newEsc.reason }),
    onSuccess: () => { toast({ title: "Escalation sent to AI COO" }); setNewEsc({ agent: "", reason: "" }); },
    onError: () => toast({ title: "Failed to escalate", variant: "destructive" }),
  });

  const STATUS_ICON: Record<string, React.ReactNode> = {
    open:         <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />,
    acknowledged: <Clock         className="h-4 w-4 text-blue-500 shrink-0" />,
    resolved:     <CheckCircle   className="h-4 w-4 text-emerald-500 shrink-0" />,
  };
  const PRIORITY_BORDER: Record<string, string> = { critical: "border-l-4 border-l-rose-500", high: "border-l-4 border-l-amber-400", medium: "", low: "" };

  return (
    <div className="space-y-4" data-testid="tab-escalations">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open",         value: data.open,         color: "text-rose-500" },
            { label: "Acknowledged", value: data.acknowledged, color: "text-blue-600 dark:text-blue-400" },
            { label: "Resolved",     value: data.resolved,     color: "text-emerald-600 dark:text-emerald-400" },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Manual escalation form */}
      <div className="p-4 rounded-xl border bg-card space-y-2.5" data-testid="escalation-form">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Raise New Escalation to AI COO</p>
        <div className="flex gap-2">
          <input value={newEsc.agent} onChange={e => setNewEsc(p => ({ ...p, agent: e.target.value }))} placeholder="Agent (e.g. Email Agent)" className="w-40 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-escalation-agent" />
          <input value={newEsc.reason} onChange={e => setNewEsc(p => ({ ...p, reason: e.target.value }))} placeholder="Describe the issue…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-escalation-reason" />
          <Button className="h-8 gap-1.5 shrink-0 text-xs" onClick={() => escalateMutation.mutate()} disabled={!newEsc.agent || !newEsc.reason || escalateMutation.isPending} data-testid="button-escalate">
            {escalateMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Escalate
          </Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-2">
          {(data?.escalations ?? []).sort((a, b) => (a.status === "open" ? -1 : 1)).map(e => (
            <div key={e.id} className={`p-4 rounded-xl border bg-card ${PRIORITY_BORDER[e.priority] ?? ""}`} data-testid={`escalation-${e.id}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5">{STATUS_ICON[e.status] ?? <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <AgentAvatar name={e.agent} size="xs" />
                    <span className="text-[10px] font-bold">{e.agent}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <AgentAvatar name={e.escalatedTo} size="xs" />
                    <span className="text-[10px] text-muted-foreground">{e.escalatedTo}</span>
                    <StatusBadge s={e.status} />
                    <PriorityBadge p={e.priority} />
                    <span className="text-[9px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}</span>
                  </div>
                  <p className="text-xs mb-1.5">{e.issue}</p>
                  {e.resolution && (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-emerald-500/10">
                      <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] text-emerald-700 dark:text-emerald-300">{e.resolution}</p>
                    </div>
                  )}
                  {e.status === "open" && (
                    <Button size="sm" className="mt-2 h-6 gap-1 text-[9px]" variant="outline" onClick={() => toast({ title: `Escalation acknowledged — AI COO routing` })} data-testid={`button-ack-${e.id}`}>
                      <CheckCircle className="h-2.5 w-2.5" />Acknowledge
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Announcements ───────────────────────────────────────────────────────

function AnnouncementsTab() {
  const { data, isLoading } = useQuery<AnnouncementData>({ queryKey: ["/api/agent-communications/announcements"], staleTime: 30_000 });
  const { toast } = useToast();
  const [broadcast, setBroadcast] = useState({ sender: "CEO Heartbeat", audience: "All Agents", message: "" });

  const announceMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agent-communications/announcement", broadcast),
    onSuccess: () => { toast({ title: "Announcement broadcast to " + broadcast.audience }); setBroadcast(p => ({ ...p, message: "" })); },
    onError: () => toast({ title: "Failed to broadcast", variant: "destructive" }),
  });

  const PRIORITY_ICON: Record<string, React.ReactNode> = {
    high:   <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />,
    medium: <Megaphone     className="h-4 w-4 text-blue-500 shrink-0 mt-0.5"  />,
    low:    <Megaphone     className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />,
  };

  return (
    <div className="space-y-4" data-testid="tab-announcements">
      {/* Broadcast form */}
      <div className="p-4 rounded-xl border bg-card space-y-2.5" data-testid="announcement-form">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Broadcast Announcement</p>
        <div className="flex gap-2 flex-wrap">
          <select value={broadcast.sender} onChange={e => setBroadcast(p => ({ ...p, sender: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-broadcast-sender">
            {["CEO Heartbeat","AI COO","Platform Brain","Engineering Brain"].map(a => <option key={a}>{a}</option>)}
          </select>
          <select value={broadcast.audience} onChange={e => setBroadcast(p => ({ ...p, audience: e.target.value }))} className="h-8 px-2.5 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="select-broadcast-audience">
            {["All Agents","Revenue Team","Scheduling Team","Research Team"].map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <input value={broadcast.message} onChange={e => setBroadcast(p => ({ ...p, message: e.target.value }))} placeholder="Broadcast message to the workforce…" className="flex-1 h-8 px-3 rounded-lg border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary" data-testid="input-announcement-message" />
          <Button className="h-8 gap-1.5 shrink-0 text-xs" onClick={() => announceMutation.mutate()} disabled={!broadcast.message.trim() || announceMutation.isPending} data-testid="button-broadcast">
            {announceMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            Broadcast
          </Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : (
        <div className="space-y-3">
          {(data?.announcements ?? []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(ann => (
            <div key={ann.id} className="p-4 rounded-xl border bg-card" data-testid={`announcement-${ann.id}`}>
              <div className="flex items-start gap-3">
                <span>{PRIORITY_ICON[ann.priority] ?? <Megaphone className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <AgentAvatar name={ann.sender} size="xs" />
                    <span className="text-[10px] font-bold">{ann.sender}</span>
                    <span className="text-[9px] text-muted-foreground">→</span>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4">{ann.audience}</Badge>
                    <PriorityBadge p={ann.priority} />
                    <span className="text-[9px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(ann.createdAt), { addSuffix: true })}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-primary mb-1">{ann.subject}</p>
                  <p className="text-xs text-muted-foreground">{ann.message}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab() {
  const { data, isLoading } = useQuery<Metrics>({ queryKey: ["/api/agent-communications/metrics"], staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="tab-analytics">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Messages Sent",       value: data?.messagesSent ?? "—",                           color: "text-primary" },
          { label: "Handoffs Completed",  value: data?.handoffsCompleted ?? "—",                      color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Escalations",         value: data?.escalations ?? "—",                            color: "text-amber-600 dark:text-amber-400" },
          { label: "Escalation Rate",     value: data ? `${data.escalationRate}%` : "—",              color: "text-muted-foreground" },
          { label: "Avg Response Time",   value: data ? `${data.avgResponseTimeMinutes}m` : "—",      color: "text-blue-600 dark:text-blue-400" },
          { label: "Collaboration Score", value: data ? `${data.collaborationScore}/100` : "—",       color: "text-primary" },
        ].map(k => (
          <div key={k.label} className="p-3.5 rounded-xl border bg-card" data-testid={`metric-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <p className={`text-2xl font-extrabold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : data && <>
        {/* Message types */}
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Messages by Type</p>
          <div className="space-y-2">
            {Object.entries(data.messagesByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const total = Object.values(data.messagesByType).reduce((s, v) => s + v, 0);
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="text-[9px] w-16 shrink-0 capitalize">{type}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                  <span className="text-[9px] font-bold w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weekly trend bar chart */}
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Weekly Activity</p>
          <div className="flex items-end gap-2 h-24">
            {data.weeklyTrend.map(day => {
              const maxMessages = Math.max(...data.weeklyTrend.map(d => d.messages));
              const pct = (day.messages / maxMessages) * 100;
              return (
                <div key={day.day} className="flex-1 flex flex-col items-center gap-1" data-testid={`trend-${day.day}`}>
                  <span className="text-[8px] text-muted-foreground">{day.messages}</span>
                  <div className="w-full rounded-t-sm bg-primary/20 overflow-hidden flex items-end" style={{ height: "64px" }}>
                    <div className="w-full rounded-t-sm bg-primary transition-all" style={{ height: `${pct}%` }} />
                  </div>
                  <span className="text-[8px] text-muted-foreground">{day.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top collaborators */}
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">Top Collaborators</p>
          <div className="space-y-2">
            {data.topCollaborators.map((agent, i) => (
              <div key={agent.agent} className="flex items-center gap-3" data-testid={`collaborator-${i}`}>
                <div className="text-[9px] font-bold text-muted-foreground w-4 text-right shrink-0">#{i + 1}</div>
                <AgentAvatar name={agent.agent} size="xs" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] font-medium truncate">{agent.agent}</span>
                    <span className="text-[9px] font-bold text-primary shrink-0">{agent.score}/100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${agent.score}%` }} />
                  </div>
                </div>
                <div className="text-[8px] text-muted-foreground text-right shrink-0">
                  <p>↑{agent.messagesIn} ↓{agent.messagesOut}</p>
                  <p>{agent.handoffs} handoffs</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Handoff status breakdown */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Completed", value: data.handoffsByStatus.completed, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Pending",   value: data.handoffsByStatus.pending,   color: "text-amber-600 dark:text-amber-400"   },
            { label: "Failed",    value: data.handoffsByStatus.failed,    color: "text-rose-500"                         },
          ].map(m => (
            <div key={m.label} className="p-3 rounded-xl border bg-card text-center">
              <p className={`text-xl font-extrabold ${m.color}`}>{m.value}</p>
              <p className="text-[9px] text-muted-foreground">Handoffs {m.label}</p>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentCommunicationsPage() {
  const [activeTab, setActiveTab]           = useState<TabId>("conversations");
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const { data: convoData } = useQuery<ConvoData>({ queryKey: ["/api/agent-communications/conversations"], staleTime: 30_000 });
  const { data: metrics }   = useQuery<Metrics>({ queryKey: ["/api/agent-communications/metrics"], staleTime: 60_000 });

  const handleConvoSelect = (id: string) => {
    setSelectedConvoId(id);
    setActiveTab("messages");
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto" data-testid="page-agent-communications">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Link href="/admin/platform-engineering">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground h-7 px-2 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />Platform Engineering
              </Button>
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Agent Communications Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The AI workforce operating as a coordinated team — messaging, handoffs, escalations, directives, and collaboration across all departments.
          </p>
        </div>

        {metrics && (
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card shrink-0 flex-wrap">
            {[
              { label: "Messages",       value: metrics.messagesSent,        color: "text-primary" },
              { label: "Collaboration",  value: `${metrics.collaborationScore}/100`, color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Avg Response",   value: `${metrics.avgResponseTimeMinutes}m`,color: "text-blue-600 dark:text-blue-400" },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${i > 0 ? "pl-3 border-l" : ""}`}>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-x-auto pb-1">
        {[
          { label: "Command Center",       href: "/admin/command-center" },
          { label: "Platform Brain",       href: "/admin/platform-brain" },
          { label: "Platform Engineering", href: "/admin/platform-engineering" },
          { label: "Agent Communications", href: null },
        ].map((step, i) => (
          <div key={step.label} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-40" />}
            {step.href
              ? <Link href={step.href}><span className="hover:text-foreground transition-colors cursor-pointer">{step.label}</span></Link>
              : <span className="font-semibold text-foreground">{step.label}</span>}
          </div>
        ))}
      </div>

      {/* Live status banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="comms-status-banner">
        {[
          { label: "Open Conversations",  value: convoData?.open         ?? "—", color: "text-amber-600 dark:text-amber-400",   icon: <MessageSquare className="h-3.5 w-3.5 text-amber-500" /> },
          { label: "Pending Handoffs",    value: "5",                             color: "text-violet-600 dark:text-violet-400", icon: <ArrowRightLeft className="h-3.5 w-3.5 text-violet-500" /> },
          { label: "Open Escalations",    value: "2",                             color: "text-rose-500",                        icon: <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> },
          { label: "Active Agents",       value: metrics?.activeAgents   ?? "—", color: "text-emerald-600 dark:text-emerald-400",icon: <Bot className="h-3.5 w-3.5 text-emerald-500" /> },
        ].map(stat => (
          <div key={stat.label} className="flex items-center gap-2.5 p-3 rounded-xl border bg-card">
            <div className="p-1.5 rounded-lg bg-muted shrink-0">{stat.icon}</div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${stat.color}`}>{stat.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" data-testid="tab-navigation-comms">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} data-testid={`tab-button-${tab.id}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-96">
        {activeTab === "conversations" && <ConversationsTab onSelect={handleConvoSelect} />}
        {activeTab === "messages"      && <MessagesTab selectedConvoId={selectedConvoId} setSelectedConvoId={setSelectedConvoId} />}
        {activeTab === "handoffs"      && <HandoffsTab />}
        {activeTab === "escalations"   && <EscalationsTab />}
        {activeTab === "announcements" && <AnnouncementsTab />}
        {activeTab === "analytics"     && <AnalyticsTab />}
      </div>

      {/* Forward nav → Agent Task Marketplace */}
      <Link href="/admin/agent-tasks">
        <div className="flex items-center gap-4 p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-indigo-500/5 hover:from-primary/10 hover:to-indigo-500/10 transition-colors cursor-pointer group" data-testid="nav-agent-tasks">
          <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
            <CheckSquare className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Agent Task Marketplace &amp; Work Delegation System</p>
            <p className="text-xs text-muted-foreground mt-0.5">Agents assign, accept, execute, verify, and complete work across departments — with ownership, accountability, deadlines, dependencies, and AI COO workload management.</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
        </div>
      </Link>

      {/* Architecture note */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-primary/5 to-teal-500/5" data-testid="architecture-complete-19-1">
        <div className="flex items-start gap-3">
          <Layers className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold mb-1">Coordinated AI Workforce — Phase 19.1 Active</p>
            <p className="text-[10px] text-muted-foreground mb-2">Agents no longer operate in isolation. They communicate, delegate, escalate, and collaborate as a coordinated workforce — with full audit trail and AI COO as communication manager.</p>
            <div className="flex flex-wrap gap-1">
              {[
                "Setup","Workforce","Operations","Intelligence","Autonomy","Trust",
                "External","Network","Revenue","Platform","Execution","Ecosystem",
                "Integrations","Workforce OS","Command Center","Customer Success OS",
                "Platform Brain","Platform Engineering","Agent Comms Hub",
              ].map((layer, i) => (
                <Badge key={layer} variant={i === 18 ? "default" : "secondary"} className="text-[8px] px-1.5 py-0 h-4">
                  {i + 1}. {layer}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
