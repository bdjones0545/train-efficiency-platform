import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Plus, Sparkles, ChevronLeft, ChevronRight, Eye, Pencil,
  CheckCircle, Circle, BarChart2, Users, Trophy, AlertTriangle,
  Loader2, Save, Trash2, Send, RefreshCw, GraduationCap,
  ClipboardList, Settings, Archive, Globe, Copy, Zap, CalendarDays,
  Youtube, Search, FileText,
} from "lucide-react";

const CATEGORIES = [
  { value: "nutrition", label: "Nutrition", color: "emerald" },
  { value: "recovery", label: "Recovery", color: "blue" },
  { value: "hydration", label: "Hydration", color: "cyan" },
  { value: "sleep", label: "Sleep", color: "violet" },
  { value: "mindset", label: "Mindset", color: "amber" },
  { value: "team_standards", label: "Team Standards", color: "rose" },
  { value: "injury_prevention", label: "Injury Prevention", color: "orange" },
  { value: "recruiting", label: "Recruiting Education", color: "pink" },
  { value: "custom", label: "Custom Topic", color: "slate" },
];

function statusBadge(status: string) {
  if (status === "published") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">Published</Badge>;
  if (status === "archived") return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-xs">Archived</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">Draft</Badge>;
}

function categoryColor(cat: string) {
  const c = CATEGORIES.find((c) => c.value === cat);
  return c?.color ?? "slate";
}

