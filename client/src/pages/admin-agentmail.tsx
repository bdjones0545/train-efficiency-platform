import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Mail, CheckCircle, XCircle, RefreshCw, Send, Inbox,
  AlertTriangle, Wifi, WifiOff, Loader2, Zap, Settings,
  ArrowDownToLine, Eye, FlaskConical, MailOpen, ChevronDown
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentInboxDef { agent: string; inbox: string; description: string; }

interface StatusData {
  configured: boolean;
  connected: boolean;
  message: string;
  agentInboxes?: AgentInboxDef[];
  inbound?: {
    byRoutedStatus: Record<string, number>;
    byClassification: Record<string, number>;
    urgentEscalations: number;
  };
}

interface AgentMailMessage {
  id: string; organization_id: string; agent_name: string; inbox: string;
  to_email: string; from_email: string; subject: string; body_preview: string;
  provider_message_id: string; status: "sent" | "failed" | "queued";
  error_message: string | null; created_at: string;
}

interface InboundMessage {
  id: string; organization_id: string; inbox: string; from_email: string;
  from_name: string | null; to_email: string; subject: string;
  body_text: string | null; body_html: string | null;
  provider_message_id: string | null; provider_thread_id: string | null;
  classification: string | null; confidence: number | null;
  routed_agent: string | null; routed_status: string;
  action_type: string | null;
  action_payload: { suggestedReply?: string; intentSignals?: string[] } | null;
  error_message: string | null; received_at: string; created_at: string;
}

interface SimCase { index: number; label: string; inbox: string; }

// ─── Helpers ────────────────────────────────────────────────────────────────

const INBOX_OPTIONS = ["revenue", "hiring", "scheduling", "support", "operations", "ceo"];

const CLASSIFICATION_COLORS: Record<string, string> = {
  new_lead:              "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  booking_request:       "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  reschedule_request:    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  cancellation_request:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  pricing_question:      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  employment_candidate:  "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  support_issue:         "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  billing_issue:         "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  athlete_parent_question: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  coach_partner_inquiry: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  software_bug_report:   "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  urgent_escalation:     "bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-200",
  general_question:      "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  spam_or_noise:         "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
};

function ClassificationBadge({ cls }: { cls: string | null }) {
  if (!cls) return <Badge variant="outline" className="text-xs">—</Badge>;
  const color = CLASSIFICATION_COLORS[cls] ?? "bg-gray-100 text-gray-700";
  return <Badge className={`text-xs font-medium ${color}`}>{cls.replace(/_/g, " ")}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Sent</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "routed") return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">Routed</Badge>;
  if (status === "spam_stored") return <Badge variant="outline" className="text-gray-500">Spam</Badge>;
  if (status === "received") return <Badge variant="secondary">Received</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function ConnectionBadge({ configured, connected }: { configured: boolean; connected: boolean }) {
  if (!configured) return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:border-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" /> Not Configured
    </Badge>
  );
  if (connected) return <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"><Wifi className="h-3 w-3" /> Connected</Badge>;
  return <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Disconnected</Badge>;
}

