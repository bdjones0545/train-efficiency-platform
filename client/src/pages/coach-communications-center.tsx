import { useState, useEffect } from "react";
import { useParams, useSearch } from "wouter";
import { navigateWithContext } from "@/lib/navigateWithContext";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Brain,
  Sparkles,
  BookTemplate,
  Users,
  Settings,
  Loader2,
  Plus,
  Mail,
  Bell,
  Check,
  Clock,
  RefreshCw,
  Filter,
  ChevronRight,
  Megaphone,
  BarChart3,
  Circle,
  CheckCircle2,
  Eye,
  Zap,
  Target,
  ArrowRight,
  Copy,
} from "lucide-react";

// ─── Auth helper ─────────────────────────────────────────────────────────────

function getOrgToken(orgId: string): string | null {
  return localStorage.getItem(`orgToken_${orgId}`);
}

function orgFetch(path: string, orgToken: string | null, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
  return fetch(path, { headers, credentials: "include", ...options });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    sent: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    scheduled: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    draft: "bg-muted/30 text-muted-foreground border-border/40",
    failed: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  };
  return map[status] ?? map.draft;
}

function channelIcon(channel: string) {
  if (channel === "email") return <Mail className="h-3.5 w-3.5" />;
  if (channel === "sms") return <MessageSquare className="h-3.5 w-3.5" />;
  return <Bell className="h-3.5 w-3.5" />;
}

function typeLabelColor(type: string) {
  const map: Record<string, string> = {
    missed_workout: "bg-rose-500/12 text-rose-400",
    low_readiness: "bg-amber-500/12 text-amber-400",
    pr_celebration: "bg-blue-500/12 text-blue-400",
    streak_milestone: "bg-orange-500/12 text-orange-400",
    education_overdue: "bg-purple-500/12 text-purple-400",
    intervention_reminder: "bg-rose-500/12 text-rose-400",
    coach_followup: "bg-sky-500/12 text-sky-400",
    upcoming_session: "bg-emerald-500/12 text-emerald-400",
    hydration_reminder: "bg-cyan-500/12 text-cyan-400",
    recovery_encouragement: "bg-indigo-500/12 text-indigo-400",
    manual: "bg-muted/30 text-muted-foreground",
  };
  return map[type] ?? map.manual;
}

const MESSAGE_TYPES = [
  { value: "missed_workout", label: "Missed Workout" },
  { value: "low_readiness", label: "Low Readiness" },
  { value: "hydration_reminder", label: "Hydration Reminder" },
  { value: "education_overdue", label: "Education Overdue" },
  { value: "pr_celebration", label: "PR Celebration" },
  { value: "streak_milestone", label: "Streak Milestone" },
  { value: "coach_followup", label: "Coach Follow-Up" },
  { value: "intervention_reminder", label: "Intervention Reminder" },
  { value: "upcoming_session", label: "Upcoming Session" },
  { value: "recovery_encouragement", label: "Recovery Encouragement" },
  { value: "manual", label: "Manual Message" },
];

// ─── Compose Message Dialog ───────────────────────────────────────────────────

