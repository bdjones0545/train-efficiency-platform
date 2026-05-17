import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";
import PrTrackerPage from "@/pages/pr-tracker";
import WorkoutBuilderPage from "@/pages/workout-builder";

export default function ProgramToolPage() {
  const params = useParams<{ slug: string; programSlug: string }>();
  const orgSlug = params.slug;
  const programSlug = params.programSlug;

  const { data: program, isLoading } = useQuery<any>({
    queryKey: ["/api/athletic/programs/by-org-slug", orgSlug, programSlug],
    queryFn: () =>
      fetch(`/api/athletic/programs/by-org-slug/${orgSlug}/${programSlug}`).then(
        (r) => r.json()
      ),
    enabled: !!orgSlug && !!programSlug,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
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

  if (program.type === "scheduling" || !program.type) {
    return <Redirect to={`/org/${orgSlug}/athletic/${programSlug}`} />;
  }

  if (program.type === "pr_tracker") {
    return <PrTrackerPage program={program} orgSlug={orgSlug} />;
  }

  if (program.type === "workout_builder") {
    return (
      <div className="p-4 sm:p-6">
        <WorkoutBuilderPage program={program} orgSlug={orgSlug} />
      </div>
    );
  }

  return (
    <div className="p-8 text-center text-muted-foreground">
      Unknown program type.
    </div>
  );
}
