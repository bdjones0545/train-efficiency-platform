import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trophy, ClipboardList, Users, Loader2, LogOut, RefreshCw, TrendingUp } from "lucide-react";

interface BootstrapData {
  user: any;
  membership: any;
  liftTypes: any[];
  teams: any[];
  entries: any[];
  myTeamIds: string[];
}

interface AthletePrDashboardProps {
  bootstrap: BootstrapData;
  orgId: string;
  programId: string;
  programName: string;
  token: string;
  onRefresh: () => void;
  onLogout: () => void;
}

function prFetch(method: string, path: string, token: string, body?: any) {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Org-Auth-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function getBestByLift(entries: any[]): Record<string, any> {
  const bests: Record<string, any> = {};
  for (const e of entries) {
    const key = e.liftTypeId;
    const current = bests[key];
    const isLower = ["seconds"].includes(e.unit);
    if (!current) {
      bests[key] = e;
    } else if (isLower ? e.value < current.value : e.value > current.value) {
      bests[key] = e;
    }
  }
  return bests;
}

export function AthletePrDashboard({
  bootstrap,
  orgId,
  programId,
  programName,
  token,
  onRefresh,
  onLogout,
}: AthletePrDashboardProps) {
  const { toast } = useToast();
  const { liftTypes, teams, entries, myTeamIds } = bootstrap;

  // Add PR dialog
  const [showAddPr, setShowAddPr] = useState(false);
  const [prLiftTypeId, setPrLiftTypeId] = useState("");
  const [prValue, setPrValue] = useState("");
  const [prDate, setPrDate] = useState(new Date().toISOString().split("T")[0]);
  const [prNotes, setPrNotes] = useState("");
  const [addingPr, setAddingPr] = useState(false);

  // Join team dialog
  const [showJoinTeam, setShowJoinTeam] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joiningTeam, setJoiningTeam] = useState(false);

  async function addPrEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!prLiftTypeId || !prValue) return;
    setAddingPr(true);
    try {
      const r = await prFetch("POST", "/api/pr-tracker/entries", token, {
        orgId,
        programId,
        liftTypeId: prLiftTypeId,
        value: parseFloat(prValue),
        entryDate: prDate,
        notes: prNotes || undefined,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      toast({ title: `PR logged: ${data.liftTypeName} — ${data.value} ${data.unit}` });
      setShowAddPr(false);
      setPrLiftTypeId(""); setPrValue(""); setPrNotes("");
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to log PR", description: err.message, variant: "destructive" });
    } finally {
      setAddingPr(false);
    }
  }

  async function joinTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoiningTeam(true);
    try {
      const r = await prFetch("POST", "/api/pr-tracker/teams/join", token, { orgId, programId, joinCode });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      toast({ title: `Joined team: ${data.team.name}` });
      setShowJoinTeam(false);
      setJoinCode("");
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to join team", description: err.message, variant: "destructive" });
    } finally {
      setJoiningTeam(false);
    }
  }

  const bests = getBestByLift(entries);
  const myTeams = teams.filter((t) => myTeamIds.includes(t.id));
  const recentEntries = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15);

  const selectedLiftType = liftTypes.find((lt) => lt.id === prLiftTypeId);

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold">My PR Record</h1>
          </div>
          <p className="text-xs text-muted-foreground">{programName} · {bootstrap.user.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onRefresh} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onLogout} data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowAddPr(true)} className="flex-1" data-testid="button-add-pr">
          <Plus className="h-4 w-4 mr-1" /> Log PR
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowJoinTeam(true)} data-testid="button-join-team">
          <Users className="h-4 w-4 mr-1" /> Join Team
        </Button>
      </div>

      {/* My Teams */}
      {myTeams.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-muted-foreground" /> My Teams
          </h2>
          <div className="flex flex-wrap gap-2">
            {myTeams.map((t) => (
              <Badge key={t.id} variant="secondary" className="text-xs py-1 px-2" data-testid={`badge-team-${t.id}`}>
                {t.name}{t.sport ? ` · ${t.sport}` : ""}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Current Bests */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" /> Current Bests
        </h2>
        {Object.keys(bests).length === 0 ? (
          <Card className="p-6 text-center space-y-2">
            <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">No PRs logged yet</p>
            <p className="text-xs text-muted-foreground">Tap "Log PR" to record your first personal record.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(bests).map(([liftTypeId, entry]: [string, any]) => {
              const lt = liftTypes.find((l) => l.id === liftTypeId);
              return (
                <Card key={liftTypeId} className="p-3 space-y-0.5" data-testid={`card-pr-${liftTypeId}`}>
                  <p className="text-xs text-muted-foreground">{lt?.name ?? "Unknown"}</p>
                  <p className="text-xl font-bold leading-none">{entry.value}</p>
                  <p className="text-xs text-muted-foreground">{entry.unit}</p>
                  <p className="text-xs text-muted-foreground/60">{entry.entryDate}</p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* PR History */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" /> PR History
        </h2>
        {recentEntries.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">No history yet.</Card>
        ) : (
          <div className="space-y-2">
            {recentEntries.map((e) => (
              <Card key={e.id} className="p-3 flex items-center justify-between" data-testid={`card-history-${e.id}`}>
                <div>
                  <p className="text-sm font-semibold">{e.liftTypeName}</p>
                  <p className="text-xs text-muted-foreground">{e.entryDate}{e.notes ? ` · ${e.notes}` : ""}</p>
                </div>
                <p className="text-sm font-bold">
                  {e.value} <span className="text-xs font-normal text-muted-foreground">{e.unit}</span>
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Add PR Dialog */}
      <Dialog open={showAddPr} onOpenChange={setShowAddPr}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Log a PR</DialogTitle></DialogHeader>
          <form onSubmit={addPrEntry} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Exercise *</Label>
              <Select value={prLiftTypeId} onValueChange={setPrLiftTypeId} required>
                <SelectTrigger data-testid="select-lift-type">
                  <SelectValue placeholder="Choose exercise" />
                </SelectTrigger>
                <SelectContent>
                  {liftTypes.map((lt) => (
                    <SelectItem key={lt.id} value={lt.id}>
                      {lt.name} ({lt.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Value ({selectedLiftType?.unit ?? "unit"}) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0"
                  value={prValue}
                  onChange={(e) => setPrValue(e.target.value)}
                  data-testid="input-pr-value"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date *</Label>
                <Input
                  type="date"
                  value={prDate}
                  onChange={(e) => setPrDate(e.target.value)}
                  data-testid="input-pr-date"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="e.g., Competition max, felt strong"
                value={prNotes}
                onChange={(e) => setPrNotes(e.target.value)}
                rows={2}
                data-testid="input-pr-notes"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addingPr || !prLiftTypeId || !prValue} className="flex-1" data-testid="button-add-pr-submit">
                {addingPr ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log PR"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowAddPr(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Join Team Dialog */}
      <Dialog open={showJoinTeam} onOpenChange={setShowJoinTeam}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Join a Team</DialogTitle></DialogHeader>
          <form onSubmit={joinTeam} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Join Code</Label>
              <Input
                placeholder="e.g., A1B2C3"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="font-mono tracking-widest text-center text-lg uppercase"
                data-testid="input-join-code"
                required
              />
              <p className="text-xs text-muted-foreground">Get the join code from your coach.</p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={joiningTeam || !joinCode.trim()} className="flex-1" data-testid="button-join-team-submit">
                {joiningTeam ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join Team"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowJoinTeam(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
