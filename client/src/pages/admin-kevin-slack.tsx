import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Slack, Shield, CheckCircle, XCircle, AlertTriangle,
  Activity, Users, Calendar, Bell, Link2, RefreshCw,
  Lock, Eye, BarChart3, Settings,
} from "lucide-react";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackConfig {
  enabled: boolean;
  eventsEnabled: boolean;
  commandsEnabled: boolean;
  actionsEnabled: boolean;
  notificationsEnabled: boolean;
  digestsEnabled: boolean;
  schedulingEnabled: boolean;
  approvalsEnabled: boolean;
  obsidianMemoryEnabled: boolean;
  appIdConfigured: boolean;
  botTokenConfigured: boolean;
  signingSecretConfigured: boolean;
  clientIdConfigured: boolean;
  stages: Record<string, boolean>;
}

interface SlackDiagnostics {
  integration: Record<string, boolean>;
  interactions: {
    totalInteractions: number;
    successRate: number;
    blockedCount: number;
    last24hCount: number;
  };
  digests: {
    totalSent: number;
    last7Days: number;
    failedCount: number;
  };
  circuitState: string;
  lastChecked: string;
}

interface IdentityMapping {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  trainefficiencyUserId: string;
  orgId: string;
  mappingStatus: "pending" | "verified" | "revoked" | "disabled";
  linkedBy: string | null;
  linkedAt: string;
  lastVerifiedAt: string | null;
}

interface AuditRecord {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  trainefficiencyUserId: string | null;
  orgId: string | null;
  intent: string;
  requestedOperation: string;
  authorizationResult: string;
  outcome: string;
  traceId: string;
  createdAt: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return active ? (
    <Badge className="bg-green-100 text-green-800 border-green-200" data-testid={`badge-active-${label}`}>
      <CheckCircle className="w-3 h-3 mr-1" /> {label ?? "Enabled"}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-gray-500" data-testid={`badge-inactive-${label}`}>
      <XCircle className="w-3 h-3 mr-1" /> {label ?? "Disabled"}
    </Badge>
  );
}

function MappingStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    verified: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    revoked: "bg-red-100 text-red-800",
    disabled: "bg-gray-100 text-gray-600",
  };
  return (
    <Badge className={colors[status] ?? "bg-gray-100 text-gray-600"} data-testid={`mapping-status-${status}`}>
      {status}
    </Badge>
  );
}

// ─── Add Mapping Dialog ───────────────────────────────────────────────────────

function AddMappingDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    slackTeamId: "",
    slackUserId: "",
    trainefficiencyUserId: "",
    orgId: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/kevin-slack/mappings", { ...form, status: "verified" }),
    onSuccess: () => {
      toast({ title: "Mapping created", description: "Identity mapping verified and active." });
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-add-mapping">
          <Link2 className="w-4 h-4 mr-2" /> Link User
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Slack Identity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {(["slackTeamId", "slackUserId", "trainefficiencyUserId", "orgId"] as const).map((field) => (
            <div key={field}>
              <Label htmlFor={`input-${field}`} className="text-xs text-muted-foreground capitalize">
                {field.replace(/([A-Z])/g, " $1")}
              </Label>
              <Input
                id={`input-${field}`}
                data-testid={`input-${field}`}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                placeholder={field}
              />
            </div>
          ))}
          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.slackTeamId || !form.slackUserId || !form.trainefficiencyUserId || !form.orgId}
            data-testid="button-submit-mapping"
          >
            {mutation.isPending ? "Linking..." : "Create Verified Mapping"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminKevinSlack() {
  const { toast } = useToast();
  const [auditOrgId, setAuditOrgId] = useState("");
  const [selectedMappingsOrgId, setSelectedMappingsOrgId] = useState("");

  const { data: config, isLoading: configLoading } = useQuery<SlackConfig>({
    queryKey: ["/api/admin/kevin-slack/config"],
  });

  const { data: diagnostics, isLoading: diagLoading, refetch: refetchDiag } = useQuery<SlackDiagnostics>({
    queryKey: ["/api/admin/kevin-slack/diagnostics"],
    refetchInterval: 30000,
  });

  const { data: mappingsData, refetch: refetchMappings } = useQuery<{ mappings: IdentityMapping[] }>({
    queryKey: ["/api/admin/kevin-slack/mappings", selectedMappingsOrgId],
    queryFn: async () => {
      const url = selectedMappingsOrgId
        ? `/api/admin/kevin-slack/mappings?orgId=${selectedMappingsOrgId}`
        : "/api/admin/kevin-slack/mappings";
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
  });

  const { data: auditData } = useQuery<{ events: AuditRecord[] }>({
    queryKey: ["/api/admin/kevin-slack/audit", auditOrgId],
    queryFn: async () => {
      if (!auditOrgId) return { events: [] };
      const res = await fetch(`/api/admin/kevin-slack/audit?orgId=${auditOrgId}&limit=50`, {
        credentials: "include",
      });
      return res.json();
    },
    enabled: !!auditOrgId,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/kevin-slack/mappings/${id}/revoke`, {}),
    onSuccess: () => {
      toast({ title: "Mapping revoked", description: "User access removed immediately." });
      refetchMappings();
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/kevin-slack/mappings/${id}/verify`, {}),
    onSuccess: () => {
      toast({ title: "Mapping verified" });
      refetchMappings();
    },
  });

  const stageRows = config?.stages
    ? Object.entries(config.stages).map(([k, v]) => ({
        label: k.replace(/_/g, " ").replace(/stage\d+/, "").trim(),
        key: k,
        active: v,
      }))
    : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Slack className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="heading-kevin-slack">
              Kevin Slack Executive Operations Hub
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage Slack integration, identity mappings, and audit logs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge active={config?.enabled ?? false} label="Slack" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchDiag(); queryClient.invalidateQueries({ queryKey: ["/api/admin/kevin-slack/config"] }); }}
            data-testid="button-refresh-diagnostics"
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Master disabled alert */}
      {!config?.enabled && !configLoading && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="w-4 h-4 text-orange-600" />
          <AlertDescription className="text-orange-800">
            <strong>Slack integration is disabled.</strong> Set{" "}
            <code className="bg-orange-100 px-1 rounded">KEVIN_SLACK_ENABLED=true</code> to activate.
            All TrainEfficiency operations continue normally.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <TabsList data-testid="tabs-kevin-slack">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-config">Configuration</TabsTrigger>
          <TabsTrigger value="mappings" data-testid="tab-mappings">Identity Mappings</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
          <TabsTrigger value="activation" data-testid="tab-activation">Activation Guide</TabsTrigger>
        </TabsList>

        {/* ── Overview tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Interactions</p>
                    <p className="text-2xl font-bold" data-testid="stat-total-interactions">
                      {diagnostics?.interactions.totalInteractions ?? "—"}
                    </p>
                  </div>
                  <Activity className="w-8 h-8 text-blue-500 opacity-70" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Success Rate</p>
                    <p className="text-2xl font-bold" data-testid="stat-success-rate">
                      {diagnostics?.interactions.successRate ?? "—"}%
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-500 opacity-70" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Blocked (Auth)</p>
                    <p className="text-2xl font-bold" data-testid="stat-blocked-count">
                      {diagnostics?.interactions.blockedCount ?? "—"}
                    </p>
                  </div>
                  <Shield className="w-8 h-8 text-red-500 opacity-70" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Digests Sent (7d)</p>
                    <p className="text-2xl font-bold" data-testid="stat-digests-sent">
                      {diagnostics?.digests.last7Days ?? "—"}
                    </p>
                  </div>
                  <Bell className="w-8 h-8 text-purple-500 opacity-70" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Integration status grid */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4" /> Integration Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: "Bot Token", key: "botTokenConfigured" },
                  { label: "Signing Secret", key: "signingSecretConfigured" },
                  { label: "Events", key: "eventsEnabled" },
                  { label: "Commands", key: "commandsEnabled" },
                  { label: "Actions", key: "actionsEnabled" },
                  { label: "Scheduling", key: "schedulingEnabled" },
                  { label: "Notifications", key: "notificationsEnabled" },
                  { label: "Digests", key: "digestsEnabled" },
                  { label: "Approvals", key: "approvalsEnabled" },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between p-2 border rounded-md">
                    <span className="text-sm">{label}</span>
                    <StatusBadge
                      active={((diagnostics?.integration ?? config ?? {}) as Record<string, boolean>)[key] ?? false}
                      label={label}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Config tab ───────────────────────────────────────────────── */}
        <TabsContent value="config" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="w-4 h-4" /> Credentials Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert className="border-blue-200 bg-blue-50">
                <AlertDescription className="text-blue-800 text-sm">
                  Credentials are read from environment variables. They are never displayed here.
                  Configure them via the Replit Secrets panel.
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { label: "SLACK_BOT_TOKEN", key: "botTokenConfigured" },
                  { label: "SLACK_SIGNING_SECRET", key: "signingSecretConfigured" },
                  { label: "SLACK_APP_ID", key: "appIdConfigured" },
                  { label: "SLACK_CLIENT_ID", key: "clientIdConfigured" },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between p-3 border rounded-md bg-gray-50">
                    <code className="text-xs font-mono">{label}</code>
                    <StatusBadge
                      active={config?.[key as keyof SlackConfig] as boolean ?? false}
                      label={config?.[key as keyof SlackConfig] ? "Set" : "Missing"}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Feature Flags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  { label: "KEVIN_SLACK_ENABLED", key: "enabled" },
                  { label: "KEVIN_SLACK_EVENTS_ENABLED", key: "eventsEnabled" },
                  { label: "KEVIN_SLACK_COMMANDS_ENABLED", key: "commandsEnabled" },
                  { label: "KEVIN_SLACK_ACTIONS_ENABLED", key: "actionsEnabled" },
                  { label: "KEVIN_SLACK_SCHEDULING_ENABLED", key: "schedulingEnabled" },
                  { label: "KEVIN_SLACK_NOTIFICATIONS_ENABLED", key: "notificationsEnabled" },
                  { label: "KEVIN_SLACK_DIGESTS_ENABLED", key: "digestsEnabled" },
                  { label: "KEVIN_SLACK_APPROVALS_ENABLED", key: "approvalsEnabled" },
                  { label: "KEVIN_SLACK_OBSIDIAN_MEMORY_ENABLED", key: "obsidianMemoryEnabled" },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between p-2 border-b last:border-0">
                    <code className="text-xs font-mono text-gray-700">{label}</code>
                    <StatusBadge
                      active={config?.[key as keyof SlackConfig] as boolean ?? false}
                      label={config?.[key as keyof SlackConfig] ? "true" : "false"}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Mappings tab ─────────────────────────────────────────────── */}
        <TabsContent value="mappings" className="space-y-6 mt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter by org ID..."
                value={selectedMappingsOrgId}
                onChange={(e) => setSelectedMappingsOrgId(e.target.value)}
                className="w-64"
                data-testid="input-filter-mappings-org"
              />
            </div>
            <AddMappingDialog onSuccess={refetchMappings} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" /> Identity Mappings
                <Badge variant="outline">{mappingsData?.mappings.length ?? 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slack User</TableHead>
                    <TableHead>Team ID</TableHead>
                    <TableHead>TE User ID</TableHead>
                    <TableHead>Org ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Linked</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(mappingsData?.mappings ?? []).map((m) => (
                    <TableRow key={m.id} data-testid={`row-mapping-${m.id}`}>
                      <TableCell className="font-mono text-xs">{m.slackUserId}</TableCell>
                      <TableCell className="font-mono text-xs">{m.slackTeamId}</TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[120px]">
                        {m.trainefficiencyUserId}
                      </TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[120px]">
                        {m.orgId}
                      </TableCell>
                      <TableCell>
                        <MappingStatusBadge status={m.mappingStatus} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.linkedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {m.mappingStatus === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => verifyMutation.mutate(m.id)}
                              disabled={verifyMutation.isPending}
                              data-testid={`button-verify-mapping-${m.id}`}
                            >
                              Verify
                            </Button>
                          )}
                          {m.mappingStatus !== "revoked" && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => revokeMutation.mutate(m.id)}
                              disabled={revokeMutation.isPending}
                              data-testid={`button-revoke-mapping-${m.id}`}
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(mappingsData?.mappings ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No identity mappings found. Use "Link User" to connect a Slack user to TrainEfficiency.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit tab ────────────────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-6 mt-6">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Enter org ID to view audit log..."
              value={auditOrgId}
              onChange={(e) => setAuditOrgId(e.target.value)}
              className="w-80"
              data-testid="input-audit-org-id"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="w-4 h-4" /> Audit Log
                <Badge variant="outline">{auditData?.events.length ?? 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Slack User</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Auth</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Trace ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(auditData?.events ?? []).map((e) => (
                    <TableRow key={e.id} data-testid={`row-audit-${e.id}`}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.slackUserId}</TableCell>
                      <TableCell className="text-xs">{e.intent}</TableCell>
                      <TableCell className="text-xs truncate max-w-[140px]">{e.requestedOperation}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            e.authorizationResult === "allowed"
                              ? "bg-green-100 text-green-800"
                              : e.authorizationResult === "denied"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-600"
                          }
                        >
                          {e.authorizationResult}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{e.outcome}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.traceId.slice(0, 8)}…
                      </TableCell>
                    </TableRow>
                  ))}
                  {!auditOrgId && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Enter an org ID above to view audit records.
                      </TableCell>
                    </TableRow>
                  )}
                  {auditOrgId && (auditData?.events ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No audit records found for this org.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Activation Guide tab ─────────────────────────────────────── */}
        <TabsContent value="activation" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Staged Activation Guide
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  stage: "Stage 1",
                  label: "Slack Verification Only",
                  description: "Accepts signed events, validates signatures, responds to URL challenges. No actions execute.",
                  flags: ["KEVIN_SLACK_ENABLED=true", "KEVIN_SLACK_EVENTS_ENABLED=true"],
                  key: "stage1_verification",
                },
                {
                  stage: "Stage 2",
                  label: "Read-Only Commands",
                  description: "Enable /kevin help, health, sessions, openings, summary. Identity and org filtering verified.",
                  flags: ["KEVIN_SLACK_COMMANDS_ENABLED=true"],
                  key: "stage2_read_commands",
                },
                {
                  stage: "Stage 3",
                  label: "Internal Scheduling Pilot",
                  description: "Create, reschedule, and cancel sessions via Slack. Requires verified ADMIN test user. All actions require explicit confirmation.",
                  flags: ["KEVIN_SLACK_ACTIONS_ENABLED=true", "KEVIN_SLACK_SCHEDULING_ENABLED=true"],
                  key: "stage3_scheduling",
                },
                {
                  stage: "Stage 4",
                  label: "Notifications",
                  description: "Enable CRITICAL and IMPORTANT notifications. Critical only — digests not yet active.",
                  flags: ["KEVIN_SLACK_NOTIFICATIONS_ENABLED=true"],
                  key: "stage4_notifications",
                },
                {
                  stage: "Stage 5",
                  label: "Daily Digests",
                  description: "Send daily executive briefs. Verify time zone and idempotency before enabling.",
                  flags: ["KEVIN_SLACK_DIGESTS_ENABLED=true"],
                  key: "stage5_digests",
                },
                {
                  stage: "Stage 6",
                  label: "Approvals via Slack",
                  description: "Route existing TrainEfficiency approval workflows through Slack buttons. One workflow at a time.",
                  flags: ["KEVIN_SLACK_APPROVALS_ENABLED=true"],
                  key: "stage6_approvals",
                },
                {
                  stage: "Stage 7",
                  label: "Obsidian Memory",
                  description: "Store sanitized Kevin memory events in Obsidian. Obsidian failure never blocks actions.",
                  flags: ["KEVIN_SLACK_OBSIDIAN_MEMORY_ENABLED=true"],
                  key: "stage7_obsidian",
                },
              ].map(({ stage, label, description, flags, key }) => {
                const active = config?.stages[key] ?? false;
                return (
                  <div
                    key={key}
                    className={`p-4 border rounded-lg ${active ? "border-green-200 bg-green-50" : "border-gray-200"}`}
                    data-testid={`stage-${key}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-muted-foreground uppercase">{stage}</span>
                          <StatusBadge active={active} label={active ? "Active" : "Inactive"} />
                        </div>
                        <p className="font-medium text-sm">{label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {flags.map((f) => (
                            <code key={f} className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                              {f}
                            </code>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <Alert className="border-orange-200 bg-orange-50 mt-4">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-800 text-sm">
                  <strong>Rollback:</strong> Set <code>KEVIN_SLACK_ENABLED=false</code> to immediately disable all Slack behavior
                  while preserving all TrainEfficiency operations. No data is deleted.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
