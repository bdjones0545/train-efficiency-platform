import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Zap, ArrowLeft, Play, Shield, AlertTriangle, CheckCircle2,
  Clock, DollarSign, TrendingUp, RefreshCw, Code2, Target,
  Brain, BarChart3, ChevronRight, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const RISK_BG: Record<string, string> = {
  low: "bg-green-500/10 border-green-500/20",
  medium: "bg-yellow-500/10 border-yellow-500/20",
  high: "bg-orange-500/10 border-orange-500/20",
  critical: "bg-red-500/10 border-red-500/20",
};
const RISK_TEXT: Record<string, string> = {
  low: "text-green-400", medium: "text-yellow-400", high: "text-orange-400", critical: "text-red-400",
};

function ScoreMeter({ label, value, max = 100, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={color}>{value}{max === 100 ? "%" : ""}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export default function DeveloperSandbox() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);

  const [form, setForm] = useState({
    name: "Football Recruiting Agent",
    description: "Automates outreach to high school athletic departments and prospects. Manages pipelines, sends personalized messages, and schedules campus visits.",
    department: "Recruiting",
    category: "lead_followup",
    riskLevel: "low" as "low" | "medium" | "high" | "critical",
    estimatedImpactValue: 500,
    requiresApproval: false,
    capabilities: "Prospect discovery, Personalized outreach, Visit scheduling, Pipeline tracking",
  });

  async function validateDefinition() {
    setLoading(true);
    try {
      const res = await fetch("/api/developer/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          department: form.department,
          capabilities: form.capabilities.split(",").map(c => c.trim()),
          executionTypes: [form.category],
          benchmarkCategories: ["success_rate"],
          requiredIntegrations: ["email_access"],
          supportedIndustries: ["Sports Performance"],
          riskLevel: form.riskLevel,
          defaultGovernanceMode: "supervised",
          requiredPermissions: [{ type: "email_access", reason: "Sends outreach", required: true }],
          version: "1.0.0",
        }),
      });
      const data = await res.json();
      setValidation(data);
    } catch {
      toast({ title: "Validation failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/workforce/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "sandbox_test",
          title: form.name,
          category: form.category,
          agentResponsible: "apex",
          priority: form.riskLevel === "low" ? "low" : form.riskLevel === "medium" ? "medium" : "high",
          estimatedImpactValue: form.estimatedImpactValue,
          requiresApproval: form.requiresApproval,
          recommendation: form.description,
          evidence: [form.capabilities],
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      toast({ title: "Simulation failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/developer">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Developer Portal
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="h-6 w-6 text-emerald-400" />
              Agent Testing Sandbox
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Test agent behavior, validate definitions, and preview execution plans before publishing — no live actions</p>
          </div>
        </div>
      </div>

      {/* Safety notice */}
      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="p-3 flex items-center gap-2 text-xs text-emerald-400">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span><strong>Sandbox mode:</strong> All simulations are read-only dry runs. No emails sent, no data modified, no workflows triggered. Safe to test any configuration.</span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="space-y-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Code2 className="h-4 w-4 text-emerald-400" />Agent Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Agent Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="bg-gray-800 border-gray-700 h-8 text-sm" data-testid="input-agent-name" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Description</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="bg-gray-800 border-gray-700 text-sm h-20" data-testid="input-agent-description" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Department</Label>
                  <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    className="bg-gray-800 border-gray-700 h-8 text-sm" data-testid="input-department" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Execution Type</Label>
                  <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {["lead_followup", "scheduling", "retention", "communication", "workflow", "operations", "research", "recruiting"].map(t => (
                        <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Risk Level</Label>
                  <Select value={form.riskLevel} onValueChange={v => setForm(f => ({ ...f, riskLevel: v as any }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {["low", "medium", "high", "critical"].map(r => (
                        <SelectItem key={r} value={r} className="text-sm capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Est. Impact Value ($)</Label>
                  <Input type="number" value={form.estimatedImpactValue}
                    onChange={e => setForm(f => ({ ...f, estimatedImpactValue: Number(e.target.value) }))}
                    className="bg-gray-800 border-gray-700 h-8 text-sm" data-testid="input-impact-value" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400">Capabilities (comma-separated)</Label>
                <Input value={form.capabilities} onChange={e => setForm(f => ({ ...f, capabilities: e.target.value }))}
                  className="bg-gray-800 border-gray-700 h-8 text-sm" data-testid="input-capabilities" />
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-gray-600 text-gray-300 flex-1"
                  onClick={validateDefinition} disabled={loading} data-testid="button-validate">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />Validate
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1"
                  onClick={runSimulation} disabled={loading} data-testid="button-simulate">
                  {loading ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                  {loading ? "Running..." : "Simulate"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Validation Results */}
          {validation && (
            <Card className={`border ${validation.valid ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {validation.valid ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
                  <span className={validation.valid ? "text-green-400" : "text-red-400"}>
                    {validation.valid ? "Definition Valid" : "Validation Errors"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(validation.errors ?? []).map((e: string, i: number) => (
                  <p key={i} className="text-xs text-red-400 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 flex-shrink-0" />{e}</p>
                ))}
                {(validation.warnings ?? []).map((w: string, i: number) => (
                  <p key={i} className="text-xs text-yellow-400 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />{w}</p>
                ))}
                {validation.riskAssessment && (
                  <div className={`mt-2 p-2 rounded text-xs ${RISK_BG[form.riskLevel]}`}>
                    <p className={RISK_TEXT[form.riskLevel]}>
                      Risk Score: {validation.riskAssessment.score}/100 ·
                      {validation.riskAssessment.approved ? " ✓ Auto-approve eligible" : " Requires manual approval"}
                    </p>
                    {(validation.riskAssessment.flags ?? []).map((f: string, i: number) => (
                      <p key={i} className="text-gray-400 mt-0.5">• {f}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Simulation Output */}
        <div>
          {loading ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Brain className="h-12 w-12 mx-auto mb-4 text-emerald-400 animate-pulse" />
                <p className="text-gray-300 font-medium">Running sandbox simulation...</p>
                <p className="text-xs text-gray-500 mt-1">Analyzing agent definition against platform data</p>
              </CardContent>
            </Card>
          ) : result ? (
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
                      <p className="text-xl font-bold text-green-400">${result.projectedRevenue?.toLocaleString()}</p>
                    </div>
                    <div className="p-3 bg-gray-800 rounded-lg text-center">
                      <p className="text-xs text-gray-500 mb-1">Time Saved</p>
                      <p className="text-xl font-bold text-blue-400">{result.projectedTimeSaved} min</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <ScoreMeter label="Projected Success Rate" value={result.projectedSuccessRate} color="text-green-400" />
                    <ScoreMeter label="Risk Score"
                      value={result.riskScore}
                      color={result.riskScore >= 70 ? "text-red-400" : result.riskScore >= 40 ? "text-yellow-400" : "text-green-400"} />
                    <ScoreMeter label="Confidence" value={result.confidence} color="text-blue-400" />
                  </div>

                  {/* Governance */}
                  <div className={`p-3 rounded-lg border ${RISK_BG[result.governance?.riskLevel ?? "low"]}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className={`h-4 w-4 ${RISK_TEXT[result.governance?.riskLevel ?? "low"]}`} />
                      <span className={`text-sm font-medium ${RISK_TEXT[result.governance?.riskLevel ?? "low"]}`}>
                        {(result.governance?.riskLevel ?? "LOW").toUpperCase()} RISK
                      </span>
                      {result.governance?.canAutoExecute ? (
                        <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border text-xs ml-auto">Auto-execute eligible</Badge>
                      ) : (
                        <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 border text-xs ml-auto">Approval required</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{result.governance?.reason}</p>
                  </div>

                  {(result.warnings ?? []).length > 0 && (
                    <div className="space-y-1">
                      {result.warnings.map((w: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-400">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{w}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Execution Steps */}
              {result.steps?.length > 0 && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Execution Plan Preview</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.steps.map((step: any) => (
                      <div key={step.step} className="flex items-start gap-3 p-2 bg-gray-800 rounded-lg">
                        <span className="text-xs font-mono text-emerald-400 flex-shrink-0 mt-0.5">{step.step}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-300">{step.name}</span>
                            {step.governanceRequired && (
                              <Badge className="text-xs bg-yellow-500/10 text-yellow-400 border-none h-4 px-1">gov</Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-600">{step.estimatedDuration}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card className="bg-emerald-500/5 border-emerald-500/20">
                <CardContent className="p-3 text-xs text-emerald-400 text-center">
                  ✓ Sandbox simulation complete — no real actions were taken
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Zap className="h-14 w-14 mx-auto mb-4 text-gray-700" />
                <p className="text-gray-400 font-medium">Configure your agent and run a simulation</p>
                <p className="text-xs text-gray-600 mt-2 max-w-xs mx-auto">
                  The sandbox previews execution outcomes, governance requirements, and risk analysis before you submit your agent for review.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// XCircle needed
function XCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>
    </svg>
  );
}
