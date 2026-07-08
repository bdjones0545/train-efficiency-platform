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
  Circle,
  Calendar,
  Dumbbell,
  Mail,
  AlertCircle,
  ArrowRight,
  Building2,
  User,
  Phone,
  Bell,
  Loader2,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  done: boolean;
  actionNeeded?: boolean;
}

interface NextSession {
  id: string;
  startAt: string;
  endAt: string;
  location: string | null;
  serviceName: string | null;
  sessionType: string | null;
  durationMin: number | null;
  coachName: string | null;
}

interface OnboardingSummary {
  userType: "athlete";
  isFirstLogin: boolean;
  profileConfirmed: boolean;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    profileImageUrl: string | null;
    smsOptIn: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    tagline: string | null;
  } | null;
  readiness: {
    state: string;
    label: string;
    description: string;
    done: boolean;
    actionNeeded: boolean;
    urgency: "high" | "medium" | "low" | "none";
  };
  checklistItems: ChecklistItem[];
  missingItems: string[];
  nextBestAction: string | null;
  progress: { completed: number; total: number; pct: number };
  nextSession: NextSession | null;
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
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function ClientOnboardingPage() {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: summary, isLoading } = useQuery<OnboardingSummary>({
    queryKey: ["/api/client/onboarding"],
    enabled: !!authUser,
  });

  const markViewedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/client/onboarding/mark-viewed"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/client/onboarding"] }),
  });

  const confirmProfileMutation = useMutation({
    mutationFn: (data: { smsOptIn?: boolean }) =>
      apiRequest("POST", "/api/client/onboarding/confirm-profile", data),
    onSuccess: () => {
      toast({ title: "Profile confirmed", description: "Your information has been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/client/onboarding"] });
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
            <p className="text-muted-foreground mb-4">Please sign in to view your onboarding.</p>
            <Button onClick={() => navigate("/")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!summary) return null;

  const { user, organization, readiness, checklistItems, missingItems, nextSession, progress, contactOptions, nextBestAction } = summary;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Athlete";
  const allDone = readiness.state === "actively_training" || readiness.state === "ready_to_train";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Welcome Header */}
        <div className="text-center space-y-2" data-testid="onboarding-welcome-header">
          {organization?.logoUrl && (
            <img src={organization.logoUrl} alt={organization.name} className="h-12 mx-auto mb-3 object-contain" />
          )}
          <h1 className="text-2xl font-bold">
            {summary.isFirstLogin ? `Welcome, ${user.firstName ?? "Athlete"}!` : `Hi, ${user.firstName ?? "Athlete"}!`}
          </h1>
          <p className="text-muted-foreground text-sm">
            {summary.isFirstLogin
              ? "Here's everything you need to know before your first training session."
              : "Your onboarding status at a glance."}
          </p>
        </div>

        {/* Organization Card */}
        {organization && (
          <Card data-testid="onboarding-org-card">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{organization.name}</p>
                  {organization.tagline && (
                    <p className="text-xs text-muted-foreground">{organization.tagline}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Readiness Status */}
        <Card data-testid="onboarding-readiness-card" className={allDone ? "border-green-500/40" : readiness.urgency === "high" ? "border-red-400/40" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Your Status</CardTitle>
              <ReadinessBadge urgency={readiness.urgency} label={readiness.label} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{readiness.description}</p>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Onboarding progress</span>
                <span>{progress.completed} / {progress.total} steps</span>
              </div>
              <Progress value={progress.pct} className="h-2" data-testid="onboarding-progress-bar" />
            </div>

            {allDone && (
              <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700 dark:text-green-400 font-medium">You're all set!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Next Session */}
        {nextSession ? (
          <Card data-testid="onboarding-next-session-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" /> Upcoming Session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-medium text-sm">{nextSession.serviceName ?? "Training Session"}</p>
              <p className="text-sm text-muted-foreground">{formatDateTime(nextSession.startAt)}</p>
              {nextSession.coachName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> with {nextSession.coachName}
                </p>
              )}
              {nextSession.location && (
                <p className="text-xs text-muted-foreground">{nextSession.location}</p>
              )}
              {nextSession.durationMin && (
                <Badge variant="outline" className="text-xs">{nextSession.durationMin} min</Badge>
              )}
            </CardContent>
          </Card>
        ) : !allDone ? (
          <Card data-testid="onboarding-no-session-card" className="border-dashed">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Calendar className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">No upcoming sessions yet. Your coach will schedule your first session.</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Checklist */}
        <Card data-testid="onboarding-checklist-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> Getting Started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {checklistItems.map((item) => (
              <div key={item.key} className="flex items-start gap-3" data-testid={`checklist-item-${item.key}`}>
                {item.done ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                ) : item.actionNeeded ? (
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`text-sm font-medium ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Missing Items / Next Best Action */}
        {(missingItems.length > 0 || nextBestAction) && !allDone && (
          <Card data-testid="onboarding-missing-items-card" className="border-amber-400/30 bg-amber-50/30 dark:bg-amber-950/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-700 dark:text-amber-400">What Needs Attention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {missingItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ArrowRight className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800 dark:text-amber-300">{item}</p>
                </div>
              ))}
              {nextBestAction && (
                <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Recommended next step:</p>
                  <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">{nextBestAction}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Profile Confirmation */}
        {!summary.profileConfirmed && (
          <Card data-testid="onboarding-profile-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Confirm Your Info
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
                  <p className="font-medium truncate">{user.email ?? "—"}</p>
                </div>
                {user.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</p>
                    <p className="font-medium">{user.phone}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Bell className="h-3 w-3" /> SMS Alerts</p>
                  <p className="font-medium">{user.smsOptIn ? "Enabled" : "Off"}</p>
                </div>
              </div>
              <Separator />
              <Button
                size="sm"
                variant="outline"
                onClick={() => confirmProfileMutation.mutate({ smsOptIn: user.smsOptIn })}
                disabled={confirmProfileMutation.isPending}
                data-testid="button-confirm-profile"
              >
                {confirmProfileMutation.isPending ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-2" /> Saving…</>
                ) : (
                  "Confirm this looks right"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* All Set — post-completion actions */}
        {allDone && (
          <Card data-testid="onboarding-complete-card" className="bg-green-50 dark:bg-green-950/20 border-green-400/30">
            <CardContent className="pt-5 pb-5 space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <div>
                  <p className="font-semibold">You're all set!</p>
                  <p className="text-sm text-muted-foreground">Everything is in place for your training.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => navigate("/bookings")} data-testid="button-view-schedule">
                  View Schedule <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/")} data-testid="button-go-dashboard">
                  Go to Dashboard <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contact Coach */}
        {contactOptions.length > 0 && (
          <Card data-testid="onboarding-contact-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" /> Contact Your Coach
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Have a question? Reach out any time.</p>
              {contactOptions.map((opt, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    if (opt.type === "email") window.location.href = `mailto:${opt.value}`;
                  }}
                  data-testid={`button-contact-${i}`}
                >
                  <Mail className="h-4 w-4 mr-2" /> {opt.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="text-center pb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-go-home">
            <Dumbbell className="h-4 w-4 mr-2" /> Go to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
