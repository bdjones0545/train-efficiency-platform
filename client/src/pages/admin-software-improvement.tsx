import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Bug, Zap, RefreshCw, Copy, Check, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Plus, Archive, Send, GitPullRequest,
  Filter, Play, ShieldAlert, Code, Wrench, Github, ExternalLink,
  CheckCircle2, Loader2, Eye,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GitHubIssueDraft {
  title: string;
  body: string;
  labels: string[];
  severity: string;
  affectedFiles: string;
  codexPromptSummary: string;
}

interface SoftwareTask {
  id: string;
  organizationId: string;
  sourceAgent: string;
  sourceType: string;
  sourceRefId?: string;
  title: string;
  problemSummary: string;
  businessContext?: string;
  affectedArea?: string;
  suspectedFiles?: string;
  reproductionSteps?: string;
  expectedBehavior?: string;
  constraints?: string;
  acceptanceChecks?: string;
  severity: string;
  priority: number;
  status: string;
  codexPrompt?: string;
  codexStatus?: string;
  codexBranch?: string;
  codexPrUrl?: string;
  githubIssueUrl?: string;
  githubApprovalQueueId?: string;
  githubIssueDraft?: GitHubIssueDraft;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface TasksResponse {
  tasks: SoftwareTask[];
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  canRunAgent: boolean;
  generatedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const STATUS_COLORS: Record<string, string> = {
  detected: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  triaged: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  ready_for_codex: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  sent_to_codex: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  merged: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
  github_issue_draft_requested: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  github_issue_created: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span data-testid={`badge-severity-${severity}`} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.medium}`}>
      {severity.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span data-testid={`badge-status-${status}`} className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.detected}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} data-testid="button-copy-prompt" className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

// ─── GitHub Issue Draft Dialog ─────────────────────────────────────────────────

function GitHubIssueDraftDialog({
  open,
  onClose,
  task,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  task: SoftwareTask;
  onRequested: () => void;
}) {
  const { toast } = useToast();
  const [showBody, setShowBody] = useState(false);

  const request = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/software-improvement/tasks/${task.id}/request-github-issue`),
    onSuccess: () => {
      toast({
        title: "GitHub issue draft queued",
        description: "The draft has been submitted for human approval. Review it in the approval queue.",
      });
      onRequested();
      onClose();
    },
    onError: (err: any) =>
      toast({ title: err?.message ?? "Failed to request GitHub issue", variant: "destructive" }),
  });

  const draft = task.githubIssueDraft ?? {
    title: `[${task.severity.toUpperCase()}] ${task.title}`,
    labels: [`severity:${task.severity}`, "ai-detected", "needs-review"],
    body: `## Problem Summary\n${task.problemSummary}\n\n## Affected Area\n${task.affectedArea ?? "Not specified"}\n\n## Suspected Files\n${task.suspectedFiles ?? "Not specified"}`,
    severity: task.severity,
    affectedFiles: task.suspectedFiles ?? "",
    codexPromptSummary: task.codexPrompt?.slice(0, 300) ?? "No prompt yet",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Issue Draft
          </DialogTitle>
          <DialogDescription>
            Review the proposed GitHub issue before submitting for approval. This will be queued — no GitHub write happens until an admin approves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Safety notice */}
          <div className="flex items-start gap-2 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2.5 text-sm text-violet-800 dark:text-violet-300">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Read-only + approval required.</strong> GitHub is in read-only mode for Phase 1. Submitting this will create an approval queue item — no GitHub issue is written until an admin explicitly approves it.
            </span>
          </div>

          {/* Title */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Proposed Title</p>
            <p className="text-sm font-medium bg-muted rounded px-3 py-2 font-mono" data-testid="text-github-draft-title">
              {draft.title}
            </p>
          </div>

          {/* Labels */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Labels</p>
            <div className="flex flex-wrap gap-1.5">
              {draft.labels.map((label) => (
                <span key={label} data-testid={`badge-github-label-${label}`} className="text-xs bg-muted border rounded px-2 py-0.5 font-mono">
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Severity + Files */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Severity</p>
              <SeverityBadge severity={draft.severity} />
            </div>
            {draft.affectedFiles && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Affected Files</p>
                <p className="text-xs font-mono text-muted-foreground truncate" data-testid="text-github-draft-files">
                  {draft.affectedFiles}
                </p>
              </div>
            )}
          </div>

          {/* Issue body preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issue Body</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowBody((v) => !v)} data-testid="button-toggle-body">
                  <Eye className="h-3 w-3 mr-1" /> {showBody ? "Hide" : "Preview"}
                </Button>
                <CopyButton text={draft.body} label="Copy Body" />
              </div>
            </div>
            {showBody && (
              <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap font-mono overflow-x-auto max-h-56 overflow-y-auto" data-testid="text-github-draft-body">
                {draft.body}
              </pre>
            )}
          </div>

          {/* Codex prompt summary */}
          {draft.codexPromptSummary && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Codex Prompt Summary</p>
              <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 line-clamp-3" data-testid="text-github-draft-codex-summary">
                {draft.codexPromptSummary}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-github-draft">Cancel</Button>
          <Button
            onClick={() => request.mutate()}
            disabled={request.isPending}
            data-testid="button-submit-github-draft"
            className="gap-1.5"
          >
            {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
            {request.isPending ? "Submitting..." : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── GitHub Approve Dialog ─────────────────────────────────────────────────────

function GitHubApproveDialog({
  open,
  onClose,
  task,
  onApproved,
}: {
  open: boolean;
  onClose: () => void;
  task: SoftwareTask;
  onApproved: () => void;
}) {
  const { toast } = useToast();
  const [showBody, setShowBody] = useState(false);

  const approve = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/software-improvement/tasks/${task.id}/approve-github-issue`),
    onSuccess: (res: any) => {
      toast({
        title: res.githubIssueUrl ? "GitHub issue created!" : "Execution attempted",
        description: res.message,
      });
      onApproved();
      onClose();
    },
    onError: (err: any) =>
      toast({ title: err?.message ?? "Execution failed", variant: "destructive" }),
  });

  const draft = task.githubIssueDraft;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Approve GitHub Issue Creation
          </DialogTitle>
          <DialogDescription>
            You are approving the creation of this GitHub issue via Composio. This action requires admin approval and cannot be undone automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              <strong>Final approval step.</strong> Clicking "Execute" will call the Composio GitHub API to create this issue. Ensure your GitHub account is connected in Composio first.
            </span>
          </div>

          {draft ? (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Issue Title</p>
                <p className="text-sm font-medium bg-muted rounded px-3 py-2 font-mono">{draft.title}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Labels</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.labels.map((label) => (
                    <span key={label} className="text-xs bg-muted border rounded px-2 py-0.5 font-mono">{label}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issue Body</p>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowBody((v) => !v)} data-testid="button-toggle-approve-body">
                    <Eye className="h-3 w-3 mr-1" /> {showBody ? "Hide" : "Preview"}
                  </Button>
                </div>
                {showBody && (
                  <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">
                    {draft.body}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No draft stored — the issue will be built from task data.</p>
          )}

          {task.githubApprovalQueueId && (
            <div className="text-xs text-muted-foreground border rounded px-3 py-2">
              <strong>Approval Queue ID:</strong> <span className="font-mono">{task.githubApprovalQueueId}</span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-approve">Cancel</Button>
          <Button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            data-testid="button-execute-github-issue"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {approve.isPending ? "Executing..." : "Execute GitHub Issue Creation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onRefresh }: { task: SoftwareTask; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showGitHubDraft, setShowGitHubDraft] = useState(false);
  const [showGitHubApprove, setShowGitHubApprove] = useState(false);
  const { toast } = useToast();

  const prepareCodex = useMutation({
    mutationFn: () => apiRequest("POST", `/api/software-improvement/tasks/${task.id}/prepare-codex`),
    onSuccess: () => { toast({ title: "Codex prompt prepared" }); onRefresh(); },
    onError: () => toast({ title: "Failed to prepare", variant: "destructive" }),
  });

  const markSent = useMutation({
    mutationFn: () => apiRequest("POST", `/api/software-improvement/tasks/${task.id}/mark-sent`),
    onSuccess: () => { toast({ title: "Marked as sent to Codex" }); onRefresh(); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const markReview = useMutation({
    mutationFn: () => apiRequest("POST", `/api/software-improvement/tasks/${task.id}/mark-review`),
    onSuccess: () => { toast({ title: "Marked for review" }); onRefresh(); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const archiveTask = useMutation({
    mutationFn: () => apiRequest("POST", `/api/software-improvement/tasks/${task.id}/archive`),
    onSuccess: () => { toast({ title: "Task archived" }); onRefresh(); },
    onError: () => toast({ title: "Failed to archive", variant: "destructive" }),
  });

  const isHighSeverity = ["high", "critical"].includes(task.severity);

  const statusActions: Record<string, JSX.Element | null> = {
    detected: (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => prepareCodex.mutate()} disabled={prepareCodex.isPending} data-testid="button-prepare-codex">
          <Code className="h-3.5 w-3.5 mr-1.5" /> Prepare Codex Prompt
        </Button>
        {isHighSeverity && (
          <Button size="sm" variant="outline" className="border-violet-400 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-900/20" onClick={() => setShowGitHubDraft(true)} data-testid="button-create-github-issue-draft">
            <Github className="h-3.5 w-3.5 mr-1.5" /> Create GitHub Issue Draft
          </Button>
        )}
      </div>
    ),
    triaged: (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => prepareCodex.mutate()} disabled={prepareCodex.isPending} data-testid="button-prepare-codex">
          <Code className="h-3.5 w-3.5 mr-1.5" /> Prepare Codex Prompt
        </Button>
        {isHighSeverity && (
          <Button size="sm" variant="outline" className="border-violet-400 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-900/20" onClick={() => setShowGitHubDraft(true)} data-testid="button-create-github-issue-draft">
            <Github className="h-3.5 w-3.5 mr-1.5" /> Create GitHub Issue Draft
          </Button>
        )}
      </div>
    ),
    ready_for_codex: (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" onClick={() => markSent.mutate()} disabled={markSent.isPending} data-testid="button-mark-sent">
          <Send className="h-3.5 w-3.5 mr-1.5" /> Mark Sent to Codex
        </Button>
        {isHighSeverity && (
          <Button size="sm" variant="outline" className="border-violet-400 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-900/20" onClick={() => setShowGitHubDraft(true)} data-testid="button-create-github-issue-draft">
            <Github className="h-3.5 w-3.5 mr-1.5" /> Create GitHub Issue Draft
          </Button>
        )}
      </div>
    ),
    sent_to_codex: (
      <Button size="sm" variant="outline" onClick={() => markReview.mutate()} disabled={markReview.isPending} data-testid="button-mark-review">
        <GitPullRequest className="h-3.5 w-3.5 mr-1.5" /> Mark PR Open
      </Button>
    ),
    in_progress: (
      <Button size="sm" variant="outline" onClick={() => markReview.mutate()} disabled={markReview.isPending} data-testid="button-mark-review">
        <GitPullRequest className="h-3.5 w-3.5 mr-1.5" /> Mark PR Open
      </Button>
    ),
    github_issue_draft_requested: (
      <div className="space-y-2 w-full">
        <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded px-3 py-2">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>GitHub issue draft is <strong>pending admin approval</strong>. Review in the approval queue, then execute below.</span>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => setShowGitHubApprove(true)}
          data-testid="button-approve-github-issue"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Create GitHub Issue
        </Button>
      </div>
    ),
    github_issue_created: null,
    needs_review: null,
    merged: null,
    rejected: null,
    archived: null,
  };

  return (
    <>
      <Card data-testid={`card-task-${task.id}`} className="border dark:border-gray-700">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <SeverityBadge severity={task.severity} />
                <StatusBadge status={task.status} />
                <span className="text-xs text-muted-foreground">Priority: {task.priority}</span>
              </div>
              <CardTitle className="text-sm font-semibold leading-snug" data-testid={`text-task-title-${task.id}`}>
                {task.title}
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setExpanded((v) => !v)}
              data-testid={`button-expand-${task.id}`}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
            <span data-testid={`text-source-agent-${task.id}`}>
              <strong>Source:</strong> {task.sourceAgent.replace(/_/g, " ")}
            </span>
            {task.affectedArea && (
              <span data-testid={`text-affected-area-${task.id}`}>
                <strong>Area:</strong> {task.affectedArea}
              </span>
            )}
            {task.githubIssueUrl && (
              <a
                href={task.githubIssueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                data-testid={`link-github-issue-${task.id}`}
              >
                <Github className="h-3 w-3" />
                View GitHub Issue
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="pt-0 space-y-3">
            {task.businessContext && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Business Context</p>
                <p className="text-sm" data-testid={`text-business-context-${task.id}`}>{task.businessContext}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Problem Summary</p>
              <p className="text-sm" data-testid={`text-problem-summary-${task.id}`}>{task.problemSummary}</p>
            </div>
            {task.suspectedFiles && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Suspected Files</p>
                <p className="text-sm font-mono text-xs bg-muted rounded px-2 py-1" data-testid={`text-suspected-files-${task.id}`}>{task.suspectedFiles}</p>
              </div>
            )}
            {task.reproductionSteps && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reproduction Steps</p>
                <p className="text-sm whitespace-pre-line" data-testid={`text-reproduction-steps-${task.id}`}>{task.reproductionSteps}</p>
              </div>
            )}
            {task.expectedBehavior && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Expected Behavior</p>
                <p className="text-sm" data-testid={`text-expected-behavior-${task.id}`}>{task.expectedBehavior}</p>
              </div>
            )}

            {task.codexPrompt && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Codex Prompt</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowPrompt((v) => !v)} data-testid="button-toggle-prompt">
                      {showPrompt ? "Hide" : "Preview"}
                    </Button>
                    <CopyButton text={task.codexPrompt} label="Copy Prompt" />
                  </div>
                </div>
                {showPrompt && (
                  <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap font-mono overflow-x-auto max-h-64 overflow-y-auto" data-testid="text-codex-prompt-preview">
                    {task.codexPrompt}
                  </pre>
                )}
              </div>
            )}

            {/* GitHub issue created info */}
            {task.status === "github_issue_created" && (
              <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">GitHub issue created via Composio</p>
                  {task.githubIssueUrl ? (
                    <a
                      href={task.githubIssueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 mt-0.5"
                      data-testid={`link-github-issue-detail-${task.id}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {task.githubIssueUrl}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">URL not returned — check GitHub directly.</p>
                  )}
                </div>
              </div>
            )}

            {/* GitHub draft stored info */}
            {task.githubIssueDraft && task.status === "github_issue_draft_requested" && (
              <div className="border rounded-lg px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stored GitHub Draft</p>
                  <CopyButton text={task.githubIssueDraft.body} label="Copy Body" />
                </div>
                <p className="text-xs font-mono bg-muted rounded px-2 py-1" data-testid="text-stored-draft-title">{task.githubIssueDraft.title}</p>
                <div className="flex flex-wrap gap-1">
                  {task.githubIssueDraft.labels.map((l) => (
                    <span key={l} className="text-xs bg-muted border rounded px-1.5 py-0.5 font-mono">{l}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1 border-t dark:border-gray-700">
              {statusActions[task.status] ?? null}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => archiveTask.mutate()}
                disabled={archiveTask.isPending || task.status === "archived"}
                data-testid={`button-archive-${task.id}`}
              >
                <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Created {new Date(task.createdAt).toLocaleDateString()}
              {task.completedAt && ` · Completed ${new Date(task.completedAt).toLocaleDateString()}`}
            </p>
          </CardContent>
        )}
      </Card>

      {showGitHubDraft && (
        <GitHubIssueDraftDialog
          open={showGitHubDraft}
          onClose={() => setShowGitHubDraft(false)}
          task={task}
          onRequested={() => {
            onRefresh();
            queryClient.invalidateQueries({ queryKey: ["/api/software-improvement/tasks"] });
          }}
        />
      )}

      {showGitHubApprove && (
        <GitHubApproveDialog
          open={showGitHubApprove}
          onClose={() => setShowGitHubApprove(false)}
          task={task}
          onApproved={() => {
            onRefresh();
            queryClient.invalidateQueries({ queryKey: ["/api/software-improvement/tasks"] });
          }}
        />
      )}
    </>
  );
}

// ─── Create Task Dialog ────────────────────────────────────────────────────────

function CreateTaskDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "", problemSummary: "", businessContext: "", affectedArea: "",
    suspectedFiles: "", reproductionSteps: "", expectedBehavior: "", severity: "medium",
  });

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/software-improvement/tasks", form),
    onSuccess: () => {
      toast({ title: "Task created successfully" });
      setForm({ title: "", problemSummary: "", businessContext: "", affectedArea: "", suspectedFiles: "", reproductionSteps: "", expectedBehavior: "", severity: "medium" });
      onSuccess();
      onClose();
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a Bug / Issue</DialogTitle>
          <DialogDescription>Create a software improvement task for the Codex workflow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="input-title">Title *</Label>
            <Input id="input-title" data-testid="input-title" value={form.title} onChange={update("title")} placeholder="Brief description of the problem" />
          </div>
          <div>
            <Label htmlFor="input-problem">Problem Summary *</Label>
            <Textarea id="input-problem" data-testid="input-problem-summary" value={form.problemSummary} onChange={update("problemSummary")} placeholder="What is broken and how does it manifest?" rows={3} />
          </div>
          <div>
            <Label htmlFor="input-severity">Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
              <SelectTrigger data-testid="select-severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="input-area">Affected Area</Label>
            <Input id="input-area" data-testid="input-affected-area" value={form.affectedArea} onChange={update("affectedArea")} placeholder="e.g., Scheduling, Email Agent, Dashboard" />
          </div>
          <div>
            <Label htmlFor="input-files">Suspected Files / Routes</Label>
            <Input id="input-files" data-testid="input-suspected-files" value={form.suspectedFiles} onChange={update("suspectedFiles")} placeholder="e.g., server/routes.ts, client/src/pages/..." />
          </div>
          <div>
            <Label htmlFor="input-steps">Reproduction Steps</Label>
            <Textarea id="input-steps" data-testid="input-reproduction-steps" value={form.reproductionSteps} onChange={update("reproductionSteps")} placeholder="1. Go to...\n2. Click...\n3. Observe..." rows={3} />
          </div>
          <div>
            <Label htmlFor="input-expected">Expected Behavior</Label>
            <Textarea id="input-expected" data-testid="input-expected-behavior" value={form.expectedBehavior} onChange={update("expectedBehavior")} placeholder="What should happen instead?" rows={2} />
          </div>
          <div>
            <Label htmlFor="input-context">Business Context</Label>
            <Textarea id="input-context" data-testid="input-business-context" value={form.businessContext} onChange={update("businessContext")} placeholder="Why does this matter to the business?" rows={2} />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-create">Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.title || !form.problemSummary} data-testid="button-submit-create">
            {create.isPending ? "Creating..." : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSoftwareImprovementPage() {
  const { toast } = useToast();
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch } = useQuery<TasksResponse>({
    queryKey: ["/api/software-improvement/tasks"],
    staleTime: 30_000,
  });

  const runAgent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/software-improvement/run"),
    onSuccess: (res: any) => {
      toast({
        title: "Software Improvement Agent ran",
        description: `${res.tasksCreated ?? 0} new task(s) created, ${res.tasksSkipped ?? 0} skipped.`,
      });
      refetch();
    },
    onError: (err: any) => toast({ title: err?.message ?? "Agent run failed", variant: "destructive" }),
  });

  const tasks = data?.tasks ?? [];

  const filtered = tasks.filter((t) => {
    if (filterSeverity !== "all" && t.severity !== filterSeverity) return false;
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterSource !== "all" && t.sourceAgent !== filterSource) return false;
    return true;
  });

  const uniqueSources = [...new Set(tasks.map((t) => t.sourceAgent))];

  const githubDraftCount = tasks.filter((t) => t.status === "github_issue_draft_requested").length;
  const githubCreatedCount = tasks.filter((t) => t.status === "github_issue_created").length;

  const stats = [
    { label: "Total Tasks", value: tasks.length, icon: Wrench, color: "text-blue-600" },
    { label: "Critical", value: data?.bySeverity?.critical ?? 0, icon: ShieldAlert, color: "text-red-600" },
    { label: "High", value: data?.bySeverity?.high ?? 0, icon: AlertTriangle, color: "text-orange-600" },
    { label: "Ready for Codex", value: data?.byStatus?.ready_for_codex ?? 0, icon: Code, color: "text-cyan-600" },
    { label: "GitHub Pending", value: githubDraftCount, icon: Github, color: "text-violet-600" },
    { label: "GitHub Created", value: githubCreatedCount, icon: CheckCircle2, color: "text-emerald-600" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bug className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold" data-testid="heading-software-improvement">Software Improvement</h1>
          </div>
          <p className="text-sm text-muted-foreground">AI-detected engineering tasks, ready for the Codex workflow. Human review required before any code changes.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAgent.mutate()}
            disabled={runAgent.isPending || !data?.canRunAgent}
            data-testid="button-run-agent"
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {runAgent.isPending ? "Scanning..." : "Run Agent Scan"}
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-task" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Report Issue
          </Button>
        </div>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <strong>Safety guardrails active.</strong> Codex cannot merge PRs automatically. GitHub issue creation via Composio is <strong>approval-required</strong> and only available for high/critical tasks. No autonomous financial or code-write actions.
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <Card key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* GitHub pending alert */}
      {githubDraftCount > 0 && (
        <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg px-4 py-3 text-sm text-violet-800 dark:text-violet-300">
          <Github className="h-4 w-4 shrink-0" />
          <span>
            <strong>{githubDraftCount} GitHub issue{githubDraftCount > 1 ? "s" : ""} pending approval.</strong>{" "}
            Expand the task{githubDraftCount > 1 ? "s" : ""} marked <em>github issue draft requested</em> and click "Approve &amp; Create GitHub Issue" to execute.
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-36 h-8" data-testid="select-filter-severity"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48 h-8" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="detected">Detected</SelectItem>
            <SelectItem value="triaged">Triaged</SelectItem>
            <SelectItem value="ready_for_codex">Ready for Codex</SelectItem>
            <SelectItem value="sent_to_codex">Sent to Codex</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="needs_review">Needs Review</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="github_issue_draft_requested">GitHub Draft Requested</SelectItem>
            <SelectItem value="github_issue_created">GitHub Issue Created</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-44 h-8" data-testid="select-filter-source"><SelectValue placeholder="Source Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            {uniqueSources.filter((s) => s !== "manual").map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterSeverity !== "all" || filterStatus !== "all" || filterSource !== "all") && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterSeverity("all"); setFilterStatus("all"); setFilterSource("all"); }} data-testid="button-clear-filters">
            Clear filters
          </Button>
        )}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="h-24 animate-pulse bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="state-empty">
          <Bug className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No tasks found</p>
          <p className="text-sm mt-1">
            {tasks.length === 0 ? "Run the agent scan or report an issue manually to get started." : "Try adjusting your filters."}
          </p>
          {tasks.length === 0 && (
            <Button className="mt-4" onClick={() => runAgent.mutate()} disabled={runAgent.isPending || !data?.canRunAgent} data-testid="button-run-agent-empty">
              <Play className="h-4 w-4 mr-2" />
              Run First Scan
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="list-tasks">
          <p className="text-xs text-muted-foreground">{filtered.length} task{filtered.length !== 1 ? "s" : ""}</p>
          {filtered.map((task) => (
            <TaskCard key={task.id} task={task} onRefresh={refetch} />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["/api/software-improvement/tasks"] }); }}
      />
    </div>
  );
}
