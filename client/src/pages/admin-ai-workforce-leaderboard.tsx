import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trophy, TrendingUp, TrendingDown, Minus,
  Clock, DollarSign, CheckCircle2, Zap, ArrowLeft,
  Star, Target, Mail, Calendar, Users, BarChart2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const AGENT_COLORS: Record<string, string> = {
  executive_agent: "bg-indigo-500",
  research_agent: "bg-sky-500",
  growth_agent: "bg-emerald-500",
  retention_agent: "bg-violet-500",
  scheduling_agent: "bg-amber-500",
  communication_agent: "bg-pink-500",
  finance_agent: "bg-teal-500",
  workflow_agent: "bg-orange-500",
};

const AGENT_NAMES: Record<string, string> = {
  executive_agent: "Atlas",
  research_agent: "Vector",
  growth_agent: "Apex",
  retention_agent: "Pulse",
  scheduling_agent: "Tempo",
  communication_agent: "Relay",
  finance_agent: "Ledger",
  workflow_agent: "Nexus",
};

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500 text-white font-bold text-sm"><Trophy className="h-4 w-4" /></div>;
  if (rank === 2) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-400 text-white font-bold text-sm">{rank}</div>;
  if (rank === 3) return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-700 text-white font-bold text-sm">{rank}</div>;
  return <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-700 text-gray-300 font-bold text-sm">{rank}</div>;
}

export default function AdminAiWorkforceLeaderboard() {
  const [period, setPeriod] = useState("30d");
  const [tab, setTab] = useState("overall");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/workforce/leaderboard", period],
    queryFn: () => fetch(`/api/workforce/leaderboard?period=${period}`).then(r => r.json()),
  });

  const { data: timeSavings } = useQuery<any>({
    queryKey: ["/api/workforce/time-savings"],
    queryFn: () => fetch("/api/workforce/time-savings").then(r => r.json()),
  });

  const agents = data?.agents ?? [];

  function sortedBy(key: string) {
    return [...agents].sort((a: any, b: any) => {
      const map: Record<string, string> = {
        revenue: "revenueInfluenced",
        time: "timeSavedHours",
        tasks: "totalActions",
        success: "successRate",
        overall: "valueScore",
      };
      return (b[map[key] ?? "valueScore"] ?? 0) - (a[map[key] ?? "valueScore"] ?? 0);
    }).map((a: any, i: number) => ({ ...a, rank: i + 1 }));
  }

  const displayed = sortedBy(tab);

  const statCards = [
    {
      label: "Top Performer",
      value: data?.topPerformer?.agentName ?? "—",
      sub: data?.topPerformer?.reason ?? "",
      icon: Trophy,
      color: "text-yellow-500",
    },
    {
      label: "Most Efficient",
      value: data?.mostEfficient?.agentName ?? "—",
      sub: data?.mostEfficient?.reason ?? "",
      icon: Clock,
      color: "text-blue-400",
    },
    {
      label: "Highest ROI",
      value: data?.highestROI?.agentName ?? "—",
      sub: data?.highestROI?.reason ?? "",
      icon: DollarSign,
      color: "text-green-400",
    },
    {
      label: "Hours Saved (Month)",
      value: timeSavings?.timeSavedThisMonth != null ? `${timeSavings.timeSavedThisMonth}h` : "—",
      sub: `$${(timeSavings?.laborSavingsThisMonth ?? 0).toFixed(0)} labor value`,
      icon: Zap,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/ai-workforce">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Workforce
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="h-6 w-6 text-yellow-400" />
              Agent Leaderboard
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">Rank agents by the business value they create</p>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-36 bg-gray-800 border-gray-700" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="quarter">Quarter</SelectItem>
            <SelectItem value="year">Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <Card key={card.label} className="bg-gray-900 border-gray-800">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                  <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                  {card.sub && <p className="text-xs text-gray-500 mt-1">{card.sub}</p>}
                </div>
                <card.icon className={`h-5 w-5 ${card.color} opacity-70`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leaderboard table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Agent Rankings</CardTitle>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-gray-800 h-8">
                <TabsTrigger value="overall" className="text-xs px-3 h-6">Overall</TabsTrigger>
                <TabsTrigger value="revenue" className="text-xs px-3 h-6">Revenue</TabsTrigger>
                <TabsTrigger value="time" className="text-xs px-3 h-6">Time Saved</TabsTrigger>
                <TabsTrigger value="tasks" className="text-xs px-3 h-6">Tasks</TabsTrigger>
                <TabsTrigger value="success" className="text-xs px-3 h-6">Success Rate</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <BarChart2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No agent activity yet for this period.</p>
              <p className="text-xs mt-1">Agents will appear here once they execute actions.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayed.map((agent: any) => {
                const color = AGENT_COLORS[agent.agentType] ?? "bg-gray-600";
                const name = AGENT_NAMES[agent.agentType] ?? agent.agentName;
                return (
                  <div
                    key={agent.agentType}
                    data-testid={`leaderboard-agent-${agent.agentType}`}
                    className="flex items-center gap-4 p-3 rounded-lg bg-gray-800 hover:bg-gray-750 transition-colors"
                  >
                    <RankBadge rank={agent.rank} />
                    <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
                      {name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{name}</span>
                        <span className="text-xs text-gray-500">{agent.department}</span>
                        <TrendIcon trend={agent.trend} />
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-400" />
                          {agent.totalActions} actions ({agent.successRate}% success)
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-blue-400" />
                          {agent.timeSavedHours}h saved
                        </span>
                        {agent.revenueInfluenced > 0 && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-green-400" />
                            ${agent.revenueInfluenced.toFixed(0)} influenced
                          </span>
                        )}
                        {agent.appointmentsBooked > 0 && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-amber-400" />
                            {agent.appointmentsBooked} booked
                          </span>
                        )}
                        {agent.leadsRecovered > 0 && (
                          <span className="flex items-center gap-1">
                            <Target className="h-3 w-3 text-pink-400" />
                            {agent.leadsRecovered} leads
                          </span>
                        )}
                        {agent.emailsSent > 0 && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-purple-400" />
                            {agent.emailsSent} emails
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-white">{agent.valueScore.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">value pts</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time savings benchmarks */}
      {timeSavings?.benchmarks && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-gray-400">Time Savings Assumptions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {timeSavings.benchmarks.map((b: any) => (
                <div key={b.action} className="bg-gray-800 rounded-lg p-2 text-center">
                  <div className="text-xs text-gray-400 capitalize">{b.action}</div>
                  <div className="text-sm font-semibold text-blue-400 mt-0.5">{b.minutesSaved} min</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Based on typical S&C business admin time. Hourly rate assumption: ${timeSavings.hourlyRateAssumption}/hr.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
