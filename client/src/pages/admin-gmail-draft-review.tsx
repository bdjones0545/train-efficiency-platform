import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  XCircle,
  Bot,
  Shield,
  Eye,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GmailDraftRequest {
  id: string;
  org_id: string;
  agent_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  purpose: string;
  risk_level: "low" | "medium" | "high";
  approval_queue_id: string | null;
  gmail_draft_id: string | null;
  status: "pending_request" | "draft_queued" | "draft_created" | "cancelled";
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending_request: { label: "Pending",     color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Clock },
  draft_queued:    { label: "Awaiting Approval", color: "bg-blue-100 text-blue-800 border-blue-200",   icon: Clock },
  draft_created:   { label: "Draft Created", color: "bg-green-100 text-green-800 border-green-200",   icon: CheckCircle2 },
  cancelled:       { label: "Cancelled",    color: "bg-gray-100 text-gray-600 border-gray-200",       icon: XCircle },
};

const RISK_CONFIG: Record<string, { label: string; color: string }> = {
  low:    { label: "Low",    color: "bg-green-100 text-green-700 border-green-200" },
  medium: { label: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  high:   { label: "High",   color: "bg-red-100 text-red-700 border-red-200" },
};

const AGENT_LABELS: Record<string, string> = {
  revenue_agent:       "Revenue Agent",
  scheduling_agent:    "Scheduling Agent",
  communication_agent: "Communication Agent",
  ceo_heartbeat:       "CEO Heartbeat",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600", icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const cfg = RISK_CONFIG[risk] ?? { label: risk, color: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.color}`}>
      {cfg.label} Risk
    </span>
  );
}

