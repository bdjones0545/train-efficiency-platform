import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Code2, ArrowLeft, Plus, CheckCircle2, XCircle, Clock, Send,
  DollarSign, BarChart3, Star, Shield, Package, RefreshCw, Book,
  TrendingUp, Zap, AlertTriangle, ChevronRight, Award, Users,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  submitted: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  under_review: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  approved: "bg-teal-500/10 text-teal-400 border-teal-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  published: "bg-green-500/10 text-green-400 border-green-500/30",
};

const EXAMPLE_DEF = {
  name: "Football Recruiting Agent",
  description: "Automates outreach to high school athletic departments and prospects. Manages pipelines, sends personalized messages, and schedules campus visits.",
  department: "Recruiting",
  capabilities: ["Prospect discovery", "Personalized outreach", "Visit scheduling", "Pipeline tracking"],
  executionTypes: ["lead_followup", "communication", "scheduling"],
  benchmarkCategories: ["lead_conversion", "scheduling_utilization"],
  requiredIntegrations: ["email_access", "lead_access"],
  supportedIndustries: ["Sports Performance", "Team Training"],
  riskLevel: "low",
  defaultGovernanceMode: "supervised",
  requiredPermissions: [
    { type: "email_access", reason: "Sends recruiting communications", required: true },
    { type: "lead_access", reason: "Reads and updates prospect pipeline", required: true },
  ],
  version: "1.0.0",
  changelogNotes: "Initial release",
};

