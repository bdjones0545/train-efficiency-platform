import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Zap, AlertTriangle, CheckCircle2, Activity, TrendingUp,
  TrendingDown, RefreshCw, Shield, Target, BarChart3, FileText,
  ChevronRight, Star, XCircle, Clock, User, Dumbbell
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useOrgId(): string {
  return (window as any).__orgId ?? "";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "Never";
  return new Date(d).toLocaleDateString();
}

function confidenceBadge(score: number) {
  if (score >= 75) return { label: "High", className: "bg-green-100 text-green-700 border-green-200" };
  if (score >= 40) return { label: "Medium", className: "bg-yellow-100 text-yellow-700 border-yellow-200" };
  return { label: "Low", className: "bg-red-100 text-red-600 border-red-200" };
}

function trustLabel(level: number) {
  const labels = ["Manual Review", "Suggest Only", "Auto Low-Risk", "Autonomous + Monitor"];
  const colors = ["text-gray-500", "text-blue-500", "text-yellow-600", "text-green-600"];
  return { label: labels[level] ?? "Unknown", color: colors[level] ?? "text-gray-500" };
}

function effectivenessColor(score: number) {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-500";
}

function TagList({ items, emptyText = "None recorded" }: { items?: string[]; emptyText?: string }) {
  if (!items?.length) return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <Badge key={i} variant="outline" className="text-xs">{item}</Badge>
      ))}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MemoryTab({ profile }: { profile: any }) {
  if (!profile) return (
    <div className="p-6 text-center text-muted-foreground text-sm">
      No memory profile yet. Run "Synthesize Intelligence" to generate one.
    </div>
  );

  const sections = [
    {
      title: "Training Identity",
      icon: <User className="h-4 w-4 text-blue-500" />,
      fields: [
        { label: "Primary Sport", value: profile.primarySport },
        { label: "Position", value: profile.position },
        { label: "Competition Level", value: profile.competitionLevel },
        { label: "Training Age", value: profile.trainingAgeYears ? `${profile.trainingAgeYears} years` : null },
      ],
    },
    {
      title: "Athlete Preferences",
      icon: <Star className="h-4 w-4 text-yellow-500" />,
      tags: [
        { label: "Preferred Exercises", items: profile.preferredExercises },
        { label: "Disliked Exercises", items: profile.dislikedExercises },
        { label: "Preferred Training Days", items: profile.preferredTrainingDays },
      ],
    },
    {
      title: "Movement Intelligence",
      icon: <Activity className="h-4 w-4 text-purple-500" />,
      tags: [
        { label: "Movement Restrictions", items: profile.movementRestrictions },
        { label: "Recurring Compensations", items: profile.recurringCompensations },
        { label: "Technical Focus Areas", items: profile.technicalFocusAreas },
        { label: "Coaching Cues That Work", items: profile.coachingCuesThatWork },
      ],
    },
    {
      title: "Readiness Intelligence",
      icon: <TrendingUp className="h-4 w-4 text-green-500" />,
      text: [
        { label: "Fatigue Patterns", value: profile.fatiguePatterns },
        { label: "Recovery Patterns", value: profile.recoveryPatterns },
        { label: "Stress Patterns", value: profile.stressPatterns },
      ],
    },
    {
      title: "Adaptation Intelligence",
      icon: <Zap className="h-4 w-4 text-orange-500" />,
      tags: [
        { label: "Exercises That Progress Well", items: profile.exercisesThatProgressWell },
        { label: "Exercises That Stall", items: profile.exercisesThatStall },
        { label: "High Response Stimuli", items: profile.highResponseStimuli },
        { label: "Low Response Stimuli", items: profile.lowResponseStimuli },
      ],
    },
    {
      title: "Injury Intelligence",
      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
      tags: [
        { label: "Recurring Pain Areas", items: profile.recurringPainAreas },
        { label: "Movement Red Flags", items: profile.movementRedFlags },
      ],
    },
    {
      title: "Coach Intelligence",
      icon: <FileText className="h-4 w-4 text-indigo-500" />,
      text: [
        { label: "Coach Notes Summary", value: profile.coachNotesSummary },
        { label: "Coaching History", value: profile.coachingHistorySummary },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {sections.map(section => (
        <Card key={section.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {section.icon}
              {section.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.fields?.map(f => f.value && (
              <div key={f.label} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <span className="text-xs font-medium">{f.value}</span>
              </div>
            ))}
            {section.tags?.map(t => (
              <div key={t.label}>
                <div className="text-xs text-muted-foreground mb-1">{t.label}</div>
                <TagList items={t.items} />
              </div>
            ))}
            {section.text?.map(t => t.value && (
              <div key={t.label}>
                <div className="text-xs text-muted-foreground mb-1">{t.label}</div>
                <p className="text-xs leading-relaxed">{t.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EffectivenessTab({ athleteUserId }: { athleteUserId: string }) {
  const orgId = useOrgId();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/athlete-intelligence/effectiveness", athleteUserId],
    queryFn: () => fetch(`/api/admin/athlete-intelligence/effectiveness/${athleteUserId}`).then(r => r.json()),
    enabled: !!athleteUserId,
  });

  const scores: any[] = data?.scores ?? [];
  const top5 = scores.slice(0, 5);
  const bottom5 = [...scores].sort((a, b) => a.effectivenessScore - b.effectivenessScore).slice(0, 5);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Top Performing Exercises
            </CardTitle>
          </CardHeader>
          <CardContent>
            {top5.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet — synthesize intelligence to populate.</p>
            ) : (
              <div className="space-y-2">
                {top5.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3" data-testid={`effectiveness-top-${s.exerciseName}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{s.exerciseName}</div>
                      <Progress value={s.effectivenessScore} className="h-1.5 mt-1" />
                    </div>
                    <span className={`text-sm font-bold ${effectivenessColor(s.effectivenessScore)}`}>{s.effectivenessScore}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Lowest Performing Exercises
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bottom5.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            ) : (
              <div className="space-y-2">
                {bottom5.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3" data-testid={`effectiveness-bottom-${s.exerciseName}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{s.exerciseName}</div>
                      <Progress value={s.effectivenessScore} className="h-1.5 mt-1" />
                    </div>
                    <span className={`text-sm font-bold ${effectivenessColor(s.effectivenessScore)}`}>{s.effectivenessScore}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full table */}
      {scores.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">All Exercise Effectiveness Scores</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-64">
              <table className="w-full text-xs">
                <thead className="border-b">
                  <tr className="text-muted-foreground">
                    <th className="text-left px-4 py-2">Exercise</th>
                    <th className="text-center px-2 py-2">Score</th>
                    <th className="text-center px-2 py-2">Used</th>
                    <th className="text-center px-2 py-2">Completion</th>
                    <th className="text-center px-2 py-2">Progression</th>
                    <th className="text-center px-2 py-2">Pain</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((s: any) => (
                    <tr key={s.id} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{s.exerciseName}</td>
                      <td className={`px-2 py-2 text-center font-bold ${effectivenessColor(s.effectivenessScore)}`}>{s.effectivenessScore}</td>
                      <td className="px-2 py-2 text-center text-muted-foreground">{s.timesUsed}</td>
                      <td className="px-2 py-2 text-center">{s.completionRate}%</td>
                      <td className="px-2 py-2 text-center">{s.progressionRate}%</td>
                      <td className={`px-2 py-2 text-center ${s.painRate > 20 ? "text-red-500" : "text-muted-foreground"}`}>{s.painRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RiskTab({ profile, athleteUserId }: { profile: any; athleteUserId: string }) {
  const memConf = profile?.memoryConfidence ?? 0;
  const conf = confidenceBadge(memConf);

  const painAreas = profile?.recurringPainAreas ?? [];
  const redFlags = profile?.movementRedFlags ?? [];
  const trustLevel = profile?.trustLevel ?? 0;

  // Compute risks
  const risks = [
    {
      label: "Injury Risk",
      level: painAreas.length >= 3 ? "High" : painAreas.length >= 1 ? "Medium" : "Low",
      color: painAreas.length >= 3 ? "text-red-600" : painAreas.length >= 1 ? "text-yellow-600" : "text-green-600",
      details: painAreas.length > 0 ? `${painAreas.length} recurring pain area(s): ${painAreas.slice(0, 3).join(", ")}` : "No pain areas identified",
    },
    {
      label: "Compliance Risk",
      level: (profile?.sessionsAnalyzed ?? 0) > 0 ? "Present" : "Unknown",
      color: "text-blue-600",
      details: `${profile?.sessionsAnalyzed ?? 0} sessions analyzed`,
    },
    {
      label: "Movement Red Flags",
      level: redFlags.length >= 2 ? "High" : redFlags.length === 1 ? "Medium" : "None",
      color: redFlags.length >= 2 ? "text-red-600" : redFlags.length === 1 ? "text-yellow-600" : "text-green-600",
      details: redFlags.length > 0 ? redFlags.slice(0, 3).join(", ") : "No red flags identified",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {risks.map(r => (
          <Card key={r.label}>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground mb-1">{r.label}</div>
              <div className={`font-bold text-lg ${r.color}`}>{r.level}</div>
              <div className="text-xs text-muted-foreground mt-1">{r.details}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-indigo-500" />
            Intelligence Quality
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Memory Confidence</span>
                <Badge variant="outline" className={`text-xs ${conf.className}`}>{conf.label}</Badge>
              </div>
              <Progress value={memConf} className="h-2" />
            </div>
            <span className="text-xl font-bold text-indigo-600">{memConf}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Last synthesized: {fmtDate(profile?.lastSynthesizedAt)} •
            Sessions analyzed: {profile?.sessionsAnalyzed ?? 0}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AutonomyTab({ profile, athleteUserId, onUpdate }: { profile: any; athleteUserId: string; onUpdate: () => void }) {
  const { toast } = useToast();
  const [selectedLevel, setSelectedLevel] = useState<string>(String(profile?.trustLevel ?? 0));

  const trustMutation = useMutation({
    mutationFn: (level: number) =>
      apiRequest("PUT", `/api/admin/athlete-intelligence/trust-level/${athleteUserId}`, {
        trustLevel: level,
        reason: `Coach manually set to Level ${level}`,
      }),
    onSuccess: () => {
      toast({ title: "Trust level updated" });
      onUpdate();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const levels = [
    { value: 0, label: "Level 0 — Manual Review", desc: "Every adaptation requires coach approval before implementation.", safe: true },
    { value: 1, label: "Level 1 — Suggest Only", desc: "System suggests adaptations; coach approves all changes.", safe: true },
    { value: 2, label: "Level 2 — Auto Low-Risk", desc: "System auto-adjusts low-risk variables (volume, intensity ranges). High-risk changes still require approval.", safe: false },
    { value: 3, label: "Level 3 — Autonomous + Monitor", desc: "System makes micro-adjustments autonomously. Coach receives daily summary. Never allows injury diagnosis, medical recommendations, or major program rewrites.", safe: false },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-orange-700 dark:text-orange-400">
              <strong>Autonomy Boundaries:</strong> The system will NEVER autonomously diagnose injuries, make medical recommendations, perform major program rewrites, or take any action outside its defined trust level without coach approval.
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {levels.map(level => {
          const isCurrent = (profile?.trustLevel ?? 0) === level.value;
          return (
            <Card key={level.value} className={isCurrent ? "border-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/20" : ""}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{level.label}</span>
                      {level.safe && <Badge variant="secondary" className="text-xs">Recommended</Badge>}
                      {isCurrent && <Badge className="text-xs bg-indigo-500">Current</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{level.desc}</p>
                  </div>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      variant={level.value > (profile?.trustLevel ?? 0) ? "default" : "outline"}
                      onClick={() => trustMutation.mutate(level.value)}
                      disabled={trustMutation.isPending}
                      data-testid={`button-set-trust-level-${level.value}`}
                    >
                      Set
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {profile?.trustLevelReason && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Last reason</div>
            <div className="text-xs">{profile.trustLevelReason}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminAthleteIntelligencePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const orgId = useOrgId();

  const [selectedAthleteId, setSelectedAthleteId] = useState<string>("");

  // Fetch all athletes
  const { data: athletesData, isLoading: athletesLoading } = useQuery<any>({
    queryKey: ["/api/admin/athlete-intelligence/athletes", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  // Fetch selected athlete profile
  const { data: profileData, refetch: refetchProfile } = useQuery<any>({
    queryKey: ["/api/admin/athlete-intelligence/profile", selectedAthleteId],
    queryFn: () => fetch(`/api/admin/athlete-intelligence/profile/${selectedAthleteId}`).then(r => r.json()),
    enabled: !!selectedAthleteId,
  });

  const athletes: any[] = athletesData?.athletes ?? [];
  const profile = profileData?.profile ?? null;

  // Auto-select first athlete
  if (!selectedAthleteId && athletes.length > 0) {
    setSelectedAthleteId(athletes[0].athleteUserId);
  }

  const selectedAthlete = athletes.find(a => a.athleteUserId === selectedAthleteId);

  const synthesizeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/athlete-intelligence/synthesize/${id}`),
    onSuccess: (data: any) => {
      toast({
        title: "Intelligence synthesized",
        description: `${data?.result?.patternsFound?.length ?? 0} pattern(s) found. Confidence: ${data?.result?.memoryConfidence ?? 0}%`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-intelligence/profile", selectedAthleteId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-intelligence/athletes", orgId] });
    },
    onError: (e: any) => toast({ title: "Synthesis failed", description: e.message, variant: "destructive" }),
  });

  const analyzeNotesMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/athlete-intelligence/analyze-notes/${id}`),
    onSuccess: (data: any) => {
      if (!data?.success) {
        toast({ title: "No coach notes", description: data?.message ?? "No notes to analyze" });
        return;
      }
      toast({ title: "Coach notes analyzed", description: data?.intelligence?.summary });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-intelligence/profile", selectedAthleteId] });
    },
    onError: (e: any) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  const synthesizeOrgMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/athlete-intelligence/synthesize-org`),
    onSuccess: (data: any) => {
      toast({ title: "Org synthesis complete", description: `${data?.athletes ?? 0} athletes synthesized` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/athlete-intelligence/athletes", orgId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex h-full min-h-screen">
      {/* Left Panel — Athlete List */}
      <div className="w-72 border-r flex flex-col">
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-500" />
            Athlete Intelligence
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Persistent memory for every athlete</p>
        </div>

        <div className="p-3 border-b">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => synthesizeOrgMutation.mutate()}
            disabled={synthesizeOrgMutation.isPending}
            data-testid="button-synthesize-all"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            {synthesizeOrgMutation.isPending ? "Synthesizing…" : "Synthesize All"}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {athletesLoading ? (
            <div className="p-4 text-xs text-muted-foreground">Loading athletes…</div>
          ) : athletes.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              No athlete intelligence profiles yet.<br />
              Run "Synthesize All" to generate.
            </div>
          ) : (
            <div>
              {athletes.map(a => {
                const conf = confidenceBadge(a.memoryConfidence ?? 0);
                const isSelected = a.athleteUserId === selectedAthleteId;
                return (
                  <button
                    key={a.athleteUserId}
                    onClick={() => setSelectedAthleteId(a.athleteUserId)}
                    className={`w-full text-left p-3 border-b hover:bg-muted/30 transition-colors ${isSelected ? "bg-indigo-50 dark:bg-indigo-950/30 border-l-2 border-l-indigo-500" : ""}`}
                    data-testid={`athlete-item-${a.athleteUserId}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{a.primarySport ?? a.athleteUserId.slice(0, 8)}</span>
                      <Badge variant="outline" className={`text-[10px] ${conf.className}`}>{conf.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">{a.sessionsAnalyzed ?? 0} sessions</span>
                      {a.activeRiskFlags > 0 && (
                        <span className="text-xs text-red-500 flex items-center gap-0.5">
                          <AlertTriangle className="h-3 w-3" /> {a.activeRiskFlags}
                        </span>
                      )}
                      {a.trustLevel > 0 && (
                        <span className="text-xs text-indigo-500">
                          <Shield className="h-3 w-3 inline" /> L{a.trustLevel}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Conf: {a.memoryConfidence ?? 0}% • Updated {fmtDate(a.updatedAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Panel — Athlete Detail */}
      <div className="flex-1 overflow-auto">
        {!selectedAthleteId ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select an athlete to view their intelligence profile.
          </div>
        ) : (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <User className="h-5 w-5 text-indigo-500" />
                  {profile?.primarySport ?? selectedAthleteId.slice(0, 16)}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  {profile && (
                    <>
                      <Badge variant="outline" className={`text-xs ${confidenceBadge(profile.memoryConfidence ?? 0).className}`}>
                        Confidence: {profile.memoryConfidence ?? 0}%
                      </Badge>
                      <Badge variant="outline" className={`text-xs ${trustLabel(profile.trustLevel ?? 0).color}`}>
                        {trustLabel(profile.trustLevel ?? 0).label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {profile.sessionsAnalyzed ?? 0} sessions analyzed
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => analyzeNotesMutation.mutate(selectedAthleteId)}
                  disabled={analyzeNotesMutation.isPending}
                  data-testid="button-analyze-notes"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  {analyzeNotesMutation.isPending ? "Analyzing…" : "Analyze Notes"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => synthesizeMutation.mutate(selectedAthleteId)}
                  disabled={synthesizeMutation.isPending}
                  data-testid="button-synthesize-athlete"
                >
                  <Brain className="h-4 w-4 mr-1" />
                  {synthesizeMutation.isPending ? "Synthesizing…" : "Synthesize Intelligence"}
                </Button>
              </div>
            </div>

            <Tabs defaultValue="memory">
              <TabsList className="mb-4">
                <TabsTrigger value="memory" data-testid="tab-memory">Memory</TabsTrigger>
                <TabsTrigger value="effectiveness" data-testid="tab-effectiveness">Exercise Effectiveness</TabsTrigger>
                <TabsTrigger value="risk" data-testid="tab-risk">Risk & Quality</TabsTrigger>
                <TabsTrigger value="autonomy" data-testid="tab-autonomy">Autonomy</TabsTrigger>
              </TabsList>

              <TabsContent value="memory">
                <MemoryTab profile={profile} />
              </TabsContent>
              <TabsContent value="effectiveness">
                <EffectivenessTab athleteUserId={selectedAthleteId} />
              </TabsContent>
              <TabsContent value="risk">
                <RiskTab profile={profile} athleteUserId={selectedAthleteId} />
              </TabsContent>
              <TabsContent value="autonomy">
                <AutonomyTab
                  profile={profile}
                  athleteUserId={selectedAthleteId}
                  onUpdate={() => refetchProfile()}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
