import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, Calendar, Zap, ChevronRight, Trash2, Edit2,
  TrendingUp, Target, Briefcase, Loader2, MessageSquare,
  Phone, FileText, Sparkles, CheckCircle, XCircle, Plus,
} from "lucide-react";
import type { TeamTrainingDeal, TeamTrainingProspect } from "@shared/schema";

type DealWithProspect = TeamTrainingDeal & { prospect?: TeamTrainingProspect };

const DEAL_STATUSES = [
  { key: "new", label: "New", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800" },
  { key: "interested", label: "Interested", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
  { key: "call_scheduled", label: "Call Scheduled", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-800" },
  { key: "proposal_sent", label: "Proposal Sent", color: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400", border: "border-yellow-200 dark:border-yellow-800" },
  { key: "won", label: "Won", color: "bg-green-500/15 text-green-700 dark:text-green-400", border: "border-green-200 dark:border-green-800" },
  { key: "lost", label: "Lost", color: "bg-red-500/15 text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
];

const KANBAN_COLUMNS = [
  { key: "new", label: "New" },
  { key: "interested", label: "Interested" },
  { key: "call_scheduled", label: "Call Scheduled" },
  { key: "proposal_sent", label: "Proposal Sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

function timeAgo(date: string | Date | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusInfo(key: string) {
  return DEAL_STATUSES.find(s => s.key === key) ?? DEAL_STATUSES[0];
}

function DealCard({
  deal,
  onEdit,
  onDelete,
  onAiAction,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  deal: DealWithProspect;
  onEdit: (d: DealWithProspect) => void;
  onDelete: (id: string) => void;
  onAiAction: (deal: DealWithProspect, action: string) => void;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const info = statusInfo(deal.status);
  return (
    <Card
      draggable
      onDragStart={() => onDragStart(deal.id)}
      onDragEnd={onDragEnd}
      className={`p-3 space-y-2 cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? "opacity-40" : ""}`}
      data-testid={`card-deal-${deal.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" data-testid={`text-deal-name-${deal.id}`}>
            {deal.prospect?.prospectName ?? "Unknown Team"}
          </p>
          <p className="text-xs text-muted-foreground">{deal.prospect?.sport ?? "—"}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onEdit(deal)} data-testid={`button-edit-deal-${deal.id}`}>
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-600" onClick={() => onDelete(deal.id)} data-testid={`button-delete-deal-${deal.id}`}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-medium">
          <DollarSign className="h-3 w-3" />
          {deal.estimatedValue > 0 ? `$${deal.estimatedValue.toLocaleString()}` : "No estimate"}
        </span>
        <span className="text-muted-foreground">{deal.probability}% probability</span>
      </div>

      {deal.nextAction && (
        <div className="flex items-start gap-1 text-xs bg-muted/60 rounded px-2 py-1">
          <ChevronRight className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
          <span className="text-muted-foreground line-clamp-2">{deal.nextAction}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {timeAgo(deal.lastActivityAt)}
        </span>
      </div>

      <div className="flex gap-1 flex-wrap pt-1">
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => onAiAction(deal, "generate_response")} data-testid={`button-ai-response-${deal.id}`}>
          <MessageSquare className="h-3 w-3 mr-1" /> Respond
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => onAiAction(deal, "suggest_next_step")} data-testid={`button-ai-next-${deal.id}`}>
          <Zap className="h-3 w-3 mr-1" /> Next Step
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => onAiAction(deal, "create_proposal")} data-testid={`button-ai-proposal-${deal.id}`}>
          <FileText className="h-3 w-3 mr-1" /> Proposal
        </Button>
      </div>
    </Card>
  );
}

function KanbanColumn({
  column,
  deals,
  onEdit,
  onDelete,
  onAiAction,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  column: { key: string; label: string };
  deals: DealWithProspect[];
  onEdit: (d: DealWithProspect) => void;
  onDelete: (id: string) => void;
  onAiAction: (deal: DealWithProspect, action: string) => void;
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (status: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const info = statusInfo(column.key);
  const colValue = deals.reduce((s, d) => s + d.estimatedValue, 0);

  return (
    <div
      className={`flex flex-col min-w-[220px] max-w-[260px] flex-1 rounded-lg border bg-muted/30 transition-colors ${isOver && draggingId ? "bg-primary/5 border-primary/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={() => { setIsOver(false); onDrop(column.key); }}
      data-testid={`column-${column.key}`}
    >
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center rounded-full w-5 h-5 text-xs font-bold ${info.color}`}>{deals.length}</span>
          <span className="font-medium text-sm">{column.label}</span>
        </div>
        {colValue > 0 && (
          <span className="text-xs text-muted-foreground">${colValue.toLocaleString()}</span>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-[100px] overflow-y-auto max-h-[600px]">
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            onEdit={onEdit}
            onDelete={onDelete}
            onAiAction={onAiAction}
            isDragging={draggingId === deal.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
        {deals.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-muted-foreground italic">
            Drop deals here
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminTeamTrainingDealsPage() {
  const { toast } = useToast();
  const [editDeal, setEditDeal] = useState<DealWithProspect | null>(null);
  const [editForm, setEditForm] = useState<Partial<DealWithProspect>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiActionLabel, setAiActionLabel] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const { data: deals = [], isLoading } = useQuery<DealWithProspect[]>({
    queryKey: ["/api/admin/team-training/deals"],
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TeamTrainingDeal> }) => {
      const res = await apiRequest("PATCH", `/api/admin/team-training/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/deals"] });
      setEditDeal(null);
      toast({ title: "Deal updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteDealMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/team-training/deals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team-training/deals"] });
      toast({ title: "Deal deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const handleDrop = (status: string) => {
    if (!draggingId || !status) return;
    const deal = deals.find(d => d.id === draggingId);
    if (!deal || deal.status === status) return;
    updateDealMutation.mutate({ id: draggingId, data: { status: status as TeamTrainingDeal["status"] } });
    setDraggingId(null);
  };

  const handleAiAction = async (deal: DealWithProspect, action: string) => {
    const labels: Record<string, string> = {
      generate_response: "Generate Response",
      suggest_next_step: "Suggest Next Step",
      create_proposal: "Create Proposal",
    };
    setAiActionLabel(labels[action] ?? action);
    setAiResult("");
    setAiDialogOpen(true);
    setAiLoading(true);
    try {
      const res = await apiRequest("POST", `/api/admin/team-training/deals/${deal.id}/ai-action`, { action });
      const data = await res.json();
      setAiResult(data.result ?? "No result returned.");
    } catch (err: any) {
      setAiResult("Error: " + err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const openEdit = (d: DealWithProspect) => {
    setEditDeal(d);
    setEditForm({
      status: d.status,
      estimatedValue: d.estimatedValue,
      finalValue: d.finalValue ?? undefined,
      probability: d.probability,
      nextAction: d.nextAction,
      notes: d.notes ?? "",
    });
  };

  // Stats
  const activeDeals = deals.filter(d => !["won", "lost"].includes(d.status));
  const wonDeals = deals.filter(d => d.status === "won");
  const projectedRevenue = activeDeals.reduce((s, d) => s + Math.round((d.estimatedValue * d.probability) / 100), 0);
  const wonRevenue = wonDeals.reduce((s, d) => s + (d.finalValue ?? d.estimatedValue), 0);
  const interestedDeals = deals.filter(d => d.status === "interested").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-deals-title">Deal Pipeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track and close team training deals from first contact to won.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Card className="p-3 text-center">
              <Briefcase className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-active-deals">{activeDeals.length}</p>
              <p className="text-xs text-muted-foreground">Active Deals</p>
            </Card>
            <Card className="p-3 text-center">
              <Target className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-interested">{interestedDeals}</p>
              <p className="text-xs text-muted-foreground">Interested Leads</p>
            </Card>
            <Card className="p-3 text-center">
              <TrendingUp className="h-4 w-4 mx-auto text-purple-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-projected">${projectedRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Projected Revenue</p>
            </Card>
            <Card className="p-3 text-center">
              <CheckCircle className="h-4 w-4 mx-auto text-green-500 mb-1" />
              <p className="text-xl font-bold" data-testid="text-stat-won">${wonRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Won Revenue</p>
            </Card>
          </>
        )}
      </div>

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(col => (
            <Skeleton key={col.key} className="min-w-[220px] h-64" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map(col => (
            <KanbanColumn
              key={col.key}
              column={col}
              deals={deals.filter(d => d.status === col.key)}
              onEdit={openEdit}
              onDelete={(id) => deleteDealMutation.mutate(id)}
              onAiAction={handleAiAction}
              draggingId={draggingId}
              onDragStart={setDraggingId}
              onDragEnd={() => setDraggingId(null)}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Edit Deal Dialog */}
      <Dialog open={!!editDeal} onOpenChange={(o) => !o && setEditDeal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Deal — {editDeal?.prospect?.prospectName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm(f => ({ ...f, status: v as TeamTrainingDeal["status"] }))}>
                <SelectTrigger data-testid="select-deal-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_STATUSES.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Estimated Value ($)</label>
                <Input
                  type="number"
                  value={editForm.estimatedValue ?? 0}
                  onChange={(e) => setEditForm(f => ({ ...f, estimatedValue: parseInt(e.target.value) || 0 }))}
                  data-testid="input-estimated-value"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Final Value ($)</label>
                <Input
                  type="number"
                  value={editForm.finalValue ?? ""}
                  placeholder="Optional"
                  onChange={(e) => setEditForm(f => ({ ...f, finalValue: e.target.value ? parseInt(e.target.value) : undefined }))}
                  data-testid="input-final-value"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Probability (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={editForm.probability ?? 40}
                onChange={(e) => setEditForm(f => ({ ...f, probability: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                data-testid="input-probability"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Next Action</label>
              <Input
                value={editForm.nextAction ?? ""}
                onChange={(e) => setEditForm(f => ({ ...f, nextAction: e.target.value }))}
                placeholder="What's the next step?"
                data-testid="input-next-action"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                className="min-h-[80px]"
                placeholder="Deal notes..."
                data-testid="textarea-notes"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditDeal(null)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={() => editDeal && updateDealMutation.mutate({ id: editDeal.id, data: editForm as Partial<TeamTrainingDeal> })}
                disabled={updateDealMutation.isPending}
                data-testid="button-save-deal"
              >
                {updateDealMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Close Assistant Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Close Assistant — {aiActionLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">
            {aiLoading ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Generating...</span>
              </div>
            ) : (
              <div className="space-y-4">
                <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 font-sans max-h-80 overflow-y-auto" data-testid="text-ai-result">
                  {aiResult}
                </pre>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (aiResult) {
                        navigator.clipboard.writeText(aiResult);
                        toast({ title: "Copied to clipboard" });
                      }
                    }}
                    data-testid="button-copy-ai-result"
                  >
                    Copy
                  </Button>
                  <Button onClick={() => setAiDialogOpen(false)} data-testid="button-close-ai-dialog">
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
