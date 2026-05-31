import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCheck, X, Edit3, RefreshCw, Clock, TrendingUp, ChevronDown,
  ChevronRight, Globe, Archive, Brain, Zap, AlertTriangle, Users,
  Building2, GraduationCap, Briefcase, BarChart3, Mail,
} from "lucide-react";

// ─── Domain Configuration ─────────────────────────────────────────────────────

const DOMAIN_TABS = [
  { key: "all",          label: "All",            apiKey: "all",          icon: Mail },
  { key: "athlete",      label: "Athlete Leads",  apiKey: "athlete",      icon: Users },
  { key: "team_training",label: "Team Training",  apiKey: "team_training",icon: TrendingUp },
  { key: "schools",      label: "Schools",        apiKey: "schools",      icon: GraduationCap },
  { key: "orgs",         label: "Organizations",  apiKey: "orgs",         icon: Building2 },
  { key: "employment",   label: "Employment",     apiKey: "employment",   icon: Briefcase },
] as const;

const DOMAIN_LABELS: Record<string, string> = {
  athlete_lead: "Athlete Lead",
  parent_lead: "Parent Lead",
  team_training: "Team Training",
  school_partnership: "School Partnership",
  athletic_director: "Athletic Director",
  coach_outreach: "Coach Outreach",
  organization_outreach: "Org Outreach",
  business_outreach: "Business Outreach",
  employment_opportunity: "Employment",
  corporate_wellness: "Corporate Wellness",
  facility_partnership: "Facility Partnership",
};

