/**
 * Kevin Console — Phase 3 (7 tabs)
 * Health · Chat · Capabilities · Events · Outcomes · Context · Audit
 * ADMIN only.
 */
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  RefreshCw,
  Server,
  Shield,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Bot,
  ScrollText,
  Send,
  Square,
  MessageSquare,
  Zap,
  Target,
  Brain,
  ToggleLeft,
  BarChart3,
  CircuitBoard,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type KevinHealth = {
  status: "healthy" | "degraded" | "down" | "unconfigured";
  hermesReachable: boolean;
  integrationEnabled: boolean;
  configured: boolean;
  gatewayState?: string | null;
  activeRuns?: number | null;
  features?: { runs: boolean; sse: boolean; approvals: boolean } | null;
  lastError?: string | null;
  checkedAt: string;
  baseUrlRedacted?: string | null;
  phase?: string;
  details?: any;
};

type KevinCapabilities = {
  status: string;
  hermes: any | null;
  teFeatureFlags: { integrationEnabled: boolean; coachAccess: "none"; phase: string };
  checkedAt: string;
  error?: string | null;
};

type KevinCapabilityRow = {
  id: string;
  orgId: string;
  capability: string;
  approvalMode: string;
  enabled: boolean;
  updatedBy: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type KevinCapabilitiesResp = {
  capabilities: KevinCapabilityRow[];
  approvalModeOrder: string[];
  tokenConfigured: boolean;
};

type KevinAuditResponse = {
  events: { id: string; eventType: string; payload: any; createdAt: string }[];
};

type KevinEventsResp = {
  events: any[];
  stats: {
    pending: string;
    processing: string;
    sent: string;
    failed: string;
    dead_lettered: string;
  };
  limit: number;
  offset: number;
};

type KevinOutcomesResp = {
  outcomes: any[];
  limit: number;
  offset: number;
};

type KevinContextResp = {
  requests: any[];
  stats: {
    success: string;
    empty: string;
    disabled: string;
    unavailable: string;
    timeout: string;
    failed: string;
    avg_duration_ms: string | null;
    avg_confidence: string | null;
  };
  limit: number;
  offset: number;
};

type CircuitStatus = {
  state: string;
  failures: number;
  lastFailureAt: string | null;
  cooldownUntil: string | null;
  cooldownMs: number;
  threshold: number;
  windowMs: number;
};

type ChatLine =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; runId?: string }
  | { role: "system"; text: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "healthy")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200" data-testid="badge-kevin-status">
        <CheckCircle2 className="h-3 w-3 mr-1" /> healthy
      </Badge>
    );
  if (s === "degraded")
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200" data-testid="badge-kevin-status">
        <AlertTriangle className="h-3 w-3 mr-1" /> degraded
      </Badge>
    );
  if (s === "unconfigured")
    return (
      <Badge variant="outline" data-testid="badge-kevin-status">
        <Server className="h-3 w-3 mr-1" /> unconfigured
      </Badge>
    );
  return (
    <Badge className="bg-rose-100 text-rose-800 border-rose-200" data-testid="badge-kevin-status">
      <XCircle className="h-3 w-3 mr-1" /> {status || "down"}
    </Badge>
  );
}

