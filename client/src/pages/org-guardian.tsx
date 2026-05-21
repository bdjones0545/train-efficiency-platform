import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Bell, BookOpen, Calendar,
  CheckCircle2, Trophy, Users, GraduationCap, Loader2,
  ShieldCheck, Dumbbell, User, Flame, Star, Heart,
  Target, TrendingUp, Clock, MessageSquare, Settings,
  Circle, Dot, ArrowLeft, Sparkles, Award,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

type View = "home" | "athlete" | "notifications" | "preferences";

function relLabel(type: string) {
  return { mother: "Mother", father: "Father", guardian: "Guardian", other: "Guardian" }[type] ?? "Guardian";
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(d: string | Date) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function athleteInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "A";
}

function statusChip({ label, color }: { label: string; color: string }) {
  const cls: Record<string, string> = {
    green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
    purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
  };
  return cls[color] ?? cls.blue;
}

function NotifIcon({ type }: { type: string }) {
  if (type === "education_progress" || type === "education_completed")
    return <GraduationCap className="h-4 w-4 text-emerald-400" />;
  if (type === "pr_update" || type === "pr_achieved")
    return <Trophy className="h-4 w-4 text-amber-400" />;
  if (type === "missed_workout")
    return <Clock className="h-4 w-4 text-amber-400" />;
  if (type === "workout_completion")
    return <Dumbbell className="h-4 w-4 text-blue-400" />;
  if (type === "streak_milestone")
    return <Flame className="h-4 w-4 text-orange-400" />;
  if (type === "coach_announcement")
    return <MessageSquare className="h-4 w-4 text-primary" />;
  return <Bell className="h-4 w-4 text-primary" />;
}

// ─── Attendance Dot Grid ──────────────────────────────────────────────────────