const DOMAIN_BADGE_CLASS: Record<string, string> = {
  athlete_lead: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  parent_lead: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  team_training: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  school_partnership: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  athletic_director: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  coach_outreach: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  organization_outreach: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  business_outreach: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  employment_opportunity: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  corporate_wellness: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  facility_partnership: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const DOMAIN_GROUP_TO_API: Record<string, string[]> = {
  athlete: ["athlete_lead", "parent_lead"],
  team_training: ["team_training"],
  schools: ["school_partnership", "athletic_director", "coach_outreach"],
  orgs: ["organization_outreach", "business_outreach", "corporate_wellness", "facility_partnership"],
  employment: ["employment_opportunity"],
};

// ─── Feedback Chips ───────────────────────────────────────────────────────────

const FEEDBACK_CHIPS = [
  "Too long", "Too generic", "Too salesy", "Weak CTA", "Missing scheduling link",
  "Wrong lead stage", "Wrong tone", "Missing sport context", "Too much hype", "Not personal enough",
];

function FeedbackChips({ selected, onToggle }: { selected: string[]; onToggle: (chip: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {FEEDBACK_CHIPS.map((chip) => (
        <button
          key={chip}
          data-testid={`chip-${chip.toLowerCase().replace(/\s+/g, "-")}`}
          onClick={() => onToggle(chip)}
          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
            selected.includes(chip)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-border hover:border-primary"
          }`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

// ─── Reject Dialog ────────────────────────────────────────────────────────────

function RejectDialog({
  proposalId, open, onClose, onDone,
}: { proposalId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [coaching, setCoaching] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposalId}/reject`, {
      reason, coachingFeedbackText: coaching, feedbackTags: chips,
    }),
    onSuccess: () => {
      toast({ title: "Draft rejected" });
      onDone(); onClose(); setReason(""); setCoaching(""); setChips([]);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = reason.trim() || coaching.trim() || chips.length > 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Reject Draft</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason (optional)</Label>
            <Input data-testid="input-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief reason…" className="mt-1" />
          </div>
          <div>
            <Label>Coach the AI (optional)</Label>
            <Textarea
              data-testid="textarea-coaching"
              value={coaching}
              onChange={(e) => setCoaching(e.target.value)}
              placeholder={"What should the AI do differently?\n\nExamples:\n• \"Mention the sport next time\"\n• \"Keep it under 100 words\"\n• \"End with a scheduling link\""}
              className="mt-1 min-h-[100px] text-sm"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Quick tags (optional)</Label>
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-reject"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
          >
            {mutation.isPending ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit & Send Dialog ───────────────────────────────────────────────────────

function EditSendDialog({
  proposal, open, onClose, onDone,
}: { proposal: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = useState(proposal?.subject ?? "");
  const [body, setBody] = useState(proposal?.bodyPreview ?? "");
  const [coaching, setCoaching] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposal.id}/edit-send`, {
      subject, body, coachingFeedbackText: coaching, feedbackTags: chips,
    }),
    onSuccess: () => { toast({ title: "Sent!" }); onDone(); onClose(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Edit & Send</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input data-testid="input-edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea data-testid="textarea-edit-body" value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 min-h-[180px] text-sm font-mono" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Coaching note for AI (optional)</Label>
            <Textarea
              data-testid="textarea-edit-coaching"
              value={coaching}
              onChange={(e) => setCoaching(e.target.value)}
              placeholder="What did you change and why?"
              className="mt-1 min-h-[60px] text-sm"
            />
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-edit-send"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !subject || !body}
          >
            {mutation.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Regenerate Dialog ────────────────────────────────────────────────────────

function RegenerateDialog({
  proposal, open, onClose, onDone,
}: { proposal: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [revised, setRevised] = useState<{ subject: string; body: string } | null>(null);
  const { toast } = useToast();

  const regenMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/ai-approvals/${proposal.id}/regenerate`, {
        feedbackText: [feedback, ...chips].filter(Boolean).join(". "),
      }),
    onSuccess: (data: any) => setRevised({ subject: data.subject, body: data.body }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/ai-approvals/${proposal.id}/approve`, {
        subject: revised?.subject, body: revised?.body,
      }),
    onSuccess: () => {
      toast({ title: "Revised draft sent!" });
      onDone(); onClose();
      setFeedback(""); setChips([]); setRevised(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => { onClose(); setRevised(null); setFeedback(""); setChips([]); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Regenerate with Feedback</DialogTitle></DialogHeader>
        {!revised ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell the AI what to improve. It will rewrite the draft using your feedback and past learning rules.
            </p>
            <Textarea
              data-testid="textarea-regen-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="E.g. 'Make it shorter and more personal. End with a direct question.'"
              className="min-h-[80px] text-sm"
            />
            <FeedbackChips selected={chips} onToggle={(c) => setChips((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])} />
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                data-testid="button-regen-submit"
                onClick={() => regenMutation.mutate()}
                disabled={regenMutation.isPending || (!feedback.trim() && chips.length === 0)}
              >
                {regenMutation.isPending
                  ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Regenerating…</>
                  : "Regenerate"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Original</p>
                <div className="rounded-md bg-muted p-3 space-y-1">
                  <p className="text-xs font-medium">{proposal.subject}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{proposal.bodyPreview}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-green-600 mb-1">Revised</p>
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 space-y-1">
                  <p className="text-xs font-medium">{revised.subject}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-6">{revised.body}</p>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRevised(null)}>Try again</Button>
              <Button
                data-testid="button-use-revised"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Sending…" : "Use this draft & Send"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({ proposal, onRefresh }: { proposal: any; onRefresh: () => void }) {
  const [showReject, setShowReject] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const { toast } = useToast();

  const domain = proposal.communicationDomain ?? "athlete_lead";
  const domainLabel = DOMAIN_LABELS[domain] ?? domain;
  const domainClass = DOMAIN_BADGE_CLASS[domain] ?? "bg-gray-100 text-gray-800";

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-approvals/${proposal.id}/approve`, {}),
    onSuccess: () => { toast({ title: "Sent!" }); onRefresh(); },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const riskColor =
    proposal.riskLevel === "low" ? "text-green-600" :
    proposal.riskLevel === "high" ? "text-red-600" : "text-yellow-600";

  return (
    <>
      <Card data-testid={`card-proposal-${proposal.id}`} className="group hover:shadow-md transition-shadow">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${domainClass}`} data-testid={`badge-domain-${proposal.id}`}>
                  {domainLabel}
                </span>
                <Badge variant="outline" className="text-xs">
                  {proposal.actionType?.replace("propose_draft:", "") ?? "message"}
                </Badge>
                <span className={`text-xs font-medium ${riskColor}`} data-testid={`text-risk-${proposal.id}`}>
                  {proposal.riskLevel?.toUpperCase() ?? "MEDIUM"} RISK
                </span>
              </div>
              <p className="font-medium text-sm truncate" data-testid={`text-subject-${proposal.id}`}>
                {proposal.subject ?? "(No subject)"}
              </p>
              <p className="text-xs text-muted-foreground">{proposal.recipientEmail}</p>
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {proposal.createdAt ? new Date(proposal.createdAt).toLocaleDateString() : "—"}
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 bg-muted/30 rounded p-2" data-testid={`text-body-${proposal.id}`}>
            {proposal.bodyPreview ?? "No content"}
          </p>

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              data-testid={`button-approve-${proposal.id}`}
              size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              {approveMutation.isPending ? "Sending…" : "Approve & Send"}
            </Button>
            <Button data-testid={`button-edit-${proposal.id}`} size="sm" variant="outline" onClick={() => setShowEdit(true)}>
              <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <Button data-testid={`button-regen-${proposal.id}`} size="sm" variant="outline" onClick={() => setShowRegen(true)}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Regenerate
            </Button>
            <Button
              data-testid={`button-reject-${proposal.id}`}
              size="sm" variant="ghost"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setShowReject(true)}
            >
              <X className="w-3.5 h-3.5 mr-1" /> Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      <RejectDialog proposalId={proposal.id} open={showReject} onClose={() => setShowReject(false)} onDone={onRefresh} />
      {showEdit && (
        <EditSendDialog proposal={proposal} open={showEdit} onClose={() => setShowEdit(false)} onDone={onRefresh} />
      )}
      {showRegen && (
        <RegenerateDialog proposal={proposal} open={showRegen} onClose={() => setShowRegen(false)} onDone={onRefresh} />
      )}
    </>
  );
}

// ─── Metrics Bar ─────────────────────────────────────────────────────────────

function MetricsBar({ domain }: { domain: string }) {
  const { data: metrics } = useQuery<any>({
    queryKey: ["/api/ai-approvals/metrics", domain],
    queryFn: () => fetch(`/api/ai-approvals/metrics?domain=${domain}`).then((r) => r.json()),
  });
  if (!metrics) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "Pending",        value: metrics.pending,               icon: Clock,         color: "text-yellow-600" },
        { label: "Approval Rate",  value: metrics.approvalRate != null ? `${metrics.approvalRate}%` : "—", icon: TrendingUp, color: "text-green-600" },
        { label: "Total Reviewed", value: metrics.totalReviewed,         icon: CheckCheck,    color: "text-blue-600" },
        { label: "Oldest Pending", value: metrics.oldestPendingHours != null ? `${metrics.oldestPendingHours}h` : "—", icon: AlertTriangle, color: "text-orange-600" },
      ].map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="p-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${color} shrink-0`} />
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                {value ?? "—"}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Autonomy Panel ───────────────────────────────────────────────────────────

const LEVEL_LABELS = ["Manual Review", "Notify Only", "Auto-Send Low Risk", "Full Autonomy"];
const LEVEL_COLORS = [
  "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
];

function AutonomyPanel({ activeDomainTab }: { activeDomainTab: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: autonomyData } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals/autonomy"],
    queryFn: () => fetch("/api/ai-approvals/autonomy").then((r) => r.json()),
  });

  const allowedDomains = activeDomainTab !== "all" ? (DOMAIN_GROUP_TO_API[activeDomainTab] ?? null) : null;
  const displayData = (autonomyData ?? []).filter((d) => !allowedDomains || allowedDomains.includes(d.domain));

  const promoteMutation = useMutation({
    mutationFn: ({ domain, level }: { domain: string; level: number }) =>
      apiRequest("POST", `/api/ai-approvals/autonomy/intake_outreach`, {
        autonomyLevel: level, enabled: level > 0, communicationDomain: domain,
      }),
    onSuccess: () => {
      toast({ title: "Autonomy updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/autonomy"] });
    },
    onError: () => toast({ title: "Error updating autonomy", variant: "destructive" }),
  });

  if (!autonomyData?.length) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                <CardTitle className="text-sm">Autonomy by Domain</CardTitle>
                <span className="text-xs text-muted-foreground ml-1">
                  ({displayData.filter((d) => d.domainAutonomyLevel > 0).length}/{displayData.length} enabled)
                </span>
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0 space-y-2">
            {displayData.map((d) => {
              const level = Math.min(d.domainAutonomyLevel ?? 0, 3);
              const hasRepeated = (d.repeatedMistakes?.length ?? 0) > 0;
              return (
                <div key={d.domain} data-testid={`autonomy-card-${d.domain}`} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{DOMAIN_LABELS[d.domain] ?? d.domain}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_COLORS[level]}`}>
                        L{level}: {LEVEL_LABELS[level]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{d.totalReviewed} reviewed</span>
                      <span>{d.approvalRate}% approved</span>
                      {d.ruleCount > 0 && <span className="text-blue-600">{d.ruleCount} rules</span>}
                    </div>
                  </div>

                  {hasRepeated && (
                    <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 dark:bg-orange-950/20 rounded px-2 py-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Repeated mistakes block promotion: {d.repeatedMistakes.join(", ")}
                    </div>
                  )}

                  {(d.readyForLevel2 || d.readyForLevel3) && !hasRepeated && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600">
                        Ready for Level {d.readyForLevel3 ? 3 : 2}
                      </span>
                      <Button
                        size="sm" variant="outline"
                        className="h-6 text-xs"
                        data-testid={`button-promote-${d.domain}`}
                        onClick={() => promoteMutation.mutate({ domain: d.domain, level: d.readyForLevel3 ? 3 : 2 })}
                        disabled={promoteMutation.isPending}
                      >
                        Promote
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Learning Dashboard ───────────────────────────────────────────────────────

function LearningDashboard({ activeDomainTab }: { activeDomainTab: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [activeLearningDomain, setActiveLearningDomain] = useState("athlete_lead");

  const { data: dashboard } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals/learning-dashboard"],
    enabled: open,
  });

  const archiveMutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiRequest("PATCH", `/api/ai-approvals/learning-rules/${ruleId}`, { status: "archived" }),
    onSuccess: () => {
      toast({ title: "Rule archived" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/learning-dashboard"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const globalMutation = useMutation({
    mutationFn: ({ id, val }: { id: string; val: boolean }) =>
      apiRequest("PATCH", `/api/ai-approvals/learning-rules/${id}`, { appliesGlobally: val }),
    onSuccess: () => {
      toast({ title: "Rule updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/learning-dashboard"] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const allowedApiDomains = activeDomainTab !== "all" ? (DOMAIN_GROUP_TO_API[activeDomainTab] ?? null) : null;
  const visibleDomains = (dashboard ?? []).filter((d) => !allowedApiDomains || allowedApiDomains.includes(d.domain));
  const activeEntry = visibleDomains.find((d) => d.domain === activeLearningDomain) ?? visibleDomains[0];

  const totalRules = (dashboard ?? []).reduce((s, d) => s + (d.rulesCount ?? 0), 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-500" />
                <CardTitle className="text-sm">What the AI Has Learned</CardTitle>
                {totalRules > 0 && (
                  <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">
                    {totalRules} rules
                  </span>
                )}
              </div>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0">
            {!dashboard ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : visibleDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No learning data yet for this domain.</p>
            ) : (
              <div className="flex gap-4 min-h-[200px]">
                {/* Domain sidebar nav */}
                <div className="flex flex-col gap-1 min-w-[160px] shrink-0">
                  {visibleDomains.map((d) => (
                    <button
                      key={d.domain}
                      data-testid={`learning-nav-${d.domain}`}
                      onClick={() => setActiveLearningDomain(d.domain)}
                      className={`text-left text-xs px-3 py-2 rounded-md transition-colors ${
                        activeEntry?.domain === d.domain
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="block font-medium">{d.label}</span>
                      <span className="opacity-70">{d.rulesCount} rules · {d.reviewedCount} reviewed</span>
                    </button>
                  ))}
                </div>

                {/* Rules content */}
                {activeEntry && (
                  <div className="flex-1 space-y-4 min-w-0">
                    {/* Outcome summary */}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="text-green-600 font-medium">
                        ✓ {(activeEntry.outcomes?.approved ?? 0) + (activeEntry.outcomes?.edited ?? 0)} approved
                      </span>
                      <span className="text-red-600 font-medium">
                        ✗ {activeEntry.outcomes?.rejected ?? 0} rejected
                      </span>
                      <span>📧 {activeEntry.outcomes?.sent ?? 0} sent</span>
                      {(activeEntry.outcomes?.replied ?? 0) > 0 && (
                        <span>💬 {activeEntry.outcomes.replied} replied</span>
                      )}
                    </div>

                    {/* Repeated mistakes warning */}
                    {activeEntry.repeatedMistakes?.length > 0 && (
                      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                        <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Repeated Mistakes — blocks autonomy promotion
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {activeEntry.repeatedMistakes.map((m: any) => (
                            <span key={m.tag ?? m} className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-2 py-0.5 rounded-full">
                              {m.tag ?? m}{m.count ? ` ×${m.count}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rule categories */}
                    {[
                      { key: "doRules",     emoji: "✅", label: "Do" },
                      { key: "avoidRules",  emoji: "🚫", label: "Avoid" },
                      { key: "toneRules",   emoji: "🎙",  label: "Tone" },
                      { key: "ctaRules",    emoji: "👆", label: "CTA" },
                      { key: "lengthRules", emoji: "📏", label: "Length" },
                    ].map(({ key, emoji, label }) => {
                      const rules: any[] = activeEntry[key] ?? [];
                      if (rules.length === 0) return null;
                      return (
                        <div key={key}>
                          <p className="text-xs font-semibold mb-1.5">{emoji} {label}</p>
                          <div className="space-y-1.5">
                            {rules.map((r: any) => (
                              <div
                                key={r.id}
                                data-testid={`rule-${r.id}`}
                                className="flex items-start gap-2 text-xs text-muted-foreground group"
                              >
                                <span className="flex-1 leading-relaxed">{r.text}</span>
                                <span className="opacity-40 shrink-0 tabular-nums">
                                  {Math.round(parseFloat(r.confidence ?? "0.75") * 100)}%
                                </span>
                                <button
                                  data-testid={`button-globe-${r.id}`}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  title={r.appliesGlobally ? "Remove global" : "Apply globally"}
                                  onClick={() => globalMutation.mutate({ id: r.id, val: !r.appliesGlobally })}
                                >
                                  <Globe className={`w-3 h-3 ${r.appliesGlobally ? "text-blue-500" : "text-muted-foreground"}`} />
                                </button>
                                <button
                                  data-testid={`button-archive-${r.id}`}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  title="Archive rule"
                                  onClick={() => archiveMutation.mutate(r.id)}
                                >
                                  <Archive className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Top rejection tags */}
                    {activeEntry.topRejectionTags?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-1.5">🏷 Top Rejection Tags</p>
                        <div className="flex flex-wrap gap-1.5">
                          {activeEntry.topRejectionTags.map((t: any) => (
                            <span
                              key={t.tag}
                              className="text-xs bg-muted px-2 py-0.5 rounded-full"
                            >
                              {t.tag} <span className="text-muted-foreground">×{t.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Proposals Panel ──────────────────────────────────────────────────────────

function ProposalsPanel({ domain }: { domain: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: proposals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/ai-approvals", domain],
    queryFn: () => fetch(`/api/ai-approvals?domain=${domain}`).then((r) => r.json()),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals/metrics"] });
  };

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/ai-approvals/bulk-approve", { ids }),
    onSuccess: (data: any) => {
      toast({ title: `Bulk approved: ${data.sent} sent` });
      setSelected(new Set()); invalidate();
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/ai-approvals/bulk-reject", { ids }),
    onSuccess: () => { toast({ title: "Bulk rejected" }); setSelected(new Set()); invalidate(); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = proposals.length > 0 && proposals.every((p) => selected.has(p.id));

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Loading drafts…</div>;
  }

  return (
    <div>
      {proposals.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="checkbox-select-all"
              checked={allSelected}
              onChange={() => allSelected ? setSelected(new Set()) : setSelected(new Set(proposals.map((p) => p.id)))}
              className="rounded"
            />
            Select all ({proposals.length})
          </label>
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                data-testid="button-bulk-approve"
                onClick={() => bulkApproveMutation.mutate([...selected])}
                disabled={bulkApproveMutation.isPending}
              >
                <CheckCheck className="w-3 h-3 mr-1" /> Approve {selected.size}
              </Button>
              <Button
                size="sm" variant="outline"
                className="text-red-600 border-red-200 h-7 text-xs"
                data-testid="button-bulk-reject"
                onClick={() => bulkRejectMutation.mutate([...selected])}
                disabled={bulkRejectMutation.isPending}
              >
                <X className="w-3 h-3 mr-1" /> Reject {selected.size}
              </Button>
            </>
          )}
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="text-center py-16" data-testid="text-empty-state">
          <CheckCheck className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">All caught up!</p>
          <p className="text-sm text-muted-foreground mt-1">No pending AI drafts for this domain.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div key={p.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                data-testid={`checkbox-select-${p.id}`}
                checked={selected.has(p.id)}
                onChange={() => toggleSelect(p.id)}
                className="mt-4 rounded"
              />
              <div className="flex-1">
                <ProposalCard proposal={p} onRefresh={invalidate} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAiApprovalsPage() {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Communications Center</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Review, approve, and coach AI-generated outreach across all communication domains.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BarChart3 className="w-4 h-4" />
          <span>Learning enabled · {DOMAIN_TABS.length - 1} domains</span>
        </div>
      </div>

      {/* Metrics */}
      <MetricsBar domain={activeTab} />

      {/* Domain Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1 w-full sm:w-auto" data-testid="tabs-domain">
          {DOMAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                data-testid={`tab-${tab.key}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {DOMAIN_TABS.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            <ProposalsPanel domain={tab.apiKey} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Autonomy Panel */}
      <AutonomyPanel activeDomainTab={activeTab} />

      {/* Learning Dashboard */}
      <LearningDashboard activeDomainTab={activeTab} />
    </div>
  );
}