export default function DeveloperPortal() {
  const [tab, setTab] = useState("agents");
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [agentDef, setAgentDef] = useState(JSON.stringify(EXAMPLE_DEF, null, 2));
  const [devProfile, setDevProfile] = useState({ displayName: "", email: "", bio: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: profile } = useQuery<any>({
    queryKey: ["/api/developer/profile"],
    queryFn: () => fetch("/api/developer/profile").then(r => r.json()).catch(() => null),
  });

  const { data: submissions = [], isLoading: subsLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/submissions"],
    queryFn: () => fetch("/api/developer/submissions").then(r => r.json()),
    initialData: [],
  });

  const { data: analytics } = useQuery<any>({
    queryKey: ["/api/developer/analytics"],
    queryFn: () => fetch("/api/developer/analytics").then(r => r.json()),
  });

  const { data: revenue } = useQuery<any>({
    queryKey: ["/api/developer/revenue"],
    queryFn: () => fetch("/api/developer/revenue").then(r => r.json()),
  });

  const { data: reputation = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/reputation"],
    queryFn: () => fetch("/api/marketplace/reputation").then(r => r.json()),
    initialData: [],
  });

  const registerDev = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/developer/register", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/developer"] }); toast({ title: "Developer account created" }); },
  });

  const submitAgent = useMutation({
    mutationFn: (def: any) => apiRequest("POST", "/api/developer/submit", def),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/submissions"] });
      setShowNewAgentForm(false);
      toast({ title: "Agent submitted for review" });
    },
    onError: (e: any) => toast({ title: "Submission failed", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    try {
      const def = JSON.parse(agentDef);
      submitAgent.mutate(def);
    } catch {
      toast({ title: "Invalid JSON — check your agent definition", variant: "destructive" });
    }
  }

  const publishedAgents = submissions.filter(s => s.submissionStatus === "published");
  const pendingAgents = submissions.filter(s => ["submitted", "under_review"].includes(s.submissionStatus));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/agent-marketplace">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Marketplace
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Code2 className="h-6 w-6 text-emerald-400" />
              Developer Portal
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Build, submit, and monetize agents on the TrainEfficiency platform</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/developer/sandbox">
            <Button variant="outline" size="sm" className="border-emerald-700 text-emerald-400" data-testid="button-sandbox-link">
              <Zap className="h-4 w-4 mr-1.5" />Test Sandbox
            </Button>
          </Link>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setShowNewAgentForm(!showNewAgentForm)} data-testid="button-new-agent">
            <Plus className="h-4 w-4 mr-1.5" />New Agent
          </Button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Published Agents",   value: publishedAgents.length,             color: "text-green-400" },
          { label: "Under Review",        value: pendingAgents.length,               color: "text-yellow-400" },
          { label: "Total Installs",      value: analytics?.totalInstalls ?? 0,      color: "text-cyan-400" },
          { label: "Revenue Generated",   value: `$${(revenue?.totalRevenue ?? 0).toLocaleString()}`, color: "text-emerald-400" },
        ].map(s => (
          <Card key={s.label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New Agent Form */}
      {showNewAgentForm && (
        <Card className="bg-gray-900 border-emerald-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-400" />Define New Agent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-2">Paste or edit your agent definition JSON. Use the example as a template.</p>
              <Textarea
                value={agentDef}
                onChange={e => setAgentDef(e.target.value)}
                className="bg-gray-800 border-gray-700 font-mono text-xs h-64"
                data-testid="input-agent-definition"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleSubmit} disabled={submitAgent.isPending}
                data-testid="button-submit-agent">
                <Send className="h-4 w-4 mr-1.5" />{submitAgent.isPending ? "Submitting..." : "Submit for Review"}
              </Button>
              <Button size="sm" variant="ghost" className="text-gray-400" onClick={() => setShowNewAgentForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-gray-800 border border-gray-700 flex-wrap h-auto">
          <TabsTrigger value="agents">My Agents</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="docs">Documentation</TabsTrigger>
          <TabsTrigger value="certification">Certifications</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
        </TabsList>

        {/* My Agents */}
        <TabsContent value="agents" className="mt-4 space-y-3">
          {submissions.length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-10 text-center">
                <Code2 className="h-12 w-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No agents submitted yet</p>
                <p className="text-xs text-gray-600 mt-1">Click "New Agent" to define and submit your first agent</p>
                <Button size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setShowNewAgentForm(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />Create First Agent
                </Button>
              </CardContent>
            </Card>
          ) : submissions.map((sub: any) => {
            const def = sub.agentDefinition as any;
            return (
              <Card key={sub.id} className="bg-gray-900 border-gray-800" data-testid={`submission-card-${sub.id}`}>
                <CardContent className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-white text-sm">{def?.name ?? "Unnamed Agent"}</p>
                      <Badge className={`text-xs border ${STATUS_STYLES[sub.submissionStatus] ?? STATUS_STYLES.draft}`}>
                        {sub.submissionStatus.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{def?.description?.substring(0, 100)}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="text-gray-500">v{def?.version ?? "1.0.0"}</span>
                      <span className="text-gray-500">·</span>
                      <span className="text-gray-400">{def?.department}</span>
                      {sub.submittedAt && <span className="text-gray-600">Submitted {new Date(sub.submittedAt).toLocaleDateString()}</span>}
                    </div>
                    {sub.reviewNotes && (
                      <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-gray-400">
                        <span className="text-gray-500">Review: </span>{sub.reviewNotes}
                      </div>
                    )}
                  </div>
                  {sub.submissionStatus === "published" && (
                    <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border text-xs flex-shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" />Live
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Submissions */}
        <TabsContent value="submissions" className="mt-4 space-y-3">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Submission Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-4 flex-wrap">
                {["Draft", "Submitted", "Under Review", "Approved", "Published"].map((s, i, arr) => (
                  <div key={s} className="flex items-center gap-1">
                    <span className={i === 3 || i === 4 ? "text-green-400" : i === 1 || i === 2 ? "text-blue-400" : "text-gray-400"}>{s}</span>
                    {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-gray-600" />}
                  </div>
                ))}
              </div>
              {submissions.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-4">No submissions yet</p>
              ) : (
                <div className="space-y-2">
                  {submissions.map((sub: any) => (
                    <div key={sub.id} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg text-xs">
                      <span className="text-gray-300">{(sub.agentDefinition as any)?.name ?? "Unnamed"}</span>
                      <Badge className={`border ${STATUS_STYLES[sub.submissionStatus] ?? STATUS_STYLES.draft}`}>
                        {sub.submissionStatus.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          {!analytics ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center text-gray-500 text-sm">No analytics data yet</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: "Active Orgs Using Your Agents", value: analytics.orgsUsing ?? 0, color: "text-cyan-400", icon: Users },
                { label: "Total Agent Installs",          value: analytics.totalInstalls ?? 0, color: "text-blue-400", icon: Package },
                { label: "Avg Rating",                    value: analytics.avgRating ? `${analytics.avgRating}/5` : "No reviews", color: "text-yellow-400", icon: Star },
                { label: "Reviews",                       value: analytics.totalReviews ?? 0, color: "text-purple-400", icon: BarChart3 },
                { label: "Published Agents",              value: analytics.published ?? 0, color: "text-green-400", icon: CheckCircle2 },
                { label: "Benchmark Score",               value: analytics.avgBenchmarkScore ? `${analytics.avgBenchmarkScore}/100` : "—", color: "text-orange-400", icon: Award },
              ].map(s => (
                <Card key={s.label} className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4">
                    <s.icon className={`h-5 w-5 mb-2 ${s.color}`} />
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Revenue */}
        <TabsContent value="revenue" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Monthly Revenue",   value: `$${(revenue?.monthlyRevenue ?? 0).toFixed(0)}`, color: "text-green-400" },
              { label: "Lifetime Revenue",  value: `$${(revenue?.lifetimeRevenue ?? 0).toFixed(0)}`, color: "text-emerald-400" },
              { label: "Pending Royalties", value: `$${(revenue?.pendingRoyalties ?? 0).toFixed(0)}`, color: "text-yellow-400" },
              { label: "Paid Out",          value: `$${(revenue?.paidOut ?? 0).toFixed(0)}`, color: "text-blue-400" },
              { label: "Revenue Share",     value: "30%", color: "text-purple-400" },
              { label: "Active Royalties",  value: revenue?.activeInstalls ?? 0, color: "text-cyan-400" },
            ].map(s => (
              <Card key={s.label} className="bg-gray-900 border-gray-800">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 font-medium mb-2">Revenue Sharing Model</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Developers receive 30% of subscription or installation revenue generated by their agents. Revenue is tracked via installation events and monthly usage attribution.
                Payouts are processed monthly. Infrastructure is complete — payment processing integration will be added in a future phase.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentation */}
        <TabsContent value="docs" className="mt-4 space-y-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Book className="h-4 w-4 text-emerald-400" />Agent SDK Reference
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  title: "AgentDefinition Schema",
                  desc: "Every agent must include: name, description, department, capabilities, executionTypes, requiredIntegrations, supportedIndustries, riskLevel, defaultGovernanceMode, requiredPermissions, version.",
                },
                {
                  title: "Execution Types",
                  desc: "Valid values: lead_followup | scheduling | retention | communication | workflow | operations | research | recruiting. Select all that apply to your agent's function.",
                },
                {
                  title: "Risk Levels",
                  desc: "low: auto-approve eligible · medium: supervised approval · high: enhanced review required · critical: platform security review required.",
                },
                {
                  title: "Permissions",
                  desc: "Declare each permission your agent needs: crm_access | email_access | calendar_access | billing_access | lead_access | reporting_access. billing_access triggers mandatory review.",
                },
                {
                  title: "Versioning",
                  desc: "Use semantic versioning (1.0.0). Every submission creates a version record. Breaking changes require a major version bump.",
                },
                {
                  title: "Certification Path",
                  desc: "Agents are auto-certified based on performance: Certified (65%+ success, 5+ samples) → High Performer → Elite Performer → Platform Recommended.",
                },
              ].map(item => (
                <div key={item.title} className="border-l-2 border-emerald-800 pl-3">
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Certifications */}
        <TabsContent value="certification" className="mt-4 space-y-3">
          {reputation.filter((r: any) =>
            submissions.some((s: any) => (s.agentDefinition as any)?.name === r.agentName)
          ).length === 0 ? (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center">
                <Award className="h-10 w-10 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 text-sm">No certification data for your agents yet</p>
                <p className="text-xs text-gray-600 mt-1">Publish an agent and generate installs to begin the certification pipeline</p>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-gray-400">Certifications appear here once agents have installation and usage data.</p>
          )}
          <Card className="bg-gray-800/40 border-gray-700/40">
            <CardContent className="p-4 text-xs text-gray-500">
              <strong className="text-gray-400">Certification pipeline:</strong> Submit → Benchmark Testing → Governance Review → Performance Validation → Certification issued automatically when thresholds are met.
            </CardContent>
          </Card>
        </TabsContent>

        {/* Benchmarks */}
        <TabsContent value="benchmarks" className="mt-4 space-y-3">
          {reputation.slice(0, 5).map((r: any) => (
            <Card key={r.agentId} className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{r.agentName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{r.trustTier} · {r.reviewCount} reviews · {r.avgRating > 0 ? `${r.avgRating}★` : "No ratings"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white">{r.reputationScore}</p>
                  <p className="text-xs text-gray-500">Reputation</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {reputation.length === 0 && (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-8 text-center text-gray-500 text-sm">
                No benchmark data available — refresh benchmarks in the marketplace to generate scores
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
