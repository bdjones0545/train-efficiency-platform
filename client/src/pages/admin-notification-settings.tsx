import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Bell, Shield, BarChart3, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";

interface NotificationSettings {
  orgId: string;
  athleteBookingConfirmation: boolean;
  athleteRecurringConfirmation: boolean;
  athleteReschedule: boolean;
  athleteCancellation: boolean;
  athleteReminder: boolean;
  adminNewBooking: boolean;
  adminRecurringBooking: boolean;
  adminReschedule: boolean;
  adminCancellation: boolean;
  dedupWindowMinutes: number;
}

interface AuditLog {
  id: string;
  type: string;
  status: string;
  recipientEmail: string;
  subject: string;
  createdAt: string;
  errorMessage?: string;
}

interface AuditSummary {
  [type: string]: { sent: number; skipped: number; deduped: number; failed: number };
}

export default function AdminNotificationSettingsPage() {
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<Partial<NotificationSettings>>({});
  const [isDirty, setIsDirty] = useState(false);

  const { data: settings, isLoading } = useQuery<NotificationSettings>({
    queryKey: ["/api/admin/email-notification-settings"],
    staleTime: 30_000,
  });

  const { data: audit } = useQuery<{ logs: AuditLog[]; summary: AuditSummary }>({
    queryKey: ["/api/admin/notification-audit"],
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<NotificationSettings>) =>
      apiRequest("PUT", "/api/admin/email-notification-settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-notification-settings"] });
      setIsDirty(false);
      toast({ title: "Settings saved", description: "Notification preferences updated." });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save settings.", variant: "destructive" });
    },
  });

  const current: NotificationSettings = {
    ...(settings || {
      orgId: "",
      athleteBookingConfirmation: true,
      athleteRecurringConfirmation: true,
      athleteReschedule: true,
      athleteCancellation: true,
      athleteReminder: true,
      adminNewBooking: true,
      adminRecurringBooking: false,
      adminReschedule: true,
      adminCancellation: true,
      dedupWindowMinutes: 15,
    }),
    ...localSettings,
  };

  function toggle(field: keyof NotificationSettings) {
    setLocalSettings((prev) => ({ ...prev, [field]: !current[field] }));
    setIsDirty(true);
  }

  function handleSave() {
    saveMutation.mutate(current);
  }

  function statusBadge(status: string) {
    if (status === "sent") return <Badge className="bg-green-600 text-white text-xs" data-testid="badge-status-sent">Sent</Badge>;
    if (status === "deduped") return <Badge className="bg-blue-600 text-white text-xs" data-testid="badge-status-deduped">Deduped</Badge>;
    if (status === "skipped") return <Badge className="bg-yellow-600 text-white text-xs" data-testid="badge-status-skipped">Skipped</Badge>;
    if (status === "failed") return <Badge className="bg-red-600 text-white text-xs" data-testid="badge-status-failed">Failed</Badge>;
    return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const summary = audit?.summary || {};
  const logs = audit?.logs || [];

  const totalSent = Object.values(summary).reduce((a, b) => a + b.sent, 0);
  const totalDeduped = Object.values(summary).reduce((a, b) => a + b.deduped, 0);
  const totalSkipped = Object.values(summary).reduce((a, b) => a + b.skipped, 0);
  const totalFailed = Object.values(summary).reduce((a, b) => a + b.failed, 0);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Email Notification Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control which emails athletes and admins receive for each booking event.
          </p>
        </div>
        {isDirty && (
          <Button
            data-testid="button-save-settings"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        )}
      </div>

      <Tabs defaultValue="preferences">
        <TabsList data-testid="tabs-notification">
          <TabsTrigger value="preferences" data-testid="tab-preferences">Preferences</TabsTrigger>
          <TabsTrigger value="dedup" data-testid="tab-dedup">Deduplication</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* ─── Preferences Tab ─────────────────────────────────────────── */}
        <TabsContent value="preferences" className="space-y-6 mt-6">
          {/* Athlete Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Athlete Notifications
              </CardTitle>
              <CardDescription>
                Emails sent directly to the athlete / client.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  field: "athleteBookingConfirmation" as const,
                  label: "Booking Confirmation",
                  desc: "Sent when a single session is booked or confirmed.",
                },
                {
                  field: "athleteRecurringConfirmation" as const,
                  label: "Recurring Sessions Confirmed",
                  desc: "Sent when a series of recurring sessions is created — covers all sessions in one email.",
                },
                {
                  field: "athleteReschedule" as const,
                  label: "Session Rescheduled",
                  desc: "Sent when a session time is changed.",
                },
                {
                  field: "athleteCancellation" as const,
                  label: "Session Cancelled",
                  desc: "Sent when a session is cancelled.",
                },
                {
                  field: "athleteReminder" as const,
                  label: "Session Reminder",
                  desc: "24-hour reminder before an upcoming session.",
                },
              ].map(({ field, label, desc }) => (
                <div key={field} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <Label className="text-sm font-medium" data-testid={`label-${field}`}>{label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <Switch
                    data-testid={`switch-${field}`}
                    checked={current[field] as boolean}
                    onCheckedChange={() => toggle(field)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Admin Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                Admin / Coach Notifications
              </CardTitle>
              <CardDescription>
                Emails sent to coaches or admins when booking events occur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  field: "adminNewBooking" as const,
                  label: "New Booking",
                  desc: "Notify the coach when a client books a session.",
                },
                {
                  field: "adminRecurringBooking" as const,
                  label: "Recurring Booking Created",
                  desc: "Notify the coach when a recurring series is set up. Off by default to reduce noise.",
                },
                {
                  field: "adminReschedule" as const,
                  label: "Session Rescheduled",
                  desc: "Notify the coach when a session is moved.",
                },
                {
                  field: "adminCancellation" as const,
                  label: "Session Cancelled",
                  desc: "Notify the coach when a session is cancelled.",
                },
              ].map(({ field, label, desc }) => (
                <div key={field} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <Label className="text-sm font-medium" data-testid={`label-${field}`}>{label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <Switch
                    data-testid={`switch-${field}`}
                    checked={current[field] as boolean}
                    onCheckedChange={() => toggle(field)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {isDirty && (
            <div className="flex justify-end">
              <Button
                data-testid="button-save-bottom"
                onClick={handleSave}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Deduplication Tab ───────────────────────────────────────── */}
        <TabsContent value="dedup" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-500" />
                Notification Deduplication
              </CardTitle>
              <CardDescription>
                Prevents the same notification type from being sent to the same recipient
                multiple times within a rolling time window. This stops athletes from
                receiving both a "Session Confirmed" and a "Recurring Sessions Confirmed"
                email when creating a recurring series in one action.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="dedupWindow" data-testid="label-dedup-window">
                  Deduplication window (minutes)
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="dedupWindow"
                    data-testid="input-dedup-window"
                    type="number"
                    min={1}
                    max={60}
                    className="w-32"
                    value={current.dedupWindowMinutes}
                    onChange={(e) => {
                      setLocalSettings((prev) => ({
                        ...prev,
                        dedupWindowMinutes: parseInt(e.target.value) || 15,
                      }));
                      setIsDirty(true);
                    }}
                  />
                  <span className="text-sm text-muted-foreground">
                    Currently: <strong>{current.dedupWindowMinutes} minutes</strong>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended: 15 minutes. Increase if your booking workflows take longer.
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium mb-3">How deduplication works</p>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-4">
                  <li>Every email is keyed by <code className="text-xs bg-muted px-1 rounded">recipient + type</code></li>
                  <li>If the same key is seen within the window, the second email is suppressed</li>
                  <li>When a "Recurring Sessions Confirmed" email is sent, the system automatically
                      blocks any "Booking Confirmation" for the same recipient — so the athlete
                      gets exactly one email for the entire recurring booking action</li>
                  <li>Suppressed emails appear in the Audit Log with status <Badge className="bg-blue-600 text-white text-xs">Deduped</Badge></li>
                </ul>
              </div>

              {isDirty && (
                <div className="flex justify-end">
                  <Button
                    data-testid="button-save-dedup"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Audit Log Tab ───────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-6 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">Sent</span>
                </div>
                <p className="text-2xl font-bold mt-1" data-testid="stat-sent">{totalSent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">Deduped</span>
                </div>
                <p className="text-2xl font-bold mt-1" data-testid="stat-deduped">{totalDeduped}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-muted-foreground">Skipped</span>
                </div>
                <p className="text-2xl font-bold mt-1" data-testid="stat-skipped">{totalSkipped}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-muted-foreground">Failed</span>
                </div>
                <p className="text-2xl font-bold mt-1" data-testid="stat-failed">{totalFailed}</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-type breakdown */}
          {Object.keys(summary).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  By Notification Type (last 7 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(summary).map(([type, counts]) => (
                    <div key={type} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-sm font-mono" data-testid={`type-${type}`}>{type}</span>
                      <div className="flex gap-2 text-xs">
                        <span className="text-green-400">{counts.sent} sent</span>
                        {counts.deduped > 0 && <span className="text-blue-400">{counts.deduped} deduped</span>}
                        {counts.skipped > 0 && <span className="text-yellow-400">{counts.skipped} skipped</span>}
                        {counts.failed > 0 && <span className="text-red-400">{counts.failed} failed</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent logs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Notifications</CardTitle>
              <CardDescription>Last 100 email events across all types.</CardDescription>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No notification logs found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground text-xs">
                        <th className="pb-2 pr-3">Time</th>
                        <th className="pb-2 pr-3">Type</th>
                        <th className="pb-2 pr-3">Recipient</th>
                        <th className="pb-2 pr-3">Subject</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} className="border-b border-border/50 last:border-0" data-testid={`log-row-${log.id}`}>
                          <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                            {log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <code className="text-xs bg-muted px-1 rounded">{log.type}</code>
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground max-w-[160px] truncate">
                            {log.recipientEmail || "—"}
                          </td>
                          <td className="py-2 pr-3 text-xs max-w-[200px] truncate" title={log.subject || ""}>
                            {log.subject || "—"}
                          </td>
                          <td className="py-2">{statusBadge(log.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
