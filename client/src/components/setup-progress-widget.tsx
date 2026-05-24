/**
 * Setup Progress Widget — Phase 7
 *
 * Shows onboarding completion score + milestone prompts.
 * Surfaced in the command center and dashboard.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle, Circle, ChevronRight, Zap, Shield, GitBranch,
  Users, Globe, Star,
} from "lucide-react";

interface SetupMilestone {
  id: string;
  label: string;
  desc: string;
  completed: boolean;
  icon: typeof CheckCircle;
  actionLabel?: string;
  actionUrl?: string;
}

function computeMilestones(data: any): SetupMilestone[] {
  const integrations: any[] = data?.integrations ?? [];
  const workflows: any[] = data?.workflows ?? [];
  const agents: any[] = data?.agents ?? [];

  const hasIntegration = integrations.some((i: any) => i.status === "connected");
  const hasPublishedWorkflow = workflows.some((w: any) => w.published);
  const hasActiveAgent = agents.length > 0;
  const hasGovernanceSet = !!(data?.governanceSettings);
  const hasMultipleWorkflows = workflows.filter((w: any) => w.published).length >= 2;

  return [
    {
      id: "connect_integration",
      label: "Connect your first integration",
      desc: "Link Gmail, Slack, or Google Calendar to enable automation",
      completed: hasIntegration,
      icon: Globe,
      actionLabel: "Connect integration",
      actionUrl: "/admin/ai-workforce",
    },
    {
      id: "first_workflow",
      label: "Create and publish a workflow",
      desc: "Build your first automation in the Workflow Builder",
      completed: hasPublishedWorkflow,
      icon: GitBranch,
      actionLabel: "Open Workflow Builder",
      actionUrl: "/admin/workflow-builder",
    },
    {
      id: "governance",
      label: "Configure governance settings",
      desc: "Set your AI team's autonomy level and approval policies",
      completed: hasGovernanceSet,
      icon: Shield,
      actionLabel: "Open Governance",
      actionUrl: "/admin/ai-governance",
    },
    {
      id: "ai_workforce",
      label: "Review your AI workforce",
      desc: "Understand which agents are active and what they do",
      completed: hasActiveAgent,
      icon: Users,
      actionLabel: "View Workforce",
      actionUrl: "/admin/ai-workforce",
    },
    {
      id: "multiple_workflows",
      label: "Activate 2+ workflows",
      desc: "Build a full automation pipeline for your organization",
      completed: hasMultipleWorkflows,
      icon: Zap,
      actionLabel: "Browse templates",
      actionUrl: "/admin/workflow-builder",
    },
  ];
}

export function SetupProgressWidget({ className = "" }: { className?: string }) {
  const { data: integrations } = useQuery<any[]>({
    queryKey: ["/api/integrations"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });
  const { data: workflows } = useQuery<any[]>({
    queryKey: ["/api/workflow-graphs"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });
  const { data: agents } = useQuery<any[]>({
    queryKey: ["/api/workforce/agents"],
    select: (d: any) => Array.isArray(d) ? d : [],
  });
  const { data: govSettings } = useQuery<any>({
    queryKey: ["/api/ai-governance"],
  });

  const milestones = computeMilestones({
    integrations: integrations ?? [],
    workflows: workflows ?? [],
    agents: agents ?? [],
    governanceSettings: govSettings,
  });

  const completed = milestones.filter(m => m.completed).length;
  const total = milestones.length;
  const pct = Math.round((completed / total) * 100);
  const nextMilestone = milestones.find(m => !m.completed);

  if (pct === 100) {
    return (
      <Card className={`border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 ${className}`} data-testid="setup-complete">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <Star className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-green-700 dark:text-green-300">Setup complete!</p>
            <p className="text-xs text-green-600 dark:text-green-400">Your AI workforce is fully configured and operational.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-testid="setup-progress-widget">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Setup Progress
          </CardTitle>
          <span className="text-xs font-semibold text-primary">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5 mt-1" />
        <p className="text-[10px] text-muted-foreground mt-1">{completed} of {total} milestones complete</p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {milestones.map(m => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 p-2.5 rounded-lg transition-colors ${m.completed ? "opacity-60" : "hover:bg-muted/40"}`}
            data-testid={`milestone-${m.id}`}
          >
            {m.completed
              ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              : <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            }
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${m.completed ? "line-through text-muted-foreground" : ""}`}>{m.label}</p>
              {!m.completed && <p className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</p>}
            </div>
            {!m.completed && m.actionUrl && (
              <Link href={m.actionUrl}>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 shrink-0 gap-0.5">
                  {m.actionLabel} <ChevronRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        ))}
        {nextMilestone && (
          <div className="pt-2 border-t">
            <p className="text-[10px] text-muted-foreground">Next up: <span className="font-medium text-foreground">{nextMilestone.label}</span></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
