import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Plus, Trash2, ToggleLeft, ToggleRight, ChevronRight,
  Shield, BookOpen, Bell, Trophy, Loader2, GraduationCap, Info,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

const TRIGGER_OPTIONS = [
  { value: "athlete_joined", label: "Athlete Joins Team", description: "Fires when a new athlete joins the organization" },
  { value: "quiz_failed", label: "Quiz Failed", description: "Fires when an athlete fails a quiz (score < 80%)" },
  { value: "readiness_low", label: "Low Readiness Check-in", description: "Fires when readiness score is below threshold" },
  { value: "pathway_completed", label: "Pathway Completed", description: "Fires when an athlete finishes all modules in a pathway" },
  { value: "module_overdue", label: "Module Overdue", description: "Fires when a module hasn't been started after assignment" },
];

const ACTION_OPTIONS = [
  { value: "assign_pathway", label: "Assign Pathway", description: "Assign a learning pathway to the athlete" },
  { value: "notify_coach", label: "Notify Coach", description: "Send a notification to all coaches in the org" },
  { value: "award_badge", label: "Award Badge", description: "Automatically award a badge to the athlete" },
];

function triggerIcon(type: string) {
  if (type === "quiz_failed") return <BookOpen className="h-3.5 w-3.5" />;
  if (type === "readiness_low") return <Shield className="h-3.5 w-3.5" />;
  if (type === "pathway_completed") return <Trophy className="h-3.5 w-3.5" />;
  if (type === "athlete_joined") return <GraduationCap className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

function triggerColor(type: string) {
  if (type === "quiz_failed") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (type === "readiness_low") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (type === "pathway_completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (type === "athlete_joined") return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

function actionColor(type: string) {
  if (type === "assign_pathway") return "bg-primary/15 text-primary border-primary/30";
  if (type === "notify_coach") return "bg-violet-500/15 text-violet-400 border-violet-500/30";
  if (type === "award_badge") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

const BLANK_RULE = {
  name: "",
  triggerType: "",
  triggerConfig: {},
  actionType: "",
  actionConfig: {},
  requiresApproval: true,
};

export default function CoachEducationRulesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(BLANK_RULE);

  const { data: rulesData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/education/rules", slug],
    queryFn: () => fetchJson("/api/org/education/rules", { headers }),
  });

  const { data: pathwaysData } = useQuery<any>({
    queryKey: ["/api/org/education/pathways", slug],
    queryFn: () => fetchJson("/api/org/education/pathways", { headers }),
  });

  const rules: any[] = rulesData?.rules ?? [];
  const pathways: any[] = pathwaysData?.pathways ?? [];
  const publishedPathways = pathways.filter((p: any) => p.status === "published");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/org/education/rules", slug] });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/education/rules", data,  headers),
    onSuccess: () => { invalidate(); setShowForm(false); setForm(BLANK_RULE); toast({ title: "Rule created" }); },
    onError: () => toast({ title: "Error creating rule", variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest("PATCH", `/api/org/education/rules/${id}`, { isActive },  headers),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/org/education/rules/${id}`, {},  headers),
    onSuccess: () => { invalidate(); toast({ title: "Rule deleted" }); },
  });

  function buildTriggerConfig() {
    const cfg: any = {};
    if (form.triggerType === "quiz_failed") cfg.threshold = parseInt(form._failThreshold ?? "1") || 1;
    if (form.triggerType === "readiness_low") cfg.threshold = parseInt(form._readinessThreshold ?? "5") || 5;
    if (form.triggerType === "pathway_completed") cfg.pathwayId = form._triggerPathwayId ?? null;
    return cfg;
  }

  function buildActionConfig() {
    const cfg: any = {};
    if (form.actionType === "assign_pathway") cfg.pathwayId = form._actionPathwayId ?? null;
    if (form.actionType === "notify_coach") cfg.message = form._notifyMessage ?? "A rule was triggered for an athlete.";
    if (form.actionType === "award_badge") cfg.pathwayId = form._actionPathwayId ?? null;
    return cfg;
  }

  function handleSubmit() {
    if (!form.name || !form.triggerType || !form.actionType) {
      toast({ title: "Fill in all required fields", variant: "destructive" });
      return;
    }
    createMut.mutate({
      name: form.name,
      triggerType: form.triggerType,
      triggerConfig: buildTriggerConfig(),
      actionType: form.actionType,
      actionConfig: buildActionConfig(),
      requiresApproval: form.requiresApproval,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Zap className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Education Rules Engine</h1>
            <p className="text-sm text-muted-foreground">Automate pathway assignments based on athlete behavior</p>
          </div>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)} data-testid="button-add-rule">
          <Plus className="h-4 w-4" />
          New Rule
        </Button>
      </div>

      {/* AI approves notice */}
      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm">
        <Info className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-blue-300">
          <span className="font-medium">Coach-controlled AI.</span>{" "}
          Rules with <em>Requires Approval</em> enabled create recommendations you review before they assign. Disable it to auto-assign instantly.
        </div>
      </div>

      {/* New Rule Form */}
      {showForm && (
        <Card className="p-5 space-y-4 border-primary/30 bg-primary/[0.03]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">New Automation Rule</p>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowForm(false); setForm(BLANK_RULE); }}>
              ✕
            </Button>
          </div>

          <Input
            placeholder="Rule name (e.g. Assign Recovery after low readiness)"
            value={form.name}
            onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))}
            className="h-9 text-sm"
            data-testid="input-rule-name"
          />

          {/* TRIGGER */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">IF — Trigger</p>
            <Select value={form.triggerType} onValueChange={(v) => setForm((p: any) => ({ ...p, triggerType: v }))}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-trigger-type">
                <SelectValue placeholder="Select a trigger..." />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div>
                      <div className="font-medium">{o.label}</div>
                      <div className="text-xs text-muted-foreground">{o.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Trigger config */}
            {form.triggerType === "quiz_failed" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Fail count ≥</span>
                <Input type="number" min="1" max="10" value={form._failThreshold ?? "1"}
                  onChange={(e) => setForm((p: any) => ({ ...p, _failThreshold: e.target.value }))}
                  className="h-8 text-xs w-20" />
                <span className="text-xs text-muted-foreground">times</span>
              </div>
            )}
            {form.triggerType === "readiness_low" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Readiness score ≤</span>
                <Input type="number" min="1" max="10" value={form._readinessThreshold ?? "5"}
                  onChange={(e) => setForm((p: any) => ({ ...p, _readinessThreshold: e.target.value }))}
                  className="h-8 text-xs w-20" />
                <span className="text-xs text-muted-foreground">/ 10</span>
              </div>
            )}
            {form.triggerType === "pathway_completed" && (
              <Select value={form._triggerPathwayId ?? ""} onValueChange={(v) => setForm((p: any) => ({ ...p, _triggerPathwayId: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any pathway (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any pathway</SelectItem>
                  {publishedPathways.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ACTION */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">THEN — Action</p>
            <Select value={form.actionType} onValueChange={(v) => setForm((p: any) => ({ ...p, actionType: v }))}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-action-type">
                <SelectValue placeholder="Select an action..." />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div>
                      <div className="font-medium">{o.label}</div>
                      <div className="text-xs text-muted-foreground">{o.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Action config */}
            {(form.actionType === "assign_pathway" || form.actionType === "award_badge") && (
              <Select value={form._actionPathwayId ?? ""} onValueChange={(v) => setForm((p: any) => ({ ...p, _actionPathwayId: v }))}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-action-pathway">
                  <SelectValue placeholder="Choose pathway..." />
                </SelectTrigger>
                <SelectContent>
                  {publishedPathways.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {form.actionType === "notify_coach" && (
              <Textarea
                placeholder="Notification message for coaches..."
                value={form._notifyMessage ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, _notifyMessage: e.target.value }))}
                className="text-xs min-h-[60px]"
              />
            )}
          </div>

          {/* Requires Approval toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/50">
            <div>
              <p className="text-sm font-medium">Requires Coach Approval</p>
              <p className="text-xs text-muted-foreground">Creates a recommendation; coach reviews before assigning</p>
            </div>
            <button
              onClick={() => setForm((p: any) => ({ ...p, requiresApproval: !p.requiresApproval }))}
              data-testid="toggle-requires-approval"
            >
              {form.requiresApproval
                ? <ToggleRight className="h-7 w-7 text-primary" />
                : <ToggleLeft className="h-7 w-7 text-muted-foreground" />}
            </button>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1 h-9 text-sm" onClick={handleSubmit}
              disabled={createMut.isPending} data-testid="button-save-rule">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Rule
            </Button>
            <Button variant="outline" className="h-9" onClick={() => { setShowForm(false); setForm(BLANK_RULE); }}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Rules List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Zap className="h-10 w-10 text-muted-foreground/20 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No rules yet</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Create your first rule to automatically assign pathways based on athlete behavior.
          </p>
          <Button size="sm" className="mt-2 gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />Create Rule
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule: any) => {
            const triggerLabel = TRIGGER_OPTIONS.find((o) => o.value === rule.triggerType)?.label ?? rule.triggerType;
            const actionLabel = ACTION_OPTIONS.find((o) => o.value === rule.actionType)?.label ?? rule.actionType;
            return (
              <Card key={rule.id} className={`p-4 transition-all ${!rule.isActive ? "opacity-50" : ""}`}
                data-testid={`card-rule-${rule.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm" data-testid={`text-rule-name-${rule.id}`}>{rule.name}</p>
                      {rule.isActive
                        ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs border">Active</Badge>
                        : <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-xs border">Paused</Badge>}
                      {rule.requiresApproval
                        ? <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs border">Approval Required</Badge>
                        : <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs border">Auto-Assign</Badge>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <Badge className={`border text-xs gap-1 flex items-center ${triggerColor(rule.triggerType)}`}>
                        {triggerIcon(rule.triggerType)}
                        IF: {triggerLabel}
                      </Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <Badge className={`border text-xs ${actionColor(rule.actionType)}`}>
                        THEN: {actionLabel}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                      onClick={() => toggleMut.mutate({ id: rule.id, isActive: !rule.isActive })}
                      disabled={toggleMut.isPending}
                      data-testid={`button-toggle-rule-${rule.id}`}
                      title={rule.isActive ? "Pause rule" : "Activate rule"}>
                      {rule.isActive
                        ? <ToggleRight className="h-4 w-4 text-primary" />
                        : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 hover:text-destructive"
                      onClick={() => deleteMut.mutate(rule.id)}
                      disabled={deleteMut.isPending}
                      data-testid={`button-delete-rule-${rule.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
