/**
 * AI Workforce Onboarding Wizard — Phase 7
 *
 * Guides new organizations through "hiring and configuring" their AI workforce.
 * 8-step flow: Welcome → Goals → Org Preset → Departments → Governance →
 *              Integrations → Workflows → Review+Launch
 *
 * All selections feed into governance settings + recommended workflow templates.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle, ChevronRight, ChevronLeft, Zap, Users, Shield,
  GitBranch, Cpu, Brain, Target, TrendingUp, MessageSquare,
  Calendar, Search, Globe, Mail, Hash, Sparkles, ArrowRight,
  Building2, BarChart2, Dumbbell, GraduationCap, HeartPulse,
  Star, Layers,
} from "lucide-react";

// ─── Data definitions ─────────────────────────────────────────────────────────

const ORG_GOALS = [
  { id: "leads", label: "Get more leads", icon: Target, desc: "Automate prospecting and lead qualification" },
  { id: "retention", label: "Improve retention", icon: TrendingUp, desc: "Re-engage and retain existing clients" },
  { id: "scheduling", label: "Automate scheduling", icon: Calendar, desc: "Streamline session booking and reminders" },
  { id: "admin", label: "Reduce admin work", icon: Zap, desc: "Eliminate repetitive manual tasks" },
  { id: "communication", label: "Improve communication", icon: MessageSquare, desc: "Send smarter, timelier outreach" },
  { id: "onboarding", label: "Streamline athlete onboarding", icon: Users, desc: "Automate new client welcome flows" },
  { id: "research", label: "Research opportunities", icon: Search, desc: "Find and qualify new business prospects" },
  { id: "reporting", label: "Executive reporting", icon: BarChart2, desc: "Automated business intelligence briefings" },
];

const ORG_PRESETS = [
  { id: "private_trainer", label: "Private Trainer", icon: Dumbbell, desc: "Solo practitioner, 5–30 clients", governance: "balanced" },
  { id: "performance_facility", label: "Performance Facility", icon: Building2, desc: "Team of coaches, 50–200 clients", governance: "balanced" },
  { id: "high_school", label: "High School Program", icon: GraduationCap, desc: "S&C for student athletes", governance: "conservative" },
  { id: "college_program", label: "College Program", icon: GraduationCap, desc: "NCAA-level performance dept", governance: "balanced" },
  { id: "pt_rehab", label: "PT / Rehab Hybrid", icon: HeartPulse, desc: "Physical therapy + strength training", governance: "conservative" },
  { id: "multi_location", label: "Multi-Location Facility", icon: Globe, desc: "Multiple sites, regional staff", governance: "advanced" },
];

const DEPARTMENTS = [
  { id: "communications", label: "Communications", icon: MessageSquare, desc: "Email outreach, reply classification, follow-up sequences", agents: ["Relay"] },
  { id: "scheduling", label: "Scheduling", icon: Calendar, desc: "Session booking, reminders, calendar automation", agents: ["Tempo"] },
  { id: "retention", label: "Retention", icon: TrendingUp, desc: "Client engagement, churn recovery, win-back campaigns", agents: ["Pulse"] },
  { id: "growth", label: "Growth / Outreach", icon: Target, desc: "Lead research, qualification, prospecting campaigns", agents: ["Apex"] },
  { id: "research", label: "Research", icon: Search, desc: "Decision-maker discovery, web intelligence", agents: ["Vector"] },
  { id: "executive", label: "Executive Intelligence", icon: BarChart2, desc: "Business summaries, KPI tracking, strategic insights", agents: ["Atlas"] },
];

const AGENTS = [
  { id: "relay", name: "Relay", dept: "communications", role: "Communication Specialist", color: "bg-blue-500", initials: "RL", desc: "Handles all outbound and inbound email communication. Classifies replies, manages follow-ups, and ensures no message goes unnoticed." },
  { id: "pulse", name: "Pulse", dept: "retention", role: "Retention Specialist", color: "bg-emerald-500", initials: "PS", desc: "Monitors client engagement signals and proactively prevents churn through timely, personalized outreach." },
  { id: "tempo", name: "Tempo", dept: "scheduling", role: "Scheduling Coordinator", color: "bg-violet-500", initials: "TM", desc: "Automates session booking, sends reminders, and handles cancellations so coaches focus on coaching." },
  { id: "apex", name: "Apex", dept: "growth", role: "Growth & Outreach Agent", color: "bg-amber-500", initials: "AX", desc: "Researches and qualifies team training leads, manages outreach campaigns, and tracks prospect pipeline." },
  { id: "vector", name: "Vector", dept: "research", role: "Research Intelligence Agent", color: "bg-pink-500", initials: "VC", desc: "Actively searches the web for decision-maker contacts, organization insights, and opportunity signals." },
  { id: "atlas", name: "Atlas", dept: "executive", role: "Business Intelligence Agent", color: "bg-slate-600", initials: "AT", desc: "Generates daily executive summaries, tracks KPIs, and surfaces strategic recommendations." },
];

const GOVERNANCE_MODES = [
  {
    id: "conservative",
    label: "Conservative",
    sub: "Maximum oversight",
    desc: "External AI actions (emails, bookings, payments) require your approval. Read-only and research actions run automatically.",
    badge: "bg-green-100 text-green-700",
    features: ["Approval rules configured on save", "External actions need approval", "Research & briefings run freely", "Ideal for getting started"],
    internalMode: "supervised",
    icon: Shield,
    color: "border-green-400",
  },
  {
    id: "balanced",
    label: "Balanced",
    sub: "Recommended",
    desc: "Low-risk actions execute automatically. High-risk actions (emails, bookings) require your approval first.",
    badge: "bg-blue-100 text-blue-700",
    features: ["Auto-execute safe actions", "Approval for comms & bookings", "Confidence checks enforced", "Recommended for most orgs"],
    internalMode: "collaborative",
    icon: Sparkles,
    color: "border-blue-400",
    recommended: true,
  },
  {
    id: "advanced",
    label: "Advanced",
    sub: "Full autonomy",
    desc: "Agents operate autonomously within configured boundaries. Best for experienced operators who trust the system.",
    badge: "bg-violet-100 text-violet-700",
    features: ["Autonomous execution", "Rate-limit governance", "Full audit trail", "For experienced operators"],
    internalMode: "autonomous",
    icon: Zap,
    color: "border-violet-400",
  },
];

const INTEGRATIONS = [
  { id: "gmail", label: "Gmail", icon: Mail, desc: "Email sending, reply detection, thread management", required: false },
  { id: "google_calendar", label: "Google Calendar", icon: Calendar, desc: "Session booking, scheduling, event creation", required: false },
  { id: "slack", label: "Slack", icon: Hash, desc: "Alerts, notifications, team updates", required: false },
  { id: "openrouter", label: "AI Models (OpenRouter)", icon: Brain, desc: "Multi-model AI for recommendations and analysis", required: false },
];

const WORKFLOW_TEMPLATES = [
  { id: "tpl-onboarding", label: "Client Onboarding", desc: "Welcome new clients and schedule their first session", goals: ["onboarding", "scheduling"] },
  { id: "tpl-retention", label: "Retention Campaign", desc: "Re-engage at-risk clients before they churn", goals: ["retention"] },
  { id: "tpl-lead-qualification", label: "Lead Qualification", desc: "Research and qualify inbound leads automatically", goals: ["leads", "research"] },
  { id: "tpl-churn-recovery", label: "Churn Recovery", desc: "Win back lapsed clients with personalized outreach", goals: ["retention", "communication"] },
  { id: "tpl-executive-summary", label: "Daily Executive Summary", desc: "Get a daily AI-generated business briefing", goals: ["reporting", "admin"] },
];

// ─── Step components ──────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="text-center space-y-4 sm:space-y-6 max-w-2xl mx-auto py-2 sm:py-4">
      <div className="relative mx-auto w-16 h-16 sm:w-20 sm:h-20">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
          <Brain className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
        </div>
        <span className="absolute -bottom-1 -right-1 h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-green-500 flex items-center justify-center">
          <CheckCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" />
        </span>
      </div>

      <div>
        <h2 className="text-xl sm:text-2xl font-bold">Set up your AI Workforce preferences</h2>
        <p className="text-muted-foreground mt-1.5 sm:mt-2 text-sm sm:text-base leading-relaxed">
          TrainEfficiency comes with a team of specialized AI agents — each designed to handle
          a specific part of running your coaching business.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-left">
        {[
          { icon: Users, title: "Specialized Agents", desc: "Each AI agent has a specific role — like email, scheduling, or lead research" },
          { icon: Shield, title: "Governance Protected", desc: "You decide what AI can do autonomously and what requires your approval first" },
          { icon: Zap, title: "Always Explainable", desc: "Every AI action is logged, explainable, and governed by your organization's approval settings" },
        ].map(item => (
          <div key={item.title} className="rounded-xl border p-3 sm:p-4 bg-card space-y-1.5 sm:space-y-2">
            <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <item.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
            </div>
            <p className="text-sm font-semibold">{item.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-3.5 w-3.5 text-green-500" />
        <span>AI actions are logged and governed by your organization's approval settings.</span>
      </div>
    </div>
  );
}

function StepGoals({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">What are your biggest priorities?</h2>
        <p className="text-sm text-muted-foreground mt-1">Select all that apply — we'll recommend the right AI agents and workflows.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ORG_GOALS.map(goal => {
          const active = selected.includes(goal.id);
          return (
            <button
              key={goal.id}
              onClick={() => onToggle(goal.id)}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`goal-${goal.id}`}
            >
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <goal.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">{goal.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{goal.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 ml-auto mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepOrgPreset({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">What type of organization are you?</h2>
        <p className="text-sm text-muted-foreground mt-1">We'll pre-configure governance and workflows for your context.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ORG_PRESETS.map(preset => {
          const active = selected === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onSelect(preset.id)}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`preset-${preset.id}`}
            >
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <preset.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{preset.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{preset.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepDepartments({ selected, onToggle, goals }: { selected: string[]; onToggle: (id: string) => void; goals: string[] }) {
  // NOTE: department selection is persisted to org_ai_workforce_settings.enabled_departments
  // and used by isAgentEnabledForOrg() to filter the workforce dashboard agent roster.
  const recommended = DEPARTMENTS.filter(d => {
    if (goals.includes("communication") || goals.includes("onboarding")) return true;
    if (goals.includes("leads") || goals.includes("research")) return d.id === "growth" || d.id === "research";
    if (goals.includes("retention")) return d.id === "retention";
    if (goals.includes("scheduling")) return d.id === "scheduling";
    if (goals.includes("reporting") || goals.includes("admin")) return d.id === "executive";
    return false;
  }).map(d => d.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Choose which AI departments you want active</h2>
        <p className="text-sm text-muted-foreground mt-1">Each department contains specialized agents. Select the ones relevant to your business — you can change this later.</p>
      </div>
      <div className="space-y-3">
        {DEPARTMENTS.map(dept => {
          const active = selected.includes(dept.id);
          const isRec = recommended.includes(dept.id);
          return (
            <button
              key={dept.id}
              onClick={() => onToggle(dept.id)}
              className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`dept-${dept.id}`}
            >
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <dept.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{dept.label}</p>
                  {isRec && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px] h-4">Recommended</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{dept.desc}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Cpu className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Agents: {dept.agents.join(", ")}</span>
                </div>
              </div>
              <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${active ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                {active && <CheckCircle className="h-3 w-3 text-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepGovernance({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">How much autonomy should your AI team have?</h2>
        <p className="text-sm text-muted-foreground mt-1">You can change this at any time in AI Governance settings.</p>
      </div>
      <div className="space-y-3">
        {GOVERNANCE_MODES.map(mode => {
          const active = selected === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => onSelect(mode.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-sm ${
                active ? `${mode.color} bg-background shadow-sm` : "border-border hover:border-muted-foreground/40"
              }`}
              data-testid={`governance-${mode.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <mode.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold">{mode.label}</p>
                      <span className="text-xs text-muted-foreground">— {mode.sub}</span>
                      {mode.recommended && <Badge className="bg-blue-100 text-blue-700 text-[10px] h-4">Recommended</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{mode.desc}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {mode.features.map(f => (
                        <span key={f} className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${mode.badge}`}>
                          <CheckCircle className="h-2.5 w-2.5" />{f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                {active && <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepIntegrations({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Choose tools to connect next</h2>
        <p className="text-sm text-muted-foreground mt-1">Select the integrations you plan to set up. You'll configure credentials in the Integrations settings after finishing this wizard.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INTEGRATIONS.map(int => {
          const active = selected.includes(int.id);
          return (
            <button
              key={int.id}
              onClick={() => onToggle(int.id)}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`integration-${int.id}`}
            >
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <int.icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{int.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{int.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
        <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Your selections are saved so we can prompt you to complete each connection. Credentials are configured separately in Integration settings and are never shared across organizations.</span>
      </div>
    </div>
  );
}

function StepWorkflows({ selected, onToggle, goals }: { selected: string[]; onToggle: (id: string) => void; goals: string[] }) {
  const recommended = WORKFLOW_TEMPLATES.filter(t => t.goals.some(g => goals.includes(g))).map(t => t.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Starter workflows</h2>
        <p className="text-sm text-muted-foreground mt-1">These will be created as drafts — review and publish when you're ready.</p>
      </div>
      <div className="space-y-3">
        {WORKFLOW_TEMPLATES.map(wf => {
          const active = selected.includes(wf.id);
          const isRec = recommended.includes(wf.id);
          return (
            <button
              key={wf.id}
              onClick={() => onToggle(wf.id)}
              className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
              data-testid={`workflow-template-${wf.id}`}
            >
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <GitBranch className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{wf.label}</p>
                  {isRec && <Badge className="bg-emerald-100 text-emerald-700 text-[10px] h-4">Match</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{wf.desc}</p>
              </div>
              {active && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" />
        All workflows are created as editable drafts. Nothing runs until you publish.
      </p>
    </div>
  );
}

function StepReview({ state }: { state: WizardState }) {
  const selectedGoals = ORG_GOALS.filter(g => state.goals.includes(g.id));
  const selectedDepts = DEPARTMENTS.filter(d => state.departments.includes(d.id));
  const selectedAgents = AGENTS.filter(a => selectedDepts.some(d => d.id === a.dept));
  const selectedIntegrations = INTEGRATIONS.filter(i => state.integrations.includes(i.id));
  const selectedWorkflows = WORKFLOW_TEMPLATES.filter(w => state.workflows.includes(w.id));
  const govMode = GOVERNANCE_MODES.find(m => m.id === state.governanceMode) ?? GOVERNANCE_MODES[1];
  const orgPreset = ORG_PRESETS.find(p => p.id === state.orgPreset);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Your AI Workforce is ready to launch</h2>
        <p className="text-sm text-muted-foreground mt-1">Review your configuration before activating.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Goals */}
        <div className="rounded-xl border p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Target className="h-3.5 w-3.5" />Goals ({selectedGoals.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedGoals.map(g => <Badge key={g.id} variant="secondary" className="text-[11px]">{g.label}</Badge>)}
          </div>
        </div>

        {/* Org type */}
        {orgPreset && (
          <div className="rounded-xl border p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Organization Type</p>
            <p className="text-sm font-semibold">{orgPreset.label}</p>
            <p className="text-xs text-muted-foreground">{orgPreset.desc}</p>
          </div>
        )}

        {/* AI Agents */}
        <div className="rounded-xl border p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />AI Agents ({selectedAgents.length})</p>
          <div className="flex flex-wrap gap-2">
            {selectedAgents.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 text-xs">
                <div className={`h-5 w-5 rounded-full ${a.color} flex items-center justify-center text-[9px] font-bold text-white`}>{a.initials}</div>
                {a.name}
              </div>
            ))}
          </div>
        </div>

        {/* Governance */}
        <div className="rounded-xl border p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />Governance</p>
          <div className="flex items-center gap-2">
            <govMode.icon className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{govMode.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{govMode.sub} — {govMode.internalMode} mode</p>
        </div>

        {/* Integrations */}
        <div className="rounded-xl border p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" />Integrations ({selectedIntegrations.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedIntegrations.length > 0 ? selectedIntegrations.map(i => (
              <div key={i.id} className="flex items-center gap-1 text-xs border rounded-full px-2 py-0.5">
                <i.icon className="h-3 w-3" />{i.label}
              </div>
            )) : <span className="text-xs text-muted-foreground italic">None selected</span>}
          </div>
        </div>

        {/* Workflows */}
        <div className="rounded-xl border p-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />Starter Workflows ({selectedWorkflows.length})</p>
          <div className="space-y-1">
            {selectedWorkflows.length > 0 ? selectedWorkflows.map(w => (
              <p key={w.id} className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" />{w.label}
              </p>
            )) : <span className="text-xs text-muted-foreground italic">None selected</span>}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Ready to save</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
            Your preferences will be saved and governance rules applied. Starter workflows are created as drafts — you review and publish them when ready. Selected integrations will show as pending setup in your dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

interface WizardState {
  goals: string[];
  orgPreset: string;
  departments: string[];
  governanceMode: string;
  integrations: string[];
  workflows: string[];
}

const INITIAL_STATE: WizardState = {
  goals: [],
  orgPreset: "",
  departments: ["communications"],
  governanceMode: "balanced",
  integrations: [],
  workflows: [],
};

const STEPS = [
  { id: "welcome", title: "Welcome", subtitle: "Meet your AI workforce" },
  { id: "goals", title: "Goals", subtitle: "What matters most" },
  { id: "preset", title: "Organization", subtitle: "Your org type" },
  { id: "departments", title: "Departments", subtitle: "Enable AI teams" },
  { id: "governance", title: "Governance", subtitle: "Trust & autonomy" },
  { id: "integrations", title: "Integrations", subtitle: "Connect tools" },
  { id: "workflows", title: "Workflows", subtitle: "Starter automations" },
  { id: "review", title: "Launch", subtitle: "Review & activate" },
];

// ─── Main Wizard ──────────────────────────────────────────────────────────────

// Maps the internal governance mode stored in DB back to wizard option IDs
function internalModeToWizardId(internalMode: string): string {
  if (internalMode === "supervised") return "conservative";
  if (internalMode === "autonomous") return "advanced";
  return "balanced"; // default: "collaborative" → "balanced"
}

export default function OnboardingAiWorkforcePage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [stepIdx, setStepIdx] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [preloaded, setPreloaded] = useState(false);

  // Route guard: check derived setup status — never trust a fragile boolean flag alone
  const { data: setupStatus, isLoading: statusLoading } = useQuery<{
    isConfigured: boolean;
    hasWorkforceRecord: boolean;
    hasDepartments: boolean;
    hasGovernanceSettings: boolean;
    hasAutomationSettings: boolean;
    setupCompleteFlag: boolean;
  }>({
    queryKey: ["/api/ai-workforce/setup-status"],
    staleTime: 0,
  });

  // Redirect configured orgs away from the wizard to the live dashboard
  useEffect(() => {
    if (!statusLoading && setupStatus?.isConfigured) {
      navigate("/admin/ai-governance");
    }
  }, [statusLoading, setupStatus, navigate]);

  // Fetch existing configuration — null means first-time setup
  const { data: existingSettings, isLoading: settingsLoading } = useQuery<any | null>({
    queryKey: ["/api/workforce/settings"],
    staleTime: 0,
    enabled: !statusLoading && !setupStatus?.isConfigured,
  });

  const isEditMode = !settingsLoading && existingSettings != null;

  // Preload wizard state from existing settings (runs once when data arrives)
  useEffect(() => {
    if (preloaded || settingsLoading || !existingSettings) return;
    setState({
      goals: Array.isArray(existingSettings.goals) ? existingSettings.goals : [],
      orgPreset: existingSettings.orgPreset ?? "",
      departments: Array.isArray(existingSettings.enabledDepartments) ? existingSettings.enabledDepartments : ["communications"],
      governanceMode: internalModeToWizardId(existingSettings.governanceMode ?? "collaborative"),
      integrations: Array.isArray(existingSettings.selectedIntegrations) ? existingSettings.selectedIntegrations : [],
      workflows: Array.isArray(existingSettings.selectedWorkflowTemplates) ? existingSettings.selectedWorkflowTemplates : [],
    });
    setPreloaded(true);
  }, [existingSettings, settingsLoading, preloaded]);

  // Block rendering until we know whether this org is configured
  // (prevents a flash of the wizard UI before the redirect fires)
  if (statusLoading || setupStatus?.isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Checking workforce status…</p>
        </div>
      </div>
    );
  }

  const toggleGoal = (id: string) => setState(s => ({
    ...s, goals: s.goals.includes(id) ? s.goals.filter(x => x !== id) : [...s.goals, id],
  }));
  const toggleDept = (id: string) => setState(s => ({
    ...s, departments: s.departments.includes(id) ? s.departments.filter(x => x !== id) : [...s.departments, id],
  }));
  const toggleIntegration = (id: string) => setState(s => ({
    ...s, integrations: s.integrations.includes(id) ? s.integrations.filter(x => x !== id) : [...s.integrations, id],
  }));
  const toggleWorkflow = (id: string) => setState(s => ({
    ...s, workflows: s.workflows.includes(id) ? s.workflows.filter(x => x !== id) : [...s.workflows, id],
  }));

  const launchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/ai-workforce/complete", {
        goals: state.goals,
        orgPreset: state.orgPreset,
        departments: state.departments,
        governanceMode: GOVERNANCE_MODES.find(m => m.id === state.governanceMode)?.internalMode ?? "collaborative",
        integrations: state.integrations,
        workflowTemplates: state.workflows,
      });
      return res.json();
    },
    onSuccess: (data: {
      success: boolean;
      workflowsCreated: string[];
      autoPublished: string[];
      integrationWarnings: string[];
      verificationLog: string[];
    }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-workforce/setup-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workforce/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflow-graphs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/settings"] });

      // Primary success toast — truthful about what actually happened
      const workflowMsg = data.workflowsCreated?.length
        ? `${data.workflowsCreated.length} starter workflow${data.workflowsCreated.length > 1 ? "s" : ""} created as drafts.`
        : "No workflows selected.";
      const autoMsg = data.autoPublished?.length
        ? ` Daily Executive Summary was auto-published.`
        : "";
      toast({
        title: isEditMode ? "AI Workforce updated." : "AI Workforce setup saved.",
        description: `${workflowMsg}${autoMsg} Governance rules applied.`,
      });

      // Secondary warning toast for unconnected integrations
      if (data.integrationWarnings?.length) {
        setTimeout(() => {
          toast({
            title: "Integration setup needed",
            description: data.integrationWarnings.join(" · "),
            variant: "destructive",
          });
        }, 800);
      }

      navigate("/admin/ai-workforce");
    },
    onError: (err: any) => {
      let title = "Setup failed";
      let description = "Please try again.";
      try {
        const raw = err?.message ?? "";
        const jsonPart = raw.indexOf("{") !== -1 ? raw.slice(raw.indexOf("{")) : null;
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          const msg = parsed.message ?? parsed.error;
          if (msg) description = msg;
          if (parsed.phase) title = `Setup failed (${parsed.phase})`;
          if (parsed.details && parsed.details !== msg) description += ` — ${parsed.details}`;
        }
      } catch {}
      toast({ title, description, variant: "destructive" });
    },
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepIdx]);

  const pct = Math.round(((stepIdx + 1) / STEPS.length) * 100);
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const isFirst = stepIdx === 0;

  const canProceed = () => {
    if (step.id === "goals") return state.goals.length > 0;
    if (step.id === "preset") return !!state.orgPreset;
    if (step.id === "departments") return state.departments.length > 0;
    return true;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex flex-col" data-testid="page-onboarding-wizard">
      {/* Top progress bar */}
      <div className="fixed top-14 sm:top-0 left-0 right-0 z-40 bg-background/90 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
              <Brain className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">{isEditMode ? "Edit AI Workforce" : "AI Workforce Setup"}</span>
          </div>
          <Progress value={pct} className="flex-1 h-1.5" />
          <span className="text-xs text-muted-foreground shrink-0">{stepIdx + 1} / {STEPS.length}</span>
        </div>

        {/* Step pills */}
        <div className="max-w-3xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => i < stepIdx && setStepIdx(i)}
              className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                i === stepIdx ? "bg-primary text-primary-foreground" :
                i < stepIdx ? "bg-primary/20 text-primary hover:bg-primary/30" :
                "bg-muted text-muted-foreground"
              }`}
            >
              {i < stepIdx ? "✓ " : ""}{s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pt-16 sm:pt-28 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto px-4">
          {step.id === "welcome" && <StepWelcome />}
          {step.id === "goals" && <StepGoals selected={state.goals} onToggle={toggleGoal} />}
          {step.id === "preset" && <StepOrgPreset selected={state.orgPreset} onSelect={v => setState(s => ({ ...s, orgPreset: v }))} />}
          {step.id === "departments" && <StepDepartments selected={state.departments} onToggle={toggleDept} goals={state.goals} />}
          {step.id === "governance" && <StepGovernance selected={state.governanceMode} onSelect={v => setState(s => ({ ...s, governanceMode: v }))} />}
          {step.id === "integrations" && <StepIntegrations selected={state.integrations} onToggle={toggleIntegration} />}
          {step.id === "workflows" && <StepWorkflows selected={state.workflows} onToggle={toggleWorkflow} goals={state.goals} />}
          {step.id === "review" && <StepReview state={state} />}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur border-t pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStepIdx(i => i - 1)}
            disabled={isFirst}
            className="gap-1.5"
            data-testid="button-wizard-back"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin/ai-workforce")} className="text-xs text-muted-foreground">
                {isEditMode ? "Cancel" : "Skip setup"}
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]"
                onClick={() => launchMutation.mutate()}
                disabled={launchMutation.isPending}
                data-testid="button-launch-workforce"
              >
                {launchMutation.isPending ? "Saving…" : (<><Zap className="h-4 w-4" />{isEditMode ? "Save Changes" : "Save & Continue"}</>)}
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5 min-w-[100px]"
                onClick={() => setStepIdx(i => i + 1)}
                disabled={!canProceed()}
                data-testid="button-wizard-next"
              >
                Continue <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
