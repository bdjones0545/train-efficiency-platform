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
import {
  Mail, CheckCircle, XCircle, RefreshCw, Send, Inbox,
  AlertTriangle, Wifi, WifiOff, Loader2, Zap, Settings
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AgentInboxDef {
  agent: string;
  inbox: string;
  description: string;
}

interface StatusData {
  configured: boolean;
  connected: boolean;
  message: string;
  agentInboxes?: AgentInboxDef[];
}

interface AgentMailMessage {
  id: string;
  organization_id: string;
  agent_name: string;
  inbox: string;
  to_email: string;
  from_email: string;
  subject: string;
  body_preview: string;
  provider_message_id: string;
  status: "sent" | "failed" | "queued";
  error_message: string | null;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "sent" | "failed" | "queued" | string }) {
  if (status === "sent") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Sent</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Queued</Badge>;
}

function ConnectionBadge({ configured, connected }: { configured: boolean; connected: boolean }) {
  if (!configured) return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:border-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" /> Not Configured
    </Badge>
  );
  if (connected) return (
    <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
      <Wifi className="h-3 w-3" /> Connected
    </Badge>
  );
  return (
    <Badge variant="destructive" className="gap-1">
      <WifiOff className="h-3 w-3" /> Disconnected
    </Badge>
  );
}

