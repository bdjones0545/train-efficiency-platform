import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Zap, Brain, Users,
  Settings, Lock, Unlock, Eye, ChevronRight, RefreshCw,
  AlertOctagon, Activity, BarChart3, Wrench, UserCheck,
  TrendingUp, Clock, Ban, ArrowRight, Info,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type GovernanceSettings = {
  id?: string;
  orgId: string;
  defaultAutonomyMode: "supervised" | "collaborative" | "autonomous";
  maximumAllowedRiskLevel: "low" | "medium" | "high" | "critical";
  defaultConfidenceThreshold: number;
  operatorReviewRequired: boolean;
  allowAutonomousCommunication: boolean;
  allowAutonomousScheduling: boolean;
  allowAutonomousFinancialActions: boolean;
  allowResearchAgents: boolean;
  allowExternalWebAccess: boolean;
  allowCrossWorkflowMemory: boolean;
  aiActivityVisibilityMode: string;
  strictModeEnabled: boolean;
  emergencyPauseEnabled: boolean;
  emergencyPauseReason: string | null;
};

type CapabilityPolicy = {
  id: string;
  orgId: string;
  agentType: string;
  capabilityName: string;
  capabilityCategory: string;
  enabled: boolean;
  requiresApproval: boolean;
  maxAutonomyLevel: string;
  minimumConfidenceScore: number;
  allowedRiskLevels: string[];
  requiresHumanReview: boolean;
  escalationRequired: boolean;
  notes: string | null;
};

type GovernanceAnalytics = {
  totalGovernanceDecisions: number;
  blockedActionCount: number;
  escalatedCount: number;
  approvalRequiredCount: number;
  autoExecutedCount: number;
  autonomousExecutionRate: number;
  approvalRate: number;
  emergencyInterventions: number;
  autonomyModeChanges: number;
  toolDenials: Record<string, number>;
  recentBlocked: any[];
  recentApprovals: any[];
};

