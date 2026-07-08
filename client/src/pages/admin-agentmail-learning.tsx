import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Brain, BookOpen, Lightbulb, CheckCircle2, XCircle, RefreshCw,
  Trash2, Edit3, Plus, ToggleLeft, ToggleRight, Search, Eye,
  TrendingUp, Users, Zap, Filter, ChevronDown, Save, X,
  MessageSquare, Award, Target,
} from "lucide-react";
import { Link } from "wouter";

// ─── Domain / type configuration ─────────────────────────────────────────────

const DOMAINS = [
  { value: "general", label: "General (All Domains)" },
  { value: "athlete_lead", label: "Athlete Leads" },
  { value: "parent_lead", label: "Parent Leads" },
  { value: "evaluation_scheduling", label: "Evaluation Scheduling" },
  { value: "onboarding", label: "Onboarding" },
  { value: "retention", label: "Retention" },
  { value: "payment_recovery", label: "Payment Recovery" },
  { value: "program_assignment", label: "Program Assignment" },
  { value: "win_back", label: "Win Back" },
  { value: "team_training", label: "Team Training" },
  { value: "school_partnership", label: "School Partnerships" },
];

const RULE_TYPES = [
  { value: "instruction", label: "Instruction" },
  { value: "do", label: "Do" },
  { value: "avoid", label: "Avoid" },
  { value: "tone", label: "Tone" },
  { value: "cta", label: "CTA" },
  { value: "length", label: "Length" },
  { value: "personalization", label: "Personalization" },
  { value: "formatting", label: "Formatting" },
];

const DOMAIN_BADGE: Record<string, string> = {
  athlete_lead: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  parent_lead: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
  evaluation_scheduling: "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300",
  onboarding: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  retention: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  payment_recovery: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  program_assignment: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
  win_back: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
  team_training: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300",
  school_partnership: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
};

const RULE_TYPE_BADGE: Record<string, string> = {
  do: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 border border-green-200",
  avoid: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 border border-red-200",
  tone: "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400 border border-purple-200",
  cta: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200",
  length: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400 border border-yellow-200",
  personalization: "bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 border border-teal-200",
  formatting: "bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200",
  instruction: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-200",
};

function domainLabel(d: string) {
  return DOMAINS.find((x) => x.value === d)?.label ?? d;
}