function ComposeDialog({
  open,
  onClose,
  orgToken,
  orgId,
  athletes,
  templates,
  onSent,
  initialAthleteId,
  initialMessageType,
  contextBanner,
}: {
  open: boolean;
  onClose: () => void;
  orgToken: string | null;
  orgId: string;
  athletes: any[];
  templates: any[];
  onSent: () => void;
  initialAthleteId?: string;
  initialMessageType?: string;
  contextBanner?: string;
}) {
  const { toast } = useToast();
  const [recipientId, setRecipientId] = useState(initialAthleteId ?? "");
  const [channel, setChannel] = useState("in_app");
  const [messageType, setMessageType] = useState(initialMessageType ?? "manual");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialAthleteId) setRecipientId(initialAthleteId);
      if (initialMessageType) setMessageType(initialMessageType);
    }
  }, [open, initialAthleteId, initialMessageType]);

  const sendMutation = useMutation({
    mutationFn: () =>
      orgFetch("/api/org/communications/send", orgToken, {
        method: "POST",
        body: JSON.stringify({ recipientUserId: recipientId || undefined, recipientType: "athlete", channel, messageType, subject, body }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: "Message sent", description: "Your message has been delivered." });
      onSent();
      onClose();
      setBody(""); setSubject(""); setRecipientId(""); setSelectedTemplate("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const applyTemplate = (templateId: string) => {
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    setSelectedTemplate(templateId);
    setSubject(tmpl.subject ?? "");
    setBody(tmpl.body ?? "");
    setMessageType(tmpl.templateType);
  };

  const generateAI = async () => {
    if (!recipientId) {
      toast({ title: "Select an athlete first", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      const r = await orgFetch("/api/org/communications/ai-generate", orgToken, {
        method: "POST",
        body: JSON.stringify({ athleteUserId: recipientId, messageType }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setSubject(data.generated?.athleteMessage?.subject ?? "");
      setBody(data.generated?.athleteMessage?.body ?? "");
      toast({ title: "AI message generated", description: "Review and send when ready." });
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Compose Message
          </DialogTitle>
        </DialogHeader>

        {contextBanner && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs mx-1">
            <ArrowRight className="h-3 w-3 text-blue-400 flex-shrink-0" />
            <span className="text-blue-300 capitalize">{contextBanner}</span>
          </div>
        )}

        <div className="space-y-3 py-2">
          {/* Recipient */}
          <div className="space-y-1">
            <Label className="text-xs">Recipient</Label>
            <Select value={recipientId} onValueChange={setRecipientId}>
              <SelectTrigger data-testid="select-recipient" className="h-8 text-sm">
                <SelectValue placeholder="Select athlete…" />
              </SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Channel + Type row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger data-testid="select-channel" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_app">In-App</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={messageType} onValueChange={setMessageType}>
                <SelectTrigger data-testid="select-message-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESSAGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Template */}
          <div className="space-y-1">
            <Label className="text-xs">Apply Template (optional)</Label>
            <Select value={selectedTemplate} onValueChange={applyTemplate}>
              <SelectTrigger data-testid="select-template" className="h-8 text-sm">
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* AI Generate button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generateAI}
            disabled={isGenerating}
            data-testid="button-ai-generate-message"
            className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/10 h-8"
          >
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {isGenerating ? "Generating…" : "AI Generate for Athlete"}
          </Button>

          {/* Subject */}
          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Message subject…"
              className="h-8 text-sm"
              data-testid="input-message-subject"
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              className="text-sm resize-none"
              data-testid="textarea-message-body"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-compose">Cancel</Button>
          <Button
            size="sm"
            onClick={() => sendMutation.mutate()}
            disabled={!body.trim() || sendMutation.isPending}
            data-testid="button-send-message"
            className="gap-1.5"
          >
            {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Quick Generate Panel ──────────────────────────────────────────────────

function AIQuickGenerate({ orgToken, athletes }: { orgToken: string | null; athletes: any[] }) {
  const { toast } = useToast();
  const [selectedAthlete, setSelectedAthlete] = useState("");
  const [messageType, setMessageType] = useState("coach_followup");
  const [generated, setGenerated] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!selectedAthlete) return;
    setIsLoading(true);
    try {
      const r = await orgFetch("/api/org/communications/ai-generate", orgToken, {
        method: "POST",
        body: JSON.stringify({ athleteUserId: selectedAthlete, messageType, generateGuardianSummary: false }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setGenerated(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Athlete</Label>
          <Select value={selectedAthlete} onValueChange={setSelectedAthlete}>
            <SelectTrigger data-testid="select-ai-athlete" className="h-9">
              <SelectValue placeholder="Select athlete…" />
            </SelectTrigger>
            <SelectContent>
              {athletes.map((a) => (
                <SelectItem key={a.userId} value={a.userId}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Message Type</Label>
          <Select value={messageType} onValueChange={setMessageType}>
            <SelectTrigger data-testid="select-ai-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESSAGE_TYPES.filter((t) => t.value !== "manual").map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        onClick={generate}
        disabled={!selectedAthlete || isLoading}
        data-testid="button-ai-quick-generate"
        className="w-full gap-2"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
        {isLoading ? "Generating personalized message…" : "Generate AI Message"}
      </Button>

      {generated && (
        <div className="space-y-3 mt-2">
          {/* Athlete message */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2" data-testid="card-ai-generated-message">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <Send className="h-3 w-3" />Athlete Message
              </span>
              <div className="flex items-center gap-1.5">
                <Badge className={`text-[10px] px-1.5 h-4 capitalize ${generated.generated?.urgency === "high" ? "bg-rose-500/15 text-rose-400" : generated.generated?.urgency === "medium" ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                  {generated.generated?.urgency ?? "low"}
                </Badge>
                <button
                  onClick={() => copyToClipboard(generated.generated?.athleteMessage?.body ?? "")}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-copy-ai-message"
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            {generated.generated?.athleteMessage?.subject && (
              <p className="text-xs font-medium text-foreground/80">
                {generated.generated.athleteMessage.subject}
              </p>
            )}
            <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
              {generated.generated?.athleteMessage?.body}
            </p>
          </div>

          {/* Coach summary */}
          {generated.generated?.coachSummary && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/15 border border-border/40">
              <Target className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] text-primary/60 uppercase font-medium mb-0.5">Coach Context</p>
                <p className="text-xs text-muted-foreground">{generated.generated.coachSummary}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab({ templates, orgToken, onRefresh }: { templates: any[]; orgToken: string | null; onRefresh: () => void }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("manual");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      orgFetch("/api/org/communications/templates", orgToken, {
        method: "POST",
        body: JSON.stringify({ title: newTitle, templateType: newType, subject: newSubject, body: newBody }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: "Template created" });
      onRefresh();
      setShowCreate(false);
      setNewTitle(""); setNewSubject(""); setNewBody("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{templates.length} templates available</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowCreate(!showCreate)} data-testid="button-create-template">
          <Plus className="h-3.5 w-3.5" />New Template
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 space-y-3 border-primary/20">
          <p className="text-sm font-semibold">Create Template</p>
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Template name…" className="h-8" data-testid="input-template-title" />
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="h-8" data-testid="select-template-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MESSAGE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Subject (optional)…" className="h-8" data-testid="input-template-subject" />
          <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Template body… Use {{athleteName}}, {{liftName}}, etc." rows={4} className="text-sm resize-none" data-testid="textarea-template-body" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)} className="flex-1">Cancel</Button>
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={!newTitle || !newBody || createMutation.isPending} className="flex-1" data-testid="button-save-template">
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Template"}
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div
            key={t.id}
            data-testid={`card-template-${t.id}`}
            className="rounded-xl border border-border/50 bg-card overflow-hidden"
          >
            <button
              onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
              data-testid={`button-expand-template-${t.id}`}
            >
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${typeLabelColor(t.templateType)}`}>
                {t.templateType.replace(/_/g, " ")}
              </span>
              <span className="flex-1 text-sm font-medium truncate">{t.title}</span>
              {t.isDefault && <Badge className="text-[9px] px-1.5 h-4 bg-primary/10 text-primary border-primary/20">Default</Badge>}
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedId === t.id ? "rotate-90" : ""}`} />
            </button>
            {expandedId === t.id && (
              <div className="px-4 pb-4 space-y-2 border-t border-border/40 pt-3">
                {t.subject && <p className="text-xs font-medium text-foreground/70">{t.subject}</p>}
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{t.body}</p>
                {(t.variables ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(t.variables as string[]).map((v) => (
                      <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-primary font-mono">{`{{${v}}}`}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoachCommunicationsCenterPage() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const { hasAccess, isHydrating } = usePermissions(slug);
  const [showCompose, setShowCompose] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const [filterType, setFilterType] = useState("all");

  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const urlAthleteId = searchParams.get("athleteId") ?? "";
  const urlTeamId = searchParams.get("teamId") ?? "";
  const urlMessageType = searchParams.get("messageType") ?? "";
  const urlSource = searchParams.get("source") ?? "";

  useEffect(() => {
    if (urlAthleteId) setShowCompose(true);
  }, [urlAthleteId]);

  const { data: navCtx } = useQuery<{ orgId: string }>({
    queryKey: [`/api/org/by-slug/${slug}/nav-context`],
    queryFn: () => fetch(`/api/org/by-slug/${slug}/nav-context`, { credentials: "include" }).then((r) => r.json()),
  });

  useEffect(() => {
    if (navCtx?.orgId) {
      setOrgId(navCtx.orgId);
      setOrgToken(getOrgToken(navCtx.orgId));
    }
  }, [navCtx?.orgId]);

  // Fetch messages
  const { data: msgData, isLoading: msgsLoading, refetch: refetchMsgs } = useQuery<{ messages: any[]; analytics: any }>({
    queryKey: ["/api/org/communications", orgId, filterType],
    queryFn: () =>
      orgFetch(`/api/org/communications${filterType !== "all" ? `?messageType=${filterType}` : ""}`, orgToken)
        .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    enabled: !!orgId && (!!orgToken || hasAccess),
    refetchInterval: 30_000,
  });

  // Fetch templates
  const { data: tmplData, refetch: refetchTemplates } = useQuery<{ templates: any[] }>({
    queryKey: ["/api/org/communications/templates", orgId],
    queryFn: () =>
      orgFetch("/api/org/communications/templates", orgToken)
        .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    enabled: !!orgId && (!!orgToken || hasAccess),
  });

  // Fetch campaigns
  const { data: campData } = useQuery<{ campaigns: any[] }>({
    queryKey: ["/api/org/communications/campaigns", orgId],
    queryFn: () =>
      orgFetch("/api/org/communications/campaigns", orgToken)
        .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    enabled: !!orgId && (!!orgToken || hasAccess),
  });

  // Fetch preferences
  const { data: prefsData } = useQuery<{ preferences: any }>({
    queryKey: ["/api/org/communications/preferences", orgId],
    queryFn: () =>
      orgFetch("/api/org/communications/preferences", orgToken)
        .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    enabled: !!orgId && (!!orgToken || hasAccess),
  });

  // Fetch athletes for compose / AI generate
  const { data: athleteData } = useQuery<any[]>({
    queryKey: [`/api/org/by-slug/${slug}/nav-context`, orgId, "athletes"],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const r = await fetch(`/api/org/by-slug/${slug}/nav-context`, { credentials: "include", headers });
      const ctx = await r.json();
      return ctx.athletes ?? [];
    },
    enabled: !!orgId && (!!orgToken || hasAccess),
  });

  const updatePrefsMutation = useMutation({
    mutationFn: (prefs: any) =>
      orgFetch("/api/org/communications/preferences", orgToken, { method: "PATCH", body: JSON.stringify(prefs) })
        .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      toast({ title: "Preferences saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/org/communications/preferences", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const messages = msgData?.messages ?? [];
  const analytics = msgData?.analytics ?? { total: 0, sent: 0, read: 0, openRate: 0 };
  const templates = tmplData?.templates ?? [];
  const campaigns = campData?.campaigns ?? [];
  const prefs = prefsData?.preferences;
  const athletes: any[] = athleteData ?? [];

  const filteredMessages = filterType === "all" ? messages : messages.filter((m) => m.messageType === filterType);

  if (!orgToken && !hasAccess && !isHydrating) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Card className="p-8 text-center max-w-sm">
          <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Coach authentication required.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10" data-testid="page-communications-center">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="text-comms-title">
            <MessageSquare className="h-5 w-5 text-primary" />
            Communications Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI-powered athlete engagement & outreach</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchMsgs()} data-testid="button-refresh-comms" className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCompose(true)} data-testid="button-compose-message" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />Compose
          </Button>
        </div>
      </div>

      {/* ── Analytics Strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="section-comms-analytics">
        {[
          { label: "Total Messages", value: analytics.total, color: "text-foreground" },
          { label: "Sent", value: analytics.sent, color: "text-emerald-400" },
          { label: "Read", value: analytics.read, color: "text-blue-400" },
          { label: "Open Rate", value: `${analytics.openRate}%`, color: analytics.openRate >= 60 ? "text-emerald-400" : analytics.openRate >= 30 ? "text-amber-400" : "text-rose-400" },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-xl bg-card border border-border/50">
            <span className={`text-2xl font-bold tabular-nums ${s.color}`} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>{s.value}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Main Tabs ─────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-9 gap-1" data-testid="tabs-communications">
          <TabsTrigger value="inbox" className="text-xs h-7" data-testid="tab-inbox">
            <Bell className="h-3.5 w-3.5 mr-1.5" />Messages
            {analytics.total > 0 && <Badge className="ml-1.5 text-[9px] px-1 h-4 bg-primary/15 text-primary border-primary/25">{analytics.total}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs h-7" data-testid="tab-ai">
            <Brain className="h-3.5 w-3.5 mr-1.5" />AI Generate
          </TabsTrigger>
          <TabsTrigger value="templates" className="text-xs h-7" data-testid="tab-templates">
            <Zap className="h-3.5 w-3.5 mr-1.5" />Templates
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs h-7" data-testid="tab-campaigns">
            <Megaphone className="h-3.5 w-3.5 mr-1.5" />Campaigns
          </TabsTrigger>
          <TabsTrigger value="preferences" className="text-xs h-7" data-testid="tab-preferences">
            <Settings className="h-3.5 w-3.5 mr-1.5" />Preferences
          </TabsTrigger>
        </TabsList>

        {/* ── Message History ──────────────────────────────────────────── */}
        <TabsContent value="inbox" className="mt-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-7 w-44 text-xs" data-testid="select-filter-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {MESSAGE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{filteredMessages.length} message{filteredMessages.length !== 1 ? "s" : ""}</span>
          </div>

          {msgsLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />Loading messages…
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No messages yet. Compose one to get started.</p>
              <Button size="sm" onClick={() => setShowCompose(true)} data-testid="button-compose-first" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />Compose Message
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMessages.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`row-message-${msg.id}`}
                  className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card hover:bg-muted/10 transition-colors"
                >
                  <div className="mt-0.5 text-muted-foreground">{channelIcon(msg.channel)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">{msg.recipientName ?? msg.recipientUserId ?? "Broadcast"}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${typeLabelColor(msg.messageType)}`}>
                        {(msg.messageType ?? "manual").replace(/_/g, " ")}
                      </span>
                      {msg.aiGenerated && <Badge className="text-[9px] px-1 h-4 bg-primary/10 text-primary border-primary/20">AI</Badge>}
                    </div>
                    {msg.subject && <p className="text-xs font-medium text-foreground/70 truncate">{msg.subject}</p>}
                    <p className="text-xs text-muted-foreground truncate">{msg.body}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-1">
                      {msg.sentAt ? new Date(msg.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <Badge className={`text-[9px] px-1.5 h-4 border capitalize ${statusBadge(msg.status)}`}>{msg.status}</Badge>
                    {msg.readAt && (
                      <span className="flex items-center gap-0.5 text-[9px] text-emerald-400">
                        <Eye className="h-2.5 w-2.5" />Read
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── AI Generate ──────────────────────────────────────────────── */}
        <TabsContent value="ai" className="mt-4">
          <Card className="p-4" data-testid="section-ai-generate">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">AI Message Generation</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Select an athlete and message type. AI will analyze their status, readiness, streaks, and recent activity to craft a personalized message.
            </p>
            {athletes.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">No athletes found in your organization.</div>
            ) : (
              <AIQuickGenerate orgToken={orgToken} athletes={athletes} />
            )}
          </Card>
        </TabsContent>

        {/* ── Templates ────────────────────────────────────────────────── */}
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab templates={templates} orgToken={orgToken} onRefresh={refetchTemplates} />
        </TabsContent>

        {/* ── Campaigns ────────────────────────────────────────────────── */}
        <TabsContent value="campaigns" className="mt-4">
          <div className="space-y-3" data-testid="section-campaigns">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}</p>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" data-testid="button-new-campaign" onClick={() =>
                orgFetch("/api/org/communications/campaigns", orgToken, {
                  method: "POST",
                  body: JSON.stringify({ title: "New Campaign", type: "manual" }),
                }).then(async (r) => {
                  if (r.ok) {
                    queryClient.invalidateQueries({ queryKey: ["/api/org/communications/campaigns", orgId] });
                    toast({ title: "Campaign created" });
                  }
                })
              }>
                <Plus className="h-3.5 w-3.5" />New Campaign
              </Button>
            </div>

            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Megaphone className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No campaigns yet. Create one to send bulk outreach.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {campaigns.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`card-campaign-${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card"
                  >
                    <Megaphone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.title}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{c.type} · {c.sentAt ? `Sent ${new Date(c.sentAt).toLocaleDateString()}` : c.scheduledAt ? `Scheduled ${new Date(c.scheduledAt).toLocaleDateString()}` : "Draft"}</p>
                    </div>
                    <Badge className={`text-[9px] px-1.5 h-4 border capitalize ${statusBadge(c.status)}`}>{c.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Preferences ──────────────────────────────────────────────── */}
        <TabsContent value="preferences" className="mt-4">
          <Card className="p-5 space-y-4 max-w-md" data-testid="section-preferences">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Delivery Preferences</h3>
            </div>
            <p className="text-xs text-muted-foreground">Control how and when you receive communications from the system.</p>

            {[
              { key: "inAppEnabled", label: "In-App Notifications", description: "Receive messages inside the platform", icon: Bell },
              { key: "emailEnabled", label: "Email Notifications", description: "Receive messages via email", icon: Mail },
              { key: "smsEnabled", label: "SMS Notifications", description: "Receive messages via SMS (requires number)", icon: MessageSquare },
              { key: "guardianEnabled", label: "Guardian Notifications", description: "Forward notifications to guardians", icon: Users },
            ].map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{description}</p>
                  </div>
                </div>
                <Switch
                  checked={prefs?.[key] ?? (key === "inAppEnabled" || key === "emailEnabled")}
                  onCheckedChange={(val) => updatePrefsMutation.mutate({ [key]: val })}
                  data-testid={`switch-pref-${key}`}
                  disabled={updatePrefsMutation.isPending}
                />
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Compose Dialog */}
      <ComposeDialog
        open={showCompose}
        onClose={() => setShowCompose(false)}
        orgToken={orgToken}
        orgId={orgId ?? ""}
        athletes={athletes}
        templates={templates}
        initialAthleteId={urlAthleteId || undefined}
        initialMessageType={urlMessageType || undefined}
        contextBanner={urlSource ? `Opened from ${urlSource.replace(/-/g, " ")}` : undefined}
        onSent={() => {
          refetchMsgs();
          queryClient.invalidateQueries({ queryKey: ["/api/org/communications", orgId] });
        }}
      />
    </div>
  );
}
