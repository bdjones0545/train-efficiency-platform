import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft, QrCode, Settings, Trophy, Users, Save, Plus, Trash2,
  ExternalLink, Copy, Check, Loader2, Mail, UserPlus, Clock, Bell,
  Send, AlertCircle
} from "lucide-react";

const DEFAULT_FIELDS = [
  { fieldName: "first_name", label: "First Name", fieldType: "text", visibility: "required" },
  { fieldName: "last_name", label: "Last Name", fieldType: "text", visibility: "required" },
  { fieldName: "email", label: "Email", fieldType: "email", visibility: "required" },
  { fieldName: "phone", label: "Phone", fieldType: "phone", visibility: "optional" },
  { fieldName: "sport", label: "Sport", fieldType: "text", visibility: "optional" },
  { fieldName: "position", label: "Position", fieldType: "text", visibility: "hidden" },
  { fieldName: "school", label: "School", fieldType: "text", visibility: "hidden" },
  { fieldName: "grad_year", label: "Graduation Year", fieldType: "text", visibility: "hidden" },
  { fieldName: "team", label: "Team", fieldType: "text", visibility: "hidden" },
  { fieldName: "age", label: "Age", fieldType: "text", visibility: "hidden" },
];

const DEFAULT_REWARDS = [
  { visitCount: 5, rewardName: "Sticker", rewardDescription: "EST branded sticker", active: true },
  { visitCount: 10, rewardName: "Water Bottle", rewardDescription: "EST water bottle", active: true },
  { visitCount: 25, rewardName: "Free Session", rewardDescription: "One complimentary training session", active: true },
  { visitCount: 50, rewardName: "Hoodie", rewardDescription: "EST hoodie", active: true },
];

type Recipient = {
  id?: string;
  coachId?: string;
  email: string;
  name: string;
  receiveDaily: boolean;
  receiveWeekly: boolean;
  active: boolean;
  lastDailySent?: any;
  lastWeeklySent?: any;
};

