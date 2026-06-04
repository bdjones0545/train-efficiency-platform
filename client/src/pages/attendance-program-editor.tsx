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
  ArrowLeft, QrCode, Settings, Trophy, Users, Save, Plus, Trash2, GripVertical,
  ExternalLink, Copy, Check, Loader2
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

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/attendance-programs", programId, "config"],
    queryFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/config`);
      if (!r.ok) throw new Error("Failed");
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

  const orgId = data?.program?.organization_id || user?.organizationId || "";
  const slug = data?.qr?.public_slug || data?.program?.slug || "";
  const checkinUrl = slug ? `${window.location.origin}/attendance/${slug}` : "";

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
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/configuration"); }
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const saveFieldsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save fields");
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Fields saved" });
      // Hydrate local state from server response to confirm what was actually persisted
      if (data.fields && data.fields.length > 0) {
        setFields(data.fields.map((f: any, i: number) => ({
          id: f.id || `f${i}`,
          fieldName: f.field_name,
          label: f.label,
          fieldType: f.field_type || "text",
          visibility: f.visibility || "required",
        })));
      }
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "config"] });
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/configuration"); }
    },
    onError: (e: any) => toast({ title: e.message || "Save failed", variant: "destructive" }),
  });

  const saveRewardsMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/attendance-programs/${programId}/rewards`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: rewards }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save rewards");
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Rewards saved" });
      // Hydrate local state from server response to confirm what was actually persisted
      if (data.tiers && data.tiers.length > 0) {
        setRewards(data.tiers.map((r: any, i: number) => ({
          id: r.id || `r${i}`,
          visitCount: r.visit_count,
          rewardName: r.reward_name,
          rewardDescription: r.reward_description || "",
          active: r.active ?? true,
        })));
      }
      qc.invalidateQueries({ queryKey: ["/api/attendance-programs", programId, "config"] });
      if (returnAfterSave.current) { returnAfterSave.current = false; navigate("/admin/configuration"); }
    },
    onError: (e: any) => toast({ title: e.message || "Save failed", variant: "destructive" }),
  });

  const copyUrl = () => {
    navigator.clipboard.writeText(checkinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const addReward = () => {
    if (!newReward.visitCount || !newReward.rewardName) return;
    setRewards(prev => [
      ...prev,
      { id: `r${Date.now()}`, visitCount: Number(newReward.visitCount), rewardName: newReward.rewardName, rewardDescription: newReward.rewardDescription, active: true }
    ].sort((a, b) => Number(a.visitCount) - Number(b.visitCount)));
    setNewReward({ visitCount: "", rewardName: "", rewardDescription: "" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const programName = data?.program?.name || "Attendance Tracker";

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
                  data-testid="input-location"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" value={config.startDate} onChange={(e) => setConfig(c => ({ ...c, startDate: e.target.value }))} data-testid="input-start-date" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End Date</Label>
                  <Input type="date" value={config.endDate} onChange={(e) => setConfig(c => ({ ...c, endDate: e.target.value }))} data-testid="input-end-date" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Program Active</p>
                  <p className="text-xs text-muted-foreground">Athletes can check in when active</p>
                </div>
                <Switch checked={config.active} onCheckedChange={(v) => setConfig(c => ({ ...c, active: v }))} data-testid="switch-active" />
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { returnAfterSave.current = false; saveConfigMutation.mutate(); }}
              disabled={saveConfigMutation.isPending}
              data-testid="button-save-settings"
            >
              {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
            <Button
              onClick={() => { returnAfterSave.current = true; saveConfigMutation.mutate(); }}
              disabled={saveConfigMutation.isPending}
              data-testid="button-save-return-settings"
            >
              {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save &amp; Return
            </Button>
          </div>
        </TabsContent>

        {/* Fields Tab */}
        <TabsContent value="fields" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Athlete Information Fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Configure which fields athletes must complete when checking in.</p>
              {fields.map((field, idx) => (
                <div key={field.id} className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30" data-testid={`field-row-${field.fieldName}`}>
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{field.label}</p>
                    <p className="text-xs text-muted-foreground">{field.fieldName}</p>
                  </div>
                  <Select
                    value={field.visibility}
                    onValueChange={(v) => setFields(prev => prev.map((f, i) => i === idx ? { ...f, visibility: v } : f))}
                    data-testid={`select-visibility-${field.fieldName}`}
                  >
                    <SelectTrigger className="w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="required">Required</SelectItem>
                      <SelectItem value="optional">Optional</SelectItem>
                      <SelectItem value="hidden">Hidden</SelectItem>
                    </SelectContent>
                  </Select>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] shrink-0 ${
                      field.visibility === "required" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                      field.visibility === "optional" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                      "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    {field.visibility}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { returnAfterSave.current = false; saveFieldsMutation.mutate(); }}
              disabled={saveFieldsMutation.isPending}
              data-testid="button-save-fields"
            >
              {saveFieldsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
            <Button
              onClick={() => { returnAfterSave.current = true; saveFieldsMutation.mutate(); }}
              disabled={saveFieldsMutation.isPending}
              data-testid="button-save-return-fields"
            >
              {saveFieldsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save &amp; Return
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
                      <Switch
                        checked={tier.active}
                        onCheckedChange={(v) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, active: v } : r))}
                        data-testid={`switch-reward-active-${idx}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setRewards(prev => prev.filter(r => r.id !== tier.id))}
                        data-testid={`button-delete-reward-${idx}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-13">
                    <Label className="text-xs text-muted-foreground w-24 shrink-0">Visits required:</Label>
                    <Input
                      type="number"
                      min="1"
                      value={tier.visitCount}
                      onChange={(e) => setRewards(prev => prev.map(r => r.id === tier.id ? { ...r, visitCount: Number(e.target.value) } : r))}
                      className="h-7 w-20 text-sm"
                      data-testid={`input-reward-visits-${idx}`}
                    />
                  </div>
                </div>
              ))}

              <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Add New Reward</p>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    min="1"
                    placeholder="Visits"
                    value={newReward.visitCount}
                    onChange={(e) => setNewReward(r => ({ ...r, visitCount: e.target.value }))}
                    className="h-8 text-sm"
                    data-testid="input-new-reward-visits"
                  />
                  <Input
                    placeholder="Reward name"
                    value={newReward.rewardName}
                    onChange={(e) => setNewReward(r => ({ ...r, rewardName: e.target.value }))}
                    className="h-8 text-sm"
                    data-testid="input-new-reward-name"
                  />
                  <Input
                    placeholder="Description"
                    value={newReward.rewardDescription}
                    onChange={(e) => setNewReward(r => ({ ...r, rewardDescription: e.target.value }))}
                    className="h-8 text-sm"
                    data-testid="input-new-reward-desc"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={addReward} disabled={!newReward.visitCount || !newReward.rewardName} data-testid="button-add-reward">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Reward
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { returnAfterSave.current = false; saveRewardsMutation.mutate(); }}
              disabled={saveRewardsMutation.isPending}
              data-testid="button-save-rewards"
            >
              {saveRewardsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
            <Button
              onClick={() => { returnAfterSave.current = true; saveRewardsMutation.mutate(); }}
              disabled={saveRewardsMutation.isPending}
              data-testid="button-save-return-rewards"
            >
              {saveRewardsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save &amp; Return
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
