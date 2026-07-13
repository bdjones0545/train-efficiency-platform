/**
 * Kevin Console — Phase 2 (health + capabilities + async ops chat)
 * ADMIN only. Coach access locked off (2026-07-13).
 */
import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-helpers";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";

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

type KevinAuditResponse = {
  events: { id: string; eventType: string; payload: any; createdAt: string }[];
};

type ChatLine =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; runId?: string }
  | { role: "system"; text: string };

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

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function AdminKevinPage() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  const refreshAll = () => {
    healthQ.refetch();
    capsQ.refetch();
    auditQ.refetch();
    runsQ.refetch();
  };

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
      if (!evRes.ok || !evRes.body) {
        throw new Error(`Events stream failed: HTTP ${evRes.status}`);
      }

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
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }
            if (ev.type === "message.delta" && ev.delta) {
              setLines((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, text: last.text + ev.delta };
                }
                return copy;
              });
            } else if (ev.type === "tool.progress") {
              setLines((prev) => [
                ...prev,
                {
                  role: "system",
                  text: `tool: ${ev.tool || "?"} ${ev.message || ""}`.trim(),
                },
              ]);
            } else if (ev.type === "approval.requested") {
              setLines((prev) => [
                ...prev,
                {
                  role: "system",
                  text: `Approval required: ${ev.summary || "host action"} (Phase 3 UI). Risk=${ev.riskClass || "?"} run=${runId}`,
                },
              ]);
            } else if (ev.type === "run.failed") {
              setLines((prev) => [
                ...prev,
                { role: "system", text: `Run failed: ${ev.message || "unknown"}` },
              ]);
            } else if (ev.type === "done") {
              // end
            }
          }
        }
      }
      qc.invalidateQueries({ queryKey: ["/api/kevin/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/kevin/audit"] });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setLines((prev) => [
          ...prev,
          { role: "system", text: e?.message || "Kevin run failed" },
        ]);
      }
    } finally {
      setStreaming(false);
      setActiveRunId(null);
      abortRef.current = null;
    }
  }, [input, streaming, sessionId, healthQ.data?.status, qc]);

  const health = healthQ.data;
  const caps = capsQ.data;

  return (
    <div className="container max-w-5xl py-6 space-y-6" data-testid="page-admin-kevin">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6" />
            Kevin Console
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ops intelligence via Hermes profile <code>kevin</code>. Phase 2 — async runs + SSE.
            ADMIN only.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} data-testid="button-kevin-refresh">
          <RefreshCw className={`h-4 w-4 mr-2 ${healthQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Connection status
            </CardTitle>
            {health ? statusBadge(health.status) : <Skeleton className="h-6 w-24" />}
          </div>
          <CardDescription>
            Browser never holds Hermes keys. BFF only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {healthQ.isLoading && <Skeleton className="h-16 w-full" />}
          {healthQ.isError && (
            <div className="text-rose-600" data-testid="text-kevin-health-error">
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
              <div>
                Endpoint: <code className="text-xs">{health.baseUrlRedacted || "—"}</code>
              </div>
              <div>
                Gateway: <strong>{health.gatewayState || "—"}</strong>
              </div>
              <div>
                Phase: <strong>{health.phase || caps?.teFeatureFlags?.phase || "2"}</strong>
              </div>
              {health.lastError && (
                <div className="sm:col-span-2 text-amber-700 text-xs">{health.lastError}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-kevin-chat">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Ops chat
          </CardTitle>
          <CardDescription>
            Starts Hermes <code>/v1/runs</code>, streams events through{" "}
            <code>/api/kevin/runs/:id/events</code>.
            {sessionId ? (
              <span className="block text-xs mt-1">session: {sessionId}</span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScrollArea className="h-72 rounded-md border p-3 bg-muted/20">
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ask Kevin about platform ops, health, or routing. Example: “Summarize current
                readiness risks.”
              </p>
            )}
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.role === "user"
                      ? "text-sm ml-6"
                      : l.role === "system"
                        ? "text-xs text-muted-foreground"
                        : "text-sm mr-6"
                  }
                >
                  <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                    {l.role}
                  </span>
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
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
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

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1 font-mono text-xs">
            {caps?.hermes ? (
              <>
                <div>model: {String(caps.hermes.model ?? "—")}</div>
                <div>runs: {String(caps.hermes.features?.run_submission ?? "—")}</div>
                <div>sse: {String(caps.hermes.features?.run_events_sse ?? "—")}</div>
              </>
            ) : (
              <p className="text-muted-foreground font-sans">{caps?.error || "Unavailable"}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {!runsQ.data?.runs?.length && (
              <p className="text-muted-foreground text-xs">No runs yet.</p>
            )}
            {runsQ.data?.runs?.slice(0, 8).map((r) => (
              <div key={r.id} className="flex justify-between gap-2 text-xs border-b py-1">
                <span className="truncate">{r.id.slice(0, 8)}…</span>
                <Badge variant="outline">{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Audit
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditQ.data?.events?.length ? (
            <ul className="text-sm divide-y" data-testid="list-kevin-audit">
              {auditQ.data.events.map((e) => (
                <li key={e.id} className="py-1.5 flex gap-2 text-xs">
                  <span className="text-muted-foreground whitespace-nowrap">
                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </span>
                  <Badge variant="outline">{e.eventType}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No audit events yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
