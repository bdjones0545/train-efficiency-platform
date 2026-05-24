import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, RefreshCw, Activity, AlertTriangle, CheckCircle,
  Users, Zap, Brain, TrendingUp, TrendingDown, Minus,
  Shield, ShieldAlert, ShieldCheck, Clock, Filter, Sparkles,
  ChevronRight, BarChart2, Loader2, X, ThumbsUp, ThumbsDown,
  MessageSquare, Dumbbell,
} from "lucide-react";
import { navigateWithContext } from "@/lib/navigateWithContext";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function riskColor(level: string) {
  if (level === "red") return "text-rose-400";
  if (level === "yellow") return "text-amber-400";
  return "text-emerald-400";
}

function riskBg(level: string) {
  if (level === "red") return "bg-rose-500/10 border-rose-500/20";
  if (level === "yellow") return "bg-amber-500/10 border-amber-500/20";
  return "bg-emerald-500/10 border-emerald-500/20";
}

function riskLabel(level: string) {
  if (level === "red") return "High Risk";
  if (level === "yellow") return "Monitor";
  return "On Track";
}

function RiskIcon({ level, className }: { level: string; className?: string }) {
  if (level === "red") return <ShieldAlert className={className ?? "h-4 w-4 text-rose-400"} />;
  if (level === "yellow") return <Shield className={className ?? "h-4 w-4 text-amber-400"} />;
  return <ShieldCheck className={className ?? "h-4 w-4 text-emerald-400"} />;
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - score / 100);
  const color = score >= 65 ? "#10b981" : score >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={5} fill="none" className="text-muted/20" />
      <circle
        cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none"
        strokeDasharray={circ} strokeDashoffset={fill}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={size < 50 ? 10 : 13} fontWeight="600" fill={color}>
        {score}
      </text>
    </svg>
  );
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    important: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    moderate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  };
  return map[severity] ?? map.info;
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Athlete Status Card ──────────────────────────────────────────────────────
function AthleteStatusCard({ row, onClick }: { row: any; onClick: () => void }) {
  const snap = row.snapshot;
  const risk = snap?.riskLevel ?? "green";
  return (
    <button onClick={onClick} className="w-full text-left" data-testid={`card-athlete-status-${row.userId}`}>
      <Card className={`p-4 border hover:border-primary/20 transition-colors ${riskBg(risk)}`}>
        <div className="flex items-center gap-3">
          <ScoreRing score={snap?.statusScore ?? 0} size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{row.userId.slice(0, 8)}…</p>
              <Badge className={`text-xs border ${severityBadge(risk === "red" ? "critical" : risk === "yellow" ? "moderate" : "info")}`}>
                {riskLabel(risk)}
              </Badge>
              {row.flagCount > 0 && (
                <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-xs">
                  {row.flagCount} flag{row.flagCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {snap ? (
              <div className="grid grid-cols-3 gap-x-3 mt-2">
                {[
                  { label: "Readiness", value: snap.readinessScore ?? 0, color: "#10b981" },
                  { label: "Adherence", value: snap.adherenceScore ?? 0, color: "#3b82f6" },
                  { label: "Education", value: snap.educationScore ?? 0, color: "#a855f7" },
                ].map((s) => (
                  <div key={s.label} className="space-y-0.5">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                    <p className="text-xs font-semibold" style={{ color: s.color }}>{s.value}%</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">No data yet — refresh to generate</p>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>
      </Card>
    </button>
  );
}

// ─── Athlete Detail Drawer ────────────────────────────────────────────────────
function AthleteDetail({
  userId, orgId, headers, onClose, slug, setLocation
}: { userId: string; orgId: string; headers: Record<string, string>; onClose: () => void; slug: string; setLocation: (to: string) => void }) {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/athlete-status", userId],
    queryFn: () => fetch(`/api/org/athlete-status/${userId}`, { headers, credentials: "include" }).then((r) => r.json()),
  });

  const refreshMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/org/athlete-status/${userId}/refresh`, {}, headers),
    onSuccess: () => { refetch(); toast({ title: "Status refreshed" }); },
  });

  const aiMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/athlete-intelligence/recommend", { athleteUserId: userId }, headers),
    onSuccess: () => { refetch(); toast({ title: "AI recommendations generated" }); },
    onError: () => toast({ title: "AI generation failed", variant: "destructive" }),
  });

  const flagMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/athlete-risk-flags/${id}`, { status }, headers),
    onSuccess: () => refetch(),
  });

  const interventionMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/interventions/${id}`, { status }, headers),
    onSuccess: () => refetch(),
  });

  const snap = data?.snapshots?.[0];
  const flags: any[] = data?.flags ?? [];
  const interventions: any[] = data?.interventions ?? [];
  const checkins: any[] = data?.checkins ?? [];
  const activeFlags = flags.filter((f) => f.status === "active");

  return (
    <div className="fixed inset-0 z-50 bg-background/95 overflow-auto">
      <div className="border-b border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Activity className="h-5 w-5 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm">Athlete Status</h1>
          <p className="text-xs text-muted-foreground truncate">{userId}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
          onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
          {refreshMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1.5 bg-emerald-700 hover:bg-emerald-600"
          onClick={() => {
            const slug = window.location.pathname.split("/")[2];
            window.location.href = `/org/${slug}/athlete/${userId}`;
          }}>
          Full Profile
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="p-4 space-y-4 max-w-lg mx-auto">
          {/* Status Score Card */}
          {snap ? (
            <Card className={`p-4 border ${riskBg(snap.riskLevel)}`}>
              <div className="flex items-center gap-4">
                <ScoreRing score={snap.statusScore} size={72} />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Overall Status</p>
                  <div className="flex items-center gap-2 mb-3">
                    <RiskIcon level={snap.riskLevel} className={`h-4 w-4 ${riskColor(snap.riskLevel)}`} />
                    <span className={`text-sm font-bold ${riskColor(snap.riskLevel)}`}>{riskLabel(snap.riskLevel)}</span>
                  </div>
                  <div className="space-y-1.5">
                    <ScoreBar label="Readiness" value={snap.readinessScore ?? 0} color="#10b981" />
                    <ScoreBar label="Adherence" value={snap.adherenceScore ?? 0} color="#3b82f6" />
                    <ScoreBar label="Recovery" value={snap.recoveryScore ?? 0} color="#f59e0b" />
                    <ScoreBar label="Education" value={snap.educationScore ?? 0} color="#a855f7" />
                    <ScoreBar label="Engagement" value={snap.engagementScore ?? 0} color="#ec4899" />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">
                Generated {new Date(snap.generatedAt).toLocaleString()}
              </p>
            </Card>
          ) : (
            <Card className="p-4 text-center text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No status data yet</p>
              <Button size="sm" className="mt-3" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                Generate Status
              </Button>
            </Card>
          )}

          {/* Recent Check-ins */}
          {checkins.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Check-ins</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {checkins.slice(0, 7).map((c: any) => (
                  <div key={c.id} className="flex-shrink-0 w-16 text-center p-2 rounded-lg bg-card border border-border/50">
                    <p className="text-sm font-bold text-primary">{c.readinessScore}<span className="text-[9px] text-muted-foreground">/10</span></p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    {c.fatigueLevel != null && (
                      <div className="mt-1 text-[9px] text-amber-400">F:{c.fatigueLevel}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Flags */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Active Flags ({activeFlags.length})
              </p>
            </div>
            <div className="space-y-2">
              {activeFlags.length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <CheckCircle className="h-6 w-6 mx-auto mb-1.5 text-emerald-400 opacity-60" />
                  <p className="text-xs">No active flags</p>
                </div>
              )}
              {activeFlags.map((f: any) => (
                <Card key={f.id} className="p-3 border border-border/50">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
                      f.severity === "critical" ? "text-rose-400" : f.severity === "important" ? "text-orange-400" : "text-amber-400"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold">{f.title}</p>
                        <Badge className={`text-[10px] border ${severityBadge(f.severity)}`}>{f.severity}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.summary}</p>
                      {f.recommendation && (
                        <p className="text-xs text-primary/80 mt-1">→ {f.recommendation}</p>
                      )}
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                          onClick={() => flagMut.mutate({ id: f.id, status: "resolved" })}>
                          Resolve
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground"
                          onClick={() => flagMut.mutate({ id: f.id, status: "dismissed" })}>
                          Dismiss
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-blue-400"
                          data-testid={`button-message-flag-${f.id}`}
                          onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: userId, source: "athlete-status" })}>
                          <MessageSquare className="h-2.5 w-2.5" />Message
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Interventions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Interventions</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-primary/30 text-primary"
                onClick={() => aiMut.mutate()} disabled={aiMut.isPending}>
                {aiMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI Suggest
              </Button>
            </div>
            <div className="space-y-2">
              {interventions.filter((i) => i.status === "pending").length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <Brain className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">No pending interventions</p>
                  <p className="text-[10px] mt-0.5">Use AI Suggest to generate recommendations</p>
                </div>
              )}
              {interventions.filter((i) => i.status === "pending").map((iv: any) => (
                <Card key={iv.id} className="p-3 border border-border/50">
                  <div className="flex items-start gap-2">
                    <div className={`h-2 w-2 rounded-full flex-shrink-0 mt-1.5 ${
                      iv.generatedBy === "ai" ? "bg-primary" : "bg-amber-400"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold">{iv.title}</p>
                        <Badge className={`text-[10px] border ${severityBadge(iv.severity)}`}>{iv.severity}</Badge>
                        {iv.generatedBy === "ai" && (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">AI</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{iv.summary}</p>
                      {iv.suggestedAction && (
                        <p className="text-xs text-primary/80 mt-1 italic">{iv.suggestedAction}</p>
                      )}
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        <Button size="sm" className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => interventionMut.mutate({ id: iv.id, status: "accepted" })}>
                          <ThumbsUp className="h-2.5 w-2.5" />Accept
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => interventionMut.mutate({ id: iv.id, status: "dismissed" })}>
                          <ThumbsDown className="h-2.5 w-2.5" />Dismiss
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-blue-400"
                          data-testid={`button-message-intervention-${iv.id}`}
                          onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: userId, source: "athlete-status", interventionId: iv.id })}>
                          <MessageSquare className="h-2.5 w-2.5" />Message
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-emerald-400"
                          data-testid={`button-workout-intervention-${iv.id}`}
                          onClick={() => navigateWithContext(setLocation, { route: `/coach/athletes/${userId}`, orgSlug: slug, athleteId: userId, source: "athlete-status" })}>
                          <Dumbbell className="h-2.5 w-2.5" />Workout
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CoachAthleteStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(`orgToken_${slug}`) ?? null;
  const { hasAccess, isHydrating } = usePermissions(slug);

  const buildHeaders = (): Record<string, string> => ({
    ...getAuthHeaders(),
    ...(orgToken ? { "X-Org-Auth-Token": orgToken } : {}),
  });

  const canLoad = !isHydrating && (!!orgToken || hasAccess);

  if (!isHydrating && !orgToken && !hasAccess) {
    console.warn("[AUTH DRIFT DETECTED]", {
      page: "coach-athlete-status",
      slug,
      hasAccess,
      isHydrating,
      orgTokenPresent: !!orgToken,
    });
  }

  const [activeTab, setActiveTab] = useState("grid");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data: statusData, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/athlete-status", slug],
    queryFn: () => fetch("/api/org/athlete-status", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: canLoad,
  });

  const { data: flagsData } = useQuery<any>({
    queryKey: ["/api/org/athlete-risk-flags", slug],
    queryFn: () => fetch("/api/org/athlete-risk-flags", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "alerts" && canLoad,
  });

  const { data: interventionsData } = useQuery<any>({
    queryKey: ["/api/org/interventions", slug],
    queryFn: () => fetch("/api/org/interventions", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "interventions" && canLoad,
  });

  const refreshAllMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/org/athlete-status/refresh-all", {}, buildHeaders()),
    onSuccess: (res) => {
      res.json().then((d: any) => {
        toast({ title: `Refreshed ${d.refreshed} athletes` });
        queryClient.invalidateQueries({ queryKey: ["/api/org/athlete-status", slug] });
      });
    },
  });

  const flagMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/athlete-risk-flags/${id}`, { status }, buildHeaders()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org/athlete-risk-flags", slug] }),
  });

  const interventionMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/org/interventions/${id}`, { status }, buildHeaders()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org/interventions", slug] }),
  });

  const athletes: any[] = statusData?.athletes ?? [];
  const flags: any[] = flagsData?.flags ?? [];
  const interventions: any[] = interventionsData?.interventions ?? [];

  const filteredAthletes = athletes.filter((a) => {
    const risk = a.snapshot?.riskLevel ?? "green";
    if (riskFilter === "all") return true;
    return risk === riskFilter;
  });

  const redCount = athletes.filter((a) => a.snapshot?.riskLevel === "red").length;
  const yellowCount = athletes.filter((a) => a.snapshot?.riskLevel === "yellow").length;
  const greenCount = athletes.filter((a) => a.snapshot?.riskLevel === "green").length;
  const noDataCount = athletes.filter((a) => !a.snapshot).length;
  const totalFlagCount = athletes.reduce((s, a) => s + (a.flagCount ?? 0), 0);
  const pendingInterventionCount = athletes.reduce((s, a) => s + (a.pendingInterventions?.length ?? 0), 0);

  // ── Auth Guards ────────────────────────────────────────────────────────────
  if (isHydrating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!orgToken && !hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <Activity className="h-10 w-10 text-muted-foreground opacity-40" />
        <div className="text-center">
          <p className="font-semibold text-sm">Coach Access Required</p>
          <p className="text-xs text-muted-foreground mt-1">Sign in to view athlete status.</p>
        </div>
        <Button size="sm" onClick={() => setLocation(`/org/${slug}/portal`)}>
          Back to Portal
        </Button>
      </div>
    );
  }

  // Detail view
  if (selectedUserId) {
    return (
      <AthleteDetail
        userId={selectedUserId}
        orgId=""
        slug={slug}
        setLocation={setLocation}
        headers={buildHeaders()}
        onClose={() => setSelectedUserId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => setLocation(`/org/${slug}/portal`)} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Activity className="h-5 w-5 text-primary" />
        <h1 className="font-semibold text-sm">Athlete Status</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
            onClick={() => refreshAllMut.mutate()} disabled={refreshAllMut.isPending}>
            {refreshAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh All
          </Button>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Green", count: greenCount, color: "text-emerald-400", bg: "bg-emerald-500/10", filter: "green" },
            { label: "Monitor", count: yellowCount, color: "text-amber-400", bg: "bg-amber-500/10", filter: "yellow" },
            { label: "At Risk", count: redCount, color: "text-rose-400", bg: "bg-rose-500/10", filter: "red" },
            { label: "No Data", count: noDataCount, color: "text-muted-foreground", bg: "bg-muted/10", filter: "all" },
          ].map((tile) => (
            <button key={tile.label} onClick={() => setRiskFilter(riskFilter === tile.filter ? "all" : tile.filter)}
              className={`rounded-xl p-2.5 text-center border transition-colors ${tile.bg} ${
                riskFilter === tile.filter ? "border-primary/30" : "border-transparent"
              }`} data-testid={`tile-risk-${tile.filter}`}>
              <p className={`text-xl font-bold ${tile.color}`}>{tile.count}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{tile.label}</p>
            </button>
          ))}
        </div>

        {(totalFlagCount > 0 || pendingInterventionCount > 0) && (
          <div className="flex gap-2 mt-3">
            {totalFlagCount > 0 && (
              <Card className="flex-1 p-2.5 border-rose-500/20 bg-rose-500/5 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                <p className="text-xs"><span className="font-semibold text-rose-400">{totalFlagCount}</span> active flag{totalFlagCount > 1 ? "s" : ""}</p>
              </Card>
            )}
            {pendingInterventionCount > 0 && (
              <Card className="flex-1 p-2.5 border-primary/20 bg-primary/5 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary flex-shrink-0" />
                <p className="text-xs"><span className="font-semibold text-primary">{pendingInterventionCount}</span> pending action{pendingInterventionCount > 1 ? "s" : ""}</p>
              </Card>
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList className="w-full rounded-none border-b border-border/50 bg-card/30 justify-start px-4 h-10 gap-1">
          <TabsTrigger value="grid" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <Users className="h-3 w-3 mr-1.5" />Athletes
          </TabsTrigger>
          <TabsTrigger value="heatmap" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <BarChart2 className="h-3 w-3 mr-1.5" />Heatmap
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <AlertTriangle className="h-3 w-3 mr-1.5" />Alerts
            {totalFlagCount > 0 && (
              <span className="ml-1.5 bg-rose-500/20 text-rose-400 text-[10px] font-bold px-1.5 rounded-full">{totalFlagCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="interventions" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <Zap className="h-3 w-3 mr-1.5" />Queue
            {pendingInterventionCount > 0 && (
              <span className="ml-1.5 bg-primary/20 text-primary text-[10px] font-bold px-1.5 rounded-full">{pendingInterventionCount}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── ATHLETES GRID ────────────────────────────────────────────────── */}
        <TabsContent value="grid" className="mt-0 p-4 space-y-2">
          {riskFilter !== "all" && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Filtering: <span className="font-semibold capitalize">{riskFilter}</span></p>
              <button onClick={() => setRiskFilter("all")} className="text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {isLoading && (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}
          {!isLoading && filteredAthletes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No athletes found</p>
              <p className="text-xs mt-1">
                {athletes.length === 0 ? "Add athletes to your organization first" : "No athletes match the selected filter"}
              </p>
            </div>
          )}
          {filteredAthletes.map((row: any) => (
            <AthleteStatusCard key={row.userId} row={row} onClick={() => setSelectedUserId(row.userId)} />
          ))}
        </TabsContent>

        {/* ── HEATMAP ──────────────────────────────────────────────────────── */}
        <TabsContent value="heatmap" className="mt-0 p-4">
          <p className="text-xs text-muted-foreground mb-3">Team Readiness Heatmap — color shows risk level</p>
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {athletes.map((row: any) => {
                const risk = row.snapshot?.riskLevel ?? "none";
                const score = row.snapshot?.statusScore ?? 0;
                const bgClass = risk === "red" ? "bg-rose-500/20 border-rose-500/30"
                  : risk === "yellow" ? "bg-amber-500/20 border-amber-500/30"
                  : risk === "green" ? "bg-emerald-500/20 border-emerald-500/30"
                  : "bg-muted/10 border-border/30";
                return (
                  <button key={row.userId} onClick={() => setSelectedUserId(row.userId)}
                    className={`rounded-xl p-3 border text-center transition-all hover:scale-105 ${bgClass}`}
                    data-testid={`heatmap-athlete-${row.userId}`}>
                    <p className="text-lg font-bold">{score}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{row.userId.slice(0, 6)}</p>
                    {row.flagCount > 0 && (
                      <div className="mt-1 text-[9px] text-rose-400 font-semibold">{row.flagCount}⚑</div>
                    )}
                  </button>
                );
              })}
              {athletes.length === 0 && (
                <div className="col-span-4 text-center py-10 text-muted-foreground text-sm">No athlete data</div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── ALERTS FEED ──────────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="mt-0 p-4 space-y-2">
          {flags.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-3 text-emerald-400 opacity-40" />
              <p className="text-sm">No active flags</p>
              <p className="text-xs mt-1">Your team looks healthy!</p>
            </div>
          ) : (
            flags.map((f: any) => (
              <Card key={f.id} className="p-3 border border-border/50">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
                    f.severity === "critical" ? "text-rose-400" : f.severity === "important" ? "text-orange-400" : "text-amber-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold">{f.title}</p>
                      <Badge className={`text-[10px] border ${severityBadge(f.severity)}`}>{f.severity}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">Athlete: {f.athleteUserId}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{f.summary}</p>
                    {f.recommendation && (
                      <p className="text-xs text-primary/80 mt-1">→ {f.recommendation}</p>
                    )}
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                        onClick={() => flagMut.mutate({ id: f.id, status: "resolved" })}>Resolve</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-muted-foreground"
                        onClick={() => flagMut.mutate({ id: f.id, status: "dismissed" })}>Dismiss</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-primary"
                        onClick={() => setSelectedUserId(f.athleteUserId)}>View</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-blue-400"
                        data-testid={`button-message-alert-${f.id}`}
                        onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: f.athleteUserId, source: "athlete-status" })}>
                        <MessageSquare className="h-2.5 w-2.5" />Message
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── INTERVENTION QUEUE ───────────────────────────────────────────── */}
        <TabsContent value="interventions" className="mt-0 p-4 space-y-2">
          {interventions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No pending interventions</p>
              <p className="text-xs mt-1">Open an athlete profile and use AI Suggest to generate recommendations</p>
            </div>
          ) : (
            interventions.map((iv: any) => (
              <Card key={iv.id} className="p-3 border border-border/50">
                <div className="flex items-start gap-2.5">
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 mt-1.5 ${
                    iv.generatedBy === "ai" ? "bg-primary" : "bg-amber-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold">{iv.title}</p>
                      <Badge className={`text-[10px] border ${severityBadge(iv.severity)}`}>{iv.severity}</Badge>
                      {iv.generatedBy === "ai" && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">AI</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">Athlete: {iv.athleteUserId}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{iv.summary}</p>
                    {iv.suggestedAction && (
                      <p className="text-xs text-primary/80 mt-1 italic">{iv.suggestedAction}</p>
                    )}
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      <Button size="sm" className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => interventionMut.mutate({ id: iv.id, status: "accepted" })}>
                        <ThumbsUp className="h-2.5 w-2.5" />Accept
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => interventionMut.mutate({ id: iv.id, status: "dismissed" })}>
                        <ThumbsDown className="h-2.5 w-2.5" />Dismiss
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-primary"
                        onClick={() => setSelectedUserId(iv.athleteUserId)}>View</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-blue-400"
                        data-testid={`button-message-queue-${iv.id}`}
                        onClick={() => navigateWithContext(setLocation, { route: "/coach/communications-center", orgSlug: slug, athleteId: iv.athleteUserId, source: "athlete-status", interventionId: iv.id })}>
                        <MessageSquare className="h-2.5 w-2.5" />Message
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1 text-emerald-400"
                        data-testid={`button-workout-queue-${iv.id}`}
                        onClick={() => navigateWithContext(setLocation, { route: `/coach/athletes/${iv.athleteUserId}`, orgSlug: slug, athleteId: iv.athleteUserId, source: "athlete-status" })}>
                        <Dumbbell className="h-2.5 w-2.5" />Workout
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