export default function CoachEducationBuilderPage() {
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
      page: "coach-education-builder",
      slug,
      hasAccess,
      isHydrating,
      orgTokenPresent: !!orgToken,
    });
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("pathways");
  const [selectedPathway, setSelectedPathway] = useState<any>(null);
  const [selectedModule, setSelectedModule] = useState<any>(null);
  const [editingModule, setEditingModule] = useState(false);
  const [moduleForm, setModuleForm] = useState<any>({ title: "", description: "", estimatedMinutes: 10, content: { sections: [] }, keyTakeaways: [], videoUrl: "", videoSearchQuery: "", performanceConnection: "", coachReinforcementNotes: [] });
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<any>(null);
  const [showCreatePathway, setShowCreatePathway] = useState(false);
  const [newPathway, setNewPathway] = useState({ title: "", category: "custom", description: "" });
  const [aiGenForm, setAiGenForm] = useState({ topic: "", ageGroup: "", sport: "", tone: "", numModules: 6, difficulty: "intermediate", goal: "" });
  const [fullProgramMode, setFullProgramMode] = useState(false);
  const [fullProgramForm, setFullProgramForm] = useState({ prompt: "", ageGroup: "", sport: "", numModules: 6, difficulty: "beginner", coachPhilosophy: "", teachingStyle: "", bannedTerms: "", emphasisAreas: "" });
  const [showPhilosophySettings, setShowPhilosophySettings] = useState(false);
  const [fullProgramDraft, setFullProgramDraft] = useState<any>(null);
  const [fullProgramLoading, setFullProgramLoading] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: pathwaysData, refetch: refetchPathways } = useQuery<any>({
    queryKey: ["/api/org/education/pathways", slug],
    queryFn: () => fetch("/api/org/education/pathways", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: canLoad,
  });
  const pathways: any[] = pathwaysData?.pathways ?? [];

  const { data: modulesData, refetch: refetchModules } = useQuery<any>({
    queryKey: ["/api/org/education/pathways/modules", selectedPathway?.slug],
    queryFn: () => fetch(`/api/org/education/pathways/${selectedPathway?.slug}/modules`, { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedPathway && canLoad,
  });
  const modules: any[] = modulesData?.modules ?? [];

  const { data: analyticsData } = useQuery<any>({
    queryKey: ["/api/org/education/analytics", slug],
    queryFn: () => fetch("/api/org/education/analytics", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "analytics" && canLoad,
  });

  const { data: assignmentsData } = useQuery<any>({
    queryKey: ["/api/org/education/assignments", slug],
    queryFn: () => fetch("/api/org/education/assignments", { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "assignments" && canLoad,
  });

  const { data: quizData } = useQuery<any>({
    queryKey: ["/api/org/education/modules/questions", selectedModule?.id],
    queryFn: () => fetch(`/api/org/education/modules/${selectedModule?.id}/questions`, { headers: buildHeaders(), credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedModule && canLoad,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createPathwayMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/education/pathways", data, buildHeaders()),
    onSuccess: () => { refetchPathways(); setShowCreatePathway(false); setNewPathway({ title: "", category: "custom", description: "" }); toast({ title: "Pathway created" }); },
    onError: () => toast({ title: "Error", description: "Failed to create pathway", variant: "destructive" }),
  });

  const updatePathwayMut = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/org/education/pathways/${id}`, data, buildHeaders()),
    onSuccess: () => { refetchPathways(); toast({ title: "Saved" }); },
  });

  const publishPathwayMut = useMutation({
    mutationFn: ({ id, action }: any) => apiRequest("POST", `/api/org/education/pathways/${id}/publish`, { action }, buildHeaders()),
    onSuccess: () => { refetchPathways(); toast({ title: "Status updated" }); },
  });

  const createModuleMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/education/modules", data, buildHeaders()),
    onSuccess: () => { refetchModules(); setEditingModule(false); toast({ title: "Module created" }); },
  });

  const updateModuleMut = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/org/education/modules/${id}`, data, buildHeaders()),
    onSuccess: () => { refetchModules(); setEditingModule(false); toast({ title: "Module saved" }); },
  });

  const saveQuizMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/education/quiz-questions", data, buildHeaders()),
    onSuccess: () => toast({ title: "Quiz saved" }),
  });

  const assignPathwayMut = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("POST", `/api/org/education/pathways/${id}/assign`, data, buildHeaders()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/org/education/assignments", slug] }); toast({ title: "Assigned!" }); },
  });

  const copyPathwayMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/org/education/pathways/${id}/copy`, {}, buildHeaders()).then(r => r.json()),
    onSuccess: (data: any) => {
      refetchPathways();
      toast({ title: "Pathway copied to your library", description: "You can now customize it for your organization." });
      setSelectedPathway(data.pathway);
      setActiveTab("builder");
    },
    onError: () => toast({ title: "Error copying pathway", variant: "destructive" }),
  });

  // ── AI Helpers ─────────────────────────────────────────────────────────────
  async function aiGenerateFullProgram() {
    if (!fullProgramForm.prompt.trim()) return;
    setFullProgramLoading(true);
    setFullProgramDraft(null);
    try {
      const r = await fetch("/api/org/education/ai/generate-full-pathway", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        credentials: "include",
        body: JSON.stringify(fullProgramForm),
      });
      const data = await r.json();
      if (data.result) setFullProgramDraft(data.result);
      else toast({ title: "AI Error", description: data.message ?? "Generation failed", variant: "destructive" });
    } catch { toast({ title: "AI Error", variant: "destructive" }); }
    setFullProgramLoading(false);
  }

  const acceptFullProgramMut = useMutation({
    mutationFn: (draft: any) => apiRequest("POST", "/api/org/education/ai/accept-full-pathway", { draft }, buildHeaders()).then(r => r.json()),
    onSuccess: (data: any) => {
      refetchPathways();
      setFullProgramDraft(null);
      setFullProgramMode(false);
      setFullProgramForm({ prompt: "", ageGroup: "", sport: "", numModules: 6, difficulty: "beginner", coachPhilosophy: "", teachingStyle: "", bannedTerms: "", emphasisAreas: "" });
      setShowPhilosophySettings(false);
      toast({ title: "Program created!", description: `${data.modulesCount} modules ready. Add YouTube links then publish.` });
      const pathway = data.pathway;
      if (pathway) { setSelectedPathway(pathway); setActiveTab("builder"); }
    },
    onError: () => toast({ title: "Error creating program", variant: "destructive" }),
  });

  async function aiGeneratePathway() {
    setAiLoading("pathway");
    try {
      const r = await fetch("/api/org/education/ai/generate-pathway", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        credentials: "include",
        body: JSON.stringify(aiGenForm),
      });
      const data = await r.json();
      setAiDraft(data.result);
    } catch { toast({ title: "AI Error", variant: "destructive" }); }
    setAiLoading(null);
  }

  async function aiGenerateModule() {
    if (!selectedModule && !moduleForm.title) return;
    setAiLoading("module");
    try {
      const r = await fetch("/api/org/education/ai/generate-module", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        credentials: "include",
        body: JSON.stringify({
          moduleTitle: moduleForm.title || selectedModule?.title,
          topic: moduleForm.title || selectedModule?.title,
          pathwayContext: selectedPathway?.title,
          pathwayId: selectedPathway?.id,
          moduleId: selectedModule?.id,
        }),
      });
      const data = await r.json();
      const r2 = data.result;
      // Normalize AI sections: AI returns `heading`, seed/save uses `title`
      const normalizedSections = (r2.sections ?? []).map((s: any) => ({
        title: s.title ?? s.heading ?? "",
        body: s.body ?? "",
      }));
      setModuleForm((prev: any) => ({
        ...prev,
        description: r2.description ?? prev.description,
        estimatedMinutes: r2.estimatedMinutes ?? prev.estimatedMinutes,
        content: { sections: normalizedSections },
        keyTakeaways: r2.keyTakeaways ?? [],
      }));
      toast({ title: "AI draft ready — review before saving", description: "Marked as AI draft. Coach review required." });
    } catch { toast({ title: "AI Error", variant: "destructive" }); }
    setAiLoading(null);
  }

  async function aiGenerateQuiz() {
    setAiLoading("quiz");
    try {
      const r = await fetch("/api/org/education/ai/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        credentials: "include",
        body: JSON.stringify({
          moduleTitle: selectedModule?.title ?? moduleForm.title,
          moduleContent: (selectedModule?.content?.sections ?? moduleForm.content?.sections ?? []).map((s: any) => s.body).join(" "),
          numQuestions: 4,
          pathwayId: selectedPathway?.id,
          moduleId: selectedModule?.id,
        }),
      });
      const data = await r.json();
      if (data.result?.questions) setQuizQuestions(data.result.questions);
      toast({ title: "Quiz draft ready — review before saving" });
    } catch { toast({ title: "AI Error", variant: "destructive" }); }
    setAiLoading(null);
  }

  async function aiRewrite(type: string, content: string) {
    setAiLoading("rewrite-" + type);
    try {
      const r = await fetch("/api/org/education/ai/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        credentials: "include",
        body: JSON.stringify({ content, rewriteType: type, pathwayId: selectedPathway?.id, moduleId: selectedModule?.id }),
      });
      const data = await r.json();
      return data.result?.rewritten ?? content;
    } catch { toast({ title: "AI Error", variant: "destructive" }); return content; }
    finally { setAiLoading(null); }
  }

  // ── Open module editor ─────────────────────────────────────────────────────
  function openModuleEditor(mod?: any) {
    if (mod) {
      setSelectedModule(mod);
      setModuleForm({
        title: mod.title,
        description: mod.description ?? "",
        estimatedMinutes: mod.estimatedMinutes ?? 10,
        content: mod.content ?? { sections: [] },
        keyTakeaways: mod.keyTakeaways ?? [],
        videoUrl: mod.videoUrl ?? "",
        videoSearchQuery: mod.videoSearchQuery ?? "",
        performanceConnection: mod.performanceConnection ?? "",
        coachReinforcementNotes: mod.coachReinforcementNotes ?? [],
      });
      setQuizQuestions(quizData?.questions ?? []);
    } else {
      setSelectedModule(null);
      setModuleForm({ title: "", description: "", estimatedMinutes: 10, content: { sections: [] }, keyTakeaways: [], videoUrl: "", videoSearchQuery: "", performanceConnection: "", coachReinforcementNotes: [] });
      setQuizQuestions([]);
    }
    setEditingModule(true);
  }

  function saveModule() {
    const payload = {
      pathwayId: selectedPathway?.id,
      title: moduleForm.title,
      description: moduleForm.description,
      estimatedMinutes: moduleForm.estimatedMinutes,
      content: moduleForm.content,
      keyTakeaways: moduleForm.keyTakeaways,
      videoUrl: moduleForm.videoUrl || null,
      videoSearchQuery: moduleForm.videoSearchQuery || null,
      performanceConnection: moduleForm.performanceConnection || null,
      coachReinforcementNotes: moduleForm.coachReinforcementNotes ?? [],
      status: "draft",
    };
    if (selectedModule) {
      updateModuleMut.mutate({ id: selectedModule.id, ...payload });
    } else {
      createModuleMut.mutate(payload);
    }
  }

  function saveQuiz() {
    saveQuizMut.mutate({
      moduleId: selectedModule?.id,
      pathwayId: selectedPathway?.id,
      questions: quizQuestions,
    });
  }

  // ── Accept AI Pathway Draft ────────────────────────────────────────────────
  async function acceptAiPathwayDraft() {
    if (!aiDraft) return;
    createPathwayMut.mutate({
      title: aiDraft.title,
      category: aiDraft.category ?? "custom",
      description: aiDraft.description ?? "",
    });
    setAiDraft(null);
  }

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
        <GraduationCap className="h-10 w-10 text-muted-foreground opacity-40" />
        <div className="text-center">
          <p className="font-semibold text-sm">Coach Access Required</p>
          <p className="text-xs text-muted-foreground mt-1">Sign in to manage your education library.</p>
        </div>
        <Button size="sm" onClick={() => setLocation(`/org/${slug}/portal`)}>
          Back to Portal
        </Button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setLocation(`/org/${slug}/portal`)} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <GraduationCap className="h-5 w-5 text-primary" />
        <h1 className="font-semibold text-sm">Education Builder</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-amber-400 hover:bg-amber-500/10"
            onClick={() => setLocation(`/org/${slug}/coach/education-rules`)}>
            <Zap className="h-3 w-3" />Rules
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-blue-400 hover:bg-blue-500/10"
            onClick={() => setLocation(`/org/${slug}/coach/education-plans`)}>
            <CalendarDays className="h-3 w-3" />Plans
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => setLocation(`/org/${slug}/coach/education-progress`)}>
            <BarChart2 className="h-3 w-3" />Progress
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-[calc(100vh-57px)]">
        <TabsList className="rounded-none border-b border-border/50 bg-card/30 justify-start px-4 h-10 gap-1 flex-shrink-0">
          <TabsTrigger value="pathways" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <BookOpen className="h-3 w-3 mr-1.5" />Pathways
          </TabsTrigger>
          <TabsTrigger value="builder" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <Settings className="h-3 w-3 mr-1.5" />Builder
          </TabsTrigger>
          <TabsTrigger value="assignments" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <ClipboardList className="h-3 w-3 mr-1.5" />Assignments
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded px-3 h-7">
            <BarChart2 className="h-3 w-3 mr-1.5" />Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── PATHWAYS TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="pathways" className="flex-1 overflow-auto p-4 space-y-4 mt-0">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{pathways.length} pathway{pathways.length !== 1 ? "s" : ""}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => { setFullProgramMode(true); setFullProgramDraft(null); setActiveTab("builder"); }}>
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />AI Generate
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowCreatePathway(true)}>
                <Plus className="h-3.5 w-3.5" />New Pathway
              </Button>
            </div>
          </div>

          {/* Create Pathway Form */}
          {showCreatePathway && (
            <Card className="p-4 border-primary/20 bg-primary/5 space-y-3">
              <p className="text-sm font-medium">New Pathway</p>
              <Input placeholder="Pathway title (e.g. Recovery Fundamentals)" value={newPathway.title}
                onChange={(e) => setNewPathway((p) => ({ ...p, title: e.target.value }))}
                className="h-9 text-sm" data-testid="input-pathway-title" />
              <Select value={newPathway.category} onValueChange={(v) => setNewPathway((p) => ({ ...p, category: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea placeholder="Short description (optional)" value={newPathway.description}
                onChange={(e) => setNewPathway((p) => ({ ...p, description: e.target.value }))}
                className="text-sm min-h-[60px]" />
              <div className="flex gap-2">
                <Button size="sm" className="h-8 text-xs" onClick={() => createPathwayMut.mutate(newPathway)}
                  disabled={createPathwayMut.isPending || !newPathway.title}>
                  {createPathwayMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowCreatePathway(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          {/* Pathway List */}
          <div className="space-y-2">
            {pathways.map((p: any) => (
              <Card key={p.id} className="p-4 hover:border-primary/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-medium">{p.title}</p>
                      {statusBadge(p.status)}
                      {p.isDefault && <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">Default</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{p.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.moduleCount ?? 0} modules</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {p.isDefault ? (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs px-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                        onClick={() => copyPathwayMut.mutate(p.id)}
                        disabled={copyPathwayMut.isPending}
                        title="Copy to My Library to customize"
                        data-testid={`button-copy-pathway-${p.id}`}>
                        {copyPathwayMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                        onClick={() => { setSelectedPathway(p); setActiveTab("builder"); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                      onClick={() => setLocation(`/org/${slug}/education/${p.slug}`)}>
                      <Eye className="h-3 w-3" />
                    </Button>
                    {!p.isDefault && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                        onClick={() => publishPathwayMut.mutate({ id: p.id, action: p.status === "published" ? "unpublish" : "publish" })}>
                        {p.status === "published" ? <Archive className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {pathways.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No pathways yet</p>
                <p className="text-xs mt-1">Create a pathway or use AI to generate one</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── BUILDER TAB ───────────────────────────────────────────────────── */}
        <TabsContent value="builder" className="flex-1 overflow-auto p-4 space-y-4 mt-0">

          {/* ── FULL PROGRAM AI GENERATOR ───────────────────────────────────── */}
          {fullProgramMode && !fullProgramDraft && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <p className="text-sm font-semibold text-amber-400">Full Program Generator</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setFullProgramMode(false)}>Cancel</Button>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Describe what you want to create. AI will generate all modules, content, quizzes, and a final test in one shot.</p>
                <Textarea
                  placeholder='e.g. "Create a 6 module nutrition program for high school football athletes focused on pre-game fueling"'
                  value={fullProgramForm.prompt}
                  onChange={(e) => {
                    const val = e.target.value;
                    const moduleMatch = val.match(/(\d+)\s*(?:module|modules|lesson|lessons)/i);
                    setFullProgramForm((p) => ({
                      ...p,
                      prompt: val,
                      ...(moduleMatch ? { numModules: Math.min(12, Math.max(2, parseInt(moduleMatch[1]))) } : {}),
                    }));
                  }}
                  className="text-sm min-h-[80px]"
                  data-testid="input-full-program-prompt"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Audience / age group</p>
                  <Input placeholder="e.g. high school athletes" value={fullProgramForm.ageGroup}
                    onChange={(e) => setFullProgramForm((p) => ({ ...p, ageGroup: e.target.value }))}
                    className="h-8 text-xs" data-testid="input-age-group" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Sport / team</p>
                  <Input placeholder="e.g. football" value={fullProgramForm.sport}
                    onChange={(e) => setFullProgramForm((p) => ({ ...p, sport: e.target.value }))}
                    className="h-8 text-xs" data-testid="input-sport" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Number of modules</p>
                  <Input placeholder="6" type="number" min={2} max={12} value={fullProgramForm.numModules}
                    onChange={(e) => setFullProgramForm((p) => ({ ...p, numModules: parseInt(e.target.value) || 6 }))}
                    className="h-8 text-xs" data-testid="input-num-modules" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Difficulty level</p>
                  <Select value={fullProgramForm.difficulty} onValueChange={(v) => setFullProgramForm((p) => ({ ...p, difficulty: v }))}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-difficulty"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Coach Philosophy Settings */}
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  onClick={() => setShowPhilosophySettings((v) => !v)}
                  data-testid="button-toggle-philosophy">
                  <ChevronRight className={`h-3 w-3 transition-transform ${showPhilosophySettings ? "rotate-90" : ""}`} />
                  Coach Philosophy Settings <span className="text-muted-foreground/50 ml-1">(optional — shapes AI voice &amp; content)</span>
                </button>
                {showPhilosophySettings && (
                  <div className="mt-3 space-y-2 pl-2 border-l border-border/40">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Coaching philosophy</p>
                      <Input
                        placeholder='e.g. "Emphasize recovery and long-term athletic development"'
                        value={fullProgramForm.coachPhilosophy}
                        onChange={(e) => setFullProgramForm((p) => ({ ...p, coachPhilosophy: e.target.value }))}
                        className="h-8 text-xs"
                        data-testid="input-coach-philosophy" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Teaching style</p>
                      <Input
                        placeholder='e.g. "Direct, practical — skip theory, focus on what athletes do"'
                        value={fullProgramForm.teachingStyle}
                        onChange={(e) => setFullProgramForm((p) => ({ ...p, teachingStyle: e.target.value }))}
                        className="h-8 text-xs"
                        data-testid="input-teaching-style" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Emphasis areas</p>
                      <Input
                        placeholder='e.g. "Movement quality, readiness, injury prevention"'
                        value={fullProgramForm.emphasisAreas}
                        onChange={(e) => setFullProgramForm((p) => ({ ...p, emphasisAreas: e.target.value }))}
                        className="h-8 text-xs"
                        data-testid="input-emphasis-areas" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Banned terminology</p>
                      <Input
                        placeholder='e.g. "bodybuilding, bulking, cutting, diet"'
                        value={fullProgramForm.bannedTerms}
                        onChange={(e) => setFullProgramForm((p) => ({ ...p, bannedTerms: e.target.value }))}
                        className="h-8 text-xs"
                        data-testid="input-banned-terms" />
                    </div>
                  </div>
                )}
              </div>

              <Button className="w-full h-10 text-sm gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                onClick={aiGenerateFullProgram}
                disabled={fullProgramLoading || !fullProgramForm.prompt.trim()}
                data-testid="button-generate-full-program">
                {fullProgramLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Generating full program — ~30 seconds</>
                ) : (
                  <><Sparkles className="h-4 w-4" />Generate Complete Program</>
                )}
              </Button>
              {fullProgramLoading && (
                <p className="text-xs text-center text-muted-foreground">Writing all modules, lessons, quizzes, and final test...</p>
              )}
            </Card>
          )}

          {/* ── FULL PROGRAM DRAFT PREVIEW ──────────────────────────────────── */}
          {fullProgramDraft && (
            <div className="space-y-3">
              <Card className="p-4 border-emerald-500/20 bg-emerald-500/5 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-400">Program Draft Ready</p>
                </div>
                <div>
                  <p className="text-sm font-bold">{fullProgramDraft.pathway?.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{fullProgramDraft.pathway?.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{fullProgramDraft.modules?.length ?? 0} modules</span>
                    <span>{fullProgramDraft.modules?.reduce((n: number, m: any) => n + (m.quiz?.length ?? 0), 0)} module quiz questions</span>
                    <span>{fullProgramDraft.finalTest?.length ?? 0} final test questions</span>
                  </div>
                </div>
              </Card>

              {(fullProgramDraft.modules ?? []).map((m: any, i: number) => (
                <Card key={i} className="p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5">{m.moduleNumber}.</span>
                    <p className="text-sm font-medium flex-1">{m.title}</p>
                    <span className="text-xs text-muted-foreground">{m.estimatedMinutes} min</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-7">{m.description}</p>
                  <div className="ml-7 flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <FileText className="h-3 w-3" />
                      <span>{m.sections?.length ?? 0} sections</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle className="h-3 w-3" />
                      <span>{m.quiz?.length ?? 0} quiz questions</span>
                    </div>
                    {m.videoSearchQuery && (
                      <div className="flex items-center gap-1 text-amber-400/70">
                        <Youtube className="h-3 w-3" />
                        <span className="truncate max-w-[120px]">{m.videoSearchQuery}</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}

              {(fullProgramDraft.finalTest?.length ?? 0) > 0 && (
                <Card className="p-3 border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Final Test</p>
                    <span className="text-xs text-muted-foreground ml-auto">{fullProgramDraft.finalTest.length} questions</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Comprehensive assessment covering all modules. Athletes must pass to earn their badge.</p>
                </Card>
              )}

              <div className="flex gap-2 pt-1">
                <Button className="flex-1 h-10 text-sm gap-1.5"
                  onClick={() => acceptFullProgramMut.mutate(fullProgramDraft)}
                  disabled={acceptFullProgramMut.isPending}
                  data-testid="button-accept-full-program">
                  {acceptFullProgramMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Create Program
                </Button>
                <Button variant="outline" className="h-10 text-sm gap-1.5"
                  onClick={() => { setFullProgramDraft(null); }}
                  disabled={acceptFullProgramMut.isPending}>
                  <RefreshCw className="h-4 w-4" />Regenerate
                </Button>
                <Button variant="ghost" className="h-10 text-sm text-muted-foreground"
                  onClick={() => { setFullProgramDraft(null); setFullProgramMode(false); }}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          {/* AI Generate Pathway (outline only mode) */}
          {!selectedPathway && !fullProgramMode && !fullProgramDraft && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <p className="text-sm font-medium">AI Generate Outline Only</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Topic (e.g. Recovery)" value={aiGenForm.topic}
                  onChange={(e) => setAiGenForm((p) => ({ ...p, topic: e.target.value }))}
                  className="h-8 text-xs col-span-2" data-testid="input-ai-topic" />
                <Input placeholder="Age group (e.g. HS athletes)" value={aiGenForm.ageGroup}
                  onChange={(e) => setAiGenForm((p) => ({ ...p, ageGroup: e.target.value }))}
                  className="h-8 text-xs" />
                <Input placeholder="Sport / team" value={aiGenForm.sport}
                  onChange={(e) => setAiGenForm((p) => ({ ...p, sport: e.target.value }))}
                  className="h-8 text-xs" />
                <Input placeholder="Goal" value={aiGenForm.goal}
                  onChange={(e) => setAiGenForm((p) => ({ ...p, goal: e.target.value }))}
                  className="h-8 text-xs" />
                <Input placeholder="# of modules" type="number" value={aiGenForm.numModules}
                  onChange={(e) => setAiGenForm((p) => ({ ...p, numModules: parseInt(e.target.value) || 6 }))}
                  className="h-8 text-xs" />
              </div>
              <Button size="sm" className="h-8 text-xs w-full gap-1.5 bg-amber-500 hover:bg-amber-600 text-black"
                onClick={aiGeneratePathway} disabled={aiLoading === "pathway" || !aiGenForm.topic}>
                {aiLoading === "pathway" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate Pathway Outline
              </Button>
            </Card>
          )}

          {/* AI Draft Result */}
          {aiDraft && !fullProgramMode && (
            <Card className="p-4 border-amber-500/20 bg-amber-500/5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <p className="text-sm font-medium text-amber-400">AI Draft — Coach Review Required</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{aiDraft.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{aiDraft.description}</p>
              </div>
              <div className="space-y-1">
                {(aiDraft.modules ?? []).map((m: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-muted-foreground w-4 flex-shrink-0">{m.moduleNumber}.</span>
                    <div>
                      <p className="font-medium">{m.title}</p>
                      <p className="text-muted-foreground">{m.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-8 text-xs flex-1 gap-1.5" onClick={acceptAiPathwayDraft}>
                  <CheckCircle className="h-3.5 w-3.5" />Accept & Create
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAiDraft(null)}>Discard</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={aiGeneratePathway}
                  disabled={aiLoading === "pathway"}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </Card>
          )}

          {/* Pathway Selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Select pathway to edit</p>
            <Select value={selectedPathway?.id ?? ""} onValueChange={(v) => {
              const p = pathways.find((p: any) => p.id === v);
              setSelectedPathway(p ?? null);
              setSelectedModule(null);
              setEditingModule(false);
            }}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Choose a pathway..." /></SelectTrigger>
              <SelectContent>
                {pathways.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {selectedPathway && !editingModule && (
            <div className="space-y-3">
              {/* Pathway Meta Edit */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Pathway Settings</p>
                  {statusBadge(selectedPathway.status)}
                </div>
                <Input defaultValue={selectedPathway.title}
                  onBlur={(e) => updatePathwayMut.mutate({ id: selectedPathway.id, title: e.target.value })}
                  className="h-9 text-sm" placeholder="Pathway title" />
                <Textarea defaultValue={selectedPathway.description ?? ""}
                  onBlur={(e) => updatePathwayMut.mutate({ id: selectedPathway.id, description: e.target.value })}
                  className="text-sm min-h-[60px]" placeholder="Description" />
                {!selectedPathway.isDefault && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-8 text-xs flex-1"
                      onClick={() => publishPathwayMut.mutate({ id: selectedPathway.id, action: selectedPathway.status === "published" ? "unpublish" : "publish" })}>
                      {selectedPathway.status === "published" ? <><Archive className="h-3 w-3 mr-1.5" />Unpublish</> : <><Globe className="h-3 w-3 mr-1.5" />Publish</>}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs"
                      onClick={() => setLocation(`/org/${slug}/education/${selectedPathway.slug}`)}>
                      <Eye className="h-3 w-3 mr-1.5" />Preview
                    </Button>
                  </div>
                )}
              </Card>

              {/* Modules List */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Modules ({modules.length})</p>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => openModuleEditor()}>
                  <Plus className="h-3 w-3" />Add Module
                </Button>
              </div>

              <div className="space-y-2">
                {modules.map((m: any, i: number) => (
                  <Card key={m.id} className="p-3 hover:border-primary/20 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-xs text-muted-foreground w-5 flex-shrink-0">{m.moduleNumber}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.title}</p>
                          <p className="text-xs text-muted-foreground">{m.estimatedMinutes ?? 10} min · {m.quizCount ?? 0} questions</p>
                        </div>
                        {m.status === "published"
                          ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs flex-shrink-0">Live</Badge>
                          : <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs flex-shrink-0">Draft</Badge>}
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => openModuleEditor(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Card>
                ))}
                {modules.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Circle className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No modules yet — add one to get started</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Module Editor ─────────────────────────────────────────────── */}
          {editingModule && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingModule(false)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <p className="text-sm font-semibold">{selectedModule ? "Edit Module" : "New Module"}</p>
              </div>

              {/* AI Draft Notice */}
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Sparkles className="h-3 w-3 flex-shrink-0" />
                <span>AI-generated content requires coach review before publishing.</span>
              </div>

              <Card className="p-4 space-y-3">
                <div className="flex gap-2">
                  <Input placeholder="Module title" value={moduleForm.title}
                    onChange={(e) => setModuleForm((p: any) => ({ ...p, title: e.target.value }))}
                    className="h-9 text-sm flex-1" data-testid="input-module-title" />
                  <Input type="number" placeholder="Min" value={moduleForm.estimatedMinutes}
                    onChange={(e) => setModuleForm((p: any) => ({ ...p, estimatedMinutes: parseInt(e.target.value) || 10 }))}
                    className="h-9 text-sm w-20" />
                </div>
                <Textarea placeholder="Short description" value={moduleForm.description}
                  onChange={(e) => setModuleForm((p: any) => ({ ...p, description: e.target.value }))}
                  className="text-sm min-h-[60px]" />

                {/* AI Generate Button */}
                <Button size="sm" variant="outline" className="h-8 text-xs w-full gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={aiGenerateModule} disabled={aiLoading === "module" || !moduleForm.title}>
                  {aiLoading === "module" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  AI Generate Module Content
                </Button>
              </Card>

              {/* Video Section */}
              <Card className="p-4 space-y-3 border-rose-500/10">
                <div className="flex items-center gap-2">
                  <Youtube className="h-4 w-4 text-rose-400" />
                  <p className="text-sm font-medium">YouTube Video</p>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                {moduleForm.videoSearchQuery && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <Search className="h-3 w-3 text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-400 font-medium">AI-suggested search</p>
                      <p className="text-xs text-muted-foreground truncate">{moduleForm.videoSearchQuery}</p>
                    </div>
                    <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(moduleForm.videoSearchQuery)}`}
                      target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-400 hover:bg-amber-500/10 flex-shrink-0">
                        Search
                      </Button>
                    </a>
                  </div>
                )}
                <Input
                  placeholder="Paste YouTube URL (e.g. https://youtube.com/watch?v=...)"
                  value={moduleForm.videoUrl}
                  onChange={(e) => setModuleForm((p: any) => ({ ...p, videoUrl: e.target.value }))}
                  className="h-9 text-sm"
                  data-testid="input-module-video-url"
                />
                {moduleForm.videoUrl && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle className="h-3 w-3" />Video link saved — athletes will see an embedded player
                  </p>
                )}
              </Card>

              {/* Sections Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Lesson Sections</p>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setModuleForm((p: any) => ({
                    ...p, content: { ...p.content, sections: [...(p.content.sections ?? []), { title: "", body: "" }] }
                  }))}>
                    <Plus className="h-3 w-3" />Add
                  </Button>
                </div>
                {(moduleForm.content?.sections ?? []).map((s: any, i: number) => (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex gap-2">
                      <Input placeholder="Section title" value={s.title ?? s.heading ?? ""}
                        onChange={(e) => {
                          const sections = [...(moduleForm.content?.sections ?? [])];
                          sections[i] = { ...sections[i], title: e.target.value, heading: undefined };
                          setModuleForm((p: any) => ({ ...p, content: { ...p.content, sections } }));
                        }}
                        className="h-8 text-xs flex-1" />
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 hover:text-destructive flex-shrink-0"
                        onClick={() => {
                          const sections = (moduleForm.content?.sections ?? []).filter((_: any, j: number) => j !== i);
                          setModuleForm((p: any) => ({ ...p, content: { ...p.content, sections } }));
                        }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Textarea placeholder="Section body..." value={s.body}
                      onChange={(e) => {
                        const sections = [...(moduleForm.content?.sections ?? [])];
                        sections[i] = { ...sections[i], body: e.target.value };
                        setModuleForm((p: any) => ({ ...p, content: { ...p.content, sections } }));
                      }}
                      className="text-xs min-h-[80px]" />
                    {/* Rewrite Tools */}
                    <div className="flex gap-1.5 flex-wrap">
                      {[["simpler", "Simpler"], ["athlete_friendly", "Athlete-Friendly"], ["shorter", "Shorter"], ["add_examples", "+ Examples"]].map(([type, label]) => (
                        <Button key={type} size="sm" variant="ghost"
                          className="h-6 text-xs px-2 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                          disabled={aiLoading === "rewrite-" + type}
                          onClick={async () => {
                            const rewritten = await aiRewrite(type, s.body);
                            const sections = [...(moduleForm.content?.sections ?? [])];
                            sections[i] = { ...sections[i], body: rewritten };
                            setModuleForm((p: any) => ({ ...p, content: { ...p.content, sections } }));
                          }}>
                          {aiLoading === "rewrite-" + type ? <Loader2 className="h-3 w-3 animate-spin" /> : label}
                        </Button>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Key Takeaways */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Key Takeaways</p>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                    onClick={() => setModuleForm((p: any) => ({ ...p, keyTakeaways: [...(p.keyTakeaways ?? []), ""] }))}>
                    <Plus className="h-3 w-3" />Add
                  </Button>
                </div>
                {(moduleForm.keyTakeaways ?? []).map((t: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <Input value={t} placeholder={`Takeaway ${i + 1}`}
                      onChange={(e) => {
                        const kts = [...(moduleForm.keyTakeaways ?? [])];
                        kts[i] = e.target.value;
                        setModuleForm((p: any) => ({ ...p, keyTakeaways: kts }));
                      }}
                      className="h-8 text-xs" />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 flex-shrink-0"
                      onClick={() => setModuleForm((p: any) => ({ ...p, keyTakeaways: (p.keyTakeaways ?? []).filter((_: any, j: number) => j !== i) }))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Performance Connection */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Why This Matters for Performance</p>
                <Textarea
                  placeholder="2-3 sentences connecting this module to specific performance outcomes (e.g. speed, recovery, focus, injury risk). Athletes see this."
                  value={moduleForm.performanceConnection ?? ""}
                  onChange={(e) => setModuleForm((p: any) => ({ ...p, performanceConnection: e.target.value }))}
                  className="text-xs min-h-[70px]"
                  data-testid="input-performance-connection"
                />
              </div>

              {/* Coach Reinforcement Notes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Coach Reinforcement Notes</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">Coach-facing only — not visible to athletes</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                    onClick={() => setModuleForm((p: any) => ({ ...p, coachReinforcementNotes: [...(p.coachReinforcementNotes ?? []), ""] }))}>
                    <Plus className="h-3 w-3" />Add
                  </Button>
                </div>
                {(moduleForm.coachReinforcementNotes ?? []).map((note: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <Input value={note} placeholder={i === 0 ? "Discussion question to ask athletes..." : i === 1 ? "Observable behavior to watch for..." : "Reinforcement drill or idea..."}
                      onChange={(e) => {
                        const notes = [...(moduleForm.coachReinforcementNotes ?? [])];
                        notes[i] = e.target.value;
                        setModuleForm((p: any) => ({ ...p, coachReinforcementNotes: notes }));
                      }}
                      className="h-8 text-xs" />
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 flex-shrink-0"
                      onClick={() => setModuleForm((p: any) => ({ ...p, coachReinforcementNotes: (p.coachReinforcementNotes ?? []).filter((_: any, j: number) => j !== i) }))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(moduleForm.coachReinforcementNotes ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/50 italic pl-1">No notes yet — AI will generate these automatically when you use the Full Program Generator</p>
                )}
              </div>

              {/* Quiz Builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Quiz Questions</p>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                      onClick={aiGenerateQuiz} disabled={aiLoading === "quiz"}>
                      {aiLoading === "quiz" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI Quiz
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                      onClick={() => setQuizQuestions((q) => [...q, { question: "", options: ["", "", "", ""], correctAnswer: 0, explanation: "" }])}>
                      <Plus className="h-3 w-3" />Add
                    </Button>
                  </div>
                </div>
                {quizQuestions.map((q: any, qi: number) => (
                  <Card key={qi} className="p-3 space-y-2">
                    <div className="flex gap-2">
                      <Input value={q.question} placeholder="Question text"
                        onChange={(e) => { const qs = [...quizQuestions]; qs[qi] = { ...qs[qi], question: e.target.value }; setQuizQuestions(qs); }}
                        className="h-8 text-xs flex-1" />
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive/60 flex-shrink-0"
                        onClick={() => setQuizQuestions(quizQuestions.filter((_, j) => j !== qi))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {(q.options ?? []).map((opt: string, oi: number) => (
                      <div key={oi} className="flex items-center gap-2">
                        <button onClick={() => { const qs = [...quizQuestions]; qs[qi] = { ...qs[qi], correctAnswer: oi }; setQuizQuestions(qs); }}
                          className={`h-4 w-4 rounded-full border flex-shrink-0 transition-colors ${q.correctAnswer === oi ? "bg-emerald-400 border-emerald-400" : "border-border"}`} />
                        <Input value={opt} placeholder={`Option ${oi + 1}`}
                          onChange={(e) => {
                            const qs = [...quizQuestions]; const opts = [...(qs[qi].options ?? [])];
                            opts[oi] = e.target.value; qs[qi] = { ...qs[qi], options: opts }; setQuizQuestions(qs);
                          }}
                          className="h-7 text-xs" />
                      </div>
                    ))}
                    <Textarea value={q.explanation} placeholder="Explanation (shown after quiz)"
                      onChange={(e) => { const qs = [...quizQuestions]; qs[qi] = { ...qs[qi], explanation: e.target.value }; setQuizQuestions(qs); }}
                      className="text-xs min-h-[50px]" />
                  </Card>
                ))}
                {selectedModule && quizQuestions.length > 0 && (
                  <Button size="sm" variant="outline" className="h-8 text-xs w-full gap-1.5"
                    onClick={saveQuiz} disabled={saveQuizMut.isPending}>
                    {saveQuizMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save Quiz
                  </Button>
                )}
              </div>

              {/* Save + Publish */}
              <div className="flex gap-2 pb-8">
                <Button className="flex-1 h-9 text-sm gap-1.5" onClick={saveModule}
                  disabled={createModuleMut.isPending || updateModuleMut.isPending || !moduleForm.title}>
                  {(createModuleMut.isPending || updateModuleMut.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Draft
                </Button>
                <Button variant="outline" className="h-9 text-sm gap-1.5 flex-1"
                  onClick={() => {
                    const payload = { pathwayId: selectedPathway?.id, ...moduleForm, status: "published" };
                    if (selectedModule) updateModuleMut.mutate({ id: selectedModule.id, ...payload });
                    else createModuleMut.mutate(payload);
                  }}
                  disabled={!moduleForm.title}>
                  <Globe className="h-4 w-4" />Publish
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── ASSIGNMENTS TAB ───────────────────────────────────────────────── */}
        <TabsContent value="assignments" className="flex-1 overflow-auto p-4 space-y-4 mt-0">
          <div>
            <p className="text-xs text-muted-foreground mb-3">Assign a published pathway to your team or individual athletes.</p>
            <Card className="p-4 space-y-3">
              <p className="text-sm font-medium">Quick Assign</p>
              <Select onValueChange={(v) => setSelectedPathway(pathways.find((p: any) => p.id === v) ?? null)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select pathway..." /></SelectTrigger>
                <SelectContent>
                  {pathways.filter((p: any) => p.status === "published").map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 h-8 text-xs gap-1.5"
                  onClick={() => selectedPathway && assignPathwayMut.mutate({ id: selectedPathway.id, assignedToType: "all_athletes" })}
                  disabled={!selectedPathway || assignPathwayMut.isPending}>
                  {assignPathwayMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  Assign to All Athletes
                </Button>
              </div>
            </Card>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recent Assignments</p>
            {(assignmentsData?.assignments ?? []).map((a: any) => (
              <Card key={a.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{pathways.find((p: any) => p.id === a.pathwayId)?.title ?? a.pathwayId}</p>
                    <p className="text-xs text-muted-foreground capitalize">{a.assignedToType.replace(/_/g, " ")}</p>
                  </div>
                  {a.dueDate && <p className="text-xs text-muted-foreground">Due {new Date(a.dueDate).toLocaleDateString()}</p>}
                </div>
              </Card>
            ))}
            {(assignmentsData?.assignments ?? []).length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <ClipboardList className="h-6 w-6 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No assignments yet</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── ANALYTICS TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="flex-1 overflow-auto p-4 space-y-4 mt-0">
          {!analyticsData && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {analyticsData && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">Total Athletes</p>
                  <p className="text-2xl font-bold mt-1">{analyticsData.totalAthletes}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-xs text-muted-foreground">Active Pathways</p>
                  <p className="text-2xl font-bold mt-1">{(analyticsData.pathwayStats ?? []).filter((s: any) => s.pathway.status === "published").length}</p>
                </Card>
              </div>

              <div className="space-y-3">
                {(analyticsData.pathwayStats ?? []).map((stat: any) => (
                  <Card key={stat.pathway.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{stat.pathway.title}</p>
                        <p className="text-xs text-muted-foreground">{stat.moduleCount} modules</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{stat.completionRate}%</p>
                        <p className="text-xs text-muted-foreground">completion</p>
                      </div>
                    </div>
                    <div className="w-full bg-muted/30 rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${stat.completionRate}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-sm font-semibold text-emerald-400">{stat.pathwayCompleted}</p>
                        <p className="text-xs text-muted-foreground">Completed</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-amber-400">{stat.inProgress}</p>
                        <p className="text-xs text-muted-foreground">In Progress</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{stat.avgScore ?? "—"}%</p>
                        <p className="text-xs text-muted-foreground">Avg Score</p>
                      </div>
                    </div>
                    {/* Per-module breakdown */}
                    <div className="space-y-1.5 pt-1 border-t border-border/30">
                      {stat.moduleStats.map((ms: any) => (
                        <div key={ms.module.id} className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground w-20 truncate flex-shrink-0">{ms.module.title}</span>
                          <div className="flex-1 bg-muted/30 rounded-full h-1">
                            <div className="bg-primary/60 h-1 rounded-full" style={{ width: `${stat.totalAthletes > 0 ? Math.round((ms.completed / stat.totalAthletes) * 100) : 0}%` }} />
                          </div>
                          <span className="text-muted-foreground w-8 text-right">{ms.completed}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
                {(analyticsData.pathwayStats ?? []).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <BarChart2 className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No analytics yet</p>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