export default function AttendanceProgramEditorPage() {
  const { programId } = useParams<{ programId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const returnAfterSave = useRef(false);

  const [config, setConfig] = useState({
    description: "",
    location: "",
    startDate: "",
    endDate: "",
    active: true,
  });

  const [fields, setFields] = useState(DEFAULT_FIELDS.map((f, i) => ({ ...f, id: `f${i}` })));
  const [rewards, setRewards] = useState(DEFAULT_REWARDS.map((r, i) => ({ ...r, id: `r${i}` })));
  const [newReward, setNewReward] = useState({ visitCount: "", rewardName: "", rewardDescription: "" });

  // Coach Reports state
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [addMode, setAddMode] = useState<"coach" | "custom" | null>(null);
  const [selectedCoachId, setSelectedCoachId] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [customName, setCustomName] = useState("");
  const [testSending, setTestSending] = useState<string | null>(null);
  const [bulkTestSending, setBulkTestSending] = useState<"daily" | "weekly" | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/attendance-programs", programId, "config"],
    queryFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/config`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!programId,
  });

  const orgId = data?.program?.organization_id || (user as any)?.organizationId || "";

  const { data: coachesData } = useQuery<any[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/coaches?organizationId=${orgId}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!orgId,
  });
  const coaches: any[] = coachesData || [];

  const { data: recipientsData } = useQuery<any>({
    queryKey: ["/api/attendance-programs", programId, "report-recipients"],
    queryFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/report-recipients`);
      if (!r.ok) return { recipients: [] };
      return r.json();
    },
    enabled: !!programId,
  });

  const { data: sgStatus } = useQuery<{ configured: boolean; fromEmail?: string }>({
    queryKey: ["/api/attendance-programs", programId, "reports/sendgrid-status"],
    queryFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/reports/sendgrid-status`);
      if (!r.ok) return { configured: false };
      return r.json();
    },
    enabled: !!programId,
  });

  useEffect(() => {
    if (data) {
      if (data.config) {
        setConfig({
          description: data.config.description || "",
          location: data.config.location || "",
          startDate: data.config.start_date || "",
          endDate: data.config.end_date || "",
          active: data.config.active ?? true,
        });
      }
      if (data.fields && data.fields.length > 0) {
        setFields(data.fields.map((f: any, i: number) => ({
          id: f.id || `f${i}`,
          fieldName: f.field_name,
          label: f.label,
          fieldType: f.field_type || "text",
          visibility: f.visibility || "required",
        })));
      }
      if (data.rewards && data.rewards.length > 0) {
        setRewards(data.rewards.map((r: any, i: number) => ({
          id: r.id || `r${i}`,
          visitCount: r.visit_count,
          rewardName: r.reward_name,
          rewardDescription: r.reward_description || "",
          active: r.active ?? true,
        })));
      }
    }
  }, [data]);

  useEffect(() => {
    if (recipientsData?.recipients) {
      setRecipients(recipientsData.recipients.map((r: any) => ({
        id: r.id,
        coachId: r.coach_id || undefined,
        email: r.email,
        name: r.name,
        receiveDaily: r.receive_daily,
        receiveWeekly: r.receive_weekly,
        active: r.active,
        lastDailySent: r.lastDailySent,
        lastWeeklySent: r.lastWeeklySent,
      })));
    }
  }, [recipientsData]);

  const slug = data?.qr?.public_slug || data?.program?.slug || "";
  const checkinUrl = slug ? `${window.location.origin}/attendance/${slug}` : "";

  const copyUrl = () => {
    if (checkinUrl) {
      navigator.clipboard.writeText(checkinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Save mutations ──────────────────────────────────────────────────────────

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, organizationId: orgId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "config"] });
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/attendance-tracker"); }
    },
    onError: () => toast({ title: "Error", description: "Failed to save settings", variant: "destructive" }),
  });

  const saveFieldsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fields.map((f, i) => ({ ...f, displayOrder: i })), organizationId: orgId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (res) => {
      toast({ title: "Fields saved" });
      if (res.fields) {
        setFields(res.fields.map((f: any, i: number) => ({
          id: f.id, fieldName: f.field_name, label: f.label, fieldType: f.field_type, visibility: f.visibility,
          displayOrder: f.display_order ?? i,
        })));
      }
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "config"] });
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/attendance-tracker"); }
    },
    onError: () => toast({ title: "Error", description: "Failed to save fields", variant: "destructive" }),
  });

  const saveRewardsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/rewards`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: rewards.map(r => ({ id: r.id, visitCount: r.visitCount, rewardName: r.rewardName, rewardDescription: r.rewardDescription, active: r.active })), organizationId: orgId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (res) => {
      toast({ title: "Rewards saved" });
      if (res.tiers) {
        setRewards(res.tiers.map((t: any, i: number) => ({
          id: t.id || `r${i}`, visitCount: t.visit_count, rewardName: t.reward_name,
          rewardDescription: t.reward_description || "", active: t.active ?? true,
        })));
      }
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "config"] });
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/attendance-tracker"); }
    },
    onError: () => toast({ title: "Error", description: "Failed to save rewards", variant: "destructive" }),
  });

  const saveRecipientsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/report-recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, orgId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: (res) => {
      toast({ title: "Recipients saved" });
      if (res.recipients) {
        setRecipients(res.recipients.map((r: any) => ({
          id: r.id, coachId: r.coach_id || undefined,
          email: r.email, name: r.name,
          receiveDaily: r.receive_daily, receiveWeekly: r.receive_weekly, active: r.active,
        })));
      }
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "report-recipients"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to save recipients", variant: "destructive" }),
  });

  const addReward = () => {
    if (!newReward.visitCount || !newReward.rewardName) return;
    setRewards(prev => [...prev, { ...newReward, visitCount: Number(newReward.visitCount), id: `r${Date.now()}`, active: true }]);
    setNewReward({ visitCount: "", rewardName: "", rewardDescription: "" });
  };

  const addCoachRecipient = () => {
    if (!selectedCoachId) return;
    const coach = coaches.find(c => c.id === selectedCoachId);
    if (!coach) return;
    const email = coach.user?.email || "";
    const name = [coach.user?.firstName, coach.user?.lastName].filter(Boolean).join(" ") || email;
    if (!email || recipients.some(r => r.email === email)) {
      toast({ title: "Already added", description: "This coach is already in the list" });
      return;
    }
    setRecipients(prev => [...prev, { coachId: coach.id, email, name, receiveDaily: true, receiveWeekly: true, active: true }]);
    setSelectedCoachId("");
    setAddMode(null);
  };

  const addCustomRecipient = () => {
    if (!customEmail || !customName) return;
    if (recipients.some(r => r.email === customEmail)) {
      toast({ title: "Already added", description: "This email is already in the list" });
      return;
    }
    setRecipients(prev => [...prev, { email: customEmail, name: customName, receiveDaily: true, receiveWeekly: true, active: true }]);
    setCustomEmail("");
    setCustomName("");
    setAddMode(null);
  };

  const sendTestEmail = async (recipientEmail: string, reportType: "daily" | "weekly") => {
    const key = `${recipientEmail}:${reportType}`;
    setTestSending(key);
    try {
      const r = await fetch(`/api/attendance-programs/${programId}/report-recipients/send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail, reportType }),
      });
      const result = await r.json();
      if (result.ok) {
        const mid = result.sendgridMessageId ? ` (ID: ${result.sendgridMessageId})` : "";
        toast({ title: "Test email sent", description: `${reportType === "daily" ? "Daily" : "Weekly"} report sent to ${recipientEmail}${mid}` });
      } else {
        toast({ title: "Send failed", description: result.error || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to send test email", variant: "destructive" });
    } finally {
      setTestSending(null);
    }
  };

  const sendBulkTestReport = async (reportType: "daily" | "weekly") => {
    setBulkTestSending(reportType);
    try {
      const r = await fetch(`/api/attendance-programs/${programId}/reports/send-test-${reportType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await r.json();
      if (!result.sendgridConfigured) {
        toast({ title: "SendGrid not configured", description: "SendGrid is not configured in this environment.", variant: "destructive" });
        return;
      }
      const sent = (result.recipients || []).filter((x: any) => x.status === "sent").length;
      const failed = (result.recipients || []).filter((x: any) => x.status === "failed").length;
      if (failed > 0 && sent === 0) {
        const firstErr = result.recipients.find((x: any) => x.error)?.error || result.error || "Unknown error";
        toast({ title: "All sends failed", description: firstErr, variant: "destructive" });
      } else if (failed > 0) {
        toast({ title: `Sent ${sent}, failed ${failed}`, description: "Some recipients failed — check email history for errors.", variant: "destructive" });
      } else if (sent === 0) {
        toast({ title: "No recipients", description: result.error || "No active recipients with this report type enabled.", variant: "destructive" });
      } else {
        toast({ title: `Test ${reportType} sent to ${sent} recipient${sent === 1 ? "" : "s"}`, description: "Check inboxes and SendGrid Activity Feed to confirm delivery." });
      }
    } catch {
      toast({ title: "Error", description: "Failed to send test reports", variant: "destructive" });
    } finally {
      setBulkTestSending(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const programName = data?.program?.name || "Attendance Tracker";

  const activeRecipients = recipients.filter(r => r.active);
  const dailyEnabled = activeRecipients.some(r => r.receiveDaily);
  const weeklyEnabled = activeRecipients.some(r => r.receiveWeekly);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/attendance-tracker")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{programName}</h1>
          <p className="text-xs text-muted-foreground">Attendance Tracker Configuration</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.open(checkinUrl, "_blank")} disabled={!checkinUrl} data-testid="button-preview-checkin">
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Preview
        </Button>
      </div>

      {checkinUrl && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <QrCode className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-0.5">Check-In URL</p>
              <p className="text-sm font-mono text-blue-400 truncate">{checkinUrl}</p>
            </div>
            <Button size="sm" variant="outline" onClick={copyUrl} className="shrink-0" data-testid="button-copy-url">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="settings">
        <TabsList className="w-full" data-testid="tabs-editor">
          <TabsTrigger value="settings" className="flex-1" data-testid="tab-settings">
            <Settings className="h-3.5 w-3.5 mr-1.5" /> Settings
          </TabsTrigger>
          <TabsTrigger value="fields" className="flex-1" data-testid="tab-fields">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Fields
          </TabsTrigger>
          <TabsTrigger value="rewards" className="flex-1" data-testid="tab-rewards">
            <Trophy className="h-3.5 w-3.5 mr-1.5" /> Rewards
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex-1" data-testid="tab-reports">
            <Mail className="h-3.5 w-3.5 mr-1.5" /> Coach Reports
          </TabsTrigger>
        </TabsList>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Basic Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={config.description}
                  onChange={(e) => setConfig(c => ({ ...c, description: e.target.value }))}
                  placeholder="Brief description of this program..."
                  className="min-h-[80px] text-sm resize-none"
                  data-testid="textarea-description"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Location</Label>
                <Input
                  value={config.location}
                  onChange={(e) => setConfig(c => ({ ...c, location: e.target.value }))}
                  placeholder="e.g., Main Gym, Field House"
                  className="h-8 text-sm"
                  data-testid="input-location"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" value={config.startDate} onChange={(e) => setConfig(c => ({ ...c, startDate: e.target.value }))} className="h-8 text-sm" data-testid="input-start-date" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End Date</Label>
                  <Input type="date" value={config.endDate} onChange={(e) => setConfig(c => ({ ...c, endDate: e.target.value }))} className="h-8 text-sm" data-testid="input-end-date" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={config.active} onCheckedChange={(v) => setConfig(c => ({ ...c, active: v }))} data-testid="switch-active" />
                <Label className="text-sm">{config.active ? "Active — accepting check-ins" : "Inactive — check-ins paused"}</Label>
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { returnAfterSave.current = false; saveConfigMutation.mutate(); }} disabled={saveConfigMutation.isPending} data-testid="button-save-settings">
              {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>
            <Button onClick={() => { returnAfterSave.current = true; saveConfigMutation.mutate(); }} disabled={saveConfigMutation.isPending} data-testid="button-save-return-settings">
              {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save &amp; Return
            </Button>
          </div>
        </TabsContent>

        {/* Fields Tab */}
        <TabsContent value="fields" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Check-In Form Fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Configure what athletes fill out when checking in via QR code.</p>
              {fields.map((field, idx) => (
                <div key={field.id} className="flex items-center gap-3 rounded-lg border p-2.5" data-testid={`field-row-${idx}`}>
                  <div className="flex-1 min-w-0">
                    <Input
                      value={field.label}
                      onChange={(e) => setFields(prev => prev.map(f => f.id === field.id ? { ...f, label: e.target.value } : f))}
                      className="h-7 text-sm border-0 p-0 font-medium bg-transparent focus-visible:ring-0"
                      data-testid={`input-field-label-${idx}`}
                    />
                    <p className="text-xs text-muted-foreground">{field.fieldName}</p>
                  </div>
                  <Select
                    value={field.visibility}
                    onValueChange={(v) => setFields(prev => prev.map(f => f.id === field.id ? { ...f, visibility: v } : f))}
                    data-testid={`select-field-visibility-${idx}`}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="required">Required</SelectItem>
                      <SelectItem value="optional">Optional</SelectItem>
                      <SelectItem value="hidden">Hidden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { returnAfterSave.current = false; saveFieldsMutation.mutate(); }} disabled={saveFieldsMutation.isPending} data-testid="button-save-fields">
              {saveFieldsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>
            <Button onClick={() => { returnAfterSave.current = true; saveFieldsMutation.mutate(); }} disabled={saveFieldsMutation.isPending} data-testid="button-save-return-fields">
              {saveFieldsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save &amp; Return
            </Button>
          </div>
        </TabsContent>

        {/* Rewards Tab */}
        <TabsContent value="rewards" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Reward Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Athletes earn rewards when they hit these visit milestones. Emails are sent automatically.</p>
              {[...rewards].sort((a, b) => Number(a.visitCount) - Number(b.visitCount)).map((tier, idx) => (
                <div key={tier.id} className="rounded-lg border p-3 space-y-2" data-testid={`reward-tier-${idx}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                      {tier.visitCount}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Input
                        value={tier.rewardName}
                        onChange={(e) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, rewardName: e.target.value } : r))}
                        className="h-7 text-sm border-0 p-0 font-medium bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                        placeholder="Reward name"
                        data-testid={`input-reward-name-${idx}`}
                      />
                      <Input
                        value={tier.rewardDescription}
                        onChange={(e) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, rewardDescription: e.target.value } : r))}
                        className="h-6 text-xs border-0 p-0 text-muted-foreground bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                        placeholder="Description (optional)"
                        data-testid={`input-reward-desc-${idx}`}
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={tier.active} onCheckedChange={(v) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, active: v } : r))} data-testid={`switch-reward-active-${idx}`} />
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setRewards(prev => prev.filter(r => r.id !== tier.id))} data-testid={`button-delete-reward-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-13">
                    <Label className="text-xs text-muted-foreground w-24 shrink-0">Visits required:</Label>
                    <Input type="number" min="1" value={tier.visitCount} onChange={(e) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, visitCount: Number(e.target.value) } : r))} className="h-7 w-20 text-sm" data-testid={`input-reward-visits-${idx}`} />
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Add New Reward</p>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" min="1" placeholder="Visits" value={newReward.visitCount} onChange={(e) => setNewReward(r => ({ ...r, visitCount: e.target.value }))} className="h-8 text-sm" data-testid="input-new-reward-visits" />
                  <Input placeholder="Reward name" value={newReward.rewardName} onChange={(e) => setNewReward(r => ({ ...r, rewardName: e.target.value }))} className="h-8 text-sm" data-testid="input-new-reward-name" />
                  <Input placeholder="Description" value={newReward.rewardDescription} onChange={(e) => setNewReward(r => ({ ...r, rewardDescription: e.target.value }))} className="h-8 text-sm" data-testid="input-new-reward-desc" />
                </div>
                <Button size="sm" variant="outline" onClick={addReward} disabled={!newReward.visitCount || !newReward.rewardName} data-testid="button-add-reward">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Reward
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { returnAfterSave.current = false; saveRewardsMutation.mutate(); }} disabled={saveRewardsMutation.isPending} data-testid="button-save-rewards">
              {saveRewardsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>
            <Button onClick={() => { returnAfterSave.current = true; saveRewardsMutation.mutate(); }} disabled={saveRewardsMutation.isPending} data-testid="button-save-return-rewards">
              {saveRewardsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}Save &amp; Return
            </Button>
          </div>
        </TabsContent>

        {/* Coach Reports Tab */}
        <TabsContent value="reports" className="space-y-4 pt-4">

          {/* SendGrid not configured warning */}
          {sgStatus && !sgStatus.configured && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">SendGrid is not configured in this environment.</p>
                <p className="text-xs opacity-80 mt-0.5">Automated reports and test emails will not send until SendGrid is connected. Check the SendGrid integration in your Replit settings.</p>
              </div>
            </div>
          )}

          {/* Schedule info */}
          <Card className="bg-muted/30 border-muted">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="space-y-1.5 text-sm flex-1">
                  <p className="font-medium">Automatic Report Schedule</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] shrink-0">Daily</Badge>
                      Monday – Friday at 5:00 PM ET
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] shrink-0">Weekly</Badge>
                      Every Friday at 5:00 PM ET
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Reports include check-in totals, athlete list, sport breakdown, and reward highlights.</p>
                  <p className="text-xs text-muted-foreground">Verify delivery through the recipient's inbox or SendGrid Activity Feed — emails sent via SendGrid do not appear in Gmail Sent.</p>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={bulkTestSending === "daily" || !sgStatus?.configured} onClick={() => sendBulkTestReport("daily")} data-testid="button-send-test-daily-all">
                      {bulkTestSending === "daily" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send Test Daily Report
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={bulkTestSending === "weekly" || !sgStatus?.configured} onClick={() => sendBulkTestReport("weekly")} data-testid="button-send-test-weekly-all">
                      {bulkTestSending === "weekly" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send Test Weekly Report
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Status summary */}
          {recipients.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-bold text-green-500">{activeRecipients.length}</p>
                  <p className="text-xs text-muted-foreground">Active Recipients</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className={`text-xl font-bold ${dailyEnabled ? "text-green-500" : "text-muted-foreground"}`}>{dailyEnabled ? "On" : "Off"}</p>
                  <p className="text-xs text-muted-foreground">Daily Reports</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className={`text-xl font-bold ${weeklyEnabled ? "text-green-500" : "text-muted-foreground"}`}>{weeklyEnabled ? "On" : "Off"}</p>
                  <p className="text-xs text-muted-foreground">Weekly Reports</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Recipients list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bell className="h-4 w-4 text-green-500" /> Report Recipients
                  {recipients.length > 0 && <Badge variant="secondary" className="text-[10px]">{recipients.length}</Badge>}
                </CardTitle>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setAddMode(addMode === "coach" ? null : "coach")} data-testid="button-add-coach-recipient">
                    <UserPlus className="h-3.5 w-3.5" /> Add Coach
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setAddMode(addMode === "custom" ? null : "custom")} data-testid="button-add-custom-recipient">
                    <Plus className="h-3.5 w-3.5" /> Custom Email
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Add coach form */}
              {addMode === "coach" && (
                <div className="rounded-lg border border-dashed p-3 bg-muted/20 space-y-2">
                  <p className="text-xs font-medium">Add Coach from Organization</p>
                  <div className="flex gap-2">
                    <Select value={selectedCoachId} onValueChange={setSelectedCoachId} data-testid="select-add-coach">
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select a coach…" />
                      </SelectTrigger>
                      <SelectContent>
                        {coaches.filter(c => c.user?.email && !recipients.some(r => r.email === c.user.email)).map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {[c.user?.firstName, c.user?.lastName].filter(Boolean).join(" ") || c.user?.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8" onClick={addCoachRecipient} disabled={!selectedCoachId} data-testid="button-confirm-add-coach">
                      Add
                    </Button>
                  </div>
                </div>
              )}

              {/* Add custom email form */}
              {addMode === "custom" && (
                <div className="rounded-lg border border-dashed p-3 bg-muted/20 space-y-2">
                  <p className="text-xs font-medium">Add Custom Email Recipient</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Full name" value={customName} onChange={e => setCustomName(e.target.value)} className="h-8 text-sm" data-testid="input-custom-name" />
                    <Input type="email" placeholder="Email address" value={customEmail} onChange={e => setCustomEmail(e.target.value)} className="h-8 text-sm" data-testid="input-custom-email" />
                  </div>
                  <Button size="sm" variant="outline" onClick={addCustomRecipient} disabled={!customEmail || !customName} data-testid="button-confirm-add-custom">
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Recipient
                  </Button>
                </div>
              )}

              {/* Empty state */}
              {recipients.length === 0 && addMode === null && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Mail className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm font-medium mb-1">No recipients yet</p>
                  <p className="text-xs text-muted-foreground">Add coaches or custom emails to receive automated attendance summaries.</p>
                </div>
              )}

              {/* Recipient rows */}
              {recipients.map((r, idx) => (
                <div key={r.email} className={`rounded-lg border p-3 space-y-2 ${!r.active ? "opacity-50" : ""}`} data-testid={`recipient-row-${idx}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{r.name}</p>
                        {r.coachId && <Badge variant="secondary" className="text-[10px]">Coach</Badge>}
                        {!r.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Disabled</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        checked={r.active}
                        onCheckedChange={(v) => setRecipients(prev => prev.map(x => x.email === r.email ? { ...x, active: v } : x))}
                        data-testid={`switch-recipient-active-${idx}`}
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setRecipients(prev => prev.filter(x => x.email !== r.email))} data-testid={`button-remove-recipient-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.receiveDaily}
                        onCheckedChange={(v) => setRecipients(prev => prev.map(x => x.email === r.email ? { ...x, receiveDaily: v } : x))}
                        data-testid={`switch-recipient-daily-${idx}`}
                      />
                      <span className="text-xs text-muted-foreground">Daily</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.receiveWeekly}
                        onCheckedChange={(v) => setRecipients(prev => prev.map(x => x.email === r.email ? { ...x, receiveWeekly: v } : x))}
                        data-testid={`switch-recipient-weekly-${idx}`}
                      />
                      <span className="text-xs text-muted-foreground">Weekly</span>
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground" disabled={testSending === `${r.email}:daily`} onClick={() => sendTestEmail(r.email, "daily")} data-testid={`button-test-daily-${idx}`}>
                        {testSending === `${r.email}:daily` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test Daily
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground" disabled={testSending === `${r.email}:weekly`} onClick={() => sendTestEmail(r.email, "weekly")} data-testid={`button-test-weekly-${idx}`}>
                        {testSending === `${r.email}:weekly` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test Weekly
                      </Button>
                    </div>
                  </div>
                  {/* Last sent info */}
                  {(r.lastDailySent || r.lastWeeklySent) && (
                    <div className="space-y-1">
                      {r.lastDailySent && (
                        <div className="text-[10px]">
                          <span className={r.lastDailySent.status === "sent" ? "text-green-500" : "text-red-400"}>
                            {r.lastDailySent.status === "sent" ? "✓" : "✗"} Daily last sent: {new Date(r.lastDailySent.sent_at).toLocaleString()}
                            {r.lastDailySent.sendgrid_message_id && <span className="text-muted-foreground ml-1">(ID: {r.lastDailySent.sendgrid_message_id})</span>}
                          </span>
                          {r.lastDailySent.status !== "sent" && r.lastDailySent.error_message && (
                            <div className="mt-0.5 flex items-start gap-1 text-red-400">
                              <AlertCircle className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                              <span className="break-all">{r.lastDailySent.error_message}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {r.lastWeeklySent && (
                        <div className="text-[10px]">
                          <span className={r.lastWeeklySent.status === "sent" ? "text-green-500" : "text-red-400"}>
                            {r.lastWeeklySent.status === "sent" ? "✓" : "✗"} Weekly last sent: {new Date(r.lastWeeklySent.sent_at).toLocaleString()}
                            {r.lastWeeklySent.sendgrid_message_id && <span className="text-muted-foreground ml-1">(ID: {r.lastWeeklySent.sendgrid_message_id})</span>}
                          </span>
                          {r.lastWeeklySent.status !== "sent" && r.lastWeeklySent.error_message && (
                            <div className="mt-0.5 flex items-start gap-1 text-red-400">
                              <AlertCircle className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                              <span className="break-all">{r.lastWeeklySent.error_message}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={() => saveRecipientsMutation.mutate()} disabled={saveRecipientsMutation.isPending} data-testid="button-save-recipients">
              {saveRecipientsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />} Save Recipients
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
