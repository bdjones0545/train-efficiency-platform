import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Building2,
  Target,
  Users,
  Zap,
  ChevronRight,
} from "lucide-react";
import { ORG_TYPE_OPTIONS, IMPROVEMENT_GOAL_OPTIONS, getOrgPreset } from "@/lib/org-presets";
import type { OrgType } from "@shared/schema";

const STEPS = [
  { id: 1, title: "Organization Profile", icon: Building2 },
  { id: 2, title: "What to Improve", icon: Target },
  { id: 3, title: "Invite Team", icon: Users },
  { id: 4, title: "First Action", icon: Zap },
];

interface OrgData {
  id: string;
  name: string;
  organizationType?: string | null;
  primarySport?: string | null;
  logoUrl?: string | null;
  onboardingCompleted?: boolean;
}

export default function SetupWizardPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [step, setStep] = useState(1);
  const [orgType, setOrgType] = useState<OrgType>("performance_facility");
  const [primarySport, setPrimarySport] = useState("");
  const [orgName, setOrgName] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [inviteEmails, setInviteEmails] = useState<string[]>(["", "", ""]);
  const [saved, setSaved] = useState(false);

  const { data: profile } = useQuery<{ organizationId?: string }>({
    queryKey: ["/api/profile"],
  });

  const orgId = profile?.organizationId;

  const { data: org } = useQuery<OrgData>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
    onSuccess: (data) => {
      if (data.name) setOrgName(data.name);
      if (data.organizationType) setOrgType(data.organizationType as OrgType);
      if (data.primarySport) setPrimarySport(data.primarySport);
    },
  } as any);

  const updateOrgMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/organizations/${orgId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
    },
  });

  const preset = getOrgPreset(orgType);

  function toggleGoal(val: string) {
    if (val === "all") {
      setGoals(["all"]);
      return;
    }
    setGoals((prev) => {
      const filtered = prev.filter((g) => g !== "all");
      return filtered.includes(val)
        ? filtered.filter((g) => g !== val)
        : [...filtered, val];
    });
  }

  async function handleStep1Next() {
    if (!orgId) return;
    await updateOrgMutation.mutateAsync({
      name: orgName || org?.name,
      organizationType: orgType,
      primarySport,
    });
    setStep(2);
  }

  async function handleStep2Next() {
    if (!orgId) return;
    await updateOrgMutation.mutateAsync({ improvementGoals: goals });
    setStep(3);
  }

  function handleStep3Next() {
    setStep(4);
  }

  async function handleFinish() {
    if (!orgId) return;
    await updateOrgMutation.mutateAsync({ onboardingCompleted: true });
    setSaved(true);
    qc.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
    setTimeout(() => setLocation(preset.onboarding.recommendedRoute), 800);
  }

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-4">
            <Zap className="h-3.5 w-3.5" />
            Setup Wizard
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to TrainEfficiency
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Let's get your organization set up in just a few steps.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-between mb-8 relative">
          <div
            className="absolute top-4 left-4 right-4 h-0.5 bg-border"
            aria-hidden
          />
          <div
            className="absolute top-4 left-4 h-0.5 bg-primary transition-all duration-500"
            style={{ width: `calc(${progress}% - 2rem)` }}
            aria-hidden
          />
          {STEPS.map((s) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex flex-col items-center gap-2 relative z-10">
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors border-2",
                    done
                      ? "bg-primary border-primary text-primary-foreground"
                      : active
                      ? "bg-background border-primary text-primary"
                      : "bg-background border-border text-muted-foreground"
                  )}
                  data-testid={`step-indicator-${s.id}`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : s.id}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium hidden sm:block",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <Card data-testid={`wizard-step-${step}`}>
          <CardContent className="pt-6 pb-6">
            {/* ── Step 1: Organization Profile ───────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-1">Organization Profile</h2>
                  <p className="text-sm text-muted-foreground">
                    Tell us about your organization so we can personalize your experience.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    data-testid="input-org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={org?.name || "Enter your organization name"}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Organization Type</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ORG_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        data-testid={`org-type-${opt.value}`}
                        onClick={() => setOrgType(opt.value)}
                        className={cn(
                          "flex flex-col items-start gap-0.5 p-3 rounded-lg border text-left transition-colors",
                          orgType === opt.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-primary/40 hover:bg-muted/40"
                        )}
                      >
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {opt.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primary-sport">Primary Sport</Label>
                  <Input
                    id="primary-sport"
                    data-testid="input-primary-sport"
                    value={primarySport}
                    onChange={(e) => setPrimarySport(e.target.value)}
                    placeholder="e.g. Football, Basketball, Soccer, All Sports…"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleStep1Next}
                    disabled={updateOrgMutation.isPending}
                    data-testid="button-step1-next"
                  >
                    Save & Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step 2: Improvement Goals ──────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-1">What Are You Trying To Improve?</h2>
                  <p className="text-sm text-muted-foreground">
                    Select everything that applies. We'll tailor the platform to match.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {IMPROVEMENT_GOAL_OPTIONS.map((opt) => {
                    const selected = goals.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        data-testid={`goal-${opt.value}`}
                        onClick={() => toggleGoal(opt.value)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-primary/40 hover:bg-muted/40"
                        )}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                            selected ? "bg-primary border-primary" : "border-muted-foreground"
                          )}
                        >
                          {selected && (
                            <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                        <span className="text-sm font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)} data-testid="button-step2-back">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={handleStep2Next}
                    disabled={updateOrgMutation.isPending}
                    data-testid="button-step2-next"
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step 3: Invite Team ────────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-1">Invite Your Team</h2>
                  <p className="text-sm text-muted-foreground">
                    Add coaches, athletes, or staff. You can always do this later.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-2">
                  {[
                    { icon: Users, label: "Coaches", color: "blue" },
                    { icon: Target, label: "Athletes", color: "green" },
                    { icon: Building2, label: "Staff", color: "purple" },
                  ].map((role) => (
                    <div
                      key={role.label}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border bg-muted/30 text-center"
                    >
                      <role.icon className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">{role.label}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Invite by Email (optional)</Label>
                  {inviteEmails.map((email, idx) => (
                    <Input
                      key={idx}
                      data-testid={`input-invite-email-${idx}`}
                      value={email}
                      onChange={(e) => {
                        const next = [...inviteEmails];
                        next[idx] = e.target.value;
                        setInviteEmails(next);
                      }}
                      placeholder={`team.member${idx + 1}@example.com`}
                      type="email"
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Full invite flow is available in Settings → Coaches after setup.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setStep(2)} data-testid="button-step3-back">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleStep3Next}
                      data-testid="button-step3-skip"
                    >
                      Skip for now
                    </Button>
                    <Button onClick={handleStep3Next} data-testid="button-step3-next">
                      Continue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 4: First Action ───────────────────────────────────────── */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-1">You're Almost Ready!</h2>
                  <p className="text-sm text-muted-foreground">
                    Based on your setup as a <strong>{preset.label}</strong>, here's the recommended first action.
                  </p>
                </div>

                <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-5">
                  <div className="flex items-start gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <Badge variant="secondary" className="mb-2 text-xs">
                        Recommended First Step
                      </Badge>
                      <h3 className="font-semibold text-base" data-testid="text-recommended-action">
                        {preset.onboarding.recommendedAction}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1" data-testid="text-recommended-message">
                        {preset.onboarding.welcomeMessage}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Your Setup
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{preset.label}</Badge>
                    {primarySport && <Badge variant="outline">{primarySport}</Badge>}
                    {goals.map((g) => (
                      <Badge key={g} variant="secondary">
                        {IMPROVEMENT_GOAL_OPTIONS.find((o) => o.value === g)?.label ?? g}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setStep(3)} data-testid="button-step4-back">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={handleFinish}
                    disabled={updateOrgMutation.isPending || saved}
                    data-testid="button-finish-setup"
                    className="min-w-[180px]"
                  >
                    {saved ? (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Done! Redirecting…
                      </>
                    ) : (
                      <>
                        {preset.onboarding.recommendedAction}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Skip link */}
        {step < 4 && (
          <div className="text-center mt-4">
            <button
              onClick={() => setLocation("/")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
              data-testid="button-skip-setup"
            >
              Skip setup for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
