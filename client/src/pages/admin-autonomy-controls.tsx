import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Sliders,
  Zap,
  Clock,
  Mail,
  Calendar,
  Bot,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronRight,
  BarChart3,
  Lock,
  Activity,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutomationSettings {
  id: string;
  orgId: string;
  autoSendFirstResponse: boolean;
  autoSendLowRiskFollowUps: boolean;
  autoSendBookingConfirmation: boolean;
  autoOfferSchedulingSlots: boolean;
  autoBookConfirmedSlots: boolean;
  minAutoSendConfidence: number;
  minAutoBookingConfidence: number;
  dailyEmailCap: number;
  dailyBookingCap: number;
  allowedSendWindowStart: string;
  allowedSendWindowEnd: string;
  requireApprovalForFirstContact: boolean;
  requireApprovalForNewRecipients: boolean;
  notifyCoachOnAutoAction: boolean;
  policyVersion: string;
}

interface AutonomyDecision {
  id: string;
  actionType: string;
  decision: "auto_execute" | "approval_required" | "blocked";
  reasons: string[];
  confidence: number;
  riskLevel: string;
  policyVersion: string;
  createdAt: string;
  result?: string;
}

interface AutonomyStats {
  today: { total: number; autoExecuted: number; approvalRequired: number; blocked: number };
  week: { total: number; autoExecuted: number; approvalRequired: number; blocked: number };
  pendingApproval: number;
}

// ─── Risk level badge logic ────────────────────────────────────────────────

function getRiskLabel(settings: AutomationSettings): { label: string; color: string; icon: typeof Shield } {
  const dangerousEnabled = [
    settings.autoSendFirstResponse,
    settings.autoBookConfirmedSlots,
    settings.autoSendBookingConfirmation,
  ].filter(Boolean).length;

  if (dangerousEnabled >= 2) return { label: "High Autonomy", color: "text-red-600 bg-red-50 border-red-200", icon: AlertTriangle };
  if (dangerousEnabled === 1 || settings.autoSendLowRiskFollowUps || settings.autoOfferSchedulingSlots)
    return { label: "Moderate Autonomy", color: "text-amber-600 bg-amber-50 border-amber-200", icon: Zap };
  return { label: "Safe (Supervised)", color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: Shield };
}

function getDecisionBadge(decision: string) {
  if (decision === "auto_execute") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Auto-Executed</Badge>;
  if (decision === "blocked") return <Badge className="bg-red-100 text-red-700 border-red-200">Blocked</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Awaiting Approval</Badge>;
}

// ─── Confirm Modal ─────────────────────────────────────────────────────────

interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  settingLabel: string;
  warningText: string;
}

function ConfirmModal({ open, onConfirm, onCancel, settingLabel, warningText }: ConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Enable {settingLabel}?
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-gray-600">
            {warningText}
          </DialogDescription>
        </DialogHeader>
        <Alert className="border-amber-200 bg-amber-50">
          <AlertDescription className="text-amber-800 text-sm">
            This setting increases the agent's autonomy. All actions are still logged and auditable. You can disable this at any time.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} data-testid="button-cancel-confirm">Cancel</Button>
          <Button onClick={onConfirm} className="bg-violet-600 hover:bg-violet-700" data-testid="button-confirm-enable">
            Yes, Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Setting Row ───────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  riskLabel: "Safe" | "Moderate" | "High";
  requiresConfirm?: boolean;
  onConfirmRequest?: () => void;
  testId?: string;
  disabled?: boolean;
}

