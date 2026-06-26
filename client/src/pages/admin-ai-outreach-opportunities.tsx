import { TrainLogo } from "@/components/train-logo";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { parseApiResponse } from "@/lib/api-helpers";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Zap, GraduationCap, Users, Building2, Briefcase, Heart,
  Store, ChevronRight, CheckCheck, RefreshCw, Mail, Target, AlertCircle,
} from "lucide-react";

// ─── Safe fetch + array helpers ────────────────────────────────────────────

async function safeFetch(url: string) {
  return authenticatedFetch(url);
}

const asArray = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? value : [];

// ─── Domain configuration for the Outreach Command Center ──────────────────

const OUTREACH_DOMAINS = [
  {
    key: "athletic_director",
    label: "Athletic Directors",
    icon: GraduationCap,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    description: "High school and collegiate athletic departments",
    goal: "Book discovery meeting",
  },
  {
    key: "school_partnership",
    label: "Schools",
    icon: GraduationCap,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800",
    badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    description: "Schools seeking strength or performance programs",
    goal: "Start partnership conversation",
  },
  {
    key: "coach_outreach",
    label: "Coaches",
    icon: Users,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800",
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    description: "Sports coaches for athlete referrals and collaboration",
    goal: "Build coaching relationships",
  },
  {
    key: "organization_outreach",
    label: "Organizations",
    icon: Building2,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800",
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    description: "Clubs, travel teams, recreation departments",
    goal: "Schedule meeting",
  },
  {
    key: "business_outreach",
    label: "Businesses",
    icon: Building2,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    description: "Local businesses, sponsors, strategic partners",
    goal: "Business relationship",
  },
  {
    key: "employment_opportunity",
    label: "Employment",
    icon: Briefcase,
    color: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800",
    badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    description: "Coaching applicants, performance coaches, interns",
    goal: "Recruitment automation",
  },
  {
    key: "corporate_wellness",
    label: "Corporate Wellness",
    icon: Heart,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800",
    badge: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
    description: "HR departments, business owners, wellness directors",
    goal: "Book sales call",
  },
  {
    key: "facility_partnership",
    label: "Facility Partners",
    icon: TrainLogo,
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800",
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
    description: "Gyms, sports complexes, training facilities",
    goal: "Partnership discussion",
  },
  {
    key: "gym_owner",
    label: "Gym Owners",
    icon: Store,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-50 dark:bg-pink-950/20 border-pink-200 dark:border-pink-800",
    badge: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
    description: "Independent gym owners for training partnerships",
    goal: "Partnership arrangement",
  },
] as const;

type OutreachDomainKey = typeof OUTREACH_DOMAINS[number]["key"];

// ─── Message type labels (pulled from config endpoint) ─────────────────────

