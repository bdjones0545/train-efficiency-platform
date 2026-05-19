import { useState, useCallback } from "react";
import { getAuthHeaders } from "@/lib/authToken";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Users,
  User,
  Upload,
  Copy,
  Loader2,
  BarChart2,
  Trophy,
  ClipboardList,
  RefreshCw,
  LogOut,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
} from "lucide-react";

interface BootstrapData {
  user: any;
  membership: any;
  liftTypes: any[];
  teams: any[];
  entries: any[];
  athleteCount: number;
}

interface CoachPrDashboardProps {
  bootstrap: BootstrapData;
  orgId: string;
  orgSlug: string;
  programId: string;
  programSlug: string;
  programName: string;
  token: string;
  onRefresh: () => void;
  onLogout: () => void;
}

function prFetch(method: string, path: string, token: string, body?: any) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (token) headers["X-Org-Auth-Token"] = token;
  return fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function CoachPrDashboard({
  bootstrap,
  orgId,
  orgSlug,
  programId,
  programSlug,
  programName,
  token,
  onRefresh,
  onLogout,
}: CoachPrDashboardProps) {
  const { toast } = useToast();
  const { liftTypes, teams, entries, athleteCount } = bootstrap;

  // Create team dialog
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamSport, setTeamSport] = useState("");
  const [teamSeason, setTeamSeason] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  // CSV import dialog
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvResult, setCsvResult] = useState<any>(null);
  const [importingCsv, setImportingCsv] = useState(false);

  // Athletes view
  const [athletes, setAthletes] = useState<any[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(false);
  const [showAthletes, setShowAthletes] = useState(false);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    setCreatingTeam(true);
    try {
      const r = await prFetch("POST", "/api/pr-tracker/teams", token, { orgId, programId, name: teamName, sport: teamSport, season: teamSeason });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      toast({ title: `Team "${data.name}" created! Join code: ${data.joinCode}` });
      setShowCreateTeam(false);
      setTeamName(""); setTeamSport(""); setTeamSeason("");
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to create team", description: err.message, variant: "destructive" });
    } finally {
      setCreatingTeam(false);
    }
  }

  async function importCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;
    setImportingCsv(true);
    setCsvResult(null);
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("orgId", orgId);
      formData.append("programId", programId);
      const csvHeaders: Record<string, string> = { ...getAuthHeaders() };
      if (token) csvHeaders["X-Org-Auth-Token"] = token;
      const r = await fetch("/api/pr-tracker/import-csv", {
        method: "POST",
        headers: csvHeaders,
        credentials: "include",
        body: formData,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setCsvResult(data);
      toast({ title: `Import done: ${data.successCount} rows processed` });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingCsv(false);
    }
  }

  async function loadAthletes() {
    setLoadingAthletes(true);
    try {
      const r = await prFetch("GET", `/api/pr-tracker/athletes?orgId=${orgId}&programId=${programId}`, token);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setAthletes(data);
      setShowAthletes(true);
    } catch (err: any) {
      toast({ title: "Failed to load athletes", description: err.message, variant: "destructive" });
    } finally {
      setLoadingAthletes(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => toast({ title: "Join code copied!" }));
  }

  const recentEntries = entries.slice(0, 10);

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold">Coach Dashboard</h1>
          </div>
          <p className="text-xs text-muted-foreground">{programName}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/org/${orgSlug}/programs/${programSlug}`} data-testid="link-dashboard">
            <Button size="sm" variant="ghost" title="PR Tracker Dashboard">
              <LayoutDashboard className="h-4 w-4" />
            </Button>
          </a>
          <a href={`/org/${orgSlug}/coach/teams`} data-testid="link-teams">
            <Button size="sm" variant="ghost" title="Teams">
              <Users className="h-4 w-4" />
            </Button>
          </a>
          <a href={`/org/${orgSlug}/coach/teams`} data-testid="link-athletes">
            <Button size="sm" variant="ghost" title="Athletes">
              <User className="h-4 w-4" />
            </Button>
          </a>
          <Button size="sm" variant="ghost" onClick={onRefresh} title="Refresh" data-testid="button-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onLogout} title="Exit to Portal" data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Athletes", value: athleteCount, icon: <Users className="h-4 w-4" /> },
          { label: "Teams", value: teams.length, icon: <Trophy className="h-4 w-4" /> },
          { label: "PR Entries", value: entries.length, icon: <ClipboardList className="h-4 w-4" /> },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center space-y-1">
            <div className="flex justify-center text-muted-foreground">{s.icon}</div>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => setShowCreateTeam(true)} data-testid="button-create-team">
          <Plus className="h-4 w-4 mr-1" /> Create Team
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowCsvImport(true)} data-testid="button-csv-import">
          <Upload className="h-4 w-4 mr-1" /> Import CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={showAthletes ? () => setShowAthletes(false) : loadAthletes}
          data-testid="button-view-athletes"
        >
          {loadingAthletes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4 mr-1" />}
          {showAthletes ? "Hide Athletes" : "View Athletes"}
        </Button>
      </div>

      {/* Teams */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" /> Teams
        </h2>
        {teams.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            No teams yet. Create one to get started.
          </Card>
        ) : (
          <div className="space-y-2">
            {teams.map((team) => (
              <Card key={team.id} className="p-3 flex items-center justify-between" data-testid={`card-team-${team.id}`}>
                <div>
                  <p className="text-sm font-semibold">{team.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {team.sport && <Badge variant="secondary" className="text-xs">{team.sport}</Badge>}
                    {team.season && <span className="text-xs text-muted-foreground">{team.season}</span>}
                    <span className="text-xs text-muted-foreground">{team.memberCount || 0} members</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Join Code</p>
                    <p className="text-sm font-mono font-bold tracking-widest">{team.joinCode}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copyCode(team.joinCode)} data-testid={`button-copy-code-${team.id}`}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Athletes */}
      {showAthletes && (
        <section>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Athletes ({athletes.length})
          </h2>
          {athletes.length === 0 ? (
            <Card className="p-4 text-center text-sm text-muted-foreground">No athletes yet.</Card>
          ) : (
            <div className="space-y-2">
              {athletes.map((a) => (
                <Card key={a.id} className="p-3 flex items-center justify-between" data-testid={`card-athlete-${a.id}`}>
                  <div>
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{a.entryCount}</p>
                    <p className="text-xs text-muted-foreground">PR entries</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recent PRs */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" /> Recent PRs
        </h2>
        {recentEntries.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">No PR entries yet.</Card>
        ) : (
          <div className="space-y-2">
            {recentEntries.map((e) => (
              <Card key={e.id} className="p-3 flex items-center justify-between" data-testid={`card-entry-${e.id}`}>
                <div>
                  <p className="text-sm font-semibold">{e.liftTypeName}</p>
                  <p className="text-xs text-muted-foreground">{e.entryDate}{e.notes ? ` · ${e.notes}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{e.value} <span className="text-xs font-normal text-muted-foreground">{e.unit}</span></p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Create Team Dialog */}
      <Dialog open={showCreateTeam} onOpenChange={setShowCreateTeam}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Create Team</DialogTitle></DialogHeader>
          <form onSubmit={createTeam} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Team Name *</Label>
              <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g., Varsity Football" data-testid="input-team-name" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Sport</Label>
                <Input value={teamSport} onChange={(e) => setTeamSport(e.target.value)} placeholder="e.g., Football" data-testid="input-team-sport" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Season</Label>
                <Input value={teamSeason} onChange={(e) => setTeamSeason(e.target.value)} placeholder="e.g., Fall 2025" data-testid="input-team-season" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={creatingTeam} className="flex-1" data-testid="button-create-team-submit">
                {creatingTeam ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Team"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowCreateTeam(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      <Dialog open={showCsvImport} onOpenChange={setShowCsvImport}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Import Athletes via CSV</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Expected columns:</p>
              <code className="break-all">name, email, team, sport, back_squat, bench_press, deadlift, power_clean, vertical_jump, forty_yard_dash</code>
            </div>
            <form onSubmit={importCsv} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">CSV File</Label>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                  data-testid="input-csv-file"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={importingCsv || !csvFile} className="flex-1" data-testid="button-import-submit">
                  {importingCsv ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setShowCsvImport(false); setCsvResult(null); }}>Cancel</Button>
              </div>
            </form>
            {csvResult && (
              <div className="rounded-md border p-3 space-y-1.5">
                <p className="text-sm font-medium">Import Complete</p>
                <div className="flex gap-3 text-xs">
                  <span className="text-green-600 dark:text-green-400">✓ {csvResult.successCount} rows imported</span>
                  {csvResult.errorCount > 0 && <span className="text-destructive">✗ {csvResult.errorCount} errors</span>}
                </div>
                {csvResult.errors?.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {csvResult.errors.map((err: any, i: number) => (
                      <p key={i} className="text-xs text-destructive">Row {err.row}: {err.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
