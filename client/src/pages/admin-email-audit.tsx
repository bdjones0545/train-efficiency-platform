import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileText,
  Mail,
  Shield,
  Filter,
  RefreshCw,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuditRecord {
  id: string;
  organization_id: string;
  channel: string;
  source_system: string;
  source_record_id?: string;
  recipient_email: string;
  recipient_name?: string;
  subject?: string;
  email_type?: string;
  triggered_by?: string;
  auto_sent: boolean;
  approval_required: boolean;
  approval_status?: string;
  policy_decision?: string;
  guard_result?: string;
  status: string;
  provider_message_id?: string;
  error_message?: string;
  sent_at?: string;
  created_at: string;
}

interface AuditStats {
  totalSent: number;
  totalBlocked: number;
  totalFailed: number;
  totalDraftCreated: number;
  totalAutoSent: number;
  totalApprovalRequired: number;
  sendgridCount: number;
  gmailCount: number;
  agentmailCount: number;
  last24hTotal: number;
  last24hSent: number;
  last24hBlocked: number;
}

const STATUS_STYLES: Record<string, { color: string; icon: typeof CheckCircle; label: string }> = {
  sent: { color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle, label: "Sent" },
  blocked: { color: "bg-red-100 text-red-800 border-red-200", icon: XCircle, label: "Blocked" },
  failed: { color: "bg-orange-100 text-orange-800 border-orange-200", icon: AlertTriangle, label: "Failed" },
  draft_created: { color: "bg-blue-100 text-blue-800 border-blue-200", icon: FileText, label: "Draft Created" },
};

const CHANNEL_STYLES: Record<string, string> = {
  sendgrid: "bg-indigo-100 text-indigo-800",
  gmail: "bg-purple-100 text-purple-800",
  agentmail: "bg-cyan-100 text-cyan-800",
};

