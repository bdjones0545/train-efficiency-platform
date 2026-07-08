import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Users,
  Mail,
  Phone,
  Clock,
  CheckCircle,
  AlertTriangle,
  Calendar,
  Send,
  Settings,
  RefreshCw,
  Dumbbell,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  AlertCircle,
  Brain,
  ExternalLink,
  LogIn,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  date: string;
  athleteUserId?: string;
  metadata?: Record<string, any>;
}

interface GuardianPrefs {
  emailEnabled: boolean;
  smsEnabled: boolean;
  marketingEnabled: boolean;
  evaluationReminders: boolean;
  scheduleNotifications: boolean;
  programUpdates: boolean;
  preferredContactMethod: string;
  pailContext: string | null;
  updatedAt: string | null;
}

interface LinkedAthleteDetail {
  athleteUserId: string;
  athleteName: string;
  linkId: string;
  linkStatus: string;
  createdAt: string | null;
  activatedAt: string | null;
  onboarding: {
    id: string;
    status: string;
    programAssigned: boolean;
    firstSessionScheduled: boolean;
    firstSessionCompleted: boolean;
    accountInviteSent: boolean;
  } | null;
}

interface GuardianAlert {
  key: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
}

interface GuardianDetailData {
  guardianUserId: string;
  inviteEmail: string;
  inviteStatus: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  lastSignInAt: string | null;
  memberSince: string | null;
  linkedAthletes: LinkedAthleteDetail[];
  timeline: TimelineEvent[];
  preferences: GuardianPrefs | null;
  alerts: GuardianAlert[];
  alertCount: number;
  recentNotifications: any[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const timelineTypeConfig: Record<string, { icon: typeof Mail; color: string; label: string }> = {
  invitation_sent: { icon: Send, color: "text-blue-500", label: "Invite Sent" },
  invitation_accepted: { icon: CheckCircle, color: "text-emerald-500", label: "Invite Accepted" },
  invitation_pending: { icon: Clock, color: "text-amber-500", label: "Awaiting Acceptance" },
  welcome_draft_queued: { icon: Mail, color: "text-purple-500", label: "Draft Queued" },
  welcome_draft_approved: { icon: CheckCircle, color: "text-emerald-500", label: "Email Sent" },
  email_sent: { icon: Send, color: "text-blue-500", label: "Email Sent" },
  notification_sent: { icon: MessageSquare, color: "text-slate-500", label: "Notification" },
  invite_resent: { icon: RefreshCw, color: "text-amber-500", label: "Invite Resent" },
  system_event: { icon: ShieldCheck, color: "text-slate-400", label: "System Event" },
};

const severityConfig = {
  critical: { bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-400", label: "Critical" },
  high: { bg: "bg-orange-50 dark:bg-orange-950/20", border: "border-orange-200 dark:border-orange-800", text: "text-orange-700 dark:text-orange-400", label: "High" },
  medium: { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400", label: "Medium" },
  low: { bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-400", label: "Low" },
};

// ─── Overview section ─────────────────────────────────────────────────────────

function OverviewSection({ data }: { data: GuardianDetailData }) {
  const inviteStatusLabel =
    data.inviteStatus === "active" ? "Active" :
    data.inviteStatus === "pending" ? "Invite Pending" :
    data.inviteStatus === "revoked" ? "Revoked" : "No Invite";

  const inviteStatusColor =
    data.inviteStatus === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" :
    data.inviteStatus === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" :
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Guardian Overview</h2>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg">
                {`${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || data.email}
              </h3>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${inviteStatusColor}`}>
                {inviteStatusLabel}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span>{data.email}</span>
            </div>
            {data.phone && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                <span>{data.phone}</span>
              </div>
            )}
          </div>
          <div className="text-right shrink-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-end">
              <LogIn className="h-3 w-3" />
              <span>{data.lastSignInAt ? `Last sign-in ${timeAgo(data.lastSignInAt)}` : "Never signed in"}</span>
            </div>
            {data.memberSince && (
              <p className="text-[11px] text-muted-foreground">Member since {formatDate(data.memberSince)}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t">
          <div className="text-center">
            <p className="text-xl font-bold">{data.linkedAthletes.length}</p>
            <p className="text-[11px] text-muted-foreground">Athletes Linked</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold">{data.timeline.length}</p>
            <p className="text-[11px] text-muted-foreground">Timeline Events</p>
          </div>
          <div className="text-center">
            <p className={`text-xl font-bold ${data.alertCount > 0 ? "text-amber-600" : ""}`}>{data.alertCount}</p>
            <p className="text-[11px] text-muted-foreground">Active Alerts</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Linked athletes section ───────────────────────────────────────────────────

function LinkedAthletesSection({ athletes }: { athletes: LinkedAthleteDetail[] }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Users className="h-4 w-4" /> Linked Athletes ({athletes.length})
        </h2>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {athletes.length === 0 && (
          <p className="text-sm text-muted-foreground/60">No athletes linked yet.</p>
        )}
        {athletes.map(a => {
          const steps = [
            a.onboarding?.accountInviteSent,
            a.onboarding?.programAssigned,
            a.onboarding?.firstSessionScheduled,
            a.onboarding?.firstSessionCompleted,
          ].filter(Boolean).length;
          const pct = (steps / 4) * 100;

          return (
            <div key={a.athleteUserId} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{a.athleteName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Linked {formatDate(a.createdAt)}
                    {a.activatedAt ? ` · Accepted ${formatDate(a.activatedAt)}` : " · Pending acceptance"}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  a.linkStatus === "active"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                }`}>
                  {a.linkStatus}
                </span>
              </div>

              {a.onboarding && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Onboarding progress</span>
                    <span className="text-[10px] font-medium text-muted-foreground">{a.onboarding.status}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${a.onboarding.firstSessionCompleted ? "bg-purple-500" : a.onboarding.firstSessionScheduled ? "bg-emerald-500" : "bg-amber-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { done: a.onboarding.accountInviteSent, label: "Account" },
                      { done: a.onboarding.programAssigned, label: "Program" },
                      { done: a.onboarding.firstSessionScheduled, label: "Scheduled" },
                      { done: a.onboarding.firstSessionCompleted, label: "Trained" },
                    ].map(step => (
                      <div key={step.label} className="flex items-center gap-0.5">
                        {step.done
                          ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                          : <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />
                        }
                        <span className="text-[9px] text-muted-foreground truncate">{step.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-1.5">
                <Link href="/admin/athlete-onboarding">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1">
                    <ExternalLink className="h-2.5 w-2.5" /> Onboarding
                  </Button>
                </Link>
                <Link href="/admin/athlete-intelligence">
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground">
                    <Brain className="h-2.5 w-2.5" /> PAIL
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Communication timeline section ───────────────────────────────────────────

function TimelineSection({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Communication Timeline ({events.length})
        </h2>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {events.length === 0 && (
          <p className="text-sm text-muted-foreground/60">No communication history yet.</p>
        )}
        <div className="relative">
          {events.map((event, idx) => {
            const cfg = timelineTypeConfig[event.type] ?? timelineTypeConfig.system_event;
            const Icon = cfg.icon;
            return (
              <div key={event.id} className="flex gap-3 pb-4">
                <div className="flex flex-col items-center">
                  <div className={`rounded-full p-1.5 border bg-background ${cfg.color} shrink-0`}>
                    <Icon className="h-3 w-3" />
                  </div>
                  {idx < events.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium">{event.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{event.description}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(event.date)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{formatDate(event.date)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Preferences section ───────────────────────────────────────────────────────

function PreferencesSection({
  guardianUserId,
  prefs,
}: {
  guardianUserId: string;
  prefs: GuardianPrefs | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<GuardianPrefs>>({
    emailEnabled: prefs?.emailEnabled ?? true,
    smsEnabled: prefs?.smsEnabled ?? false,
    marketingEnabled: prefs?.marketingEnabled ?? false,
    evaluationReminders: prefs?.evaluationReminders ?? true,
    scheduleNotifications: prefs?.scheduleNotifications ?? true,
    programUpdates: prefs?.programUpdates ?? true,
    preferredContactMethod: prefs?.preferredContactMethod ?? "email",
    pailContext: prefs?.pailContext ?? "",
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<GuardianPrefs>) =>
      apiRequest("PATCH", `/api/admin/guardians/${guardianUserId}/preferences`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/guardian", guardianUserId] });
      toast({ title: "Preferences saved", description: "Guardian preferences have been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleField = (field: keyof GuardianPrefs) => {
    const updated = { ...form, [field]: !form[field as keyof typeof form] };
    setForm(updated);
    updateMutation.mutate(updated);
  };

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Settings className="h-4 w-4" /> Communication Preferences
        </h2>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {!prefs && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
            No preferences set — defaults will apply until the guardian configures them.
          </p>
        )}

        <div className="space-y-3">
          {([
            { key: "emailEnabled", label: "Email notifications", description: "Receive updates via email" },
            { key: "evaluationReminders", label: "Evaluation reminders", description: "Reminders for upcoming evaluations" },
            { key: "scheduleNotifications", label: "Schedule notifications", description: "Updates about session scheduling" },
            { key: "programUpdates", label: "Program updates", description: "Notifications about training program changes" },
            { key: "marketingEnabled", label: "Marketing emails", description: "Occasional newsletters and announcements" },
          ] as const).map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground">{description}</p>
              </div>
              <Switch
                checked={!!(form[key])}
                onCheckedChange={() => toggleField(key as keyof GuardianPrefs)}
                disabled={updateMutation.isPending}
                data-testid={`switch-${key}`}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5 pt-2 border-t">
          <Label className="text-xs font-medium">Preferred contact method</Label>
          <Select
            value={form.preferredContactMethod ?? "email"}
            onValueChange={v => {
              const updated = { ...form, preferredContactMethod: v };
              setForm(updated);
              updateMutation.mutate(updated);
            }}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="select-contact-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Phone call</SelectItem>
              <SelectItem value="text">Text (SMS)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 pt-2 border-t">
          <Label className="text-xs font-medium">PAIL Guardian Context</Label>
          <p className="text-[11px] text-muted-foreground">
            Coach notes about this guardian for AI agent context (e.g. "highly involved", "prefers email", "handles scheduling").
          </p>
          <Textarea
            value={form.pailContext ?? ""}
            onChange={e => setForm(f => ({ ...f, pailContext: e.target.value }))}
            placeholder="e.g. Highly involved parent, primary contact, prefers detailed weekly updates..."
            className="text-xs min-h-[80px] resize-none"
            data-testid="textarea-pail-context"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate(form)}
            data-testid="button-save-context">
            {updateMutation.isPending ? "Saving…" : "Save Context"}
          </Button>
        </div>

        {prefs?.updatedAt && (
          <p className="text-[10px] text-muted-foreground">Last updated {timeAgo(prefs.updatedAt)}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Alerts section ───────────────────────────────────────────────────────────

function AlertsSection({ alerts }: { alerts: GuardianAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> Alerts
          </h2>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" /> No active alerts for this guardian.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Alerts ({alerts.length})
        </h2>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {alerts.map(alert => {
          const cfg = severityConfig[alert.severity];
          return (
            <div key={alert.key}
              className={`rounded-md border ${cfg.bg} ${cfg.border} px-3 py-2 flex items-start justify-between gap-3`}>
              <div>
                <p className={`text-[10px] font-semibold uppercase ${cfg.text}`}>{cfg.label}</p>
                <p className="text-xs text-foreground mt-0.5">{alert.message}</p>
              </div>
              {alert.actionUrl && (
                <Link href={alert.actionUrl}>
                  <Button size="sm" variant="outline"
                    className={`h-6 text-[10px] shrink-0 border ${cfg.border} ${cfg.text}`}>
                    {alert.actionLabel}
                  </Button>
                </Link>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Actions panel ────────────────────────────────────────────────────────────

function ActionsPanel({ data, guardianUserId }: { data: GuardianDetailData; guardianUserId: string }) {
  const { toast } = useToast();

  const draftMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/admin/guardians/${guardianUserId}/queue-welcome-draft`, {}),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/guardian", guardianUserId] });
      toast({ title: d?.ok ? "Draft queued" : "Already queued", description: d?.message });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/org/guardians/invite`, {
        inviteEmail: data.inviteEmail,
        athleteUserId: data.linkedAthletes[0]?.athleteUserId,
      }),
    onSuccess: () => {
      toast({ title: "Invite sent", description: `Invite resent to ${data.inviteEmail}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send invite", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Quick Actions</h2>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <Button variant="default" className="w-full gap-1.5 h-9 text-sm justify-start"
          disabled={draftMutation.isPending}
          onClick={() => draftMutation.mutate()}
          data-testid="button-queue-welcome-draft">
          <Send className="h-4 w-4" /> Queue Guardian Welcome Draft
        </Button>

        {data.inviteStatus === "pending" && (
          <Button variant="outline" className="w-full gap-1.5 h-9 text-sm justify-start"
            disabled={inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
            data-testid="button-resend-invite">
            <Mail className="h-4 w-4" /> Resend Guardian Invite
          </Button>
        )}

        <Link href="/admin/athlete-onboarding">
          <Button variant="outline" className="w-full gap-1.5 h-9 text-sm justify-start"
            data-testid="button-go-onboarding">
            <ExternalLink className="h-4 w-4" /> View Athlete Onboarding
          </Button>
        </Link>

        <Link href="/admin/ai-approvals">
          <Button variant="ghost" className="w-full gap-1.5 h-9 text-sm justify-start text-muted-foreground"
            data-testid="button-go-approvals">
            <Mail className="h-4 w-4" /> AI Approvals
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminGuardianDetailPage() {
  const { id: guardianUserId } = useParams<{ id: string }>();

  const { data, isLoading, isError, refetch } = useQuery<GuardianDetailData>({
    queryKey: ["/api/admin/guardian", guardianUserId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/guardians/${guardianUserId}`);
      if (!res.ok) throw new Error("Failed to load guardian");
      return res.json();
    },
    enabled: !!guardianUserId,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/guardians">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8"
              data-testid="button-back">
              <ArrowLeft className="h-3.5 w-3.5" /> Guardians
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">
              {isLoading ? "Loading…" : data ? (`${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || data.email) : "Guardian Profile"}
            </h1>
            {data && <p className="text-muted-foreground text-sm">{data.email}</p>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5"
          data-testid="button-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="font-medium text-destructive">Failed to load guardian profile</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
        </div>
      )}

      {!isLoading && !isError && !data && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-muted-foreground">Guardian not found.</p>
          <Link href="/admin/guardians">
            <Button variant="outline" size="sm" className="mt-3">Back to Guardians</Button>
          </Link>
        </div>
      )}

      {!isLoading && !isError && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — main content */}
          <div className="lg:col-span-2 space-y-6">
            <OverviewSection data={data} />
            <AlertsSection alerts={data.alerts} />
            <LinkedAthletesSection athletes={data.linkedAthletes} />
            <TimelineSection events={data.timeline} />
          </div>

          {/* Right column — sidebar */}
          <div className="space-y-6">
            <ActionsPanel data={data} guardianUserId={guardianUserId!} />
            <PreferencesSection guardianUserId={guardianUserId!} prefs={data.preferences} />
          </div>
        </div>
      )}
    </div>
  );
}