function AgentBadge({ agentId }: { agentId: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-xs font-medium">
      <Bot className="w-3 h-3" />
      {AGENT_LABELS[agentId] ?? agentId}
    </span>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Draft Card ───────────────────────────────────────────────────────────────

function DraftCard({ draft, onApprove, onCancel, isApproving, isCancelling }: {
  draft: GmailDraftRequest;
  onApprove?: (id: string) => void;
  onCancel?: (id: string) => void;
  isApproving?: boolean;
  isCancelling?: boolean;
}) {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const isActionable = draft.status === "draft_queued";
  const hasError = !!draft.error_message;

  return (
    <Card
      data-testid={`card-draft-${draft.id}`}
      className="border border-gray-200 shadow-sm"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-2 items-center">
            <AgentBadge agentId={draft.agent_id} />
            <StatusBadge status={draft.status} />
            <RiskBadge risk={draft.risk_level} />
          </div>
          <span className="text-xs text-gray-400">{formatDate(draft.created_at)}</span>
        </div>
        <CardTitle className="text-sm font-semibold text-gray-900 mt-2">
          {draft.subject}
        </CardTitle>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Mail className="w-3 h-3" />
          <span data-testid={`text-recipient-${draft.id}`}>{draft.recipient_email}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Purpose */}
        <div className="rounded-md bg-blue-50 border border-blue-100 p-2">
          <p className="text-xs text-blue-700 font-medium mb-0.5">Purpose</p>
          <p className="text-xs text-blue-900" data-testid={`text-purpose-${draft.id}`}>{draft.purpose}</p>
        </div>

        {/* Body preview */}
        <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500 font-medium">Email Body</p>
            <button
              data-testid={`button-toggle-body-${draft.id}`}
              onClick={() => setBodyExpanded(!bodyExpanded)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              {bodyExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <p className={`text-xs text-gray-700 whitespace-pre-line ${bodyExpanded ? "" : "line-clamp-3"}`}>
            {draft.body}
          </p>
        </div>

        {/* Metadata rows */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-400">Approval Queue ID</span>
            <p className="text-gray-700 font-mono text-xs truncate" data-testid={`text-queue-id-${draft.id}`}>
              {draft.approval_queue_id ?? "—"}
            </p>
          </div>
          {draft.gmail_draft_id && (
            <div>
              <span className="text-gray-400">Gmail Draft ID</span>
              <p className="text-gray-700 font-mono text-xs truncate" data-testid={`text-draft-id-${draft.id}`}>
                {draft.gmail_draft_id}
              </p>
            </div>
          )}
        </div>

        {/* Error message */}
        {hasError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-2">
            <div className="flex items-center gap-1 text-xs text-red-700 font-medium mb-0.5">
              <AlertCircle className="w-3 h-3" />
              Last Attempt Failed — Retryable
            </div>
            <p className="text-xs text-red-600" data-testid={`text-error-${draft.id}`}>{draft.error_message}</p>
          </div>
        )}

        {/* Actions */}
        {isActionable && onApprove && onCancel && (
          <>
            <Separator />
            <div className="flex items-center gap-2">
              <Button
                data-testid={`button-approve-${draft.id}`}
                size="sm"
                onClick={() => onApprove(draft.id)}
                disabled={isApproving || isCancelling}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              >
                {isApproving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {hasError ? "Retry Draft" : "Approve & Create Draft"}
              </Button>
              <Button
                data-testid={`button-cancel-${draft.id}`}
                size="sm"
                variant="outline"
                onClick={() => onCancel(draft.id)}
                disabled={isApproving || isCancelling}
                className="flex items-center gap-1.5 text-gray-600"
              >
                {isCancelling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                Cancel
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminGmailDraftReviewPage() {
  const { toast } = useToast();
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "cancel" | null>(null);

  const pendingQuery = useQuery<{ drafts: GmailDraftRequest[]; count: number }>({
    queryKey: ["/api/composio/gmail-draft/pending"],
    staleTime: 30_000,
  });

  const allQuery = useQuery<{ drafts: GmailDraftRequest[]; count: number }>({
    queryKey: ["/api/composio/gmail-draft/all"],
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/composio/gmail-draft/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/composio/gmail-draft/all"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/composio/gmail-draft/${id}/approve`).then(r => r.json()),
    onMutate: (id) => { setActioningId(id); setActionType("approve"); },
    onSuccess: (data: any) => {
      toast({
        title: "Gmail Draft Created",
        description: data.message ?? "Draft successfully created in Gmail.",
      });
      invalidate();
    },
    onError: (err: any) => {
      toast({
        title: "Draft Creation Failed",
        description: err.message ?? "Composio execution failed. The request remains retryable.",
        variant: "destructive",
      });
      invalidate();
    },
    onSettled: () => { setActioningId(null); setActionType(null); },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/composio/gmail-draft/${id}/cancel`),
    onMutate: (id) => { setActioningId(id); setActionType("cancel"); },
    onSuccess: () => {
      toast({ title: "Request Cancelled", description: "Draft request has been cancelled." });
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
      invalidate();
    },
    onSettled: () => { setActioningId(null); setActionType(null); },
  });

  const pending = pendingQuery.data?.drafts ?? [];
  const all = allQuery.data?.drafts ?? [];
  const created = all.filter((d) => d.status === "draft_created");
  const cancelled = all.filter((d) => d.status === "cancelled");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900" data-testid="text-page-title">
              Gmail Draft Review
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Review and approve agent-requested Gmail draft creations.
            No email is ever sent — only drafts are created.
          </p>
        </div>
        <Button
          data-testid="button-refresh"
          variant="outline"
          size="sm"
          onClick={invalidate}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Safety notice */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex items-start gap-2">
        <Shield className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <span className="font-semibold">Draft-only mode.</span>{" "}
          Approving creates a draft in Gmail — it does not send. The agent cannot
          send emails autonomously. GMAIL_SEND_EMAIL is blocked in the tool registry.
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3" data-testid="stats-row">
        {[
          { label: "Pending Approval", value: pending.length, color: "text-blue-600", testId: "stat-pending" },
          { label: "Drafts Created",   value: created.length, color: "text-green-600", testId: "stat-created" },
          { label: "Cancelled",        value: cancelled.length, color: "text-gray-500", testId: "stat-cancelled" },
        ].map(({ label, value, color, testId }) => (
          <Card key={label} className="border border-gray-200">
            <CardContent className="p-3 text-center">
              <p className={`text-2xl font-bold ${color}`} data-testid={testId}>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList data-testid="tabs-list">
          <TabsTrigger data-testid="tab-pending" value="pending">
            Pending{pending.length > 0 ? ` (${pending.length})` : ""}
          </TabsTrigger>
          <TabsTrigger data-testid="tab-created" value="created">Created</TabsTrigger>
          <TabsTrigger data-testid="tab-cancelled" value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger data-testid="tab-all" value="all">All</TabsTrigger>
        </TabsList>

        {/* Pending */}
        <TabsContent value="pending" className="mt-4 space-y-4">
          {pendingQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading pending drafts…
            </div>
          ) : pending.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No pending draft requests.</p>
              </CardContent>
            </Card>
          ) : (
            pending.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onApprove={(id) => approveMutation.mutate(id)}
                onCancel={(id) => cancelMutation.mutate(id)}
                isApproving={actioningId === draft.id && actionType === "approve"}
                isCancelling={actioningId === draft.id && actionType === "cancel"}
              />
            ))
          )}
        </TabsContent>

        {/* Created */}
        <TabsContent value="created" className="mt-4 space-y-4">
          {allQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : created.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No drafts have been created yet.
              </CardContent>
            </Card>
          ) : (
            created.map((draft) => <DraftCard key={draft.id} draft={draft} />)
          )}
        </TabsContent>

        {/* Cancelled */}
        <TabsContent value="cancelled" className="mt-4 space-y-4">
          {cancelled.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No cancelled requests.
              </CardContent>
            </Card>
          ) : (
            cancelled.map((draft) => <DraftCard key={draft.id} draft={draft} />)
          )}
        </TabsContent>

        {/* All */}
        <TabsContent value="all" className="mt-4 space-y-4">
          {allQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : all.length === 0 ? (
            <Card className="border border-dashed border-gray-200">
              <CardContent className="py-12 text-center text-gray-400 text-sm">
                No draft requests found.
              </CardContent>
            </Card>
          ) : (
            all.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onApprove={draft.status === "draft_queued" ? (id) => approveMutation.mutate(id) : undefined}
                onCancel={draft.status === "draft_queued" ? (id) => cancelMutation.mutate(id) : undefined}
                isApproving={actioningId === draft.id && actionType === "approve"}
                isCancelling={actioningId === draft.id && actionType === "cancel"}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
