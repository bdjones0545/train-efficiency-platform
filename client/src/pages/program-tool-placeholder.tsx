import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { BarChart2, Dumbbell, Loader2 } from "lucide-react";
import { Redirect } from "wouter";

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

  const config =
    program.type === "pr_tracker"
      ? {
          icon: <BarChart2 className="h-8 w-8" />,
          message: "PR Tracker coming soon.",
        }
      : {
          icon: <Dumbbell className="h-8 w-8" />,
          message: "Workout Builder coming soon.",
        };

  return (
    <div className="p-6 max-w-xl mx-auto">
      <Card className="p-8 text-center space-y-4">
        <div className="flex justify-center text-muted-foreground">
          {config.icon}
        </div>
        <h1 className="text-xl font-semibold" data-testid="text-program-tool-name">
          {program.name}
        </h1>
        <p className="text-muted-foreground" data-testid="text-program-tool-message">
          {config.message}
        </p>
      </Card>
    </div>
  );
}
