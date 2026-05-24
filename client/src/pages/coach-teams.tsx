import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, Trophy, ChevronRight, Plus, Code, Calendar } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import { format } from "date-fns";

function CoachTeamsSkeleton() {
  return (
    <div className="space-y-4 pt-6 px-4 max-w-2xl mx-auto">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 px-6">
      <div className="inline-flex h-16 w-16 rounded-full bg-muted items-center justify-center mb-4">
        <Users className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">No teams yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        Create a team from the PR Tracker dashboard and athletes will be able to join with a code.
      </p>
    </div>
  );
}

export default function CoachTeamsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const { toast } = useToast();

  const { data: org, isLoading: orgLoading } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;

  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const { hasAccess, isHydrating } = usePermissions(slug);

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setOrgToken(token))
      .catch(() => {
        localStorage.removeItem(`orgToken_${orgId}`);
      });
  }, [orgId]);

  const { data: teamsData, isLoading: teamsLoading } = useQuery<any>({
    queryKey: ["/api/org/coach/teams", orgId, orgToken, hasAccess],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch("/api/org/coach/teams", { headers, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!orgId && (!!orgToken || hasAccess),
  });

  function handleAuthenticated(token: string) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setShowAuth(false);
  }

  if (orgLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (!orgToken && !hasAccess && !isHydrating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center space-y-6">
        {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-14 w-auto rounded-xl" />}
        <div>
          <h1 className="text-2xl font-bold">{org?.name}</h1>
          <p className="text-muted-foreground mt-1">Coach login required to manage teams</p>
        </div>
        <Button size="lg" onClick={() => setShowAuth(true)}>Log In</Button>
        {showAuth && (
          <OrgAuthModal
            orgId={orgId || ""}
            programName={org?.name || ""}
            onAuthenticated={handleAuthenticated}
            onClose={() => setShowAuth(false)}
          />
        )}
      </div>
    );
  }

  const teams: any[] = teamsData?.teams || [];

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <a href={`/org/${slug}/portal`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" /> Portal
              </Button>
            </a>
          </div>
          <span className="font-semibold text-sm">My Teams</span>
          <div className="w-16" />
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Coach Dashboard</h1>
            <p className="text-sm text-muted-foreground">{teams.length} team{teams.length !== 1 ? "s" : ""} you manage</p>
          </div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-400" />
          </div>
        </div>

        {teamsLoading ? (
          <CoachTeamsSkeleton />
        ) : teams.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {teams.map((team: any) => (
              <a key={team.id} href={`/org/${slug}/coach/teams/${team.id}`} data-testid={`link-team-${team.id}`}>
                <Card className="p-4 hover:border-primary/40 transition-colors cursor-pointer group">
                  <div className="flex items-start gap-4">
                    {/* Team icon */}
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                      <Users className="h-6 w-6 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-base" data-testid={`text-team-name-${team.id}`}>{team.name}</h3>
                        {team.sport && (
                          <Badge variant="outline" className="text-xs">{team.sport}</Badge>
                        )}
                        {team.season && (
                          <Badge variant="secondary" className="text-xs">{team.season}</Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {team.memberCount} athlete{team.memberCount !== 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {team.createdAt ? format(new Date(team.createdAt), "MMM yyyy") : "—"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">Join code:</span>
                        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded font-bold tracking-widest" data-testid={`text-join-code-${team.id}`}>
                          {team.joinCode}
                        </code>
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1 group-hover:text-primary transition-colors" />
                  </div>
                </Card>
              </a>
            ))}
          </div>
        )}

        {/* Info card */}
        <Card className="p-4 border-dashed opacity-70">
          <div className="flex items-start gap-3">
            <Code className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Creating teams</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Create and manage teams from the PR Tracker dashboard. Athletes join using the team's join code.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