const INBOX_OPTIONS = ["revenue", "hiring", "scheduling", "support", "operations", "ceo"];

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminAgentMailPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [testTo, setTestTo] = useState("");
  const [sendForm, setSendForm] = useState({
    fromInbox: "operations",
    to: "",
    subject: "",
    body: "",
    agentName: "Manual Send",
  });
  const [verifyInbox, setVerifyInbox] = useState("revenue");

  // ─── Queries ─────────────────────────────────────────────────────────────

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({
    queryKey: ["/api/agentmail/status"],
  });

  const { data: inboxesData, isLoading: inboxesLoading } = useQuery<{ configured: boolean; inboxes: any[]; agentInboxes: AgentInboxDef[] }>({
    queryKey: ["/api/agentmail/inboxes"],
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery<{
    messages: AgentMailMessage[];
    byStatus: Record<string, number>;
  }>({
    queryKey: ["/api/agentmail/messages"],
  });

  // ─── Mutations ───────────────────────────────────────────────────────────

  const testMutation = useMutation({
    mutationFn: (to: string) => apiRequest("POST", "/api/agentmail/test", { to }),
    onSuccess: () => {
      toast({ title: "Test email sent", description: "Check your inbox for the test message." });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] });
    },
    onError: (e: any) => toast({ title: "Test failed", description: e?.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: (data: typeof sendForm) => apiRequest("POST", "/api/agentmail/send", data),
    onSuccess: () => {
      toast({ title: "Email sent", description: "Message delivered via AgentMail." });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/messages"] });
      setSendForm({ fromInbox: "operations", to: "", subject: "", body: "", agentName: "Manual Send" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e?.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: (inbox: string) => apiRequest("POST", "/api/agentmail/inboxes/verify", { inbox }),
    onSuccess: (data: any) => {
      toast({
        title: data?.created ? "Inbox created" : "Inbox verified",
        description: data?.created ? `${verifyInbox}@ inbox was created.` : `${verifyInbox}@ inbox already exists.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/inboxes"] });
    },
    onError: (e: any) => toast({ title: "Verification failed", description: e?.message, variant: "destructive" }),
  });

  // ─── Render ──────────────────────────────────────────────────────────────

  const messages = messagesData?.messages ?? [];
  const sentCount = messagesData?.byStatus?.sent ?? 0;
  const failedCount = messagesData?.byStatus?.failed ?? 0;
  const queuedCount = messagesData?.byStatus?.queued ?? 0;
  const agentInboxes = statusData?.agentInboxes ?? inboxesData?.agentInboxes ?? [];

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
              Dedicated agent inbox infrastructure for outbound and inbound communications
            </p>
          </div>
          <div className="flex items-center gap-3">
            {statusLoading
              ? <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</Badge>
              : <ConnectionBadge configured={statusData?.configured ?? false} connected={statusData?.connected ?? false} />
            }
            <Button
              data-testid="button-refresh-status"
              variant="outline"
              size="sm"
              onClick={() => { refetchStatus(); queryClient.invalidateQueries({ queryKey: ["/api/agentmail/"] }); }}
            >
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
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-mono">
                    {[
                      ["AGENTMAIL_API_KEY", "Your AgentMail API key (required)"],
                      ["AGENTMAIL_BASE_URL", "API base URL (default: https://api.agentmail.to/v0)"],
                      ["AGENTMAIL_DEFAULT_FROM", "Default sender address (optional)"],
                      ["AGENTMAIL_WEBHOOK_SECRET", "Webhook HMAC secret (optional)"],
                      ["AGENTMAIL_ORG_DOMAIN", "Your inbox domain, e.g. yourco.com (optional)"],
                    ].map(([key, hint]) => (
                      <div key={key} className="bg-amber-100 dark:bg-amber-900/30 rounded px-2 py-1">
                        <span className="font-bold text-amber-900 dark:text-amber-200">{key}</span>
                        <span className="text-amber-600 dark:text-amber-400 ml-2 text-xs font-sans">{hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Sent", value: sentCount, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
            { label: "Failed", value: failedCount, icon: <XCircle className="h-4 w-4 text-red-500" /> },
            { label: "Queued", value: queuedCount, icon: <Loader2 className="h-4 w-4 text-blue-500" /> },
            { label: "Total", value: messages.length, icon: <Mail className="h-4 w-4 text-muted-foreground" /> },
          ].map((s) => (
            <Card key={s.label} data-testid={`stat-${s.label.toLowerCase()}`}>
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
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="inboxes" data-testid="tab-inboxes">Agent Inboxes</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages">Sent Messages</TabsTrigger>
            <TabsTrigger value="failed" data-testid="tab-failed">Failed</TabsTrigger>
            <TabsTrigger value="send" data-testid="tab-send">Send Email</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4" /> Connection Status
                </CardTitle>
                <CardDescription>Current AgentMail API connection health</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium">Configuration</span>
                  <span className="text-sm text-muted-foreground">
                    {statusData?.configured ? "✓ Credentials present" : "✗ Not configured"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm font-medium">API Connection</span>
                  <span className="text-sm text-muted-foreground">
                    {statusData?.connected ? "✓ Live" : statusData?.configured ? "✗ Unreachable" : "–"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium">Status Message</span>
                  <span className="text-sm text-muted-foreground max-w-xs text-right">{statusData?.message ?? "–"}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agent → Inbox Mapping</CardTitle>
                <CardDescription>Which agent uses which dedicated inbox</CardDescription>
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

          {/* ── Inboxes ── */}
          <TabsContent value="inboxes" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-4 w-4" /> Configured Inboxes
                </CardTitle>
                <CardDescription>Inboxes provisioned in AgentMail</CardDescription>
              </CardHeader>
              <CardContent>
                {inboxesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading inboxes…
                  </div>
                ) : !inboxesData?.configured ? (
                  <p className="text-sm text-muted-foreground py-4">AgentMail not configured — inboxes unavailable.</p>
                ) : inboxesData.inboxes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No inboxes found yet. Use the verify tool below to create them.</p>
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
              <CardHeader>
                <CardTitle>Verify / Create Inbox</CardTitle>
                <CardDescription>Ensure an agent inbox is provisioned in AgentMail</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Inbox local-part</Label>
                    <Select value={verifyInbox} onValueChange={setVerifyInbox}>
                      <SelectTrigger data-testid="select-verify-inbox">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INBOX_OPTIONS.map((o) => (
                          <SelectItem key={o} value={o}>{o}@</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    data-testid="button-verify-inbox"
                    onClick={() => verifyMutation.mutate(verifyInbox)}
                    disabled={verifyMutation.isPending || !statusData?.configured}
                  >
                    {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Verify / Create
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Sent Messages ── */}
          <TabsContent value="messages" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Sent Messages</CardTitle>
                <CardDescription>All outbound messages logged by the AgentMail integration</CardDescription>
              </CardHeader>
              <CardContent>
                {messagesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
                  </div>
                ) : messages.filter(m => m.status !== "failed").length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No sent messages yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Inbox</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {messages.filter(m => m.status !== "failed").slice(0, 100).map((m) => (
                          <TableRow key={m.id} data-testid={`row-message-${m.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(m.created_at).toLocaleString()}
                            </TableCell>
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
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" /> Failed Messages
                </CardTitle>
                <CardDescription>Messages that failed to deliver — review errors for debugging</CardDescription>
              </CardHeader>
              <CardContent>
                {messages.filter(m => m.status === "failed").length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No failed messages. Great!</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Inbox</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {messages.filter(m => m.status === "failed").map((m) => (
                          <TableRow key={m.id} data-testid={`row-failed-${m.id}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(m.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-sm">{m.agent_name}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs font-mono">{m.inbox}@</Badge></TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">{m.to_email}</TableCell>
                            <TableCell className="text-sm max-w-[160px] truncate">{m.subject}</TableCell>
                            <TableCell className="text-sm text-red-600 dark:text-red-400 max-w-[200px] truncate">
                              {m.error_message ?? "Unknown error"}
                            </TableCell>
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
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-4 w-4" /> Send Email from Agent Inbox
                </CardTitle>
                <CardDescription>Manually send a message from any agent inbox</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>From Inbox</Label>
                    <Select value={sendForm.fromInbox} onValueChange={(v) => setSendForm(f => ({ ...f, fromInbox: v }))}>
                      <SelectTrigger data-testid="select-send-inbox">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INBOX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}@</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Agent Name</Label>
                    <Input
                      data-testid="input-agent-name"
                      value={sendForm.agentName}
                      onChange={(e) => setSendForm(f => ({ ...f, agentName: e.target.value }))}
                      placeholder="e.g. Revenue Agent"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>To Email</Label>
                  <Input
                    data-testid="input-send-to"
                    type="email"
                    value={sendForm.to}
                    onChange={(e) => setSendForm(f => ({ ...f, to: e.target.value }))}
                    placeholder="recipient@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Subject</Label>
                  <Input
                    data-testid="input-send-subject"
                    value={sendForm.subject}
                    onChange={(e) => setSendForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="Email subject"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Body</Label>
                  <Textarea
                    data-testid="input-send-body"
                    value={sendForm.body}
                    onChange={(e) => setSendForm(f => ({ ...f, body: e.target.value }))}
                    placeholder="Email body…"
                    rows={6}
                  />
                </div>
                <Button
                  data-testid="button-send-email"
                  onClick={() => sendMutation.mutate(sendForm)}
                  disabled={sendMutation.isPending || !statusData?.configured || !sendForm.to || !sendForm.subject || !sendForm.body}
                >
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
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-4 w-4" /> Connection Settings
                </CardTitle>
                <CardDescription>
                  AgentMail credentials are stored as Replit Secrets — never committed to code.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add the following secrets in the <strong>Replit Secrets</strong> panel (the lock icon in the sidebar):
                </p>
                <div className="space-y-3">
                  {[
                    { key: "AGENTMAIL_API_KEY", required: true, format: "Your AgentMail API key", example: "am_live_xxxxxxxxxxxx" },
                    { key: "AGENTMAIL_BASE_URL", required: false, format: "API base URL", example: "https://api.agentmail.to/v0" },
                    { key: "AGENTMAIL_DEFAULT_FROM", required: false, format: "Default from address", example: "operations@yourco.com" },
                    { key: "AGENTMAIL_WEBHOOK_SECRET", required: false, format: "HMAC secret for webhook verification", example: "whsec_xxxxxxxxxxxx" },
                    { key: "AGENTMAIL_ORG_DOMAIN", required: false, format: "Your custom inbox domain (if any)", example: "yourco.com" },
                  ].map(({ key, required, format, example }) => (
                    <div key={key} className="bg-muted/40 rounded-lg px-4 py-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-bold">{key}</code>
                        {required
                          ? <Badge variant="destructive" className="text-xs">Required</Badge>
                          : <Badge variant="outline" className="text-xs">Optional</Badge>
                        }
                      </div>
                      <p className="text-xs text-muted-foreground">{format}</p>
                      <p className="text-xs font-mono text-muted-foreground/60">Example: {example}</p>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-3">
                  <p className="text-sm font-medium">Test Connection</p>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1 space-y-1">
                      <Label>Send test email to</Label>
                      <Input
                        data-testid="input-test-to"
                        type="email"
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <Button
                      data-testid="button-test-connection"
                      variant="outline"
                      onClick={() => testMutation.mutate(testTo)}
                      disabled={testMutation.isPending || !statusData?.configured || !testTo}
                    >
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
    </div>
  );
}
