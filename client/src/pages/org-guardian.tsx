import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Bell, BookOpen, Calendar,
  CheckCircle, Trophy, Users, GraduationCap, Loader2,
  ShieldCheck, AlertTriangle, Circle, Dumbbell, User,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

type View = "home" | "athlete" | "notifications";

function relLabel(type: string) {
  return { mother: "Mother", father: "Father", guardian: "Guardian", other: "Guardian" }[type] ?? "Guardian";
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NotifIcon({ type }: { type: string }) {
  if (type === "education_progress" || type === "education_completed")
    return <GraduationCap className="h-4 w-4 text-emerald-400" />;
  if (type === "pr_update" || type === "pr_achieved")
    return <Trophy className="h-4 w-4 text-amber-400" />;
  if (type === "missed_workout")
    return <AlertTriangle className="h-4 w-4 text-rose-400" />;
  if (type === "workout_completion")
    return <Dumbbell className="h-4 w-4 text-blue-400" />;
  return <Bell className="h-4 w-4 text-primary" />;
}

export default function OrgGuardianPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [view, setView] = useState<View>("home");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  // ── Portal data ────────────────────────────────────────────────────────────
  const { data: portalData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/guardian/portal", slug],
    queryFn: () => fetch("/api/org/guardian/portal", { headers }).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const athletes: any[] = portalData?.athletes ?? [];
  const unreadCount: number = portalData?.unreadCount ?? 0;

  // ── Athlete detail ─────────────────────────────────────────────────────────
  const { data: athleteData, isLoading: loadingAthlete } = useQuery<any>({
    queryKey: ["/api/org/guardian/athlete", selectedAthleteId],
    queryFn: () => fetch(`/api/org/guardian/athlete/${selectedAthleteId}`, { headers }).then((r) => r.json()),
    enabled: !!selectedAthleteId && view === "athlete",
  });

  // ── Notifications ──────────────────────────────────────────────────────────
  const { data: notifsData, refetch: refetchNotifs } = useQuery<any>({
    queryKey: ["/api/org/guardian/notifications", slug],
    queryFn: () => fetch("/api/org/guardian/notifications", { headers }).then((r) => r.json()),
    enabled: view === "notifications",
  });
  const notifications: any[] = notifsData?.notifications ?? [];

  const markReadMut = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/org/guardian/notifications/${id}/read`, {}, { headers }),
    onSuccess: () => { refetchNotifs(); queryClient.invalidateQueries({ queryKey: ["/api/org/guardian/portal", slug] }); },
  });

  const markAllReadMut = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/org/guardian/notifications/read-all", {}, { headers }),
    onSuccess: () => { refetchNotifs(); queryClient.invalidateQueries({ queryKey: ["/api/org/guardian/portal", slug] }); },
  });

  // ── HOME ───────────────────────────────────────────────────────────────────
  if (view === "home") {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setLocation(`/org/${slug}/portal`)} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-sm flex-1">Guardian Portal</h1>
          <button onClick={() => setView("notifications")} className="relative p-1" data-testid="button-notifications">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] font-bold flex items-center justify-center text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>

        <div className="p-4 space-y-5">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}

          {/* Linked Athletes */}
          {athletes.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Linked Athletes
              </p>
              <div className="space-y-3">
                {athletes.map((a: any) => {
                  const prof = a.profile;
                  const edu = a.education;
                  return (
                    <button key={a.athleteUserId} className="w-full text-left"
                      onClick={() => { setSelectedAthleteId(a.athleteUserId); setView("athlete"); }}
                      data-testid={`card-athlete-${a.athleteUserId}`}>
                      <Card className="p-4 hover:border-primary/20 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">
                              {prof?.firstName && prof?.lastName
                                ? `${prof.firstName} ${prof.lastName}`
                                : prof?.username ?? "Athlete"}
                            </p>
                            <p className="text-xs text-muted-foreground">{relLabel(a.link?.relationshipType)}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold text-primary">{edu.percentComplete}%</p>
                            <p className="text-xs text-muted-foreground">education</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
                        </div>

                        {/* Quick stats row */}
                        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/30">
                          <div className="text-center">
                            <p className="text-sm font-semibold">{a.upcomingBookings?.length ?? 0}</p>
                            <p className="text-xs text-muted-foreground">Upcoming</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold">{edu.completedModules}</p>
                            <p className="text-xs text-muted-foreground">Modules Done</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold">{edu.avgScore !== null ? `${edu.avgScore}%` : "—"}</p>
                            <p className="text-xs text-muted-foreground">Quiz Avg</p>
                          </div>
                        </div>

                        {/* Education progress bar */}
                        {edu.totalModules > 0 && (
                          <div className="mt-2.5">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                              <span>Education Progress</span>
                              <span>{edu.completedModules}/{edu.totalModules} modules</span>
                            </div>
                            <div className="w-full bg-muted/30 rounded-full h-1.5">
                              <div className="bg-emerald-400 h-1.5 rounded-full transition-all"
                                style={{ width: `${edu.percentComplete}%` }} />
                            </div>
                          </div>
                        )}
                      </Card>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* No athletes linked yet */}
          {!isLoading && athletes.length === 0 && (
            <Card className="p-8 text-center space-y-3">
              <Users className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium">No athletes linked yet</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ask your coach or athlete to send you a guardian invite. Once accepted,
                you'll see their progress and schedule here.
              </p>
            </Card>
          )}

          {/* Recent Notifications */}
          {notifications.length === 0 && unreadCount === 0 && !isLoading && athletes.length > 0 && (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Notifications</p>
              <Card className="p-4 text-center text-muted-foreground">
                <Bell className="h-6 w-6 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No notifications yet</p>
              </Card>
            </section>
          )}

          {/* Privacy Notice */}
          <Card className="p-3 border-border/30 bg-card/30">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                You can view schedules, education progress, and key milestones.
                Private coach notes and readiness data are not visible to guardians.
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ── ATHLETE DETAIL ─────────────────────────────────────────────────────────
  if (view === "athlete" && selectedAthleteId) {
    const prof = athleteData?.profile;
    const edu = athleteData?.education;
    const upcoming = athleteData?.upcomingBookings ?? [];
    const recent = athleteData?.recentAthletic ?? [];

    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setView("home")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-semibold text-sm flex-1">
            {prof?.firstName && prof?.lastName
              ? `${prof.firstName} ${prof.lastName}`
              : prof?.username ?? "Athlete"}
          </h1>
          <Badge variant="outline" className="text-xs border-primary/30 text-primary">Guardian View</Badge>
        </div>

        <div className="p-4 space-y-5">
          {loadingAthlete && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

          {!loadingAthlete && (
            <>
              {/* ── Education Progress ──────────────────────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <GraduationCap className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Education Progress</p>
                </div>
                <Card className="p-4">
                  {edu?.totalModules > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Learning Pathway</p>
                        <Badge className={`text-xs ${edu.percentComplete === 100 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-primary/10 text-primary border-primary/20"}`}>
                          {edu.percentComplete}%
                        </Badge>
                      </div>
                      <div className="w-full bg-muted/30 rounded-full h-2">
                        <div className="bg-emerald-400 h-2 rounded-full transition-all"
                          style={{ width: `${edu.percentComplete}%` }} />
                      </div>
                      <div className="grid grid-cols-3 gap-3 pt-1">
                        <div className="text-center">
                          <p className="text-lg font-bold text-emerald-400">{edu.completedModules}</p>
                          <p className="text-xs text-muted-foreground">Completed</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">{edu.totalModules - edu.completedModules}</p>
                          <p className="text-xs text-muted-foreground">Remaining</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">{edu.avgScore !== null ? `${edu.avgScore}%` : "—"}</p>
                          <p className="text-xs text-muted-foreground">Avg Score</p>
                        </div>
                      </div>
                      {edu.percentComplete === 100 && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                          <Trophy className="h-4 w-4 text-amber-400" />
                          <p className="text-xs text-amber-400 font-medium">Pathway Complete — Great work!</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">
                      <BookOpen className="h-6 w-6 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No education modules assigned yet</p>
                    </div>
                  )}
                </Card>
              </section>

              {/* ── Upcoming Schedule ───────────────────────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-blue-400" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Upcoming Sessions</p>
                </div>
                {upcoming.length > 0 ? (
                  <div className="space-y-2">
                    {upcoming.map((b: any) => (
                      <Card key={b.id} className="p-3 flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-blue-400/10 flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-4 w-4 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{b.sessionType ?? b.serviceName ?? "Session"}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(b.startTime)} at {new Date(b.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{b.status ?? "confirmed"}</Badge>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="p-4 text-center text-muted-foreground">
                    <p className="text-xs">No upcoming sessions in the next 30 days</p>
                  </Card>
                )}
              </section>

              {/* ── Recent Activity ─────────────────────────────────────────── */}
              {recent.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Dumbbell className="h-4 w-4 text-violet-400" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recent Activity</p>
                  </div>
                  <div className="space-y-2">
                    {recent.slice(0, 4).map((r: any) => (
                      <Card key={r.id} className="p-3 flex items-center gap-3">
                        <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{r.sessionName ?? r.programName ?? "Training Session"}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Privacy Note ─────────────────────────────────────────────── */}
              <Card className="p-3 border-border/30 bg-card/30">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This view shows schedules and education progress only.
                    Private coaching data, readiness scores, and notes are not visible here.
                  </p>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  if (view === "notifications") {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setView("home")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-semibold text-sm flex-1">Notifications</h1>
          {notifications.some((n: any) => !n.isRead) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => markAllReadMut.mutate()} disabled={markAllReadMut.isPending}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="p-4 space-y-2">
          {notifications.map((n: any) => (
            <button key={n.id} className="w-full text-left" onClick={() => !n.isRead && markReadMut.mutate(n.id)}>
              <Card className={`p-4 flex items-start gap-3 transition-colors ${!n.isRead ? "border-primary/20 bg-primary/5" : ""}`}>
                <div className="h-8 w-8 rounded-full bg-card flex items-center justify-center flex-shrink-0 mt-0.5">
                  <NotifIcon type={n.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">{formatDate(n.createdAt)}</p>
                </div>
                {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />}
              </Card>
            </button>
          ))}
          {notifications.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No notifications yet</p>
              <p className="text-xs mt-1">You'll receive updates about your athlete's progress here</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
