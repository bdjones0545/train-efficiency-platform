import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Calendar,
  Mail,
  AlertCircle,
  Building2,
  User,
  Bell,
  Loader2,
  ChevronRight,
  ShieldCheck,
  Users,
  ArrowRight,
  Phone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AthleteEntry {
  athleteUserId: string;
  athleteName: string;
  athleteAvatar: string | null;
  linkStatus: string;
  organization: { name: string; slug: string } | null;
  readiness: {
    state: string;
    label: string;
    description: string;
    done: boolean;
    actionNeeded: boolean;
    urgency: "high" | "medium" | "low" | "none";
  };
  missingItems: string[];
  nextSession: {
    startAt: string;
    endAt: string;
    location: string | null;
    serviceName: string | null;
  } | null;
  progress: { completed: number; total: number; pct: number };
}

interface GuardianSummary {
  userType: "guardian";
  isFirstLogin: boolean;
  profileConfirmed: boolean;
  guardian: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    smsOptIn: boolean;
  };
  linkedAthletes: AthleteEntry[];
  communicationPreferences: {
    smsOptIn: boolean;
    notificationPreferences: unknown;
  };
  contactOptions: { label: string; type: string; value: string }[];
}

function ReadinessBadge({ urgency, label }: { urgency: string; label: string }) {
  const colors: Record<string, string> = {
    none: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[urgency] ?? colors.low}`}>
      {label}
    </span>
  );
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function AthleteCard({ athlete }: { athlete: AthleteEntry }) {
  const allDone = athlete.readiness.done;
  return (
    <Card
      data-testid={`athlete-card-${athlete.athleteUserId}`}
      className={allDone ? "border-green-500/30" : athlete.readiness.urgency === "high" ? "border-red-400/30" : ""}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {athlete.athleteAvatar ? (
              <img src={athlete.athleteAvatar} alt={athlete.athleteName} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="font-semibold text-sm">{athlete.athleteName}</p>
              {athlete.organization && (
                <p className="text-xs text-muted-foreground">{athlete.organization.name}</p>
              )}
            </div>
          </div>
          <ReadinessBadge urgency={athlete.readiness.urgency} label={athlete.readiness.label} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{athlete.readiness.description}</p>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{athlete.progress.completed} / {athlete.progress.total}</span>
          </div>
          <Progress value={athlete.progress.pct} className="h-1.5" data-testid={`progress-${athlete.athleteUserId}`} />
        </div>

        {/* Next session */}
        {athlete.nextSession && (
          <div className="flex items-start gap-2 bg-muted/40 rounded-lg p-2">
            <Calendar className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium">{athlete.nextSession.serviceName ?? "Training Session"}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(athlete.nextSession.startAt)}</p>
              {athlete.nextSession.location && (
                <p className="text-xs text-muted-foreground">{athlete.nextSession.location}</p>
              )}
            </div>
          </div>
        )}

        {/* Missing items */}
        {athlete.missingItems.length > 0 && (
          <div className="space-y-1 pt-1 border-t">
            {athlete.missingItems.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        )}

        {allDone && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-xs font-medium">Ready to train!</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function GuardianOnboardingPage() {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: summary, isLoading } = useQuery<GuardianSummary>({
    queryKey: ["/api/guardian/onboarding"],
    enabled: !!authUser,
  });

  const markViewedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/guardian/onboarding/mark-viewed"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/guardian/onboarding"] }),
  });

  const confirmProfileMutation = useMutation({
    mutationFn: (data: { smsOptIn?: boolean }) =>
      apiRequest("POST", "/api/guardian/onboarding/confirm-profile", data),
    onSuccess: () => {
      toast({ title: "Preferences saved", description: "Your communication preferences have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/guardian/onboarding"] });
    },
  });

  useEffect(() => {
    if (summary?.isFirstLogin) {
      markViewedMutation.mutate();
    }
  }, [summary?.isFirstLogin]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-sm w-full mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-4">Please sign in to view athlete onboarding.</p>
            <Button onClick={() => navigate("/")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!summary) return null;

  const { guardian, linkedAthletes, communicationPreferences, contactOptions } = summary;
  const displayName = [guardian.firstName, guardian.lastName].filter(Boolean).join(" ") || guardian.email || "Guardian";
  const allAthletesReady = linkedAthletes.length > 0 && linkedAthletes.every((a) => a.readiness.done);
  const pendingLinks = linkedAthletes.filter((a) => a.linkStatus === "pending");

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Welcome Header */}
        <div className="text-center space-y-2" data-testid="guardian-welcome-header">
          <div className="mx-auto h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">
            {summary.isFirstLogin ? `Welcome, ${guardian.firstName ?? "Guardian"}!` : `Hi, ${guardian.firstName ?? "Guardian"}!`}
          </h1>
          <p className="text-muted-foreground text-sm">
            {linkedAthletes.length > 0
              ? `You're connected to ${linkedAthletes.length} athlete${linkedAthletes.length > 1 ? "s" : ""}. Here's their onboarding status.`
              : "Your guardian account is set up. Athletes will appear here once linked."}
          </p>
        </div>

        {/* Pending link notice */}
        {pendingLinks.length > 0 && (
          <Card data-testid="guardian-pending-links-card" className="border-yellow-400/30 bg-yellow-50/30 dark:bg-yellow-950/10">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Pending Athlete Connections</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                    {pendingLinks.length} athlete connection{pendingLinks.length > 1 ? "s are" : " is"} pending approval from your organization.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* No athletes */}
        {linkedAthletes.length === 0 && (
          <Card data-testid="guardian-no-athletes-card" className="border-dashed">
            <CardContent className="pt-6 pb-6 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">No athletes linked yet</p>
              <p className="text-xs text-muted-foreground mt-1">Your organization will send you an invite to connect with your athlete.</p>
            </CardContent>
          </Card>
        )}

        {/* All Set */}
        {allAthletesReady && (
          <Card data-testid="guardian-all-set-card" className="bg-green-50 dark:bg-green-950/20 border-green-400/30">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-7 w-7 text-green-500" />
                <div>
                  <p className="font-semibold text-sm">All athletes are ready to train!</p>
                  <p className="text-xs text-muted-foreground">Everything looks great.</p>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => navigate("/")} data-testid="button-guardian-dashboard">
                  Dashboard <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Athlete Cards */}
        {linkedAthletes.map((athlete) => (
          <AthleteCard key={athlete.athleteUserId} athlete={athlete} />
        ))}

        {/* Communication Preferences */}
        <Card data-testid="guardian-comms-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" /> Communication Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="font-medium">{displayName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="font-medium truncate text-xs">{guardian.email ?? "—"}</p>
              </div>
              {guardian.phone && (
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</p>
                  <p className="font-medium text-xs">{guardian.phone}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">SMS alerts</p>
                <p className="font-medium text-xs">{communicationPreferences.smsOptIn ? "Enabled" : "Off"}</p>
              </div>
            </div>
            {!summary.profileConfirmed && (
              <>
                <Separator />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirmProfileMutation.mutate({ smsOptIn: communicationPreferences.smsOptIn })}
                  disabled={confirmProfileMutation.isPending}
                  data-testid="button-guardian-confirm-profile"
                >
                  {confirmProfileMutation.isPending ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-2" /> Saving…</>
                  ) : (
                    "Confirm preferences"
                  )}
                </Button>
              </>
            )}
            {summary.profileConfirmed && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-xs">Preferences confirmed</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contact Organization */}
        {contactOptions.length > 0 && (
          <Card data-testid="guardian-contact-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Contact Organization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Questions about scheduling, billing, or your athlete's progress?</p>
              {contactOptions.map((opt, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    if (opt.type === "email") window.location.href = `mailto:${opt.value}`;
                  }}
                  data-testid={`button-guardian-contact-${i}`}
                >
                  <Mail className="h-4 w-4 mr-2" /> {opt.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="text-center pb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-guardian-home">
            Go to Home <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