const SOURCE_LABELS: Record<string, string> = {
  follow_up_cron: "Follow-Up Cron",
  auto_execution_engine: "Auto-Execute",
  scheduled_email_agent: "Scheduled Agent",
  agent_tool: "Agent Tool",
  agentmail_reply: "AgentMail Reply",
  transactional: "Transactional",
  gmail_agent: "Gmail Agent",
};

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  "data-testid": testId,
}: {
  label: string;
  value: number;
  icon: typeof CheckCircle;
  color: string;
  "data-testid"?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditRow({ record }: { record: AuditRecord }) {
  const statusInfo = STATUS_STYLES[record.status] ?? STATUS_STYLES.failed;
  const StatusIcon = statusInfo.icon;
  const channelClass = CHANNEL_STYLES[record.channel] ?? "bg-gray-100 text-gray-800";
  const sourceLabel = SOURCE_LABELS[record.source_system] ?? record.source_system;
  const when = new Date(record.created_at).toLocaleString();

  return (
    <div
      className="grid grid-cols-[auto_1fr_auto] gap-3 p-3 border rounded-lg text-sm hover:bg-muted/30 transition-colors"
      data-testid={`audit-row-${record.id}`}
    >
      <div className="flex items-start pt-0.5">
        <StatusIcon className={`w-4 h-4 ${record.status === "sent" ? "text-green-600" : record.status === "blocked" ? "text-red-600" : "text-orange-500"}`} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5 mb-1">
          <Badge variant="outline" className={`text-xs ${channelClass}`}>
            {record.channel.toUpperCase()}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {sourceLabel}
          </Badge>
          {record.auto_sent && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
              Auto-Sent
            </Badge>
          )}
          {record.approval_required && (
            <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
              Approval Required
            </Badge>
          )}
          {record.guard_result && record.guard_result !== "passed" && (
            <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
              {record.guard_result.replace("blocked_", "").replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="font-medium truncate" data-testid={`audit-subject-${record.id}`}>
          {record.subject ?? "(no subject)"}
        </div>
        <div className="text-muted-foreground flex items-center gap-1">
          <ArrowRight className="w-3 h-3" />
          <span data-testid={`audit-recipient-${record.id}`}>{record.recipient_email}</span>
          {record.recipient_name && <span className="text-muted-foreground/60">({record.recipient_name})</span>}
        </div>
        {record.error_message && (
          <div className="text-red-600 text-xs mt-1 truncate" data-testid={`audit-error-${record.id}`}>
            ✕ {record.error_message}
          </div>
        )}
      </div>
      <div className="text-right text-muted-foreground whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{when}</span>
        </div>
        <Badge className={`text-xs mt-1 border ${statusInfo.color}`} variant="outline">
          {statusInfo.label}
        </Badge>
      </div>
    </div>
  );
}

export default function AdminEmailAuditPage() {
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [autoSentFilter, setAutoSentFilter] = useState<string>("all");
  const [recipientFilter, setRecipientFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;

  const { data: stats, isLoading: statsLoading } = useQuery<AuditStats>({
    queryKey: ["/api/email-audit/stats"],
    staleTime: 30_000,
  });

  const { data: auditData, isLoading: logLoading, refetch } = useQuery<{ rows: AuditRecord[]; total: number }>({
    queryKey: [
      "/api/email-audit",
      channelFilter,
      statusFilter,
      autoSentFilter,
      recipientFilter,
      offset,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (autoSentFilter === "true") params.set("autoSent", "true");
      if (autoSentFilter === "false") params.set("autoSent", "false");
      if (recipientFilter.trim()) params.set("recipientEmail", recipientFilter.trim());
      const res = await fetch(`/api/email-audit?${params}`);
      return res.json();
    },
    staleTime: 15_000,
  });

  const rows = auditData?.rows ?? [];
  const total = auditData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function resetFilters() {
    setChannelFilter("all");
    setStatusFilter("all");
    setAutoSentFilter("all");
    setRecipientFilter("");
    setOffset(0);
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Email Send Audit Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Unified visibility across all automated email channels — every send, block, draft, or failure.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-audit">
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Phase 8 — Safety Warning Banner */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
        <div className="text-sm">
          <span className="font-semibold">Communication Safety Active:</span>{" "}
          Gmail agent tool sends are routed to Drafts only. All automated outreach goes through the Send Guard
          chain (emergency pause → suppression → daily cap → cross-channel 24h window). Policy errors default
          to <em>approval_required</em>, not auto-execute.
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Sent"
          value={stats?.totalSent ?? 0}
          icon={CheckCircle}
          color="bg-green-100 text-green-700"
          data-testid="stat-total-sent"
        />
        <StatCard
          label="Blocked"
          value={stats?.totalBlocked ?? 0}
          icon={XCircle}
          color="bg-red-100 text-red-700"
          data-testid="stat-total-blocked"
        />
        <StatCard
          label="Auto-Sent"
          value={stats?.totalAutoSent ?? 0}
          icon={Mail}
          color="bg-indigo-100 text-indigo-700"
          data-testid="stat-total-auto-sent"
        />
        <StatCard
          label="Approval Required"
          value={stats?.totalApprovalRequired ?? 0}
          icon={Shield}
          color="bg-purple-100 text-purple-700"
          data-testid="stat-total-approval-required"
        />
      </div>

      {/* Last 24h row */}
      {stats && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span data-testid="stat-24h-total">
            <strong className="text-foreground">{stats.last24hTotal}</strong> emails in last 24h
          </span>
          <span>·</span>
          <span data-testid="stat-24h-sent">
            <strong className="text-green-700">{stats.last24hSent}</strong> sent
          </span>
          <span>·</span>
          <span data-testid="stat-24h-blocked">
            <strong className="text-red-700">{stats.last24hBlocked}</strong> blocked
          </span>
          <span>·</span>
          <span>
            Channels: <strong className="text-indigo-700">{stats.sendgridCount}</strong> SendGrid /{" "}
            <strong className="text-purple-700">{stats.gmailCount}</strong> Gmail /{" "}
            <strong className="text-cyan-700">{stats.agentmailCount}</strong> AgentMail
          </span>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Channel</Label>
              <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setOffset(0); }} data-testid="select-channel-filter">
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="sendgrid">SendGrid</SelectItem>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="agentmail">AgentMail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }} data-testid="select-status-filter">
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="draft_created">Draft Created</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Auto-Sent</Label>
              <Select value={autoSentFilter} onValueChange={(v) => { setAutoSentFilter(v); setOffset(0); }} data-testid="select-autosent-filter">
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Auto-sent only</SelectItem>
                  <SelectItem value="false">Human-sent only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Recipient</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Search email..."
                value={recipientFilter}
                onChange={(e) => { setRecipientFilter(e.target.value); setOffset(0); }}
                data-testid="input-recipient-filter"
              />
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={resetFilters} data-testid="button-reset-filters">
            Reset filters
          </Button>
        </CardContent>
      </Card>

      {/* Log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted-foreground" data-testid="text-total-records">
            {total.toLocaleString()} records {total !== rows.length && `(showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)})`}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {logLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="text-empty-audit">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No audit records yet</p>
            <p className="text-sm mt-1">
              Records appear here as automated emails are sent, blocked, or drafted.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((record) => (
              <AuditRow key={record.id} record={record} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
