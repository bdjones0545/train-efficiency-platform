import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Brain, ArrowLeft, Play, DollarSign, Clock, Target, Shield,
  TrendingUp, AlertTriangle, CheckCircle2, Zap, RefreshCw, ChevronRight,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const RISK_COLORS: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

const RISK_BG: Record<string, string> = {
  low: "bg-green-500/10 border-green-500/20",
  medium: "bg-yellow-500/10 border-yellow-500/20",
  high: "bg-orange-500/10 border-orange-500/20",
  critical: "bg-red-500/10 border-red-500/20",
};

function ScoreMeter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={color}>{value}{label.includes("%") || label.includes("Rate") ? "%" : label.includes("Score") ? "/100" : ""}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export default function AdminAiWorkforceSimulator() {
  const [selectedRec, setSelectedRec] = useState<any>(null);
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: recs, isLoading: recsLoading } = useQuery<any[]>({
    queryKey: ["/api/workforce/optimization-recommendations"],
    queryFn: () => fetch("/api/workforce/optimization-recommendations").then(r => r.json()),
    initialData: [],
  });

  const { data: trustData } = useQuery<any>({
    queryKey: ["/api/workforce/trust"],
    queryFn: () => fetch("/api/workforce/trust").then(r => r.json()),
  });

  const createPlan = useMutation({
    mutationFn: (rec: any) => apiRequest("POST", "/api/workforce/executions", rec),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/executions"] });
      toast({ title: "Execution plan created — check the Action Center for status" });
    },
    onError: () => toast({ title: "Failed to create execution plan", variant: "destructive" }),
  });

  async function runSimulation(rec: any) {
    if (!rec) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await fetch("/api/workforce/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      });
      const data = await res.json();
      setSimResult(data);
    } catch {
      toast({ title: "Simulation failed", variant: "destructive" });
    } finally {
      setSimLoading(false);
    }
  }

  const handleSelectRec = (id: string) => {
    const rec = (recs ?? []).find((r: any) => r.id === id);
    setSelectedRec(rec ?? null);
    setSimResult(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/ai-workforce/executions">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Action Center
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-purple-400" />
              Workforce Simulator
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Preview execution outcomes before committing to any action</p>
          </div>
        </div>
        <Link href="/admin/ai-workforce/optimization">
          <Button variant="outline" size="sm" className="border-purple-700 text-purple-400">
            <Target className="h-4 w-4 mr-1.5" />Recommendations
          </Button>
        </Link>
      </div>

      {/* Trust context */}
      {trustData && (
        <Card className={`border ${RISK_BG[trustData.tier === "Autonomous Ready" ? "low" : trustData.tier === "Highly Trusted" ? "low" : trustData.tier === "Trusted" ? "medium" : "high"]}`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Current Trust Tier: <span className="font-medium text-white">{trustData.tier}</span></p>
              <p className="text-xs text-gray-500 mt-0.5">{trustData.recommendation}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-white">{trustData.overall}</p>
              <p className="text-xs text-gray-500">Trust Score</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-purple-400" />Select Recommendation to Simulate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recsLoading ? (
                <div className="h-10 bg-gray-800 rounded animate-pulse" />
              ) : (recs ?? []).length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">
                  <p>No recommendations available to simulate.</p>
                  <Link href="/admin/ai-workforce/optimization">
                    <Button size="sm" variant="outline" className="mt-2 border-gray-600">View Optimization Center</Button>
                  </Link>
                </div>
              ) : (
                <Select onValueChange={handleSelectRec} data-testid="select-recommendation">
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-sm">
                    <SelectValue placeholder="Choose a recommendation..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700 max-h-60">
                    {(recs ?? []).map((rec: any) => (
                      <SelectItem key={rec.id} value={rec.id} className="text-sm">
                        <span className="font-medium">{rec.agentName}</span> · {rec.title.substring(0, 50)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedRec && (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-800 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Selected</p>
                    <p className="text-sm font-medium text-white">{selectedRec.title}</p>
                    <p className="text-xs text-gray-400 mt-1">{selectedRec.recommendation}</p>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span className="text-green-400">{selectedRec.estimatedImpact}</span>
                      <span className="text-gray-400">{Math.round((selectedRec.confidence ?? 0) * 100)}% confidence</span>
                      <span className="text-purple-400">via {selectedRec.agentName}</span>
                    </div>
                  </div>

                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700"
                    onClick={() => runSimulation(selectedRec)}
                    disabled={simLoading}
                    data-testid="button-run-simulation"
                  >
                    {simLoading ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running simulation...</>
                    ) : (
                      <><Play className="h-4 w-4 mr-2" />Run Simulation</>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Safety Layer note */}
          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                <strong className="text-gray-400">Safety layer:</strong> The simulator projects execution outcomes using historical agent performance data without performing any real actions.
                Simulations help you make informed approval decisions. After reviewing results, use "Approve & Execute" to create a governed execution plan.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Simulation Output Panel */}
        <div>
          {simLoading ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center">
                <Brain className="h-12 w-12 mx-auto mb-4 text-purple-400 animate-pulse" />
                <p className="text-gray-300 font-medium">Running workforce simulation...</p>
                <p className="text-sm text-gray-500 mt-1">Analyzing historical data and governance policies</p>
              </CardContent>
            </Card>
          ) : simResult ? (
            <div className="space-y-4">
              {/* Projection Summary */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-400" />Simulation Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-gray-800 rounded-lg text-center">
                      <p className="text-xs text-gray-500 mb-1">Projected Revenue</p>
                      <p className="text-xl font-bold text-green-400">${simResult.projectedRevenue?.toLocaleString()}</p>
                    </div>
                    <div className="p-3 bg-gray-800 rounded-lg text-center">
                      <p className="text-xs text-gray-500 mb-1">Time Saved</p>
                      <p className="text-xl font-bold text-blue-400">{simResult.projectedTimeSaved} min</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <ScoreMeter label="Success Rate" value={simResult.projectedSuccessRate} max={100} color="text-green-400" />
                    <ScoreMeter label="Risk Score" value={simResult.riskScore} max={100} color={simResult.riskScore >= 70 ? "text-red-400" : simResult.riskScore >= 40 ? "text-yellow-400" : "text-green-400"} />
                    <ScoreMeter label="Confidence" value={simResult.confidence} max={100} color="text-blue-400" />
                  </div>

                  {/* Governance result */}
                  <div className={`p-3 rounded-lg border ${RISK_BG[simResult.governance?.riskLevel ?? "low"]}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className={`h-4 w-4 ${RISK_COLORS[simResult.governance?.riskLevel ?? "low"]}`} />
                      <span className={`text-sm font-medium ${RISK_COLORS[simResult.governance?.riskLevel ?? "low"]}`}>
                        {simResult.governance?.riskLevel?.toUpperCase()} RISK
                      </span>
                      {simResult.governance?.canAutoExecute ? (
                        <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border text-xs ml-auto">Auto-execute eligible</Badge>
                      ) : (
                        <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 border text-xs ml-auto">Approval required</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{simResult.governance?.reason}</p>
                  </div>

                  {/* Warnings */}
                  {simResult.warnings?.length > 0 && (
                    <div className="space-y-1">
                      {simResult.warnings.map((w: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{w}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Execution Steps Preview */}
              {simResult.steps?.length > 0 && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-400">Execution Steps Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {simResult.steps.map((step: any) => (
                      <div key={step.step} className="flex items-start gap-3 p-2 bg-gray-800 rounded-lg">
                        <span className="text-xs font-mono text-purple-400 flex-shrink-0 mt-0.5">{step.step}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-300">{step.name}</span>
                            {step.governanceRequired && (
                              <Badge className="text-xs bg-yellow-500/10 text-yellow-400 border-none h-4 px-1.5">gov. required</Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-600">{step.description} · {step.estimatedDuration}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Approve & Execute CTA */}
              {selectedRec && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => createPlan.mutate(selectedRec)}
                  disabled={createPlan.isPending}
                  data-testid="button-approve-and-execute"
                >
                  {createPlan.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Creating plan...</>
                  ) : simResult.governance?.canAutoExecute ? (
                    <><Zap className="h-4 w-4 mr-2" />Approve & Auto-Execute</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 mr-2" />Submit for Approval</>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Brain className="h-14 w-14 mx-auto mb-4 text-gray-700" />
                <p className="text-gray-400 font-medium">Select a recommendation and run a simulation</p>
                <p className="text-sm text-gray-600 mt-2 max-w-xs mx-auto">
                  The simulator will project revenue impact, time savings, success probability, risk score, and execution steps based on your workforce's historical performance data.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
