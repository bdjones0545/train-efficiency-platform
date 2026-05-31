import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Globe, TrendingUp, Users, Package, DollarSign,
  Star, Award, RefreshCw, CheckCircle2, AlertTriangle, Zap,
  BarChart3, Target, Activity, Brain, GitBranch, Shield,
  ArrowUp, ArrowRight, Trophy, Layers, Clock, Code2, ChevronRight,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={radius} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle cx="45" cy="45" r={radius} fill="none" stroke="currentColor"
          strokeWidth="8" strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round" className={color}
          transform="rotate(-90 45 45)" />
        <text x="45" y="49" textAnchor="middle" fontSize="16" fontWeight="bold" fill="white">{pct}</text>
      </svg>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

const MILESTONES = [
  { key: "first_developer",     label: "First Developer",   count: 1,    icon: Code2,    color: "text-emerald-400" },
  { key: "ten_developers",      label: "10 Developers",     count: 10,   icon: Users,    color: "text-blue-400" },
  { key: "hundred_developers",  label: "100 Developers",    count: 100,  icon: Globe,    color: "text-purple-400" },
  { key: "thousand_developers", label: "1,000 Developers",  count: 1000, icon: Trophy,   color: "text-yellow-400" },
  { key: "first_install",       label: "First Install",     count: 1,    icon: Package,  color: "text-cyan-400" },
  { key: "hundred_installs",    label: "100 Installs",      count: 100,  icon: Layers,   color: "text-indigo-400" },
  { key: "first_review",        label: "First Review",      count: 1,    icon: Star,     color: "text-yellow-400" },
  { key: "first_revenue",       label: "First Revenue",     count: 1,    icon: DollarSign, color: "text-green-400" },
  { key: "first_certified",     label: "First Certification", count: 1,  icon: Award,    color: "text-orange-400" },
];

