import { useState, useEffect } from "react";
import { useParams, Redirect, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import PrTrackerPage from "@/pages/pr-tracker";
import WorkoutBuilderPage from "@/pages/workout-builder";

export default function ProgramToolPage() {
  const params = useParams<{ slug: string; programSlug: string }>();
  const orgSlug = params.slug;
  const programSlug = params.programSlug;
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const contextAthleteId = searchParams.get("athleteId") ?? undefined;
  const contextTeamId = searchParams.get("teamId") ?? undefined;

  const { user, isLoading: authLoading } = useAuth();

  const { data: program, isLoading: programLoading } = useQuery<any>({
    queryKey: ["/api/athletic/programs/by-org-slug", orgSlug, programSlug],
    queryFn: () =>
      fetch(`/api/athletic/programs/by-org-slug/${orgSlug}/${programSlug}`).then(
        (r) => r.json()
      ),
    enabled: !!orgSlug && !!programSlug,
  });

  const orgId: string | undefined = program?.organizationId;

  const [orgToken, setOrgToken] = useState<string | null>(null);

  useEffect(() => {
    if (orgId) {
      const stored = localStorage.getItem(`orgToken_${orgId}`);
      if (stored) setOrgToken(stored);
    }
  }, [orgId]);

  function handleOrgAuthenticated(token: string, _user: any, _membership: any) {
    if (orgId) {
      localStorage.setItem(`orgToken_${orgId}`, token);
      setOrgToken(token);
    }
  }

  const isLoading = authLoading || programLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!program || program.message) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Program not found.
      </div>
    );
  }

  const isMainAuthed = !!user;
  const isOrgAuthed = !!orgToken;

  if (!isMainAuthed && !isOrgAuthed) {
    return (
      <OrgAuthModal
        orgId={program.organizationId}
        programId={program.id}
        programName={program.name}
        onAuthenticated={handleOrgAuthenticated}
        onClose={() => setLocation(`/org/${orgSlug}`)}
      />
    );
  }

  if (program.type === "scheduling" || !program.type) {
    return <Redirect to={`/org/${orgSlug}/athletic/${programSlug}`} />;
  }

  if (program.type === "pr_tracker") {
    return <PrTrackerPage program={program} orgSlug={orgSlug} />;
  }

  if (program.type === "workout_builder") {
    return (
      <div className="p-4 sm:p-6">
        <WorkoutBuilderPage
          program={program}
          orgSlug={orgSlug}
          contextAthleteId={contextAthleteId}
          contextTeamId={contextTeamId}
        />
      </div>
    );
  }

  return (
    <div className="p-8 text-center text-muted-foreground">
      Unknown program type.
    </div>
  );
}