function ruleTypeLabel(t: string) {
  return RULE_TYPES.find((x) => x.value === t)?.label ?? t;
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: summary, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-learning/summary"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cards = [
    { label: "Active Rules", value: summary?.totalActiveRules ?? 0, icon: CheckCircle2, color: "text-green-600" },
    { label: "Standing Instructions", value: summary?.standingInstructions ?? 0, icon: BookOpen, color: "text-blue-600" },
    { label: "Learned Rules", value: summary?.learnedRules ?? 0, icon: Brain, color: "text-purple-600" },
    { label: "Disabled Rules", value: summary?.disabledRules ?? 0, icon: XCircle, color: "text-gray-500" },
    { label: "Domains with Rules", value: summary?.domainsWithRules ?? 0, icon: Target, color: "text-teal-600" },
    { label: "Total Feedback Records", value: summary?.totalFeedbackRecords ?? 0, icon: MessageSquare, color: "text-orange-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={`w-4 h-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className="text-2xl font-bold" data-testid={`card-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>{c.value}</p>
          </Card>
        ))}
      </div>

      {(summary?.mostCorrectedDomain || summary?.mostCommonFeedbackTag) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {summary?.mostCorrectedDomain && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Most Corrected Domain
              </p>
              <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${DOMAIN_BADGE[summary.mostCorrectedDomain] ?? DOMAIN_BADGE.general}`}>
                {domainLabel(summary.mostCorrectedDomain)}
              </span>
            </Card>
          )}
          {summary?.mostCommonFeedbackTag && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Award className="w-3 h-3" /> Most Common Feedback
              </p>
              <p className="text-sm font-semibold">{summary.mostCommonFeedbackTag}</p>
            </Card>
          )}
        </div>
      )}

      {summary?.domainBreakdown && Object.keys(summary.domainBreakdown).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Filter className="w-4 h-4" /> Rules by Domain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.domainBreakdown as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .map(([d, count]) => (
                  <div key={d} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${DOMAIN_BADGE[d] ?? DOMAIN_BADGE.general}`}>
                    {domainLabel(d)}
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-blue-800 dark:text-blue-300 font-medium mb-1 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4" /> How AgentMail Learning Works
          </p>
          <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1 leading-relaxed list-disc list-inside">
            <li>When you reject, edit, or regenerate a draft, AgentMail extracts rules from your feedback.</li>
            <li>Learned rules are injected into future drafts for that domain automatically.</li>
            <li>Standing Instructions (added here) are injected first — they have highest priority.</li>
            <li>Inactive rules are never used in generation.</li>
            <li>You can always edit or disable any rule.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Learned Rules Tab ────────────────────────────────────────────────────────

function LearnedRulesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [domainFilter, setDomainFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const { data: rules = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/agentmail-learning/rules"],
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/admin/agentmail-learning/rules/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/summary"] });
      toast({ title: "Rule updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ruleText }: { id: string; ruleText: string }) =>
      apiRequest("PATCH", `/api/admin/agentmail-learning/rules/${id}`, { ruleText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/rules"] });
      setEditingId(null);
      toast({ title: "Rule text updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/agentmail-learning/rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/summary"] });
      toast({ title: "Rule archived" });
    },
    onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
  });

  const filtered = rules.filter((r) => {
    if (domainFilter !== "all" && r.communicationDomain !== domainFilter) return false;
    if (typeFilter !== "all" && r.ruleType !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (searchQuery && !r.ruleText.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search rules…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-48"
            data-testid="input-search-rules"
          />
        </div>
        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger className="h-8 text-xs w-40" data-testid="select-domain-filter">
            <SelectValue placeholder="Domain" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Domains</SelectItem>
            {DOMAINS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 text-xs w-36" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {RULE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-32" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} rule{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No learned rules yet.</p>
          <p className="text-xs mt-1">Rules are extracted automatically when you reject, edit, or regenerate AI drafts.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rule) => {
            const isActive = rule.status === "active";
            const isEditing = editingId === rule.id;
            return (
              <Card key={rule.id} className={`p-4 ${!isActive ? "opacity-60" : ""}`} data-testid={`card-rule-${rule.id}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="text-sm min-h-[60px]"
                          data-testid={`textarea-edit-rule-${rule.id}`}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => editMutation.mutate({ id: rule.id, ruleText: editText })} disabled={editMutation.isPending}>
                            {editMutation.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{rule.ruleText}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[rule.communicationDomain] ?? DOMAIN_BADGE.general}`}>
                        {domainLabel(rule.communicationDomain ?? "athlete_lead")}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RULE_TYPE_BADGE[rule.ruleType] ?? RULE_TYPE_BADGE.instruction}`}>
                        {ruleTypeLabel(rule.ruleType)}
                      </span>
                      {rule.confidence && (
                        <span className="text-xs text-muted-foreground">
                          Confidence: <span className="font-semibold">{Math.round(Number(rule.confidence) * 100)}%</span>
                        </span>
                      )}
                      {rule.timesApplied > 0 && (
                        <span className="text-xs text-muted-foreground">Applied: {rule.timesApplied}×</span>
                      )}
                      {rule.createdAt && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(rule.createdAt).toLocaleDateString()}
                        </span>
                      )}
                      {!isActive && (
                        <Badge variant="outline" className="text-xs">{rule.status}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      onClick={() => { setEditingId(rule.id); setEditText(rule.ruleText); }}
                      title="Edit rule text"
                      data-testid={`button-edit-rule-${rule.id}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-muted"
                      onClick={() => toggleMutation.mutate({ id: rule.id, status: isActive ? "superseded" : "active" })}
                      title={isActive ? "Deactivate rule" : "Activate rule"}
                      data-testid={`button-toggle-rule-${rule.id}`}
                    >
                      {isActive
                        ? <ToggleRight className="w-4 h-4 text-green-600" />
                        : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600"
                      onClick={() => { if (confirm("Archive this rule?")) deleteMutation.mutate(rule.id); }}
                      title="Archive rule"
                      data-testid={`button-delete-rule-${rule.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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

// ─── Standing Instructions Tab ────────────────────────────────────────────────

function StandingInstructionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newDomain, setNewDomain] = useState("general");
  const [newType, setNewType] = useState("instruction");
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");

  const { data: instructions = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/agentmail-learning/instructions"],
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/agentmail-learning/instructions", {
      communicationDomain: newDomain,
      ruleType: newType,
      ruleText: newText,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/summary"] });
      setNewText(""); setNewDomain("general"); setNewType("instruction"); setShowForm(false);
      toast({ title: "Instruction added", description: "Will be injected into new drafts immediately." });
    },
    onError: (e: any) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ruleText }: { id: string; ruleText: string }) =>
      apiRequest("PATCH", `/api/admin/agentmail-learning/instructions/${id}`, { ruleText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/instructions"] });
      setEditingId(null);
      toast({ title: "Instruction updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/agentmail-learning/instructions/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/summary"] });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/agentmail-learning/instructions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agentmail-learning/summary"] });
      toast({ title: "Instruction removed" });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  const filtered = domainFilter === "all" ? instructions : instructions.filter((i) => i.communicationDomain === domainFilter);

  if (isLoading) {
    return <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={domainFilter} onValueChange={setDomainFilter}>
            <SelectTrigger className="h-8 text-xs w-44" data-testid="select-instruction-domain-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Domains</SelectItem>
              {DOMAINS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{filtered.length} instruction{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowForm((p) => !p)} data-testid="button-add-instruction">
          <Plus className="w-3.5 h-3.5 mr-1.5" />Add Instruction
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4 text-primary" /> New Standing Instruction
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Communication Domain</label>
              <Select value={newDomain} onValueChange={setNewDomain}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-new-instruction-domain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOMAINS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rule Type</label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-new-instruction-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            placeholder="E.g. 'Always mention the athlete's sport in the opening line. Keep emails under 150 words for parent outreach.'"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="text-sm min-h-[80px] mb-3"
            data-testid="textarea-new-instruction"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newText.trim()}
              data-testid="button-save-instruction"
            >
              {createMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save Instruction</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setNewText(""); }}>
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No standing instructions yet.</p>
          <p className="text-xs mt-1">Add your own coaching rules above — they will be applied to every AI draft for that domain.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inst) => {
            const isEditing = editingId === inst.id;
            return (
              <Card key={inst.id} className={`p-4 ${!inst.isActive ? "opacity-60" : ""}`} data-testid={`card-instruction-${inst.id}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="text-sm min-h-[60px]"
                          data-testid={`textarea-edit-instruction-${inst.id}`}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => editMutation.mutate({ id: inst.id, ruleText: editText })} disabled={editMutation.isPending}>
                            {editMutation.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{inst.ruleText}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DOMAIN_BADGE[inst.communicationDomain] ?? DOMAIN_BADGE.general}`}>
                        {domainLabel(inst.communicationDomain)}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RULE_TYPE_BADGE[inst.ruleType] ?? RULE_TYPE_BADGE.instruction}`}>
                        {ruleTypeLabel(inst.ruleType)}
                      </span>
                      {inst.createdAt && (
                        <span className="text-xs text-muted-foreground">{new Date(inst.createdAt).toLocaleDateString()}</span>
                      )}
                      {!inst.isActive && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      onClick={() => { setEditingId(inst.id); setEditText(inst.ruleText); }}
                      title="Edit"
                      data-testid={`button-edit-instruction-${inst.id}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-muted"
                      onClick={() => toggleMutation.mutate({ id: inst.id, isActive: !inst.isActive })}
                      title={inst.isActive ? "Disable" : "Enable"}
                      data-testid={`button-toggle-instruction-${inst.id}`}
                    >
                      {inst.isActive
                        ? <ToggleRight className="w-4 h-4 text-green-600" />
                        : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600"
                      onClick={() => { if (confirm("Remove this instruction?")) deleteMutation.mutate(inst.id); }}
                      title="Remove"
                      data-testid={`button-delete-instruction-${inst.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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

// ─── Context Preview Tab ──────────────────────────────────────────────────────

function ContextPreviewTab() {
  const [selectedDomain, setSelectedDomain] = useState("athlete_lead");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/agentmail-learning/context", selectedDomain],
    queryFn: () => fetch(`/api/admin/agentmail-learning/context?domain=${selectedDomain}`, { credentials: "include" }).then((r) => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={selectedDomain} onValueChange={setSelectedDomain}>
          <SelectTrigger className="w-56" data-testid="select-context-preview-domain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOMAINS.filter((d) => d.value !== "general").map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${data?.totalRules ?? 0} active rule${(data?.totalRules ?? 0) !== 1 ? "s" : ""} for this domain`}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          {/* Standing Instructions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                Standing Instructions
                <Badge variant="outline" className="text-xs">{data?.standingInstructions?.length ?? 0}</Badge>
                <span className="text-xs text-muted-foreground font-normal ml-1">— Injected first (highest priority)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.standingInstructions?.length ? (
                <p className="text-xs text-muted-foreground italic">No standing instructions for this domain. <Link href="/admin/agentmail-learning" className="text-primary underline">Add one →</Link></p>
              ) : (
                <div className="space-y-2">
                  {data.standingInstructions.map((r: any) => (
                    <div key={r.id} className="flex items-start gap-2 text-sm">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${RULE_TYPE_BADGE[r.ruleType] ?? RULE_TYPE_BADGE.instruction}`}>
                        {ruleTypeLabel(r.ruleType)}
                      </span>
                      <span>{r.ruleText}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Learned Rules */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-600" />
                Learned Rules
                <Badge variant="outline" className="text-xs">{data?.learnedRules?.length ?? 0}</Badge>
                <span className="text-xs text-muted-foreground font-normal ml-1">— Injected after standing instructions</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.learnedRules?.length ? (
                <p className="text-xs text-muted-foreground italic">No learned rules for this domain yet. Rules are generated automatically when you provide feedback on drafts.</p>
              ) : (
                <div className="space-y-2">
                  {data.learnedRules.map((r: any) => (
                    <div key={r.id} className="flex items-start gap-2 text-sm">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${RULE_TYPE_BADGE[r.ruleType] ?? RULE_TYPE_BADGE.instruction}`}>
                        {ruleTypeLabel(r.ruleType)}
                      </span>
                      <span className="flex-1">{r.ruleText}</span>
                      {r.confidence && (
                        <span className="text-xs text-muted-foreground shrink-0">{Math.round(Number(r.confidence) * 100)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {data?.totalRules === 0 && (
            <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900 p-4">
              <p className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 shrink-0" />
                No active learning rules for this domain yet. Reject or edit a draft to start building rules, or add a Standing Instruction above.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAgentmailLearningPage() {
  return (
    <div className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AgentMail Learning Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            View and control what the AI has learned. Add standing instructions. Preview what rules are active for each domain.
          </p>
        </div>
        <Link href="/admin/ai-approvals">
          <Button variant="outline" size="sm" data-testid="link-back-to-approvals">
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            AI Approvals
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="text-xs" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="learned" className="text-xs" data-testid="tab-learned-rules">Learned Rules</TabsTrigger>
          <TabsTrigger value="instructions" className="text-xs" data-testid="tab-standing-instructions">Standing Instructions</TabsTrigger>
          <TabsTrigger value="context" className="text-xs" data-testid="tab-context-preview">Context Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="learned" className="mt-4">
          <LearnedRulesTab />
        </TabsContent>

        <TabsContent value="instructions" className="mt-4">
          <StandingInstructionsTab />
        </TabsContent>

        <TabsContent value="context" className="mt-4">
          <ContextPreviewTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
