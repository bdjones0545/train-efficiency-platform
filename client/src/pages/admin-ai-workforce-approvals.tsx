import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2, XCircle, Clock, ArrowLeft, AlertTriangle,
  Brain, Activity, Lightbulb, RefreshCw, ChevronRight,
  Shield, Target, DollarSign, Zap,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PRIORITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  low: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const OUTCOME_STYLES: Record<string, string> = {
  accepted: "bg-green-500/10 text-green-400 border-green-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  deferred: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

export default function AdminAiWorkforceApprovals() {
  const [tab, setTab] = useState("pending");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Optimization recommendations (source of approval items)
  const { data: recs, isLoading: recsLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/workforce/optimization-recommendations"],
    queryFn: () => fetch("/api/workforce/optimization-recommendations").then(r => r.json()),
    initialData: [],
  });

  // Memory — approved/rejected/deferred history
  const { data: memory, isLoading: memoryLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/memory"],
    queryFn: () => fetch("/api/workforce/memory").then(r => r.json()),
    initialData: [],
  });

  // Agent pending actions
  const { data: pendingActions, isLoading: actionsLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/activity"],
    queryFn: () => fetch("/api/workforce/activity").then(r => r.json()).then(d => (d.pendingApprovals ?? []).slice(0, 20)),
    initialData: [],
  });

  const decide = useMutation({
    mutationFn: ({ rec, outcome }: { rec: any; outcome: "accepted" | "rejected" | "deferred" }) =>
      apiRequest("POST", "/api/workforce/memory", {
        memoryType: "recommendation",
        key: rec.id,
        title: rec.title,
        summary: rec.recommendation,
        outcome,
        value: outcome === "accepted" ? (rec.estimatedImpactValue ?? 0) : 0,
        context: { category: rec.category, agentResponsible: rec.agentResponsible, priority: rec.priority },
      }),
    onSuccess: (_, { outcome }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/optimization-recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/memory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/intelligence-scorecard"] });
      const msg = outcome === "accepted" ? "Approved — saved to workforce memory" :
                  outcome === "rejected" ? "Rejected — won't surface again for 30 days" :
                  "Deferred — will resurface if conditions persist";
      toast({ title: msg });
    },
  });

  const requiresApproval = (recs ?? []).filter((r: any) => r.requiresApproval);
  const suggestions = (recs ?? []).filter((r: any) => !r.requiresApproval);

  const memoryByOutcome = (outcome: string) =>
    (memory ?? []).filter((m: any) => m.outcome === outcome);

  const decisionItems = [...(memory ?? [])].sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/ai-workforce/optimization">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Optimization
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-blue-400" />
              Optimization Approvals
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Review AI recommendations before they're acted on</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-gray-400" onClick={() => refetch()} data-testid="button-refresh-approvals">
          <RefreshCw className="h-4 w-4 mr-1" />Refresh
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Needs Approval</p>
            <p className="text-2xl font-bold text-orange-400">{requiresApproval.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Approved (Total)</p>
            <p className="text-2xl font-bold text-green-400">{memoryByOutcome("accepted").length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Rejected</p>
            <p className="text-2xl font-bold text-red-400">{memoryByOutcome("rejected").length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-800 border border-gray-700">
          <TabsTrigger value="pending">
            Needs Approval
            {requiresApproval.length > 0 && (
              <Badge className="ml-1.5 bg-orange-500 text-white text-xs h-5 px-1.5">{requiresApproval.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          <TabsTrigger value="history">Decision History</TabsTrigger>
          <TabsTrigger value="agent-actions">Agent Actions</TabsTrigger>
        </TabsList>

        {/* ── Needs Approval ── */}
        <TabsContent value="pending" className="mt-4 space-y-3">
          {recsLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-36 bg-gray-800 rounded-xl animate-pulse" />)}</div>
          ) : requiresApproval.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400 opacity-40" />
                <p className="text-gray-300 font-medium">No items needing approval</p>
                <p className="text-sm text-gray-500 mt-1">
                  Recommendations requiring approval will appear here when detected.
                </p>
              </CardContent>
            </Card>
          ) : requiresApproval.map((rec: any) => (
            <Card key={rec.id} className="bg-gray-900 border-orange-800/40 hover:border-orange-700/60 transition-colors" data-testid={`approval-${rec.id}`}>
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs border">Needs Approval</Badge>
                      <Badge className={`text-xs border ${PRIORITY_STYLES[rec.priority]}`}>{rec.priority}</Badge>
                    </div>
                    <p className="font-semibold text-white mb-1">{rec.title}</p>
                    <p className="text-xs text-gray-400 leading-relaxed mb-3">{rec.recommendation}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      <div className="bg-gray-800 rounded p-2">
                        <p className="text-gray-500 mb-0.5">Current State</p>
                        <p className="text-gray-300">{rec.currentState}</p>
                      </div>
                      <div className="bg-gray-800 rounded p-2">
                        <p className="text-gray-500 mb-0.5">Est. Impact</p>
                        <p className="text-green-400 font-medium">{rec.estimatedImpact}</p>
                      </div>
                      <div className="bg-gray-800 rounded p-2">
                        <p className="text-gray-500 mb-0.5">Confidence</p>
                        <p className="text-blue-400">{Math.round((rec.confidence ?? 0) * 100)}% · Agent: {rec.agentName}</p>
                      </div>
                    </div>

                    {rec.evidence?.length > 0 && (
                      <ul className="mt-3 space-y-0.5">
                        {rec.evidence.slice(0, 2).map((e: string, i: number) => (
                          <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                            <span className="text-blue-400 flex-shrink-0 mt-0.5">•</span>{e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0 justify-center">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => decide.mutate({ rec, outcome: "accepted" })}
                      disabled={decide.isPending}
                      data-testid={`button-approve-${rec.id}`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-700 text-yellow-400 hover:bg-yellow-900/20"
                      onClick={() => decide.mutate({ rec, outcome: "deferred" })}
                      disabled={decide.isPending}
                      data-testid={`button-defer-${rec.id}`}
                    >
                      <Clock className="h-4 w-4 mr-1.5" />Defer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-800 text-red-400 hover:bg-red-900/20"
                      onClick={() => decide.mutate({ rec, outcome: "rejected" })}
                      disabled={decide.isPending}
                      data-testid={`button-reject-${rec.id}`}
                    >
                      <XCircle className="h-4 w-4 mr-1.5" />Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Suggestions (no approval required) ── */}
        <TabsContent value="suggestions" className="mt-4 space-y-3">
          {suggestions.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center text-gray-500 text-sm">No suggestions at this time.</CardContent>
            </Card>
          ) : suggestions.map((rec: any) => (
            <Card key={rec.id} className="bg-gray-900 border-gray-800" data-testid={`suggestion-${rec.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{rec.title}</span>
                      <Badge className={`text-xs border ${PRIORITY_STYLES[rec.priority]}`}>{rec.priority}</Badge>
                    </div>
                    <p className="text-xs text-gray-400">{rec.recommendation}</p>
                    <p className="text-xs text-green-400 mt-1">{rec.estimatedImpact}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 h-7 px-3 text-xs"
                      onClick={() => decide.mutate({ rec, outcome: "accepted" })}
                      data-testid={`button-accept-${rec.id}`}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="border-gray-600 text-gray-400 h-7 px-3 text-xs"
                      onClick={() => decide.mutate({ rec, outcome: "rejected" })}
                      data-testid={`button-decline-${rec.id}`}>
                      Decline
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── Decision History ── */}
        <TabsContent value="history" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-gray-400">Workforce Memory — Decision Log</CardTitle>
            </CardHeader>
            <CardContent>
              {memoryLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-800 rounded animate-pulse" />)}</div>
              ) : decisionItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No decisions recorded yet. Approving or rejecting recommendations saves them to workforce memory.
                </div>
              ) : (
                <div className="space-y-2">
                  {decisionItems.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg" data-testid={`memory-${m.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{m.title}</p>
                        <p className="text-xs text-gray-400">{new Date(m.createdAt).toLocaleDateString()} · {m.memoryType}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        {m.value > 0 && <span className="text-xs text-green-400">${m.value.toFixed(0)}</span>}
                        <Badge className={`text-xs border ${OUTCOME_STYLES[m.outcome] ?? "bg-gray-500/10 text-gray-400 border-gray-500/30"}`}>
                          {m.outcome}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Agent Pending Actions ── */}
        <TabsContent value="agent-actions" className="mt-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-gray-400">Pending Agent Actions</CardTitle>
                <Link href="/admin/ai-workforce/activity">
                  <Button size="sm" variant="ghost" className="text-gray-400 h-7 text-xs">
                    Full Activity Feed <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {actionsLoading ? (
                <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-12 bg-gray-800 rounded animate-pulse" />)}</div>
              ) : (pendingActions ?? []).length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No agent actions pending approval.</div>
              ) : (
                <div className="space-y-2">
                  {(pendingActions ?? []).map((action: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                      <div>
                        <p className="text-sm text-white">{action.actionType?.replace(/_/g, " ") ?? "Action"}</p>
                        <p className="text-xs text-gray-400">
                          {action.agentType ?? "Agent"} · {action.createdAt ? new Date(action.createdAt).toLocaleString() : ""}
                        </p>
                      </div>
                      <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 border text-xs">pending</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