function ConfidenceBadge({ conf }: { conf: number | null }) {
  if (conf === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(conf * 100);
  const color = pct >= 80 ? "text-green-600" : pct >= 60 ? "text-yellow-600" : "text-red-500";
  return <span className={`text-xs font-medium ${color}`}>{pct}%</span>;
}

// ─── Inbound message detail dialog ──────────────────────────────────────────

function InboundDetailDialog({
  message,
  onClose,
  onReply,
}: {
  message: InboundMessage | null;
  onClose: () => void;
  onReply: (msg: InboundMessage) => void;
}) {
  if (!message) return null;
  const suggestedReply = message.action_payload?.suggestedReply;
  const signals = message.action_payload?.intentSignals ?? [];

  return (
    <Dialog open={!!message} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailOpen className="h-4 w-4" />
            {message.subject}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3">
            <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{message.from_name ?? ""} &lt;{message.from_email}&gt;</span></div>
            <div><span className="text-muted-foreground">To:</span> <span className="font-medium">{message.to_email}</span></div>
            <div><span className="text-muted-foreground">Inbox:</span> <Badge variant="outline" className="font-mono text-xs">{message.inbox}@</Badge></div>
            <div><span className="text-muted-foreground">Received:</span> <span>{new Date(message.received_at).toLocaleString()}</span></div>
            <div><span className="text-muted-foreground">Classification:</span> <ClassificationBadge cls={message.classification} /></div>
            <div><span className="text-muted-foreground">Confidence:</span> <ConfidenceBadge conf={message.confidence} /></div>
            <div><span className="text-muted-foreground">Agent:</span> <span className="font-medium">{message.routed_agent ?? "—"}</span></div>
            <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={message.routed_status} /></div>
          </div>

          {signals.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Intent signals</p>
              <div className="flex flex-wrap gap-1">
                {signals.map((s) => <Badge key={s} variant="outline" className="text-xs">{s.replace(/_/g, " ")}</Badge>)}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Message body</p>
            <div className="bg-muted/40 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
              {message.body_text ?? "(no body text)"}
            </div>
          </div>

          {suggestedReply && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                <Zap className="h-3 w-3" /> AI Suggested Reply Draft
              </p>
              <p className="text-sm text-blue-900 dark:text-blue-200 whitespace-pre-wrap">{suggestedReply}</p>
            </div>
          )}

          {message.error_message && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 p-2 rounded">
              Error: {message.error_message}
            </div>
          )}

          {message.routed_status !== "spam_stored" && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => onReply(message)} className="gap-1">
                <Send className="h-3 w-3" /> Compose Reply
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminAgentMailPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [testTo, setTestTo] = useState("");
  const [sendForm, setSendForm] = useState({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" });
  const [verifyInbox, setVerifyInbox] = useState("revenue");
  const [selectedInbound, setSelectedInbound] = useState<InboundMessage | null>(null);
  const [inboundFilter, setInboundFilter] = useState({ inbox: "", classification: "", routed_status: "" });
  const [replyDraft, setReplyDraft] = useState<{ to: string; subject: string; body: string; fromInbox: string } | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({
    queryKey: ["/api/agentmail/status"],
  });

  const { data: inboxesData, isLoading: inboxesLoading } = useQuery<{ configured: boolean; inboxes: any[]; agentInboxes: AgentInboxDef[] }>({
    queryKey: ["/api/agentmail/inboxes"],
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery<{ messages: AgentMailMessage[]; byStatus: Record<string, number> }>({
    queryKey: ["/api/agentmail/messages"],
  });

  const { data: inboundData, isLoading: inboundLoading, refetch: refetchInbound } = useQuery<{
    messages: InboundMessage[];
    byClassification: Record<string, number>;
    byStatus: Record<string, number>;
    total: number;
  }>({
    queryKey: ["/api/agentmail/inbound"],
  });

  const { data: simCases } = useQuery<SimCase[]>({
    queryKey: ["/api/agentmail/simulate-inbound/cases"],
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const testMutation = useMutation({
    mutationFn: (to: string) => apiRequest("POST", "/api/agentmail/test", { to }),
    onSuccess: () => { toast({ title: "Test email sent" }); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] }); },
    onError: (e: any) => toast({ title: "Test failed", description: e?.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: (data: typeof sendForm) => apiRequest("POST", "/api/agentmail/send", data),
    onSuccess: () => {
      toast({ title: "Email sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] });
      setSendForm({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e?.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: (inbox: string) => apiRequest("POST", "/api/agentmail/inboxes/verify", { inbox }),
    onSuccess: (data: any) => {
      toast({ title: data?.created ? "Inbox created" : "Inbox verified" });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] });
    },
    onError: (e: any) => toast({ title: "Verification failed", description: e?.message, variant: "destructive" }),
  });

  const simulateMutation = useMutation({
    mutationFn: (testCaseIndex: number) => apiRequest("POST", "/api/agentmail/simulate-inbound", { testCaseIndex }),
    onSuccess: (data: any) => {
      toast({ title: "Simulation complete", description: `Classified as: ${data?.classification ?? "unknown"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inbound"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/status"] });
      refetchInbound();
    },
    onError: (e: any) => toast({ title: "Simulation failed", description: e?.message, variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: (data: { fromInbox: string; to: string; subject: string; body: string; threadId: string }) =>
      apiRequest("POST", "/api/agentmail/reply", { ...data, agentName: "Manual Reply" }),
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setReplyDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] });
    },
    onError: (e: any) => toast({ title: "Reply failed", description: e?.message, variant: "destructive" }),
  });

  // ─── Derived state ────────────────────────────────────────────────────────

  const messages = messagesData?.messages ?? [];
  const sentCount = messagesData?.byStatus?.sent ?? 0;
  const failedCount = messagesData?.byStatus?.failed ?? 0;
  const agentInboxes = statusData?.agentInboxes ?? inboxesData?.agentInboxes ?? [];

  const inboundMessages = (inboundData?.messages ?? []).filter((m) => {
    if (inboundFilter.inbox && m.inbox !== inboundFilter.inbox) return false;
    if (inboundFilter.classification && m.classification !== inboundFilter.classification) return false;
    if (inboundFilter.routed_status && m.routed_status !== inboundFilter.routed_status) return false;
    return true;
  });

  const urgentCount = statusData?.inbound?.urgentEscalations ?? 0;
  const totalInbound = inboundData?.total ?? 0;
  const routedInbound = inboundData?.byStatus?.routed ?? 0;
  const failedInbound = inboundData?.byStatus?.failed ?? 0;

  function handleOpenReply(msg: InboundMessage) {
    setSelectedInbound(null);
    setReplyDraft({
      to: msg.from_email,
      subject: `Re: ${msg.subject}`,
      body: msg.action_payload?.suggestedReply ?? "",
      fromInbox: msg.inbox,
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="h-6 w-6 text-primary" />
              AgentMail
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Dedicated agent inbox infrastructure — outbound sends and inbound routing
            </p>
          </div>
          <div className="flex items-center gap-3">
            {statusLoading
              ? <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</Badge>
              : <ConnectionBadge configured={statusData?.configured ?? false} connected={statusData?.connected ?? false} />
            }
            <Button data-testid="button-refresh-status" variant="outline" size="sm"
              onClick={() => { refetchStatus(); refetchInbound(); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/"] }); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Not configured banner */}
        {!statusLoading && !statusData?.configured && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">AgentMail Not Configured</p>
                  <p className="text-sm text-amber-700 dark:text-amber-400">{statusData?.message}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Sent", value: sentCount, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
            { label: "Send Failures", value: failedCount, icon: <XCircle className="h-4 w-4 text-red-500" /> },
            { label: "Inbound Total", value: totalInbound, icon: <ArrowDownToLine className="h-4 w-4 text-blue-500" /> },
            { label: "Routed", value: routedInbound, icon: <Zap className="h-4 w-4 text-purple-500" /> },
            { label: "Urgent", value: urgentCount, icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
          ].map((s) => (
            <Card key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
              <CardContent className="pt-4 pb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                </div>
                {s.icon}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main tabs */}
        <Tabs defaultValue="inbound">
          <TabsList className="flex-wrap">
            <TabsTrigger value="inbound" data-testid="tab-inbound">
              Inbound {totalInbound > 0 && <Badge className="ml-1 text-xs bg-primary/20 text-primary">{totalInbound}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="simulate" data-testid="tab-simulate">Simulate</TabsTrigger>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="inboxes" data-testid="tab-inboxes">Agent Inboxes</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages">Outbound Log</TabsTrigger>
            <TabsTrigger value="failed" data-testid="tab-failed">Failed</TabsTrigger>
            <TabsTrigger value="send" data-testid="tab-send">Send Email</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          {/* ── Inbound ── */}
          <TabsContent value="inbound" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ArrowDownToLine className="h-4 w-4" /> Inbound Messages
                    </CardTitle>
                    <CardDescription>Emails received at agent inboxes — classified, routed, and ready for action</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchInbound()} data-testid="button-refresh-inbound">
                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                  <Select value={inboundFilter.inbox || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, inbox: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-36" data-testid="filter-inbox">
                      <SelectValue placeholder="All inboxes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All inboxes</SelectItem>
                      {INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={inboundFilter.classification || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, classification: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-52" data-testid="filter-classification">
                      <SelectValue placeholder="All classifications" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classifications</SelectItem>
                      {Object.keys(inboundData?.byClassification ?? {}).map((c) => (
                        <SelectItem key={c} value={c}>{c.replace(/_/g, " ")} ({inboundData!.byClassification[c]})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={inboundFilter.routed_status || "all"} onValueChange={(v) => setInboundFilter(f => ({ ...f, routed_status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-40" data-testid="filter-status">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {["received", "routed", "spam_stored", "failed"].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(inboundFilter.inbox || inboundFilter.classification || inboundFilter.routed_status) && (
                    <Button variant="ghost" size="sm" onClick={() => setInboundFilter({ inbox: "", classification: "", routed_status: "" })}>
                      Clear filters
                    </Button>
                  )}
                </div>

                {inboundLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading inbound messages…</div>
                ) : inboundMessages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ArrowDownToLine className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No inbound messages yet.</p>
                    <p className="text-xs mt-1">Use the <strong>Simulate</strong> tab to test inbound routing.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Received</TableHead>
                          <TableHead>Inbox</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Classification</TableHead>
                          <TableHead>Conf.</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Suggested Reply</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inboundMessages.map((m) => (
                          <TableRow key={m.id} data-testid={`row-inbound-${m.id}`} className="cursor-pointer hover:bg-muted/40">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(m.received_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">{m.inbox}@</Badge>
                            </TableCell>
                            <TableCell className="text-sm max-w-[140px]">
                              <div className="truncate font-medium">{m.from_name ?? m.from_email}</div>
                              <div className="truncate text-xs text-muted-foreground">{m.from_email}</div>
                            </TableCell>
                            <TableCell className="text-sm max-w-[180px] truncate">{m.subject}</TableCell>
                            <TableCell><ClassificationBadge cls={m.classification} /></TableCell>
                            <TableCell><ConfidenceBadge conf={m.confidence} /></TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate text-muted-foreground">{m.routed_agent ?? "—"}</TableCell>
                            <TableCell><StatusBadge status={m.routed_status} /></TableCell>
                            <TableCell>
                              {m.action_payload?.suggestedReply ? (
                                <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 gap-1">
                                  <Zap className="h-2.5 w-2.5" /> Draft ready
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => setSelectedInbound(m)} data-testid={`button-view-${m.id}`}>
                                <Eye className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Classification breakdown */}
            {Object.keys(inboundData?.byClassification ?? {}).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(inboundData!.byClassification).map(([cls, cnt]) => (
                  <div key={cls} className="bg-muted/40 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-xs truncate mr-2">{cls.replace(/_/g, " ")}</span>
                    <span className="text-sm font-bold shrink-0">{cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Simulate ── */}
          <TabsContent value="simulate" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4" /> Simulate Inbound Email
                </CardTitle>
                <CardDescription>
                  Run test inbound payloads through the full classification and routing pipeline — no real emails are sent.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(simCases ?? []).map((tc) => (
                    <div key={tc.index} className="border rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{tc.label}</p>
                        <Badge variant="outline" className="font-mono text-xs mt-1">{tc.inbox}@</Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`button-simulate-${tc.index}`}
                        disabled={simulateMutation.isPending}
                        onClick={() => simulateMutation.mutate(tc.index)}
                      >
                        {simulateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                        <span className="ml-1">Run</span>
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">After running, switch to the <strong>Inbound</strong> tab to see the classified result and any suggested reply draft.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> Connection Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Configuration", statusData?.configured ? "✓ Credentials present" : "✗ Not configured"],
                  ["API Connection", statusData?.connected ? "✓ Live" : statusData?.configured ? "✗ Unreachable" : "–"],
                  ["Status", statusData?.message ?? "–"],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground text-right max-w-xs">{val}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agent → Inbox Mapping</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agentInboxes.map((a) => (
                    <div key={a.inbox} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{a.agent}</p>
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                      </div>
                      <Badge variant="outline" className="font-mono text-xs">{a.inbox}@</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Agent Inboxes ── */}
          <TabsContent value="inboxes" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Inbox className="h-4 w-4" /> Configured Inboxes</CardTitle>
              </CardHeader>
              <CardContent>
                {inboxesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : !inboxesData?.configured ? (
                  <p className="text-sm text-muted-foreground py-4">AgentMail not configured.</p>
                ) : inboxesData.inboxes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No inboxes found. Use the verify tool below.</p>
                ) : (
                  <div className="space-y-2">
                    {inboxesData.inboxes.map((inbox: any, i: number) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md">
                        <span className="text-sm font-mono">{inbox.address ?? inbox.username ?? JSON.stringify(inbox)}</span>
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Verify / Create Inbox</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Inbox local-part</Label>
                    <Select value={verifyInbox} onValueChange={setVerifyInbox}>
                      <SelectTrigger data-testid="select-verify-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button data-testid="button-verify-inbox"
                    onClick={() => verifyMutation.mutate(verifyInbox)}
                    disabled={verifyMutation.isPending || !statusData?.configured}>
                    {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Verify / Create
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Outbound Log ── */}
          <TabsContent value="messages" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Outbound Sent Messages</CardTitle>
                <CardDescription>All outbound messages logged by the AgentMail integration</CardDescription>
              </CardHeader>
              <CardContent>
                {messagesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : messages.filter(m => m.status !== "failed").length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No sent messages yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>Inbox</TableHead>
                          <TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {messages.filter(m => m.status !== "failed").slice(0, 100).map((m) => (
                          <TableRow key={m.id} data-testid={`row-message-${m.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                            <TableCell className="text-sm">{m.agent_name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">{m.to_email}</TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate">{m.subject}</TableCell>
                            <TableCell><StatusBadge status={m.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Failed ── */}
          <TabsContent value="failed" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" /> Failed Messages</CardTitle>
              </CardHeader>
              <CardContent>
                {messages.filter(m => m.status === "failed").length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No failed messages.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead><TableHead>Agent</TableHead><TableHead>Inbox</TableHead>
                          <TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {messages.filter(m => m.status === "failed").map((m) => (
                          <TableRow key={m.id} data-testid={`row-failed-${m.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</TableCell>
                            <TableCell className="text-sm">{m.agent_name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[120px] truncate">{m.to_email}</TableCell>
                            <TableCell className="text-sm max-w-[120px] truncate">{m.subject}</TableCell>
                            <TableCell className="text-sm text-red-600 dark:text-red-400 max-w-[160px] truncate">{m.error_message ?? "Unknown"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Send Email ── */}
          <TabsContent value="send" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Send Email from Agent Inbox</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>From Inbox</Label>
                    <Select value={sendForm.fromInbox} onValueChange={(v) => setSendForm(f => ({ ...f, fromInbox: v }))}>
                      <SelectTrigger data-testid="select-send-inbox"><SelectValue /></SelectTrigger>
                      <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Agent Name</Label>
                    <Input data-testid="input-agent-name" value={sendForm.agentName}
                      onChange={(e) => setSendForm(f => ({ ...f, agentName: e.target.value }))} placeholder="e.g. Revenue Agent" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>To Email</Label>
                  <Input data-testid="input-send-to" type="email" value={sendForm.to}
                    onChange={(e) => setSendForm(f => ({ ...f, to: e.target.value }))} placeholder="recipient@example.com" />
                </div>
                <div className="space-y-1">
                  <Label>Subject</Label>
                  <Input data-testid="input-send-subject" value={sendForm.subject}
                    onChange={(e) => setSendForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject" />
                </div>
                <div className="space-y-1">
                  <Label>Body</Label>
                  <Textarea data-testid="input-send-body" value={sendForm.body}
                    onChange={(e) => setSendForm(f => ({ ...f, body: e.target.value }))} placeholder="Email body…" rows={6} />
                </div>
                <Button data-testid="button-send-email"
                  onClick={() => sendMutation.mutate(sendForm)}
                  disabled={sendMutation.isPending || !statusData?.configured || !sendForm.to || !sendForm.subject || !sendForm.body}>
                  {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send Email
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Settings ── */}
          <TabsContent value="settings" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Connection Settings</CardTitle>
                <CardDescription>AgentMail credentials are stored as Replit Secrets.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { key: "AGENTMAIL_API_KEY", required: true, example: "am_live_xxxx" },
                    { key: "AGENTMAIL_BASE_URL", required: false, example: "https://api.agentmail.to/v0" },
                    { key: "AGENTMAIL_DEFAULT_FROM", required: false, example: "operations@yourco.com" },
                    { key: "AGENTMAIL_WEBHOOK_SECRET", required: false, example: "whsec_xxxx" },
                    { key: "AGENTMAIL_ORG_DOMAIN", required: false, example: "yourco.com" },
                  ].map(({ key, required, example }) => (
                    <div key={key} className="bg-muted/40 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-bold">{key}</code>
                        {required ? <Badge variant="destructive" className="text-xs">Required</Badge>
                          : <Badge variant="outline" className="text-xs">Optional</Badge>}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground/60 mt-0.5">Example: {example}</p>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">Test Connection</p>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1 space-y-1">
                      <Label>Send test email to</Label>
                      <Input data-testid="input-test-to" type="email" value={testTo}
                        onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
                    </div>
                    <Button data-testid="button-test-connection" variant="outline"
                      onClick={() => testMutation.mutate(testTo)}
                      disabled={testMutation.isPending || !statusData?.configured || !testTo}>
                      {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                      Send Test
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Inbound detail dialog */}
      <InboundDetailDialog
        message={selectedInbound}
        onClose={() => setSelectedInbound(null)}
        onReply={handleOpenReply}
      />

      {/* Reply composer dialog */}
      {replyDraft && (
        <Dialog open={!!replyDraft} onOpenChange={() => setReplyDraft(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Compose Reply</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>From Inbox</Label>
                <Select value={replyDraft.fromInbox} onValueChange={(v) => setReplyDraft(d => d ? { ...d, fromInbox: v } : d)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input value={replyDraft.to} onChange={(e) => setReplyDraft(d => d ? { ...d, to: e.target.value } : d)} />
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={replyDraft.subject} onChange={(e) => setReplyDraft(d => d ? { ...d, subject: e.target.value } : d)} />
              </div>
              <div className="space-y-1">
                <Label>Body</Label>
                <Textarea value={replyDraft.body} rows={6}
                  onChange={(e) => setReplyDraft(d => d ? { ...d, body: e.target.value } : d)} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setReplyDraft(null)}>Cancel</Button>
                <Button
                  data-testid="button-send-reply"
                  disabled={replyMutation.isPending || !statusData?.configured}
                  onClick={() => {
                    if (!replyDraft) return;
                    replyMutation.mutate({
                      fromInbox: replyDraft.fromInbox,
                      to: replyDraft.to,
                      subject: replyDraft.subject,
                      body: replyDraft.body,
                      threadId: "manual",
                    });
                  }}>
                  {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send Reply
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
