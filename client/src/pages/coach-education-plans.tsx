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
  CalendarDays, Plus, Trash2, Play, Pause, Loader2, ChevronDown,
  ChevronRight, Users, GraduationCap, BookOpen, CheckCircle, Circle,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function statusBadge(status: string) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return <Badge className={`text-xs border ${cls}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export default function CoachEducationPlansPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [showForm, setShowForm] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    assignedToType: "all_athletes",
    startDate: "",
    weeks: [] as { week: number; pathwayId: string; notes: string }[],
  });

  const { data: plansData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/education/plans", slug],
    queryFn: () => fetchJson("/api/org/education/plans", { headers }),
  });

  const { data: pathwaysData } = useQuery<any>({
    queryKey: ["/api/org/education/pathways", slug],
    queryFn: () => fetchJson("/api/org/education/pathways", { headers }),
  });

  const plans: any[] = plansData?.plans ?? [];
  const pathways: any[] = (pathwaysData?.pathways ?? []).filter((p: any) => p.status === "published");
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/org/education/plans", slug] });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/education/plans", data,  headers),
    onSuccess: () => { invalidate(); setShowForm(false); resetForm(); toast({ title: "Plan created!" }); },
    onError: () => toast({ title: "Error creating plan", variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/education/plans/${id}/activate`, {},  headers),
    onSuccess: (data: any) => {
      invalidate();
      toast({ title: "Plan activated", description: `${data?.assigned ?? 0} week-1 pathway(s) assigned` });
    },
    onError: () => toast({ title: "Error activating plan", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/org/education/plans/${id}`, data,  headers),
    onSuccess: () => { invalidate(); toast({ title: "Plan updated" }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/org/education/plans/${id}`, {},  headers),
    onSuccess: () => { invalidate(); setSelectedPlanId(null); toast({ title: "Plan deleted" }); },
  });

  function resetForm() {
    setForm({ name: "", description: "", assignedToType: "all_athletes", startDate: "", weeks: [] });
  }

  function addWeek() {
    const nextWeek = (form.weeks[form.weeks.length - 1]?.week ?? 0) + 1;
    setForm((p) => ({ ...p, weeks: [...p.weeks, { week: nextWeek, pathwayId: "", notes: "" }] }));
  }

  function updateWeek(i: number, key: string, value: string) {
    const weeks = [...form.weeks];
    weeks[i] = { ...weeks[i], [key]: value };
    setForm((p) => ({ ...p, weeks }));
  }

  function removeWeek(i: number) {
    const weeks = form.weeks.filter((_, j) => j !== i);
    // Renumber
    const renumbered = weeks.map((w, idx) => ({ ...w, week: idx + 1 }));
    setForm((p) => ({ ...p, weeks: renumbered }));
  }

  function handleSubmit() {
    if (!form.name) { toast({ title: "Plan name is required", variant: "destructive" }); return; }
    createMut.mutate({
      name: form.name,
      description: form.description,
      assignedToType: form.assignedToType,
      weeks: form.weeks,
      startDate: form.startDate || null,
    });
  }

  function pathwayTitle(id: string) {
    return pathways.find((p) => p.id === id)?.title ?? "Unknown Pathway";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <CalendarDays className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Assignment Plans</h1>
            <p className="text-sm text-muted-foreground">Build week-by-week learning curricula for your athletes</p>
          </div>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)} data-testid="button-new-plan">
          <Plus className="h-4 w-4" />New Plan
        </Button>
      </div>

      {/* New Plan Form */}
      {showForm && (
        <Card className="p-5 space-y-4 border-primary/30 bg-primary/[0.03]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">New Assignment Plan</p>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowForm(false); resetForm(); }}>✕</Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Plan name (e.g. Rookie Onboarding)" value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="h-9 text-sm" data-testid="input-plan-name" />
            <Input type="date" value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
              className="h-9 text-sm" />
          </div>

          <Textarea placeholder="Description (optional)" value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            className="text-sm min-h-[60px]" />

          <Select value={form.assignedToType} onValueChange={(v) => setForm((p) => ({ ...p, assignedToType: v }))}>
            <SelectTrigger className="h-9 text-sm" data-testid="select-assign-to">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_athletes">All Athletes</SelectItem>
              <SelectItem value="team">Specific Team</SelectItem>
              <SelectItem value="individual">Individual Athlete</SelectItem>
            </SelectContent>
          </Select>

          {/* Weekly schedule builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Weekly Schedule</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={addWeek} data-testid="button-add-week">
                <Plus className="h-3 w-3" />Add Week
              </Button>
            </div>

            {form.weeks.length === 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                Add weeks to build your curriculum
              </div>
            )}

            {form.weeks.map((w, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-border/60 bg-muted/10">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary">{w.week}</span>
                </div>
                <Select value={w.pathwayId} onValueChange={(v) => updateWeek(i, "pathwayId", v)}>
                  <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-week-pathway-${i}`}>
                    <SelectValue placeholder="Choose pathway..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(pathways as any[]).filter((p) => !!p.id && p.id.trim() !== "").map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Notes" value={w.notes}
                  onChange={(e) => updateWeek(i, "notes", e.target.value)}
                  className="h-8 text-xs w-28" />
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 flex-shrink-0"
                  onClick={() => removeWeek(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button className="flex-1 h-9 text-sm" onClick={handleSubmit} disabled={createMut.isPending} data-testid="button-save-plan">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Plan
            </Button>
            <Button variant="outline" className="h-9" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Plans List + Detail */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : plans.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <CalendarDays className="h-10 w-10 text-muted-foreground/20 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No plans yet</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Create a week-by-week curriculum to guide athletes through their education journey.
          </p>
          <Button size="sm" className="mt-2 gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />Create Plan
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Plan list */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />Plans ({plans.length})
            </p>
            {plans.map((plan: any) => (
              <button key={plan.id} onClick={() => setSelectedPlanId(plan.id === selectedPlanId ? null : plan.id)}
                data-testid={`card-plan-${plan.id}`}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  selectedPlanId === plan.id
                    ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                    : "border-border bg-card hover:border-primary/30"
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{plan.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {statusBadge(plan.status)}
                      <Badge className="text-xs border bg-muted/20 text-muted-foreground border-border">
                        {(plan.weeks as any[])?.length ?? 0} weeks
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground capitalize">{plan.assignedToType.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground/40 flex-shrink-0 transition-transform ${selectedPlanId === plan.id ? "rotate-90 text-primary" : ""}`} />
                </div>
              </button>
            ))}
          </div>

          {/* Plan detail */}
          <div className="lg:col-span-2">
            {selectedPlan ? (
              <Card className="p-5 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-base" data-testid="text-selected-plan-name">{selectedPlan.name}</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {statusBadge(selectedPlan.status)}
                      <Badge className="text-xs border bg-muted/20 text-muted-foreground border-border">
                        <Users className="h-3 w-3 mr-1" />
                        {selectedPlan.assignedToType.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {selectedPlan.description && (
                      <p className="text-sm text-muted-foreground mt-1">{selectedPlan.description}</p>
                    )}
                    {selectedPlan.startDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Started: {new Date(selectedPlan.startDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {selectedPlan.status === "draft" && (
                      <Button size="sm" className="h-8 text-xs gap-1.5"
                        onClick={() => activateMut.mutate(selectedPlan.id)}
                        disabled={activateMut.isPending}
                        data-testid="button-activate-plan">
                        {activateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Activate
                      </Button>
                    )}
                    {selectedPlan.status === "active" && (
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => updateMut.mutate({ id: selectedPlan.id, status: "paused" })}
                        disabled={updateMut.isPending}>
                        <Pause className="h-3.5 w-3.5" />Pause
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive/60 hover:text-destructive"
                      onClick={() => deleteMut.mutate(selectedPlan.id)}
                      disabled={deleteMut.isPending}
                      data-testid="button-delete-plan">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Weekly curriculum */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />Weekly Curriculum ({(selectedPlan.weeks as any[])?.length ?? 0} weeks)
                  </p>
                  <div className="space-y-2">
                    {((selectedPlan.weeks as any[]) ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No weeks scheduled.</p>
                    )}
                    {((selectedPlan.weeks as any[]) ?? []).map((w: any) => (
                      <div key={w.week} className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-card">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">W{w.week}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {w.pathwayId ? (
                            <p className="text-sm font-medium truncate">{pathwayTitle(w.pathwayId)}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No pathway selected</p>
                          )}
                          {w.notes && <p className="text-xs text-muted-foreground mt-0.5">{w.notes}</p>}
                        </div>
                        {w.pathwayId
                          ? <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                          : <Circle className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-12 text-center space-y-3">
                <CalendarDays className="h-8 w-8 text-muted-foreground/20 mx-auto" />
                <p className="text-sm text-muted-foreground">Select a plan to see its schedule</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