function useMessageTypes(domain: string) {
  return useQuery<Array<{ value: string; label: string; goal: string }>>({
    queryKey: ["/api/ai-outreach/config", domain],
    queryFn: () => safeFetch(`/api/ai-outreach/config?domain=${domain}`).then((d: any) => asArray<{ value: string; label: string; goal: string }>(d?.messageTypes)),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Generate Draft Dialog ─────────────────────────────────────────────────

function GenerateDraftDialog({
  open,
  onClose,
  domain,
  prospect,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  domain: string;
  prospect?: any;
  onDone: () => void;
}) {
  const [messageType, setMessageType] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(prospect?.decisionMakerEmail || prospect?.contactEmail || "");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ subject: string; body: string; actionId: string } | null>(null);
  const { toast } = useToast();
  const { data: messageTypes = [] } = useMessageTypes(domain);

  const domainCfg = OUTREACH_DOMAINS.find((d) => d.key === domain);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-outreach/generate", {
      domain,
      messageType,
      recipientEmail: recipientEmail || undefined,
      prospectId: prospect?.id,
      context: {
        contactName: prospect?.decisionMakerName || prospect?.contactName,
        contactRole: prospect?.decisionMakerTitle || prospect?.contactRole,
        organizationName: prospect?.prospectName,
        sport: prospect?.sport !== "unknown" ? prospect?.sport : undefined,
        city: prospect?.city !== "unknown" ? prospect?.city : undefined,
        state: prospect?.state !== "unknown" ? prospect?.state : undefined,
        notes: notes || prospect?.notes,
        estimatedValue: prospect?.estimatedValue,
      },
    }),
    onSuccess: (data: any) => {
      setResult(data);
      toast({ title: "Draft queued in AI Comms Center" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setResult(null); setMessageType(""); setNotes(""); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Generate {domainCfg?.label} Draft
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-3">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium mb-1">
                <CheckCheck className="w-4 h-4" />
                Draft queued for review
              </div>
              <p className="text-xs text-muted-foreground">
                This draft is now in the AI Communications Center waiting for your approval.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <p className="text-sm font-medium">{result.subject}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{result.body}</p>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => window.location.href = "/admin/ai-approvals"}>
              <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
              Review in AI Comms Center
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {prospect && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <div className="font-medium">{prospect.prospectName}</div>
                {(prospect.decisionMakerName || prospect.contactName) && (
                  <div className="text-muted-foreground text-xs mt-0.5">
                    {prospect.decisionMakerName || prospect.contactName}
                    {(prospect.decisionMakerTitle || prospect.contactRole) && ` · ${prospect.decisionMakerTitle || prospect.contactRole}`}
                  </div>
                )}
                {prospect.city && prospect.city !== "unknown" && (
                  <div className="text-muted-foreground text-xs">{[prospect.city, prospect.state].filter(Boolean).join(", ")}</div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="messageType">Message Type</Label>
              <Select value={messageType} onValueChange={setMessageType}>
                <SelectTrigger id="messageType" data-testid="select-message-type">
                  <SelectValue placeholder="Select message type…" />
                </SelectTrigger>
                <SelectContent>
                  {messageTypes.map((mt) => (
                    <SelectItem key={mt.value} value={mt.value} data-testid={`option-${mt.value}`}>
                      <div>
                        <div className="font-medium">{mt.label}</div>
                        <div className="text-xs text-muted-foreground">{mt.goal}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!prospect && (
              <div className="space-y-2">
                <Label htmlFor="recipientEmail">Recipient Email</Label>
                <Input
                  id="recipientEmail"
                  data-testid="input-recipient-email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="contact@example.com"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Context (optional)</Label>
              <Textarea
                id="notes"
                data-testid="textarea-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes to help the AI draft a better message…"
                className="h-20 text-sm"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button
                size="sm"
                data-testid="button-generate-draft"
                disabled={!messageType || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</> : <><Zap className="w-3.5 h-3.5 mr-1.5" />Generate Draft</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Generate Dialog ──────────────────────────────────────────────────

function BulkGenerateDialog({
  open,
  onClose,
  domain,
  prospects,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  domain: string;
  prospects: any[];
  onDone: () => void;
}) {
  const [messageType, setMessageType] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { toast } = useToast();
  const { data: messageTypes = [] } = useMessageTypes(domain);
  const domainCfg = OUTREACH_DOMAINS.find((d) => d.key === domain);

  const safeProspects = asArray<any>(prospects);
  const eligible = safeProspects.filter((p) => p.decisionMakerEmail || p.contactEmail).slice(0, 20);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-outreach/bulk-generate", {
      domain, messageType, prospectIds: selected,
    }).then(parseApiResponse),
    onSuccess: (data: any) => {
      toast({ title: `${data?.succeeded ?? 0} drafts queued in AI Comms Center` });
      setSelected([]); setMessageType(""); onDone(); onClose();
    },
    onError: (e: any) => toast({ title: "Bulk generate failed", description: e.message, variant: "destructive" }),
  });

  const toggleAll = () => setSelected(selected.length === eligible.length ? [] : eligible.map((p) => p.id));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Bulk Generate — {domainCfg?.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Message Type</Label>
            <Select value={messageType} onValueChange={setMessageType}>
              <SelectTrigger data-testid="select-bulk-message-type">
                <SelectValue placeholder="Select message type…" />
              </SelectTrigger>
              <SelectContent>
                {messageTypes.map((mt) => (
                  <SelectItem key={mt.value} value={mt.value}>{mt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Select Prospects ({selected.length} selected)</Label>
              <button className="text-xs text-primary underline" onClick={toggleAll} data-testid="button-select-all">
                {selected.length === eligible.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            {eligible.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No prospects with email addresses found in this domain.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {eligible.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => setSelected((prev) => prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id])}
                      className="rounded"
                      data-testid={`checkbox-prospect-${p.id}`}
                    />
                    <span className="flex-1 truncate">{p.prospectName}</span>
                    <span className="text-xs text-muted-foreground truncate">{p.decisionMakerEmail || p.contactEmail}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            All generated drafts require approval in the AI Communications Center before sending.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            data-testid="button-bulk-generate"
            disabled={!messageType || selected.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</>
              : <><Zap className="w-3.5 h-3.5 mr-1.5" />Generate {selected.length} Draft{selected.length !== 1 ? "s" : ""}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Prospect Row ──────────────────────────────────────────────────────────

function ProspectRow({ prospect, domain, onGenerate }: { prospect: any; domain: string; onGenerate: (p: any) => void }) {
  const hasEmail = !!(prospect.decisionMakerEmail || prospect.contactEmail);
  const contactName = prospect.decisionMakerName || prospect.contactName;
  const contactRole = prospect.decisionMakerTitle || prospect.contactRole;

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors group" data-testid={`row-prospect-${prospect.id}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{prospect.prospectName}</div>
        {contactName && (
          <div className="text-xs text-muted-foreground truncate">
            {contactName}{contactRole ? ` · ${contactRole}` : ""}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {[prospect.city !== "unknown" && prospect.city, prospect.state !== "unknown" && prospect.state].filter(Boolean).join(", ")}
          {prospect.sport && prospect.sport !== "unknown" && <> · {prospect.sport}</>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!hasEmail && (
          <Badge variant="outline" className="text-xs text-muted-foreground">No email</Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          data-testid={`button-generate-${prospect.id}`}
          disabled={!hasEmail}
          onClick={() => onGenerate(prospect)}
        >
          <Zap className="w-3 h-3 mr-1" />
          Generate Draft
        </Button>
      </div>
    </div>
  );
}

// ─── Domain Panel ──────────────────────────────────────────────────────────

function DomainPanel({ domainKey }: { domainKey: string }) {
  const [generateTarget, setGenerateTarget] = useState<any | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: rawProspects, isLoading } = useQuery<any>({
    queryKey: ["/api/ai-outreach/opportunities", domainKey],
    queryFn: () => safeFetch(`/api/ai-outreach/opportunities?domain=${domainKey}`),
  });
  const prospects = asArray<any>(rawProspects);

  const { data: rawRecentDrafts } = useQuery<any>({
    queryKey: ["/api/ai-outreach/recent", domainKey],
    queryFn: () => safeFetch(`/api/ai-outreach/recent?domain=${domainKey}`),
  });
  const recentDrafts = asArray<any>(rawRecentDrafts);

  const withEmail = prospects.filter((p) => p.decisionMakerEmail || p.contactEmail);
  const withoutEmail = prospects.filter((p) => !p.decisionMakerEmail && !p.contactEmail);
  const cfg = OUTREACH_DOMAINS.find((d) => d.key === domainKey);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ai-outreach/recent", domainKey] });
    queryClient.invalidateQueries({ queryKey: ["/api/ai-approvals"] });
  };

  if (isLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading prospects…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{prospects.length}</div>
            <div className="text-xs text-muted-foreground">Prospects</div>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{withEmail.length}</div>
            <div className="text-xs text-muted-foreground">With Email</div>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-primary">{recentDrafts.length}</div>
            <div className="text-xs text-muted-foreground">Pending Drafts</div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {withEmail.length > 0 && (
          <Button size="sm" variant="outline" data-testid={`button-bulk-open-${domainKey}`} onClick={() => setBulkOpen(true)}>
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            Bulk Generate Drafts ({withEmail.length})
          </Button>
        )}
        {recentDrafts.length > 0 && (
          <Button size="sm" variant="ghost" asChild>
            <a href="/admin/ai-approvals">
              <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
              Review {recentDrafts.length} pending in AI Comms Center
            </a>
          </Button>
        )}
      </div>

      {prospects.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No prospects found for this domain.</p>
          <p className="text-xs mt-1">Add prospects via the Team Training Leads page or CSV import.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {withEmail.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 px-2.5">Ready to contact ({withEmail.length})</div>
              {withEmail.map((p) => (
                <ProspectRow key={p.id} prospect={p} domain={domainKey} onGenerate={setGenerateTarget} />
              ))}
            </div>
          )}
          {withoutEmail.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 px-2.5">Missing email ({withoutEmail.length})</div>
              {withoutEmail.slice(0, 10).map((p) => (
                <ProspectRow key={p.id} prospect={p} domain={domainKey} onGenerate={setGenerateTarget} />
              ))}
              {withoutEmail.length > 10 && (
                <p className="text-xs text-muted-foreground px-2.5 mt-1">+{withoutEmail.length - 10} more without email</p>
              )}
            </div>
          )}
        </div>
      )}

      {generateTarget && (
        <GenerateDraftDialog
          open={!!generateTarget}
          onClose={() => setGenerateTarget(null)}
          domain={domainKey}
          prospect={generateTarget}
          onDone={invalidate}
        />
      )}

      <BulkGenerateDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        domain={domainKey}
        prospects={prospects}
        onDone={invalidate}
      />
    </div>
  );
}

// ─── Domain Summary Cards (overview) ──────────────────────────────────────

// ─── Employment Panel ──────────────────────────────────────────────────────
// Uses the dedicated employment_applicants table instead of prospects.

const APPLICANT_STATUS_OPTIONS = [
  { value: "new",                label: "New" },
  { value: "contacted",          label: "Contacted" },
  { value: "interview_requested",label: "Interview Requested" },
  { value: "interviewed",        label: "Interviewed" },
  { value: "offer_sent",         label: "Offer Sent" },
  { value: "hired",              label: "Hired" },
  { value: "rejected",           label: "Rejected" },
];

const APPLICANT_STATUS_COLOR: Record<string, string> = {
  new: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  interview_requested: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  interviewed: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  offer_sent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  hired: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function EmploymentPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [generateTarget, setGenerateTarget] = useState<any | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", roleAppliedFor: "", experienceLevel: "", location: "", source: "", notes: "" });

  const { data: rawApplicants, isLoading } = useQuery<any>({
    queryKey: ["/api/employment-applicants"],
    queryFn: () => safeFetch("/api/employment-applicants"),
  });
  const applicants = asArray<any>(rawApplicants);

  const { data: rawRecentDraftsEmp } = useQuery<any>({
    queryKey: ["/api/ai-outreach/recent", "employment_opportunity"],
    queryFn: () => safeFetch(`/api/ai-outreach/recent?domain=employment_opportunity`),
  });
  const recentDrafts = asArray<any>(rawRecentDraftsEmp);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/employment-applicants", data),
    onSuccess: () => {
      toast({ title: "Applicant added" });
      queryClient.invalidateQueries({ queryKey: ["/api/employment-applicants"] });
      setAddOpen(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", roleAppliedFor: "", experienceLevel: "", location: "", source: "", notes: "" });
    },
    onError: () => toast({ title: "Failed to add applicant", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/employment-applicants/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employment-applicants"] });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const byStatus: Record<string, number> = {};
  applicants.forEach((a) => { byStatus[a.status] = (byStatus[a.status] ?? 0) + 1; });

  if (isLoading) return <div className="text-center py-12 text-sm text-muted-foreground">Loading applicants…</div>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold">{applicants.length}</div>
            <div className="text-xs text-muted-foreground">Applicants</div>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-green-600">{byStatus.hired ?? 0}</div>
            <div className="text-xs text-muted-foreground">Hired</div>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-3">
            <div className="text-2xl font-bold text-primary">{recentDrafts.length}</div>
            <div className="text-xs text-muted-foreground">Pending Drafts</div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" data-testid="button-add-applicant" onClick={() => setAddOpen(true)}>
          <Users className="w-3.5 h-3.5 mr-1.5" />
          Add Applicant
        </Button>
        {recentDrafts.length > 0 && (
          <Button size="sm" variant="outline" asChild>
            <a href="/admin/ai-approvals">
              <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
              Review {recentDrafts.length} Pending Draft{recentDrafts.length !== 1 ? "s" : ""}
            </a>
          </Button>
        )}
      </div>

      {/* Applicant list */}
      {applicants.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No applicants yet. Add applicants to start generating outreach drafts.
        </div>
      ) : (
        <div className="space-y-1.5">
          {applicants.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors group border" data-testid={`row-applicant-${a.id}`}>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{a.firstName} {a.lastName}</div>
                <div className="text-xs text-muted-foreground">
                  {a.email}{a.roleAppliedFor && ` · ${a.roleAppliedFor}`}{a.location && ` · ${a.location}`}
                </div>
                {a.experienceLevel && (
                  <div className="text-xs text-muted-foreground">{a.experienceLevel} experience</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={a.status}
                  onValueChange={(val) => statusMutation.mutate({ id: a.id, status: val })}
                >
                  <SelectTrigger className="h-7 w-36 text-xs" data-testid={`select-status-${a.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLICANT_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid={`button-generate-${a.id}`}
                  onClick={() => setGenerateTarget({ ...a, prospectName: `${a.firstName} ${a.lastName}`, contactEmail: a.email, decisionMakerEmail: a.email, decisionMakerName: `${a.firstName} ${a.lastName}`, decisionMakerTitle: a.roleAppliedFor })}
                >
                  <Zap className="w-3 h-3 mr-1" />
                  Generate Draft
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add applicant dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Applicant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">First Name *</Label>
                <Input data-testid="input-first-name" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="Jane" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last Name *</Label>
                <Input data-testid="input-last-name" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email *</Label>
              <Input data-testid="input-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Role Applied For</Label>
                <Input data-testid="input-role" value={form.roleAppliedFor} onChange={(e) => setForm((f) => ({ ...f, roleAppliedFor: e.target.value }))} placeholder="S&C Coach" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Experience Level</Label>
                <Input data-testid="input-experience" value={form.experienceLevel} onChange={(e) => setForm((f) => ({ ...f, experienceLevel: e.target.value }))} placeholder="3 years" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Location</Label>
                <Input data-testid="input-location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Chicago, IL" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Source</Label>
                <Input data-testid="input-source" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="Indeed, referral…" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea data-testid="textarea-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" className="h-16 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" data-testid="button-save-applicant" disabled={!form.firstName || !form.lastName || !form.email || createMutation.isPending} onClick={() => createMutation.mutate(form)}>
              {createMutation.isPending ? "Saving…" : "Add Applicant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate draft dialog */}
      {generateTarget && (
        <GenerateDraftDialog
          open={!!generateTarget}
          onClose={() => setGenerateTarget(null)}
          domain="employment_opportunity"
          prospect={generateTarget}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/ai-outreach/recent", "employment_opportunity"] })}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DomainSummaryCard({ cfg, onSelect }: { cfg: typeof OUTREACH_DOMAINS[number]; onSelect: () => void }) {
  const { data: rawSummaryProspects } = useQuery<any>({
    queryKey: ["/api/ai-outreach/opportunities", cfg.key],
    queryFn: () => safeFetch(`/api/ai-outreach/opportunities?domain=${cfg.key}`),
    staleTime: 60_000,
  });
  const prospects = asArray<any>(rawSummaryProspects);

  const { data: rawSummaryDrafts } = useQuery<any>({
    queryKey: ["/api/ai-outreach/recent", cfg.key],
    queryFn: () => safeFetch(`/api/ai-outreach/recent?domain=${cfg.key}`),
    staleTime: 60_000,
  });
  const recentDrafts = asArray<any>(rawSummaryDrafts);

  const Icon = cfg.icon;
  const withEmail = prospects.filter((p: any) => p.decisionMakerEmail || p.contactEmail).length;

  return (
    <Card
      className={`border cursor-pointer transition-all hover:shadow-md ${cfg.bg}`}
      data-testid={`card-domain-${cfg.key}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={`p-2 rounded-lg bg-white/60 dark:bg-black/20 ${cfg.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          {recentDrafts.length > 0 && (
            <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
              {recentDrafts.length} pending
            </Badge>
          )}
        </div>
        <div className="font-semibold text-sm">{cfg.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5 mb-3">{cfg.description}</div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">{prospects.length} prospects</span>
          {withEmail > 0 && <span className={`font-medium ${cfg.color}`}>{withEmail} with email</span>}
        </div>
        <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
          <span>Open</span><ChevronRight className="w-3 h-3" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AdminAiOutreachOpportunitiesPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Outreach Opportunities</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Generate AI-drafted outreach for every business domain. All drafts require approval in the AI Comms Center.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href="/admin/ai-approvals">
              <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
              AI Comms Center
            </a>
          </Button>
        </div>
      </div>

      {/* Notice banner */}
      <div className="flex items-start gap-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 text-sm">
        <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <span className="text-blue-800 dark:text-blue-200">
          Generated drafts flow into the <strong>AI Communications Center</strong> for approval before sending. Learning rules improve generation quality over time per domain.
        </span>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1 w-full" data-testid="tabs-outreach-domains">
          <TabsTrigger value="overview" className="text-xs" data-testid="tab-overview">
            <Target className="w-3.5 h-3.5 mr-1" />
            Overview
          </TabsTrigger>
          {OUTREACH_DOMAINS.map((d) => {
            const Icon = d.icon;
            return (
              <TabsTrigger key={d.key} value={d.key} className="text-xs" data-testid={`tab-${d.key}`}>
                <Icon className="w-3.5 h-3.5 mr-1" />
                {d.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {OUTREACH_DOMAINS.map((cfg) => (
              <DomainSummaryCard
                key={cfg.key}
                cfg={cfg}
                onSelect={() => setActiveTab(cfg.key)}
              />
            ))}
          </div>
        </TabsContent>

        {/* Domain tabs */}
        {OUTREACH_DOMAINS.map((d) => (
          <TabsContent key={d.key} value={d.key} className="mt-4">
            <Card className="border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <d.icon className={`w-4 h-4 ${d.color}`} />
                  {d.label}
                  <Badge variant="outline" className="text-xs font-normal ml-1">{d.goal}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.key === "employment_opportunity" ? (
                  <EmploymentPanel />
                ) : (
                  <DomainPanel domainKey={d.key} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