function SettingRow({ label, description, value, onChange, riskLabel, requiresConfirm, onConfirmRequest, testId, disabled }: SettingRowProps) {
  const riskColors: Record<string, string> = {
    Safe: "text-emerald-600 bg-emerald-50 border-emerald-200",
    Moderate: "text-amber-600 bg-amber-50 border-amber-200",
    High: "text-red-600 bg-red-50 border-red-200",
  };
  return (
    <div className="flex items-start justify-between py-3 gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${riskColors[riskLabel]}`}>
            {riskLabel}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
      <Switch
        checked={value}
        onCheckedChange={(checked) => {
          if (checked && requiresConfirm && onConfirmRequest) {
            onConfirmRequest();
          } else {
            onChange(checked);
          }
        }}
        disabled={disabled}
        data-testid={testId}
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function AdminAutonomyControlsPage() {
  const { toast } = useToast();
  const [pendingField, setPendingField] = useState<string | null>(null);

  const { data: settings, isLoading: settingsLoading } = useQuery<AutomationSettings>({
    queryKey: ["/api/admin/autonomy/settings"],
  });

  const { data: stats } = useQuery<AutonomyStats>({
    queryKey: ["/api/admin/autonomy/stats"],
    refetchInterval: 30000,
  });

  const { data: decisions, isLoading: decisionsLoading } = useQuery<AutonomyDecision[]>({
    queryKey: ["/api/admin/autonomy/decisions"],
    refetchInterval: 30000,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<AutomationSettings>) =>
      apiRequest("PATCH", "/api/admin/autonomy/settings", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/autonomy/settings"] });
      toast({ title: "Settings saved", description: "Autonomy policy updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const executorMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/autonomy/executor/run", {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/autonomy/decisions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/autonomy/stats"] });
      toast({ title: "Executor cycle complete", description: `${data.stats?.evaluated ?? 0} actions evaluated.` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const update = (field: keyof AutomationSettings, value: any) => {
    updateMutation.mutate({ [field]: value });
  };

  const confirmUpdate = (field: string) => {
    setPendingField(field);
  };

  const handleConfirm = () => {
    if (pendingField) {
      updateMutation.mutate({ [pendingField]: true } as any);
    }
    setPendingField(null);
  };

  if (settingsLoading || !settings) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="h-8 bg-gray-100 rounded w-64 animate-pulse" />
        <div className="h-4 bg-gray-100 rounded w-96 animate-pulse" />
        <div className="grid grid-cols-3 gap-4 mt-6">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const riskInfo = getRiskLabel(settings);
  const RiskIcon = riskInfo.icon;

  const HIGH_RISK_CONFIRMS: Record<string, { label: string; warning: string }> = {
    autoSendFirstResponse: {
      label: "Auto-Send First Responses",
      warning: "The agent will automatically send the first outreach email to new leads without human review. Only enable this if you are confident in your intake quality and AI output.",
    },
    autoBookConfirmedSlots: {
      label: "Auto-Book Confirmed Slots",
      warning: "The agent will automatically create bookings when a lead confirms a time slot, without human review. Ensure your availability system is accurate before enabling.",
    },
    autoSendBookingConfirmation: {
      label: "Auto-Send Booking Confirmations",
      warning: "The agent will automatically send booking confirmation emails to leads. Ensure your confirmation template is reviewed and your booking system is reliable.",
    },
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="h-6 w-6 text-violet-600" />
            Autonomy Controls
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Control which actions the agent can take automatically — and under what conditions.
          </p>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium ${riskInfo.color}`} data-testid="badge-risk-level">
          <RiskIcon className="h-4 w-4" />
          {riskInfo.label}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-violet-50 to-white">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Today — Evaluated</div>
            <div className="text-2xl font-bold text-violet-700" data-testid="stat-today-total">{stats?.today?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Auto-Executed</div>
            <div className="text-2xl font-bold text-emerald-700" data-testid="stat-auto-executed">{stats?.today?.autoExecuted ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-50 to-white">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Awaiting Approval</div>
            <div className="text-2xl font-bold text-amber-700" data-testid="stat-awaiting-approval">{stats?.pendingApproval ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-gradient-to-br from-red-50 to-white">
          <CardContent className="p-4">
            <div className="text-xs text-gray-500 mb-1">Blocked Today</div>
            <div className="text-2xl font-bold text-red-700" data-testid="stat-blocked">{stats?.today?.blocked ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Automation Settings */}
        <div className="lg:col-span-2 space-y-4">

          {/* Email Automation */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-violet-500" />
                Email Automation
              </CardTitle>
              <CardDescription className="text-xs">Control when the agent can send emails without human review.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-gray-100">
              <SettingRow
                label="Auto-Send First Responses"
                description="Agent sends the initial outreach email to new leads automatically."
                value={settings.autoSendFirstResponse}
                onChange={(v) => update("autoSendFirstResponse", v)}
                riskLabel="High"
                requiresConfirm
                onConfirmRequest={() => confirmUpdate("autoSendFirstResponse")}
                testId="toggle-auto-first-response"
                disabled={updateMutation.isPending}
              />
              <SettingRow
                label="Auto-Send Low-Risk Follow-Ups"
                description="Agent sends follow-up emails when risk is low and confidence is above threshold."
                value={settings.autoSendLowRiskFollowUps}
                onChange={(v) => update("autoSendLowRiskFollowUps", v)}
                riskLabel="Moderate"
                testId="toggle-auto-followup"
                disabled={updateMutation.isPending}
              />
              <SettingRow
                label="Auto-Send Booking Confirmations"
                description="Agent automatically sends booking confirmation emails after a slot is booked."
                value={settings.autoSendBookingConfirmation}
                onChange={(v) => update("autoSendBookingConfirmation", v)}
                riskLabel="High"
                requiresConfirm
                onConfirmRequest={() => confirmUpdate("autoSendBookingConfirmation")}
                testId="toggle-auto-booking-confirmation"
                disabled={updateMutation.isPending}
              />
            </CardContent>
          </Card>

          {/* Scheduling Automation */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-violet-500" />
                Scheduling Automation
              </CardTitle>
              <CardDescription className="text-xs">Control when the agent can offer slots and create bookings.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-gray-100">
              <SettingRow
                label="Auto-Offer Scheduling Slots"
                description="Agent automatically suggests available time slots when a lead expresses scheduling intent."
                value={settings.autoOfferSchedulingSlots}
                onChange={(v) => update("autoOfferSchedulingSlots", v)}
                riskLabel="Moderate"
                testId="toggle-auto-offer-slots"
                disabled={updateMutation.isPending}
              />
              <SettingRow
                label="Auto-Book Confirmed Slots"
                description="Agent creates a booking when a lead confirms a previously offered time slot."
                value={settings.autoBookConfirmedSlots}
                onChange={(v) => update("autoBookConfirmedSlots", v)}
                riskLabel="High"
                requiresConfirm
                onConfirmRequest={() => confirmUpdate("autoBookConfirmedSlots")}
                testId="toggle-auto-book"
                disabled={updateMutation.isPending}
              />
            </CardContent>
          </Card>

          {/* Thresholds & Limits */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Sliders className="h-4 w-4 text-violet-500" />
                Thresholds & Rate Limits
              </CardTitle>
              <CardDescription className="text-xs">Minimum confidence required for auto-execution and daily volume caps.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-700 flex items-center justify-between">
                  <span>Email Auto-Send Confidence</span>
                  <span className="text-violet-600 font-bold" data-testid="value-email-confidence">{Math.round(settings.minAutoSendConfidence * 100)}%</span>
                </Label>
                <Slider
                  min={60} max={99} step={1}
                  value={[Math.round(settings.minAutoSendConfidence * 100)]}
                  onValueChange={([v]) => update("minAutoSendConfidence", v / 100)}
                  className="w-full"
                  data-testid="slider-email-confidence"
                />
                <p className="text-xs text-gray-400">Minimum AI confidence score required before auto-sending an email.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-700 flex items-center justify-between">
                  <span>Booking Auto-Execute Confidence</span>
                  <span className="text-violet-600 font-bold" data-testid="value-booking-confidence">{Math.round(settings.minAutoBookingConfidence * 100)}%</span>
                </Label>
                <Slider
                  min={60} max={99} step={1}
                  value={[Math.round(settings.minAutoBookingConfidence * 100)]}
                  onValueChange={([v]) => update("minAutoBookingConfidence", v / 100)}
                  className="w-full"
                  data-testid="slider-booking-confidence"
                />
                <p className="text-xs text-gray-400">Parser confidence required before auto-confirming a booking slot.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-700">Daily Email Cap</Label>
                  <Input
                    type="number" min={1} max={500}
                    value={settings.dailyEmailCap}
                    onChange={(e) => update("dailyEmailCap", parseInt(e.target.value) || 20)}
                    className="h-8 text-sm"
                    data-testid="input-daily-email-cap"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-700">Daily Booking Cap</Label>
                  <Input
                    type="number" min={1} max={100}
                    value={settings.dailyBookingCap}
                    onChange={(e) => update("dailyBookingCap", parseInt(e.target.value) || 10)}
                    className="h-8 text-sm"
                    data-testid="input-daily-booking-cap"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Send Window */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-500" />
                Allowed Send Window
              </CardTitle>
              <CardDescription className="text-xs">Agent will only auto-send within this time window (24h format, org timezone).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-700">Window Start</Label>
                  <Input
                    type="time"
                    value={settings.allowedSendWindowStart}
                    onChange={(e) => update("allowedSendWindowStart", e.target.value)}
                    className="h-8 text-sm"
                    data-testid="input-window-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-700">Window End</Label>
                  <Input
                    type="time"
                    value={settings.allowedSendWindowEnd}
                    onChange={(e) => update("allowedSendWindowEnd", e.target.value)}
                    className="h-8 text-sm"
                    data-testid="input-window-end"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Approval Gates */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-violet-500" />
                Approval Gates
              </CardTitle>
              <CardDescription className="text-xs">Force human approval for sensitive contact scenarios.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-gray-100">
              <SettingRow
                label="Require Approval for First Contact"
                description="Always route first-ever messages to a new contact through human approval."
                value={settings.requireApprovalForFirstContact}
                onChange={(v) => update("requireApprovalForFirstContact", v)}
                riskLabel="Safe"
                testId="toggle-approval-first-contact"
                disabled={updateMutation.isPending}
              />
              <SettingRow
                label="Require Approval for New Recipients"
                description="Require approval when sending to an email address not previously in your system."
                value={settings.requireApprovalForNewRecipients}
                onChange={(v) => update("requireApprovalForNewRecipients", v)}
                riskLabel="Safe"
                testId="toggle-approval-new-recipients"
                disabled={updateMutation.isPending}
              />
              <SettingRow
                label="Notify Coach on Auto-Action"
                description="Send a notification to the coach whenever the agent auto-executes an action."
                value={settings.notifyCoachOnAutoAction}
                onChange={(v) => update("notifyCoachOnAutoAction", v)}
                riskLabel="Safe"
                testId="toggle-notify-coach"
                disabled={updateMutation.isPending}
              />
            </CardContent>
          </Card>

        </div>

        {/* Right column — decision log + executor */}
        <div className="space-y-4">

          {/* Executor Card */}
          <Card className="border shadow-sm bg-gradient-to-br from-violet-50 to-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4 text-violet-600" />
                Action Executor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-500">
                The executor runs every 5 minutes, evaluating all proposed actions against your policy settings. You can also trigger a manual cycle.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full border-violet-200 text-violet-700 hover:bg-violet-50"
                onClick={() => executorMutation.mutate()}
                disabled={executorMutation.isPending}
                data-testid="button-run-executor"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-2 ${executorMutation.isPending ? "animate-spin" : ""}`} />
                {executorMutation.isPending ? "Running..." : "Run Executor Cycle"}
              </Button>
              <div className="text-xs text-gray-400 text-center">Policy v{settings.policyVersion}</div>
            </CardContent>
          </Card>

          {/* Week Summary */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-500" />
                7-Day Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Auto-Executed", value: stats?.week?.autoExecuted ?? 0, color: "text-emerald-600", testId: "stat-week-auto" },
                { label: "Approval Required", value: stats?.week?.approvalRequired ?? 0, color: "text-amber-600", testId: "stat-week-approval" },
                { label: "Blocked", value: stats?.week?.blocked ?? 0, color: "text-red-600", testId: "stat-week-blocked" },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between py-1">
                  <span className="text-xs text-gray-500">{item.label}</span>
                  <span className={`text-sm font-bold ${item.color}`} data-testid={item.testId}>{item.value}</span>
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500">Total Decisions</span>
                <span className="text-sm font-bold text-gray-800">{stats?.week?.total ?? 0}</span>
              </div>
            </CardContent>
          </Card>

          {/* Recent Decisions */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-500" />
                Recent Decisions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {decisionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
                </div>
              ) : !decisions?.length ? (
                <div className="text-xs text-gray-400 text-center py-6">
                  No decisions logged yet. The executor runs every 5 minutes.
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {decisions.slice(0, 20).map((d) => (
                    <div
                      key={d.id}
                      className="p-2 rounded-lg border bg-white hover:bg-gray-50 transition-colors"
                      data-testid={`decision-row-${d.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700 truncate max-w-32">
                          {d.actionType.replace("propose_draft:", "").replace(/_/g, " ")}
                        </span>
                        {getDecisionBadge(d.decision)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {d.reasons?.[0] || "Policy evaluated"}
                      </div>
                      <div className="text-xs text-gray-300 mt-0.5">
                        {new Date(d.createdAt).toLocaleTimeString()} · {Math.round(d.confidence * 100)}% confidence · risk={d.riskLevel}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Safety Rules */}
          <Card className="border shadow-sm bg-gray-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-gray-500" />
                Permanent Safety Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-xs text-gray-500">
                {[
                  "Suppressed / unsubscribed leads: always blocked",
                  "High risk actions: always require approval",
                  "Sensitive language detected: always blocked",
                  "Emergency pause enabled: all actions blocked",
                  "Duplicate action in last hour: blocked",
                  "Outside send window: approval required",
                  "Daily cap exceeded: approval required",
                ].map((rule, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <XCircle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                    {rule}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Confirm Modals */}
      {Object.entries(HIGH_RISK_CONFIRMS).map(([field, config]) => (
        <ConfirmModal
          key={field}
          open={pendingField === field}
          settingLabel={config.label}
          warningText={config.warning}
          onConfirm={handleConfirm}
          onCancel={() => setPendingField(null)}
        />
      ))}
    </div>
  );
}