function AttendanceDots({ dots }: { dots: { date: string; completed: boolean }[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {dots.map((d) => (
        <div
          key={d.date}
          title={d.date}
          className={`h-4 w-4 rounded-sm transition-colors ${
            d.completed
              ? "bg-emerald-400"
              : "bg-muted/40 dark:bg-muted/30"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  color = "blue",
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  color?: string;
}) {
  const colors: Record<string, string> = {
    green: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    blue: "bg-blue-500/10 text-blue-500",
    orange: "bg-orange-500/10 text-orange-500",
    purple: "bg-purple-500/10 text-purple-500",
  };
  return (
    <div className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-2xl bg-card border border-border/50">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${colors[color] ?? colors.blue}`}>
        {icon}
      </div>
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color = "emerald" }: { pct: number; color?: string }) {
  const c: Record<string, string> = {
    emerald: "bg-emerald-400",
    blue: "bg-blue-400",
    amber: "bg-amber-400",
    orange: "bg-orange-400",
  };
  return (
    <div className="w-full bg-muted/30 rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all ${c[color] ?? c.emerald}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ─── Athlete Home Card (summary) ──────────────────────────────────────────────

function AthleteCard({ a, onClick }: { a: any; onClick: () => void }) {
  const edu = a.education;
  const streak = a.streak;
  const name = a.athleteName ?? "Athlete";
  const status = a.supportiveStatus ?? { label: "On Track", color: "blue" };

  return (
    <button className="w-full text-left" onClick={onClick} data-testid={`card-athlete-${a.athleteUserId}`}>
      <Card className="p-4 hover:border-primary/30 hover:shadow-sm transition-all active:scale-[0.99]">
        {/* Name row */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-11 w-11 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">{athleteInitials(name)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{name}</p>
            <p className="text-xs text-muted-foreground">{relLabel(a.link?.relationshipType ?? "guardian")}</p>
          </div>
          <Badge className={`text-[10px] px-2 py-0.5 border ${statusChip(status)}`}>{status.label}</Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center p-2 rounded-xl bg-muted/20">
            <div className="flex items-center justify-center gap-0.5 mb-0.5">
              <Flame className="h-3 w-3 text-orange-400" />
              <span className="text-base font-bold text-orange-400">{streak?.currentStreak ?? 0}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Day Streak</p>
          </div>
          <div className="text-center p-2 rounded-xl bg-muted/20">
            <p className="text-base font-bold text-emerald-400 mb-0.5">{edu?.percentComplete ?? 0}%</p>
            <p className="text-[10px] text-muted-foreground">Education</p>
          </div>
          <div className="text-center p-2 rounded-xl bg-muted/20">
            <p className="text-base font-bold mb-0.5">{a.attendance?.completedLast30Days ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Sessions (30d)</p>
          </div>
        </div>

        {/* Education bar */}
        {edu?.totalModules > 0 && (
          <div>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>Learning Progress</span>
              <span>{edu.completedModules}/{edu.totalModules} modules</span>
            </div>
            <ProgressBar pct={edu.percentComplete} color="emerald" />
          </div>
        )}
      </Card>
    </button>
  );
}

// ─── Athlete Detail View ──────────────────────────────────────────────────────

function AthleteDetailView({
  athleteId,
  slug,
  headers,
  onBack,
}: {
  athleteId: string;
  slug: string;
  headers: Record<string, string>;
  onBack: () => void;
}) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/org/guardian/athlete", athleteId],
    queryFn: () => fetch(`/api/org/guardian/athlete/${athleteId}`, { headers }).then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const name = data?.athleteName ?? "Athlete";
  const edu = data?.education ?? { totalModules: 0, completedModules: 0, percentComplete: 0, avgScore: null, overdueModules: [], recentCompletions: [] };
  const streak = data?.streak ?? { currentStreak: 0, longestStreak: 0, totalSessionsCompleted: 0 };
  const attendance = data?.attendance ?? { completedLast30Days: 0, consistencyPct: 0, attendanceDots: [], last14Completed: 0 };
  const upcoming = data?.upcomingBookings ?? [];
  const recentPRs = data?.recentPRs ?? [];
  const status = data?.supportiveStatus ?? { label: "On Track", color: "blue", message: "Making steady progress." };

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1 -ml-1" data-testid="button-back-athlete">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-primary">{athleteInitials(name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{name}</p>
          <Badge className={`text-[9px] px-1.5 h-4 border ${statusChip(status)}`}>{status.label}</Badge>
        </div>
      </div>

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Status message */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-primary/5 border border-primary/15">
          <Heart className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/70 leading-relaxed">{status.message}</p>
        </div>

        {/* ── A. Snapshot Stats ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2" data-testid="section-snapshot-stats">
          <StatCard icon={<Flame className="h-4 w-4" />} value={streak.currentStreak} label="Day Streak" color="orange" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} value={`${edu.percentComplete}%`} label="Education" color="green" />
          <StatCard icon={<Dumbbell className="h-4 w-4" />} value={attendance.completedLast30Days} label="Sessions 30d" color="blue" />
        </div>

        {/* ── B. Upcoming Schedule ─────────────────────────────────────────────── */}
        <section data-testid="section-upcoming-schedule">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Upcoming Schedule</h3>
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2">
              {upcoming.map((b: any) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-border/50 bg-card">
                  <div className="h-9 w-9 rounded-xl bg-blue-400/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{b.sessionType ?? b.serviceName ?? "Training Session"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(b.startTime)} at {formatTime(b.startTime)}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{b.status ?? "confirmed"}</Badge>
                </div>
              ))}
              {/* Education due */}
              {edu.overdueModules.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-500/25 bg-amber-500/5">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Learning Module Due</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 truncate">"{edu.overdueModules[0]?.title}"</p>
                  </div>
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-500 border-amber-500/25">Pending</Badge>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 rounded-2xl border border-border/40 bg-card">
              <Calendar className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No upcoming sessions in the next 30 days</p>
            </div>
          )}
        </section>

        {/* ── C. Progress Highlights ───────────────────────────────────────────── */}
        <section data-testid="section-progress-highlights">
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Progress Highlights</h3>
          </div>
          <div className="space-y-2">
            {/* Streak milestone */}
            {streak.currentStreak >= 3 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-orange-500/25 bg-orange-500/5">
                <Flame className="h-5 w-5 text-orange-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{streak.currentStreak}-Day Training Streak!</p>
                  <p className="text-xs text-muted-foreground">Longest streak: {streak.longestStreak} days</p>
                </div>
              </div>
            )}

            {/* PRs */}
            {recentPRs.length > 0 && recentPRs.slice(0, 3).map((pr: any) => (
              <div key={pr.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-500/25 bg-amber-500/5">
                <Trophy className="h-5 w-5 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                    {pr.liftName} — {pr.value} {pr.unit}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(pr.entryDate)} {pr.verified ? "· Verified" : ""}</p>
                </div>
                {pr.verified && <Award className="h-4 w-4 text-amber-400 flex-shrink-0" />}
              </div>
            ))}

            {/* Total sessions milestone */}
            {streak.totalSessionsCompleted > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5">
                <Sparkles className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{streak.totalSessionsCompleted} Total Sessions Completed</p>
                  <p className="text-xs text-muted-foreground">Incredible dedication to the craft!</p>
                </div>
              </div>
            )}

            {/* Education completion milestone */}
            {edu.recentCompletions.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-blue-500/25 bg-blue-500/5">
                <GraduationCap className="h-5 w-5 text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Education Module Completed</p>
                  <p className="text-xs text-muted-foreground">Recently finished {edu.recentCompletions.length} module{edu.recentCompletions.length > 1 ? "s" : ""}!</p>
                </div>
              </div>
            )}

            {streak.currentStreak < 3 && recentPRs.length === 0 && streak.totalSessionsCompleted === 0 && edu.recentCompletions.length === 0 && (
              <div className="text-center py-6 rounded-2xl border border-border/40 bg-card">
                <Star className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Highlights will appear as they train</p>
              </div>
            )}
          </div>
        </section>

        {/* ── D. Education Progress ─────────────────────────────────────────────── */}
        <section data-testid="section-education-progress">
          <div className="flex items-center gap-2 mb-3">
            <GraduationCap className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Education Progress</h3>
          </div>
          <Card className="p-4 rounded-2xl">
            {edu.totalModules > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">Learning Pathway</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{edu.completedModules} of {edu.totalModules} modules complete</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${edu.percentComplete === 100 ? "text-emerald-400" : "text-primary"}`}>
                      {edu.percentComplete}%
                    </p>
                    {edu.avgScore !== null && (
                      <p className="text-xs text-muted-foreground">Avg score: {edu.avgScore}%</p>
                    )}
                  </div>
                </div>

                <ProgressBar pct={edu.percentComplete} color="emerald" />

                {edu.percentComplete === 100 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Trophy className="h-4 w-4 text-amber-400" />
                    <p className="text-sm font-semibold text-amber-500">Pathway Complete — Incredible work!</p>
                  </div>
                )}

                {edu.overdueModules.length > 0 && edu.percentComplete < 100 && (
                  <div className="pt-1 border-t border-border/30">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Up Next:</p>
                    {edu.overdueModules.slice(0, 2).map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 py-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                        <p className="text-xs text-foreground/70 truncate">{m.title}</p>
                      </div>
                    ))}
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

        {/* ── E. Attendance & Consistency ──────────────────────────────────────── */}
        <section data-testid="section-attendance">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Consistency Trend</h3>
          </div>
          <Card className="p-4 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">Last 14 Days</p>
                <p className="text-xs text-muted-foreground">{attendance.last14Completed} of 14 days active</p>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold ${attendance.consistencyPct >= 70 ? "text-emerald-400" : attendance.consistencyPct >= 40 ? "text-amber-400" : "text-blue-400"}`}>
                  {attendance.consistencyPct}%
                </p>
                <p className="text-xs text-muted-foreground">Consistency</p>
              </div>
            </div>

            <AttendanceDots dots={attendance.attendanceDots} />

            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded-sm bg-emerald-400" />Active day
              </div>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded-sm bg-muted/40" />Rest day
              </div>
            </div>

            <div className="pt-1 border-t border-border/30">
              <p className="text-xs text-muted-foreground">
                {attendance.consistencyPct >= 70
                  ? "Excellent consistency! Keep supporting their routine."
                  : attendance.consistencyPct >= 40
                  ? "Building consistency. Encouragement goes a long way!"
                  : "Every session is a win. Help them show up when they can."}
              </p>
            </div>
          </Card>
        </section>

        {/* ── F. Coach Messages ─────────────────────────────────────────────────── */}
        <section data-testid="section-coach-messages">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Coach Updates</h3>
          </div>
          <CoachMessagesInline headers={headers} athleteId={athleteId} />
        </section>

        {/* Privacy note */}
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl border border-border/30 bg-card/40">
          <ShieldCheck className="h-4 w-4 text-primary/60 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            This view shows schedules, progress, and education only. Private coaching intelligence and internal notes are kept confidential.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Coach Messages Component ──────────────────────────────────────────

function CoachMessagesInline({ headers, athleteId }: { headers: Record<string, string>; athleteId: string }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/org/guardian/notifications", athleteId],
    queryFn: () => fetch("/api/org/guardian/notifications", { headers }).then((r) => r.json()),
  });
  const notifs: any[] = (data?.notifications ?? []).filter((n: any) => n.athleteUserId === athleteId).slice(0, 5);

  if (notifs.length === 0) {
    return (
      <div className="text-center py-5 rounded-2xl border border-border/40 bg-card">
        <MessageSquare className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No messages yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notifs.map((n: any) => (
        <div key={n.id} className={`flex items-start gap-3 px-4 py-3 rounded-2xl border transition-colors ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border/40 bg-card"}`}>
          <div className="h-8 w-8 rounded-full bg-card border border-border/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <NotifIcon type={n.type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{n.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
            <p className="text-[10px] text-muted-foreground/50 mt-1">{formatDate(n.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Preferences View ─────────────────────────────────────────────────────────

function PreferencesView({
  athletes,
  headers,
  onBack,
}: {
  athletes: any[];
  headers: Record<string, string>;
  onBack: () => void;
}) {
  const { toast } = useToast();

  const PREF_LABELS: Record<string, { label: string; desc: string }> = {
    schedule: { label: "Schedule Updates", desc: "Upcoming sessions and reminders" },
    attendance: { label: "Attendance Tracking", desc: "Completed and missed sessions" },
    education: { label: "Education Progress", desc: "Module completions and milestones" },
    prMilestones: { label: "Achievement Alerts", desc: "PRs and milestone celebrations" },
    workoutCompletion: { label: "Workout Completions", desc: "When a session is finished" },
    announcements: { label: "Coach Announcements", desc: "Team messages and updates" },
    streaks: { label: "Streak Milestones", desc: "Consistency achievements" },
  };

  const updateMutation = useMutation({
    mutationFn: ({ athleteUserId, key, val }: { athleteUserId: string; key: string; val: boolean }) =>
      fetch("/api/org/guardian/preferences", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ athleteUserId, preferences: { [key]: val } }),
      }).then((r) => r.json()),
    onSuccess: () => toast({ title: "Preferences saved" }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1 -ml-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Settings className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-bold flex-1">Notification Preferences</h1>
      </div>

      <div className="px-4 py-5 max-w-lg mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">Choose what updates you'd like to receive for each athlete.</p>

        {athletes.map((a: any) => {
          const perms = (a.link?.permissions as Record<string, boolean>) ?? {};
          return (
            <div key={a.athleteUserId}>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary">{athleteInitials(a.athleteName ?? "A")}</span>
                </div>
                <p className="text-sm font-bold">{a.athleteName}</p>
              </div>
              <Card className="divide-y divide-border/30 rounded-2xl overflow-hidden">
                {Object.entries(PREF_LABELS).map(([key, { label, desc }]) => (
                  <div key={key} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <p className="text-xs font-medium">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                      checked={perms[key] !== false}
                      onCheckedChange={(val) =>
                        updateMutation.mutate({ athleteUserId: a.athleteUserId, key, val })
                      }
                      data-testid={`switch-pref-${a.athleteUserId}-${key}`}
                      disabled={updateMutation.isPending}
                    />
                  </div>
                ))}
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Notifications View ───────────────────────────────────────────────────────

function NotificationsView({
  headers,
  onBack,
}: {
  headers: Record<string, string>;
  onBack: () => void;
}) {
  const { data, refetch } = useQuery<any>({
    queryKey: ["/api/org/guardian/notifications"],
    queryFn: () => fetch("/api/org/guardian/notifications", { headers }).then((r) => r.json()),
  });
  const notifications: any[] = data?.notifications ?? [];

  const markReadMut = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/org/guardian/notifications/${id}/read`, { method: "PATCH", headers }).then((r) => r.json()),
    onSuccess: () => refetch(),
  });

  const markAllMut = useMutation({
    mutationFn: () =>
      fetch("/api/org/guardian/notifications/read-all", { method: "PATCH", headers }).then((r) => r.json()),
    onSuccess: () => refetch(),
  });

  const hasUnread = notifications.some((n: any) => !n.isRead);

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1 -ml-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Bell className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-bold flex-1">Notifications</h1>
        {hasUnread && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markAllMut.mutate()}>
            Mark all read
          </Button>
        )}
      </div>

      <div className="px-4 py-4 space-y-2 max-w-lg mx-auto">
        {notifications.map((n: any) => (
          <button
            key={n.id}
            className="w-full text-left"
            onClick={() => !n.isRead && markReadMut.mutate(n.id)}
            data-testid={`notif-${n.id}`}
          >
            <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border transition-colors ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border/40 bg-card"}`}>
              <div className="h-9 w-9 rounded-full bg-card border border-border/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <NotifIcon type={n.type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">{formatDate(n.createdAt)}</p>
              </div>
              {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
            </div>
          </button>
        ))}

        {notifications.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Bell className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No notifications yet</p>
            <p className="text-xs mt-1">Updates about your athlete will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrgGuardianPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers: Record<string, string> = {
    "X-Org-Auth-Token": orgToken,
    "Content-Type": "application/json",
  };

  const [view, setView] = useState<View>("home");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  // Dashboard data
  const { data: dashboardData, isLoading } = useQuery<any>({
    queryKey: ["/api/org/guardian/dashboard", slug],
    queryFn: () => fetch("/api/org/guardian/dashboard", { headers }).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const athletes: any[] = dashboardData?.athletes ?? [];
  const unreadCount: number = dashboardData?.unreadCount ?? 0;
  const recentNotifications: any[] = dashboardData?.recentNotifications ?? [];

  // ── Views ──────────────────────────────────────────────────────────────────

  if (view === "athlete" && selectedAthleteId) {
    return (
      <AthleteDetailView
        athleteId={selectedAthleteId}
        slug={slug}
        headers={headers}
        onBack={() => { setSelectedAthleteId(null); setView("home"); }}
      />
    );
  }

  if (view === "notifications") {
    return (
      <NotificationsView
        headers={headers}
        onBack={() => setView("home")}
      />
    );
  }

  if (view === "preferences") {
    return (
      <PreferencesView
        athletes={athletes}
        headers={headers}
        onBack={() => setView("home")}
      />
    );
  }

  // ── HOME ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-10" data-testid="page-guardian-portal">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation(`/org/${slug}/portal`)}
          className="text-muted-foreground hover:text-foreground p-1 -ml-1"
          data-testid="button-back-portal"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="font-bold text-sm flex-1">Guardian Portal</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("preferences")}
            className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-preferences"
          >
            <Settings className="h-4.5 w-4.5 h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setView("notifications")}
            className="relative p-2 rounded-xl hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-notifications"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[9px] font-bold flex items-center justify-center text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 py-5 max-w-lg mx-auto space-y-6">
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Linked Athletes */}
        {!isLoading && athletes.length > 0 && (
          <section data-testid="section-linked-athletes">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Your Athletes</h2>
            </div>
            <div className="space-y-3">
              {athletes.map((a: any) => (
                <AthleteCard
                  key={a.athleteUserId}
                  a={a}
                  onClick={() => { setSelectedAthleteId(a.athleteUserId); setView("athlete"); }}
                />
              ))}
            </div>
          </section>
        )}

        {/* No athletes linked */}
        {!isLoading && athletes.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center" data-testid="section-no-athletes">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-8 w-8 text-primary/50" />
            </div>
            <div>
              <p className="text-sm font-bold">No athletes linked yet</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xs leading-relaxed">
                Ask your coach or athlete to send you a guardian invite. Once accepted, you'll see their progress and schedule here.
              </p>
            </div>
          </div>
        )}

        {/* Recent Notifications preview */}
        {!isLoading && recentNotifications.length > 0 && (
          <section data-testid="section-recent-updates">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent Updates</h2>
              </div>
              {recentNotifications.length > 3 && (
                <button
                  onClick={() => setView("notifications")}
                  className="text-xs text-primary hover:underline"
                >
                  See all
                </button>
              )}
            </div>
            <div className="space-y-2">
              {recentNotifications.slice(0, 3).map((n: any) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 rounded-2xl border ${!n.isRead ? "border-primary/20 bg-primary/5" : "border-border/40 bg-card"}`}
                  data-testid={`notif-preview-${n.id}`}
                >
                  <div className="h-8 w-8 rounded-full bg-card border border-border/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <NotifIcon type={n.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>
                  </div>
                  {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Privacy / Trust Badge */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-border/30 bg-card/40">
          <ShieldCheck className="h-4 w-4 text-primary/60 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-foreground/70">Trusted Support Portal</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              You can see schedules, education progress, and key milestones. Private coaching notes and internal data are kept confidential.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