type AgentIdentity = {
  agentType: string;
  name: string;
  role: string;
  department: string;
  description: string;
  avatarInitials: string;
  avatarColor: string;
  capabilityManifest: string[];
  defaultAutonomyLevel: string;
  defaultRiskTolerance: string;
  toolCategories: string[];
  status: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTONOMY_CONFIG = {
  supervised: { label: "Supervised", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", icon: UserCheck, description: "All actions require human approval. Safest mode." },
  collaborative: { label: "Collaborative", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", icon: Users, description: "Low-risk, high-confidence actions auto-execute. Medium risk requires approval." },
  autonomous: { label: "Autonomous", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", icon: Zap, description: "Low and medium risk auto-execute. High risk still requires approval." },
};

const RISK_CONFIG = {
  low: { color: "bg-green-100 text-green-800", label: "Low" },
  medium: { color: "bg-amber-100 text-amber-800", label: "Medium" },
  high: { color: "bg-orange-100 text-orange-800", label: "High" },
  critical: { color: "bg-red-100 text-red-800", label: "Critical" },
};

const AVATAR_COLORS: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function AutonomyBadge({ mode }: { mode: string }) {
  const cfg = AUTONOMY_CONFIG[mode as keyof typeof AUTONOMY_CONFIG];
  if (!cfg) return <Badge variant="outline">{mode}</Badge>;
  return <Badge className={`${cfg.color} border-0 text-xs`}>{cfg.label}</Badge>;
}

function RiskBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level as keyof typeof RISK_CONFIG];
  if (!cfg) return <Badge variant="outline">{level}</Badge>;
  return <Badge className={`${cfg.color} border-0 text-xs`}>{cfg.label}</Badge>;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminAiGovernancePage() {
  const { toast } = useToast();
  const [emergencyReason, setEmergencyReason] = useState("");
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);

  const { data: settings, isLoading: settingsLoading, isError: settingsError } = useQuery<GovernanceSettings>({
    queryKey: ["/api/governance/settings"],
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<GovernanceAnalytics>({
    queryKey: ["/api/governance/analytics"],
  });

  const { data: agents } = useQuery<AgentIdentity[]>({
    queryKey: ["/api/governance/agents"],
  });

  const { data: policies } = useQuery<CapabilityPolicy[]>({
    queryKey: ["/api/governance/policies"],
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (updates: Partial<GovernanceSettings>) =>
      apiRequest("PATCH", "/api/governance/settings", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      toast({ title: "Governance settings updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const emergencyPauseMutation = useMutation({
    mutationFn: ({ enable, reason }: { enable: boolean; reason?: string }) =>
      apiRequest("POST", "/api/governance/emergency-pause", { enable, reason }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/analytics"] });
      toast({
        title: vars.enable ? "Emergency pause activated" : "Emergency pause deactivated",
        description: vars.enable ? "All AI operations are now paused." : "AI operations are resuming.",
        variant: vars.enable ? "destructive" : "default",
      });
      setShowEmergencyDialog(false);
      setEmergencyReason("");
    },
  });

  const changeModeM = useMutation({
    mutationFn: (mode: string) => apiRequest("POST", "/api/governance/autonomy-mode", { mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/analytics"] });
      toast({ title: "Autonomy mode updated" });
    },
  });

  const isPaused = settings?.emergencyPauseEnabled;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-ai-governance">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${isPaused ? "bg-red-50 dark:bg-red-950" : "bg-indigo-50 dark:bg-indigo-950"}`}>
            <Shield className={`w-6 h-6 ${isPaused ? "text-red-600" : "text-indigo-600"}`} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">AI Governance</h1>
            <p className="text-sm text-muted-foreground">Control how your AI workforce operates</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPaused ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => emergencyPauseMutation.mutate({ enable: false })}
              disabled={emergencyPauseMutation.isPending}
              data-testid="button-disable-pause"
            >
              <Unlock className="h-3.5 w-3.5 mr-1.5" /> Restore Operations
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
              onClick={() => setShowEmergencyDialog(true)}
              data-testid="button-emergency-pause"
            >
              <AlertOctagon className="h-3.5 w-3.5 mr-1.5" /> Emergency Pause
            </Button>
          )}
        </div>
      </div>

      {/* Emergency pause banner */}
      {isPaused && (
        <div className="rounded-xl border-2 border-red-400 bg-red-50 dark:bg-red-950/40 p-4 flex items-start gap-3" data-testid="banner-emergency-pause">
          <AlertOctagon className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">Emergency Pause Active</p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
              All AI operations are currently paused.{settings?.emergencyPauseReason && <> Reason: <span className="font-medium">{settings.emergencyPauseReason}</span></>}
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="dashboard">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="agents" data-testid="tab-agents">Agents</TabsTrigger>
          <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          <TabsTrigger value="emergency" data-testid="tab-emergency">Controls</TabsTrigger>
        </TabsList>

        {/* ── Dashboard Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-4 mt-4">
          {/* Autonomy mode selector */}
          <Card data-testid="card-autonomy-mode">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" /> Global Autonomy Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              {settingsLoading ? <Skeleton className="h-20" /> : (
                <div className="grid grid-cols-3 gap-3">
                  {(["supervised", "collaborative", "autonomous"] as const).map(mode => {
                    const cfg = AUTONOMY_CONFIG[mode];
                    const Icon = cfg.icon;
                    const active = settings?.defaultAutonomyMode === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => changeModeM.mutate(mode)}
                        disabled={changeModeM.isPending || isPaused}
                        data-testid={`button-mode-${mode}`}
                        className={`rounded-xl border-2 p-3 text-left transition-all ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                          <span className={`text-xs font-semibold ${active ? "text-primary" : "text-foreground"}`}>{cfg.label}</span>
                          {active && <CheckCircle className="h-3 w-3 text-primary ml-auto" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug">{cfg.description}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analytics overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {analyticsLoading ? [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />) : (
              <>
                <StatCard icon={<XCircle className="h-4 w-4 text-red-500" />} label="Blocked" value={analytics?.blockedActionCount ?? 0} sub="last 30 days" testId="stat-blocked" />
                <StatCard icon={<Clock className="h-4 w-4 text-amber-500" />} label="Approval Required" value={analytics?.approvalRequiredCount ?? 0} sub="last 30 days" testId="stat-approvals" />
                <StatCard icon={<Zap className="h-4 w-4 text-green-500" />} label="Auto-executed" value={analytics?.autoExecutedCount ?? 0} sub={`${analytics?.autonomousExecutionRate ?? 0}% of decisions`} testId="stat-auto" />
                <StatCard icon={<AlertOctagon className="h-4 w-4 text-orange-500" />} label="Emergency Events" value={analytics?.emergencyInterventions ?? 0} sub="all time" testId="stat-emergency" />
              </>
            )}
          </div>

          {/* Agent status overview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" /> Agent Status Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!agents ? <Skeleton className="h-24" /> : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {agents.map(a => (
                    <div key={a.agentType} className="flex items-center gap-2.5 p-2 rounded-lg border border-border" data-testid={`agent-status-${a.agentType}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${AVATAR_COLORS[a.avatarColor] ?? AVATAR_COLORS.gray}`}>
                        {a.avatarInitials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{a.role}</p>
                      </div>
                      <div className={`w-2 h-2 rounded-full shrink-0 ml-auto ${a.status === "active" ? "bg-green-500" : a.status === "paused" ? "bg-amber-500" : "bg-red-500"}`} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent blocked actions */}
          {analytics && analytics.recentBlocked.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Ban className="h-4 w-4 text-red-500" /> Recent Blocked Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analytics.recentBlocked.slice(0, 5).map((entry: any) => (
                  <div key={entry.id} className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900" data-testid={`blocked-entry-${entry.id}`}>
                    <p className="text-xs font-medium text-red-700 dark:text-red-300 line-clamp-2">{entry.reasoningSummary ?? "Blocked by governance policy"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {entry.actorName ?? entry.actorType} · {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Agents Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="agents" className="space-y-4 mt-4">
          {!agents ? <Skeleton className="h-40" /> : agents.map(agent => (
            <AgentPermissionCard
              key={agent.agentType}
              agent={agent}
              policy={policies?.find(p => p.agentType === agent.agentType)}
              onUpdate={(updates) => {
                apiRequest("PATCH", `/api/governance/policies/${agent.agentType}`, updates)
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/governance/policies"] });
                    toast({ title: `${agent.name} policy updated` });
                  });
              }}
            />
          ))}
        </TabsContent>

        {/* ── Policies Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="policies" className="space-y-4 mt-4">
          {settingsLoading ? (
            <div className="space-y-4" data-testid="policies-loading">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : settingsError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3" data-testid="policies-error">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-destructive">Unable to load governance policies.</p>
                <p className="text-xs text-muted-foreground mt-1">Check server logs or try refreshing the page.</p>
              </div>
            </div>
          ) : settings ? (
            <GovernancePoliciesPanel settings={settings} onUpdate={(u) => updateSettingsMutation.mutate(u)} saving={updateSettingsMutation.isPending} />
          ) : (
            <div className="rounded-xl border border-border bg-muted/30 p-8 text-center" data-testid="policies-empty">
              <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No governance policies configured.</p>
              <p className="text-xs text-muted-foreground mt-1">Visit this page again to auto-provision defaults.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Emergency Controls Tab ───────────────────────────────────────── */}
        <TabsContent value="emergency" className="space-y-4 mt-4">
          <EmergencyControlsPanel
            settings={settings}
            onEmergencyPause={(reason) => emergencyPauseMutation.mutate({ enable: true, reason })}
            onRestoreOperations={() => emergencyPauseMutation.mutate({ enable: false })}
            isPending={emergencyPauseMutation.isPending}
          />
        </TabsContent>
      </Tabs>

      {/* Emergency pause dialog */}
      <Dialog open={showEmergencyDialog} onOpenChange={setShowEmergencyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertOctagon className="h-5 w-5" /> Activate Emergency Pause
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">This will immediately pause ALL AI operations across the org. No agents will be able to execute until you restore operations.</p>
            <div>
              <Label className="text-xs font-medium">Reason (optional)</Label>
              <Textarea
                value={emergencyReason}
                onChange={e => setEmergencyReason(e.target.value)}
                placeholder="Why are you pausing AI operations?"
                className="mt-1 text-sm"
                data-testid="input-emergency-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmergencyDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => emergencyPauseMutation.mutate({ enable: true, reason: emergencyReason || undefined })}
              disabled={emergencyPauseMutation.isPending}
              data-testid="button-confirm-pause"
            >
              <AlertOctagon className="h-3.5 w-3.5 mr-1.5" /> Activate Emergency Pause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, testId }: { icon: React.ReactNode; label: string; value: number; sub: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function AgentPermissionCard({ agent, policy, onUpdate }: { agent: AgentIdentity; policy?: CapabilityPolicy; onUpdate: (u: any) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Card data-testid={`card-agent-${agent.agentType}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${AVATAR_COLORS[agent.avatarColor] ?? AVATAR_COLORS.gray}`}>
            {agent.avatarInitials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{agent.name}</span>
              <Badge variant="outline" className="text-[10px]">{agent.role}</Badge>
              {policy && <AutonomyBadge mode={policy.maxAutonomyLevel} />}
            </div>
            <p className="text-xs text-muted-foreground truncate">{agent.department} · {agent.description.substring(0, 60)}…</p>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${agent.status === "active" ? "bg-green-500" : "bg-red-500"}`} />
          <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 space-y-4">
          <Separator />
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Capability Manifest</p>
            <ul className="space-y-1">
              {agent.capabilityManifest.map((cap, i) => (
                <li key={i} className="text-xs flex items-center gap-1.5">
                  <CheckCircle className="h-3 w-3 text-green-500 shrink-0" /> {cap}
                </li>
              ))}
            </ul>
          </div>

          {policy && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Autonomy Level</Label>
                  <Select
                    value={policy.maxAutonomyLevel}
                    onValueChange={(v) => onUpdate({ maxAutonomyLevel: v })}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-autonomy-${agent.agentType}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supervised">Supervised</SelectItem>
                      <SelectItem value="collaborative">Collaborative</SelectItem>
                      <SelectItem value="autonomous">Autonomous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Min. Confidence ({(policy.minimumConfidenceScore * 100).toFixed(0)}%)</Label>
                  <Slider
                    min={0} max={100} step={5}
                    value={[policy.minimumConfidenceScore * 100]}
                    onValueChange={([v]) => onUpdate({ minimumConfidenceScore: v / 100 })}
                    className="mt-2"
                    data-testid={`slider-confidence-${agent.agentType}`}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={policy.enabled}
                    onCheckedChange={(v) => onUpdate({ enabled: v })}
                    data-testid={`switch-enabled-${agent.agentType}`}
                  />
                  <Label className="text-xs">Agent Enabled</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={policy.requiresApproval}
                    onCheckedChange={(v) => onUpdate({ requiresApproval: v })}
                    data-testid={`switch-approval-${agent.agentType}`}
                  />
                  <Label className="text-xs">Requires Approval</Label>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function GovernancePoliciesPanel({ settings, onUpdate, saving }: { settings: GovernanceSettings; onUpdate: (u: Partial<GovernanceSettings>) => void; saving: boolean }) {
  return (
    <div className="space-y-4">
      <Card data-testid="card-confidence-threshold">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" /> Confidence & Risk Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Default Confidence Threshold</Label>
              <span className="text-sm font-bold text-primary">{((settings.defaultConfidenceThreshold ?? 0.75) * 100).toFixed(0)}%</span>
            </div>
            <Slider
              min={0} max={100} step={5}
              value={[(settings.defaultConfidenceThreshold ?? 0.75) * 100]}
              onValueChange={([v]) => onUpdate({ defaultConfidenceThreshold: v / 100 })}
              data-testid="slider-confidence-threshold"
            />
            <p className="text-xs text-muted-foreground">Agent actions with confidence below this threshold will require approval.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Maximum Allowed Risk Level</Label>
            <Select
              value={settings.maximumAllowedRiskLevel}
              onValueChange={(v) => onUpdate({ maximumAllowedRiskLevel: v as any })}
            >
              <SelectTrigger data-testid="select-max-risk">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low only</SelectItem>
                <SelectItem value="medium">Medium and below</SelectItem>
                <SelectItem value="high">High and below</SelectItem>
                <SelectItem value="critical">All risk levels</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-feature-flags">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" /> Feature Authorization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "allowAutonomousCommunication", label: "Autonomous Communication", desc: "Allow agents to send emails/SMS without approval" },
            { key: "allowAutonomousScheduling", label: "Autonomous Scheduling", desc: "Allow agents to create calendar events automatically" },
            { key: "allowAutonomousFinancialActions", label: "Autonomous Financial Actions", desc: "Allow agents to create/send invoices automatically" },
            { key: "allowResearchAgents", label: "Research Agents", desc: "Allow Vector to conduct web research" },
            { key: "allowExternalWebAccess", label: "External Web Access", desc: "Allow agents to access external websites" },
            { key: "allowCrossWorkflowMemory", label: "Cross-Workflow Memory", desc: "Allow agents to share context across workflows" },
            { key: "strictModeEnabled", label: "Strict Mode", desc: "Force supervised mode for all agents regardless of settings" },
            { key: "operatorReviewRequired", label: "Operator Review Required", desc: "All actions require at least one operator review" },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4" data-testid={`toggle-${key}`}>
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                checked={Boolean(settings[key as keyof GovernanceSettings])}
                onCheckedChange={(v) => onUpdate({ [key]: v } as any)}
                disabled={saving}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function EmergencyControlsPanel({ settings, onEmergencyPause, onRestoreOperations, isPending }: {
  settings?: GovernanceSettings;
  onEmergencyPause: (reason: string) => void;
  onRestoreOperations: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  const isPaused = settings?.emergencyPauseEnabled;

  return (
    <div className="space-y-4">
      <Card className={isPaused ? "border-2 border-red-400" : ""} data-testid="card-emergency-controls">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <AlertOctagon className={`h-4 w-4 ${isPaused ? "text-red-500" : "text-muted-foreground"}`} />
            Emergency Pause Control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPaused ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 border border-red-200 dark:border-red-900">
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">All AI operations are currently paused</p>
                {settings?.emergencyPauseReason && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">Reason: {settings.emergencyPauseReason}</p>
                )}
              </div>
              <Button onClick={onRestoreOperations} disabled={isPending} className="w-full" data-testid="button-restore-operations">
                <Unlock className="h-3.5 w-3.5 mr-1.5" /> {isPending ? "Restoring…" : "Restore All AI Operations"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Activating emergency pause will immediately stop all AI agents from executing any actions. Workflows will pause safely. Use this in an emergency situation.</p>
              <div>
                <Label className="text-xs font-medium">Reason</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the reason for emergency pause…" className="mt-1 text-sm" data-testid="input-pause-reason" />
              </div>
              <Button
                variant="destructive"
                onClick={() => onEmergencyPause(reason)}
                disabled={isPending}
                className="w-full"
                data-testid="button-activate-pause"
              >
                <AlertOctagon className="h-3.5 w-3.5 mr-1.5" /> {isPending ? "Activating…" : "Activate Emergency Pause"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" /> Safety Architecture Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>• Emergency pause blocks all non-system agent actions immediately</p>
          <p>• Currently running workflows will pause safely at their next step boundary</p>
          <p>• All emergency actions are logged to the unified audit trail</p>
          <p>• Operator overrides and memories are preserved during pause</p>
          <p>• System maintenance agents (Core) continue to operate in restricted mode</p>
        </CardContent>
      </Card>
    </div>
  );
}