export default function AdminEcosystem() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ecosystem } = useQuery<any>({
    queryKey: ["/api/marketplace/ecosystem"],
    queryFn: () => fetch("/api/marketplace/ecosystem").then(r => r.json()),
  });

  const { data: score } = useQuery<any>({
    queryKey: ["/api/marketplace/ecosystem-score"],
    queryFn: () => fetch("/api/marketplace/ecosystem-score").then(r => r.json()),
  });

  const { data: validation } = useQuery<any>({
    queryKey: ["/api/marketplace/validation"],
    queryFn: () => fetch("/api/marketplace/validation").then(r => r.json()),
  });

  const { data: adoption } = useQuery<any>({
    queryKey: ["/api/marketplace/adoption"],
    queryFn: () => fetch("/api/marketplace/adoption").then(r => r.json()),
  });

  const { data: health } = useQuery<any>({
    queryKey: ["/api/marketplace/health"],
    queryFn: () => fetch("/api/marketplace/health").then(r => r.json()),
  });

  const refreshAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketplace/ecosystem/refresh", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace"] });
      toast({ title: "Ecosystem refreshed" });
    },
  });

  const totalScore = score?.ecosystemScore ?? 0;
  const components = score?.components ?? {};

  const milestoneData = {
    first_developer: (ecosystem?.developers ?? 0) >= 1,
    ten_developers: (ecosystem?.developers ?? 0) >= 10,
    hundred_developers: (ecosystem?.developers ?? 0) >= 100,
    thousand_developers: (ecosystem?.developers ?? 0) >= 1000,
    first_install: (ecosystem?.totalInstalls ?? 0) >= 1,
    hundred_installs: (ecosystem?.totalInstalls ?? 0) >= 100,
    first_review: (ecosystem?.totalReviews ?? 0) >= 1,
    first_revenue: (ecosystem?.marketplaceRevenue ?? 0) > 0,
    first_certified: (ecosystem?.certificationBreakdown?.certified ?? 0) +
      (ecosystem?.certificationBreakdown?.high_performer ?? 0) > 0,
  };

  const achievedCount = Object.values(milestoneData).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/agent-marketplace">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" />Marketplace
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-indigo-400" />
              Ecosystem Validation Dashboard
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Agent Economy health — developers, adoption, revenue, and certification growth</p>
          </div>
        </div>
        <Button onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending}
          className="bg-indigo-600 hover:bg-indigo-700" size="sm" data-testid="button-refresh-ecosystem">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshAll.isPending ? "animate-spin" : ""}`} />
          {refreshAll.isPending ? "Refreshing..." : "Refresh All"}
        </Button>
      </div>

      {/* Ecosystem Score */}
      <Card className="bg-gradient-to-br from-gray-900 to-gray-900/50 border-indigo-800/40">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Big score ring */}
            <div className="flex-shrink-0 text-center">
              <div className="relative">
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#1f2937" strokeWidth="10" />
                  <circle cx="60" cy="60" r="50" fill="none"
                    stroke={totalScore >= 70 ? "#6366f1" : totalScore >= 40 ? "#f59e0b" : "#ef4444"}
                    strokeWidth="10"
                    strokeDasharray={`${(totalScore / 100) * 314} 314`}
                    strokeLinecap="round"
                    transform="rotate(-90 60 60)" />
                  <text x="60" y="64" textAnchor="middle" fontSize="22" fontWeight="bold" fill="white">{totalScore}</text>
                  <text x="60" y="82" textAnchor="middle" fontSize="9" fill="#6b7280">/100</text>
                </svg>
              </div>
              <p className="text-sm font-medium text-indigo-300 mt-1">Ecosystem Score</p>
            </div>

            {/* Component scores */}
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-5 gap-4">
              {[
                { key: "developerActivity", label: "Developers", color: "text-emerald-400" },
                { key: "agentQuality",      label: "Quality",    color: "text-blue-400" },
                { key: "adoption",          label: "Adoption",   color: "text-cyan-400" },
                { key: "revenue",           label: "Revenue",    color: "text-green-400" },
                { key: "trust",             label: "Trust",      color: "text-yellow-400" },
                { key: "certification",     label: "Certs",      color: "text-orange-400" },
                { key: "retention",         label: "Retention",  color: "text-purple-400" },
                { key: "reviews",           label: "Reviews",    color: "text-pink-400" },
                { key: "marketplaceHealth", label: "Health",     color: "text-indigo-400" },
              ].map(c => (
                <ScoreRing key={c.key} score={components[c.key] ?? 0} label={c.label} color={c.color} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Published Agents",    value: ecosystem?.publishedAgents ?? 0,                             color: "text-indigo-400",  icon: Brain },
          { label: "Developers",          value: ecosystem?.developers ?? 0,                                  color: "text-emerald-400", icon: Code2 },
          { label: "Total Installs",      value: ecosystem?.totalInstalls ?? 0,                               color: "text-blue-400",    icon: Package },
          { label: "Reviews",             value: ecosystem?.totalReviews ?? 0,                                color: "text-yellow-400",  icon: Star },
          { label: "Avg Rating",          value: ecosystem?.avgRating > 0 ? `${ecosystem.avgRating}★` : "—", color: "text-yellow-300",  icon: Star },
          { label: "Marketplace Revenue", value: `$${(ecosystem?.marketplaceRevenue ?? 0).toLocaleString()}`, color: "text-green-400",   icon: DollarSign },
          { label: "Health Score",        value: `${health?.healthScore ?? 0}/100`,                           color: "text-teal-400",    icon: Activity },
          { label: "Milestones Hit",      value: `${achievedCount}/${MILESTONES.length}`,                     color: "text-purple-400",  icon: Trophy },
        ].map(s => (
          <Card key={s.label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <s.icon className={`h-4 w-4 mb-2 ${s.color}`} />
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Milestone Tracker */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-400" />
              Ecosystem Milestones
              <Badge className="ml-auto bg-indigo-500/10 text-indigo-400 border-none">
                {achievedCount}/{MILESTONES.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {MILESTONES.map(m => {
              const achieved = (milestoneData as any)[m.key] ?? false;
              return (
                <div key={m.key}
                  className={`flex items-center gap-3 p-2 rounded-lg ${achieved ? "bg-gray-800/60" : "bg-gray-900/40"}`}
                  data-testid={`milestone-${m.key}`}>
                  <div className={`p-1.5 rounded ${achieved ? "bg-green-500/10" : "bg-gray-800"} flex-shrink-0`}>
                    {achieved
                      ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                      : <m.icon className={`h-4 w-4 ${achieved ? m.color : "text-gray-600"}`} />
                    }
                  </div>
                  <span className={`text-sm flex-1 ${achieved ? "text-gray-200" : "text-gray-500"}`}>{m.label}</span>
                  {achieved && <Badge className="bg-green-500/10 text-green-400 border-none text-xs">Achieved</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Validation Scoreboard */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-400" />Validation Scoreboard
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {validation ? (
              <>
                {[
                  { label: "Published Agents",  value: validation.publishedAgents ?? 0, goal: 10,  color: "bg-indigo-500" },
                  { label: "Developers",        value: validation.developers ?? 0,       goal: 10,  color: "bg-emerald-500" },
                  { label: "Installs",          value: validation.installs ?? 0,         goal: 100, color: "bg-blue-500" },
                  { label: "Reviews",           value: validation.reviews ?? 0,          goal: 50,  color: "bg-yellow-500" },
                  { label: "Certifications",    value: validation.certifications ?? 0,   goal: 5,   color: "bg-orange-500" },
                  { label: "Retention (%)",     value: validation.retention ?? 0,        goal: 80,  color: "bg-teal-500" },
                ].map(item => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">{item.label}</span>
                      <span className="text-white font-medium">{item.value} / {item.goal}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${item.color} transition-all duration-700`}
                        style={{ width: `${Math.min(100, (item.value / item.goal) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                <div className={`mt-3 p-2 rounded-lg text-xs text-center ${
                  validation.overallValidation === "passing"
                    ? "bg-green-500/10 text-green-400"
                    : validation.overallValidation === "progressing"
                    ? "bg-yellow-500/10 text-yellow-400"
                    : "bg-gray-800 text-gray-500"
                }`}>
                  Marketplace validation: <strong>{validation.overallValidation ?? "bootstrapping"}</strong>
                </div>
              </>
            ) : (
              <div className="h-40 bg-gray-800 rounded-xl animate-pulse" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Adoption Panel */}
      {adoption && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-400" />Adoption Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "New Installs (30d)",    value: adoption.newInstalls ?? 0,                                      color: "text-blue-400" },
                { label: "Active Installs",       value: adoption.activeInstalls ?? 0,                                   color: "text-green-400" },
                { label: "Retention Rate",        value: `${adoption.retentionRate ?? 0}%`,                              color: "text-teal-400" },
                { label: "Churn (30d)",           value: adoption.churn ?? 0,                                            color: "text-red-400" },
                { label: "Usage Frequency",       value: `${adoption.usageFrequency ?? 0}×/day`,                         color: "text-purple-400" },
                { label: "Upgrade Rate",          value: `${adoption.upgradeRate ?? 0}%`,                                color: "text-yellow-400" },
                { label: "Revenue / Install",     value: `$${(adoption.revenuePerInstall ?? 0).toFixed(0)}`,             color: "text-green-300" },
                { label: "Revenue / Org",         value: `$${(adoption.revenuePerOrg ?? 0).toFixed(0)}`,                color: "text-emerald-400" },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Effect */}
      {score?.networkEffectScore !== undefined && (
        <Card className="bg-gray-800/30 border-gray-700/40">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 rounded-lg">
              <Activity className="h-6 w-6 text-indigo-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white">Network Effect Score: {score.networkEffectScore}/100</p>
              <p className="text-xs text-gray-400 mt-0.5">
                As more developers add agents, each new org gets more value. As more orgs install agents, each new developer earns more. Network effects accelerate at scale.
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-2xl font-bold text-indigo-400">{score.networkEffectScore}</p>
              <p className="text-xs text-gray-500">of 100</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Links */}
      <div className="flex flex-wrap gap-3">
        <Link href="/admin/agent-marketplace">
          <Button variant="outline" size="sm" className="border-indigo-700 text-indigo-400">
            <Package className="h-4 w-4 mr-1.5" />Marketplace
          </Button>
        </Link>
        <Link href="/marketplace/store">
          <Button variant="outline" size="sm" className="border-blue-700 text-blue-400">
            <Brain className="h-4 w-4 mr-1.5" />Agent Store
          </Button>
        </Link>
        <Link href="/developer">
          <Button variant="outline" size="sm" className="border-emerald-700 text-emerald-400">
            <Code2 className="h-4 w-4 mr-1.5" />Developer Portal
          </Button>
        </Link>
      </div>
    </div>
  );
}