function eventStatusBadge(status: string) {
  if (status === "sent") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">{status}</Badge>;
  if (status === "pending") return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">{status}</Badge>;
  if (status === "processing") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">{status}</Badge>;
  if (status === "dead_lettered") return <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-xs">{status}</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

function outcomeBadge(outcome: string) {
  if (outcome === "approved") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">{outcome}</Badge>;
  if (outcome === "rejected") return <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-xs">{outcome}</Badge>;
  if (outcome === "sent") return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">{outcome}</Badge>;
  return <Badge variant="outline" className="text-xs">{outcome}</Badge>;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fmt(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function statN(v: string | number | null | undefined) {
  if (v == null) return 0;
  return typeof v === "number" ? v : parseInt(v as string, 10) || 0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthTab({ healthQ, capsQ, circuitQ }: {
  healthQ: ReturnType<typeof useQuery<KevinHealth>>;
  capsQ: ReturnType<typeof useQuery<KevinCapabilities>>;
  circuitQ: ReturnType<typeof useQuery<CircuitStatus>>;
}) {
  const health = healthQ.data;
  const caps = capsQ.data;
  const circuit = circuitQ.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Connection status
            </CardTitle>
            {health ? statusBadge(health.status) : <Skeleton className="h-6 w-24" />}
          </div>
          <CardDescription>Browser never holds Hermes keys. BFF only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {healthQ.isLoading && <Skeleton className="h-16 w-full" />}
          {healthQ.isError && (
            <div className="text-rose-600 text-sm" data-testid="text-kevin-health-error">
              {(healthQ.error as Error)?.message}
            </div>
          )}
          {health && (
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                {health.hermesReachable ? (
                  <Wifi className="h-4 w-4 text-emerald-600" />
                ) : (
                  <WifiOff className="h-4 w-4 text-rose-600" />
                )}
                Reachable: <strong>{health.hermesReachable ? "yes" : "no"}</strong>
              </div>
              <div>Endpoint: <code className="text-xs">{health.baseUrlRedacted || "—"}</code></div>
              <div>Gateway: <strong>{health.gatewayState || "—"}</strong></div>
              <div>Phase: <strong>{health.phase || caps?.teFeatureFlags?.phase || "3"}</strong></div>
              <div>Active runs: <strong>{health.activeRuns ?? "—"}</strong></div>
              <div>Integration: <strong>{health.integrationEnabled ? "enabled" : "disabled"}</strong></div>
              {health.lastError && (
                <div className="sm:col-span-2 text-amber-700 text-xs">{health.lastError}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CircuitBoard className="h-4 w-4" /> Circuit breaker
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {circuitQ.isLoading && <Skeleton className="h-10 w-full" />}
          {circuit ? (
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                State:
                <Badge
                  className={
                    circuit.state === "closed"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                      : circuit.state === "half_open"
                        ? "bg-amber-100 text-amber-800 border-amber-200"
                        : "bg-rose-100 text-rose-800 border-rose-200"
                  }
                  data-testid="badge-kevin-circuit-state"
                >
                  {circuit.state}
                </Badge>
              </div>
              <div>Failures: <strong>{circuit.failures}</strong> / {circuit.threshold}</div>
              <div>Window: <strong>{circuit.windowMs / 1000}s</strong></div>
              <div>Cooldown: <strong>{circuit.cooldownMs / 1000}s</strong></div>
              {circuit.lastFailureAt && (
                <div className="sm:col-span-2 text-muted-foreground text-xs">
                  Last failure: {fmt(circuit.lastFailureAt)}
                  {circuit.cooldownUntil ? ` · Cool until: ${fmt(circuit.cooldownUntil)}` : ""}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Unavailable</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> Hermes capabilities
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1 font-mono text-xs">
          {caps?.hermes ? (
            <>
              <div>model: {String(caps.hermes.model ?? "—")}</div>
              <div>runs: {String(caps.hermes.features?.run_submission ?? "—")}</div>
              <div>sse: {String(caps.hermes.features?.run_events_sse ?? "—")}</div>
              <div>approvals: {String(caps.hermes.features?.approvals ?? "—")}</div>
            </>
          ) : (
            <p className="text-muted-foreground font-sans">{caps?.error || "Unavailable"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChatTab({ healthQ, capsQ, runsQ }: {
  healthQ: ReturnType<typeof useQuery<KevinHealth>>;
  capsQ: ReturnType<typeof useQuery<KevinCapabilities>>;
  runsQ: ReturnType<typeof useQuery<{ runs: any[] }>>;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopRun = useCallback(async () => {
    abortRef.current?.abort();
    if (activeRunId) {
      try {
        await authenticatedFetch(`/api/kevin/runs/${activeRunId}/stop`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    setStreaming(false);
    setActiveRunId(null);
  }, [activeRunId]);

  const sendMessage = useCallback(async () => {
    const message = input.trim();
    if (!message || streaming) return;
    if (healthQ.data?.status === "unconfigured" || healthQ.data?.status === "down") {
      setLines((prev) => [
        ...prev,
        { role: "system", text: "Kevin is unconfigured or down — fix health before chatting." },
      ]);
      return;
    }

    setInput("");
    setLines((prev) => [...prev, { role: "user", text: message }, { role: "assistant", text: "" }]);
    setStreaming(true);

    const clientRequestId = uuid();
    try {
      const res = await authenticatedFetch("/api/kevin/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          sessionId: sessionId || undefined,
          mode: "ops_chat",
          clientRequestId,
          contextHints: { includeAgentHealth: true },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const runId = data?.receipt?.runId as string;
      const nextSession = data?.receipt?.sessionId as string;
      if (nextSession) setSessionId(nextSession);
      setActiveRunId(runId);
      setLines((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, runId };
        return copy;
      });

      const ac = new AbortController();
      abortRef.current = ac;
      const evRes = await authenticatedFetch(`/api/kevin/runs/${runId}/events`, {
        signal: ac.signal,
      });
      if (!evRes.ok || !evRes.body) throw new Error(`Events stream failed: HTTP ${evRes.status}`);

      const reader = evRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const chunk of chunks) {
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: any;
            try { ev = JSON.parse(payload); } catch { continue; }
            if (ev.type === "message.delta" && ev.delta) {
              setLines((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") copy[copy.length - 1] = { ...last, text: last.text + ev.delta };
                return copy;
              });
            } else if (ev.type === "tool.progress") {
              setLines((prev) => [...prev, { role: "system", text: `tool: ${ev.tool || "?"} ${ev.message || ""}`.trim() }]);
            } else if (ev.type === "approval.requested") {
              setLines((prev) => [...prev, { role: "system", text: `Approval required: ${ev.summary || "host action"} risk=${ev.riskClass || "?"}` }]);
            } else if (ev.type === "run.failed") {
              setLines((prev) => [...prev, { role: "system", text: `Run failed: ${ev.message || "unknown"}` }]);
            }
          }
        }
      }
      qc.invalidateQueries({ queryKey: ["/api/kevin/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/kevin/audit"] });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setLines((prev) => [...prev, { role: "system", text: e?.message || "Kevin run failed" }]);
      }
    } finally {
      setStreaming(false);
      setActiveRunId(null);
      abortRef.current = null;
    }
  }, [input, streaming, sessionId, healthQ.data?.status, qc]);

  return (
    <div className="space-y-4">
      <Card data-testid="card-kevin-chat">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Ops chat
          </CardTitle>
          <CardDescription>
            Starts Hermes <code>/v1/runs</code>, streams SSE through BFF.
            {sessionId && <span className="block text-xs mt-1">session: {sessionId}</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScrollArea className="h-72 rounded-md border p-3 bg-muted/20">
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ask Kevin about platform ops, agent health, or routing. Example: "Summarize current readiness risks."
              </p>
            )}
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.role === "user" ? "text-sm ml-6" : l.role === "system" ? "text-xs text-muted-foreground" : "text-sm mr-6"
                  }
                >
                  <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">{l.role}</span>
                  <div className="whitespace-pre-wrap mt-0.5">{l.text || (streaming && l.role === "assistant" ? "…" : "")}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Kevin…"
              className="min-h-[72px]"
              disabled={streaming}
              data-testid="input-kevin-message"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
            />
            {streaming ? (
              <Button variant="destructive" onClick={stopRun} data-testid="button-kevin-stop">
                <Square className="h-4 w-4 mr-1" /> Stop
              </Button>
            ) : (
              <Button onClick={sendMessage} disabled={!input.trim()} data-testid="button-kevin-send">
                <Send className="h-4 w-4 mr-1" /> Send
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {!runsQ.data?.runs?.length && <p className="text-muted-foreground text-xs">No runs yet.</p>}
          {runsQ.data?.runs?.slice(0, 8).map((r) => (
            <div key={r.id} className="flex justify-between gap-2 text-xs border-b py-1">
              <span className="truncate">{r.id.slice(0, 8)}…</span>
              <Badge variant="outline">{r.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CapabilitiesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const capsAdminQ = useQuery<KevinCapabilitiesResp>({
    queryKey: ["/api/admin/kevin/capabilities"],
    queryFn: () => fetchJson("/api/admin/kevin/capabilities"),
  });

  const seedMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/kevin/capabilities/seed"),
    onSuccess: () => {
      toast({ title: "Capabilities seeded" });
      qc.invalidateQueries({ queryKey: ["/api/admin/kevin/capabilities"] });
    },
    onError: (e: any) => toast({ title: "Seed failed", description: e?.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: ({ capability, approvalMode, enabled }: { capability: string; approvalMode: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/admin/kevin/capabilities/${capability}`, { approvalMode, enabled }),
    onSuccess: () => {
      toast({ title: "Capability updated" });
      qc.invalidateQueries({ queryKey: ["/api/admin/kevin/capabilities"] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const caps = capsAdminQ.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-medium text-sm">Per-capability approval mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            observe → suggest → approve → auto-execute. Internal service token:&nbsp;
            <Badge variant={caps?.tokenConfigured ? "default" : "outline"} className="text-xs">
              {caps?.tokenConfigured ? "configured" : "not set"}
            </Badge>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
          data-testid="button-kevin-seed-caps"
        >
          Seed defaults
        </Button>
      </div>

      {capsAdminQ.isLoading && <Skeleton className="h-40 w-full" />}
      {capsAdminQ.isError && (
        <p className="text-sm text-rose-600">{(capsAdminQ.error as Error)?.message}</p>
      )}

      {caps?.capabilities?.map((cap) => (
        <Card key={cap.capability} data-testid={`card-kevin-cap-${cap.capability}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-0.5 flex-1">
                <div className="font-medium text-sm font-mono">{cap.capability}</div>
                {cap.description && (
                  <div className="text-xs text-muted-foreground">{cap.description}</div>
                )}
                {cap.updatedBy && (
                  <div className="text-xs text-muted-foreground">Updated by {cap.updatedBy}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={cap.enabled}
                  onCheckedChange={(v) =>
                    patchMut.mutate({ capability: cap.capability, approvalMode: cap.approvalMode, enabled: v })
                  }
                  data-testid={`switch-kevin-cap-enabled-${cap.capability}`}
                />
                <Select
                  value={cap.approvalMode}
                  onValueChange={(v) =>
                    patchMut.mutate({ capability: cap.capability, approvalMode: v, enabled: cap.enabled })
                  }
                >
                  <SelectTrigger className="w-36 text-xs" data-testid={`select-kevin-cap-mode-${cap.capability}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(caps.approvalModeOrder ?? ["observe", "suggest", "approve", "auto_execute"]).map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {!capsAdminQ.isLoading && !caps?.capabilities?.length && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No capabilities seeded yet. Click "Seed defaults" to populate.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EventsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const eventsQ = useQuery<KevinEventsResp>({
    queryKey: ["/api/admin/kevin/events"],
    queryFn: () => fetchJson("/api/admin/kevin/events?limit=30"),
    refetchInterval: 15_000,
  });

  const flushMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/kevin/events/flush"),
    onSuccess: (data: any) => {
      toast({ title: `Flushed: ${data?.dispatched ?? 0} dispatched, ${data?.dead ?? 0} dead-lettered` });
      qc.invalidateQueries({ queryKey: ["/api/admin/kevin/events"] });
    },
    onError: (e: any) => toast({ title: "Flush failed", description: e?.message, variant: "destructive" }),
  });

  const stats = eventsQ.data?.stats;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Pending", key: "pending", color: "text-blue-600" },
          { label: "Processing", key: "processing", color: "text-amber-600" },
          { label: "Sent", key: "sent", color: "text-emerald-600" },
          { label: "Failed", key: "failed", color: "text-rose-600" },
          { label: "Dead-lettered", key: "dead_lettered", color: "text-rose-800" },
        ].map(({ label, key, color }) => (
          <Card key={key}>
            <CardContent className="pt-3 pb-3 text-center">
              <div className={`text-2xl font-bold ${color}`} data-testid={`stat-kevin-events-${key}`}>
                {stats ? statN((stats as any)[key]) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-between items-center gap-2">
        <h3 className="font-medium text-sm">Event queue (last 30)</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => flushMut.mutate()}
          disabled={flushMut.isPending}
          data-testid="button-kevin-flush-events"
        >
          <Zap className="h-4 w-4 mr-1" /> Manual flush
        </Button>
      </div>

      {eventsQ.isLoading && <Skeleton className="h-40 w-full" />}

      <div className="divide-y rounded-md border text-xs" data-testid="list-kevin-events">
        {eventsQ.data?.events?.map((ev) => (
          <div key={ev.id} className="flex items-start gap-3 px-3 py-2">
            {eventStatusBadge(ev.status)}
            <div className="flex-1 min-w-0">
              <div className="font-mono truncate">{ev.event_type}</div>
              <div className="text-muted-foreground truncate">{ev.entity_type}{ev.entity_id ? `:${ev.entity_id.slice(0, 8)}` : ""}</div>
            </div>
            <div className="text-muted-foreground whitespace-nowrap shrink-0">{fmt(ev.created_at)}</div>
          </div>
        ))}
        {!eventsQ.isLoading && !eventsQ.data?.events?.length && (
          <div className="px-3 py-6 text-center text-muted-foreground">No events yet.</div>
        )}
      </div>
    </div>
  );
}

function OutcomesTab() {
  const outcomesQ = useQuery<KevinOutcomesResp>({
    queryKey: ["/api/admin/kevin/outcomes"],
    queryFn: () => fetchJson("/api/admin/kevin/outcomes?limit=30"),
    refetchInterval: 20_000,
  });

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm">Recorded outcomes (last 30)</h3>
      {outcomesQ.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="divide-y rounded-md border text-xs" data-testid="list-kevin-outcomes">
        {outcomesQ.data?.outcomes?.map((o) => (
          <div key={o.id} className="flex items-start gap-3 px-3 py-2">
            {outcomeBadge(o.outcome)}
            <div className="flex-1 min-w-0">
              <div className="font-mono truncate">{o.entity_type}:{o.entity_id?.slice(0, 8)}</div>
              {o.result_summary && <div className="text-muted-foreground truncate">{o.result_summary}</div>}
              {o.recorded_by && <div className="text-muted-foreground">by {o.recorded_by}</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="text-xs">{o.forward_status}</Badge>
              <span className="text-muted-foreground whitespace-nowrap">{fmt(o.created_at)}</span>
            </div>
          </div>
        ))}
        {!outcomesQ.isLoading && !outcomesQ.data?.outcomes?.length && (
          <div className="px-3 py-6 text-center text-muted-foreground">No outcomes recorded yet.</div>
        )}
      </div>
    </div>
  );
}

function ContextTab() {
  const ctxQ = useQuery<KevinContextResp>({
    queryKey: ["/api/admin/kevin/context-requests"],
    queryFn: () => fetchJson("/api/admin/kevin/context-requests?limit=30"),
    refetchInterval: 20_000,
  });

  const stats = ctxQ.data?.stats;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Success", key: "success", color: "text-emerald-600" },
            { label: "Empty", key: "empty", color: "text-amber-600" },
            { label: "Disabled", key: "disabled", color: "text-muted-foreground" },
            { label: "Failed", key: "failed", color: "text-rose-600" },
          ].map(({ label, key, color }) => (
            <Card key={key}>
              <CardContent className="pt-3 pb-3 text-center">
                <div className={`text-2xl font-bold ${color}`}>{statN((stats as any)[key])}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {stats?.avg_duration_ms && (
        <p className="text-xs text-muted-foreground">
          Avg response time: <strong>{parseFloat(stats.avg_duration_ms).toFixed(0)}ms</strong>
          {stats.avg_confidence ? ` · Avg confidence: ${parseFloat(stats.avg_confidence).toFixed(2)}` : ""}
        </p>
      )}

      <h3 className="font-medium text-sm">Context requests (last 30, 7d)</h3>
      {ctxQ.isLoading && <Skeleton className="h-40 w-full" />}
      <div className="divide-y rounded-md border text-xs" data-testid="list-kevin-context">
        {ctxQ.data?.requests?.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-3 py-2">
            <Badge variant={r.status === "success" ? "default" : "outline"} className="text-xs shrink-0">{r.status}</Badge>
            <div className="flex-1 min-w-0">
              <div className="font-mono truncate">{r.agent_type}{r.workflow ? ` / ${r.workflow}` : ""}</div>
              {r.question && <div className="text-muted-foreground truncate">{r.question.slice(0, 80)}</div>}
              {r.response_summary && <div className="text-muted-foreground truncate">{r.response_summary.slice(0, 80)}</div>}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {r.duration_ms && <span className="text-muted-foreground">{r.duration_ms}ms</span>}
              <span className="text-muted-foreground whitespace-nowrap">{fmt(r.created_at)}</span>
            </div>
          </div>
        ))}
        {!ctxQ.isLoading && !ctxQ.data?.requests?.length && (
          <div className="px-3 py-6 text-center text-muted-foreground">No context requests yet.</div>
        )}
      </div>
    </div>
  );
}

function AuditTab({ auditQ }: { auditQ: ReturnType<typeof useQuery<KevinAuditResponse>> }) {
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm">Audit log (last 15)</h3>
      {auditQ.isLoading && <Skeleton className="h-40 w-full" />}
      {auditQ.data?.events?.length ? (
        <ul className="divide-y rounded-md border text-xs" data-testid="list-kevin-audit">
          {auditQ.data.events.map((e) => (
            <li key={e.id} className="px-3 py-2 flex gap-3">
              <span className="text-muted-foreground whitespace-nowrap shrink-0">{fmt(e.createdAt)}</span>
              <Badge variant="outline" className="text-xs shrink-0">{e.eventType}</Badge>
              {e.payload?.message && <span className="text-muted-foreground truncate">{e.payload.message}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No audit events yet.</CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminKevinPage() {
  const healthQ = useQuery<KevinHealth>({
    queryKey: ["/api/kevin/health"],
    queryFn: () => fetchJson("/api/kevin/health"),
    refetchInterval: 30_000,
  });
  const capsQ = useQuery<KevinCapabilities>({
    queryKey: ["/api/kevin/capabilities"],
    queryFn: () => fetchJson("/api/kevin/capabilities"),
    refetchInterval: 60_000,
  });
  const auditQ = useQuery<KevinAuditResponse>({
    queryKey: ["/api/kevin/audit"],
    queryFn: () => fetchJson("/api/kevin/audit?limit=15"),
    refetchInterval: 60_000,
  });
  const runsQ = useQuery<{ runs: any[] }>({
    queryKey: ["/api/kevin/runs"],
    queryFn: () => fetchJson("/api/kevin/runs?limit=10"),
    refetchInterval: 30_000,
  });
  const circuitQ = useQuery<CircuitStatus>({
    queryKey: ["/api/admin/kevin/circuit-breaker"],
    queryFn: () => fetchJson("/api/admin/kevin/circuit-breaker"),
    refetchInterval: 30_000,
  });

  const health = healthQ.data;

  const refreshAll = () => {
    healthQ.refetch();
    capsQ.refetch();
    auditQ.refetch();
    runsQ.refetch();
    circuitQ.refetch();
  };

  return (
    <div className="container max-w-5xl py-6 space-y-6" data-testid="page-admin-kevin">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6" />
            Kevin Console
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Persistent AI intelligence layer — Phase 3. Events · Outcomes · Context · Capabilities. ADMIN only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {health ? statusBadge(health.status) : <Skeleton className="h-6 w-24" />}
          <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-kevin-refresh">
            <RefreshCw className={`h-4 w-4 mr-2 ${healthQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="health" data-testid="tabs-kevin">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="health" data-testid="tab-kevin-health">
            <Activity className="h-3.5 w-3.5 mr-1.5" /> Health
          </TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-kevin-chat">
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Chat
          </TabsTrigger>
          <TabsTrigger value="capabilities" data-testid="tab-kevin-capabilities">
            <ToggleLeft className="h-3.5 w-3.5 mr-1.5" /> Capabilities
          </TabsTrigger>
          <TabsTrigger value="events" data-testid="tab-kevin-events">
            <Zap className="h-3.5 w-3.5 mr-1.5" /> Events
          </TabsTrigger>
          <TabsTrigger value="outcomes" data-testid="tab-kevin-outcomes">
            <Target className="h-3.5 w-3.5 mr-1.5" /> Outcomes
          </TabsTrigger>
          <TabsTrigger value="context" data-testid="tab-kevin-context">
            <Brain className="h-3.5 w-3.5 mr-1.5" /> Context
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-kevin-audit">
            <ScrollText className="h-3.5 w-3.5 mr-1.5" /> Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4">
          <HealthTab healthQ={healthQ} capsQ={capsQ} circuitQ={circuitQ} />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatTab healthQ={healthQ} capsQ={capsQ} runsQ={runsQ} />
        </TabsContent>

        <TabsContent value="capabilities" className="mt-4">
          <CapabilitiesTab />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <EventsTab />
        </TabsContent>

        <TabsContent value="outcomes" className="mt-4">
          <OutcomesTab />
        </TabsContent>

        <TabsContent value="context" className="mt-4">
          <ContextTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditTab auditQ={auditQ} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
