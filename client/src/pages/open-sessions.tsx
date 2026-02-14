import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Calendar, Clock, Users, UserPlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { OpenSession, ParticipantWithUser } from "@/lib/types";

function ParticipantsList({ bookingId }: { bookingId: string }) {
  const { data: participants, isLoading } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", bookingId, "participants"],
  });

  if (isLoading) return <Skeleton className="h-4 w-32" />;
  if (!participants || participants.length === 0) {
    return <p className="text-xs text-muted-foreground">No athletes registered yet</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5" data-testid={`participants-list-${bookingId}`}>
      {participants.map((p) => (
        <Badge key={p.id} variant="secondary" className="text-xs" data-testid={`badge-participant-${p.userId}`}>
          {p.user.firstName} {p.user.lastName}
        </Badge>
      ))}
    </div>
  );
}

export default function OpenSessionsPage() {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();

  const { data: sessions, isLoading } = useQuery<OpenSession[]>({
    queryKey: ["/api/sessions/open"],
  });

  const joinMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("POST", `/api/bookings/${bookingId}/join`);
      return res.json();
    },
    onSuccess: (_data, bookingId) => {
      toast({ title: "Registered", description: "You've been added to this session." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", bookingId, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Please log in", description: "You need to be logged in to join.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleJoin = (bookingId: string) => {
    if (!isAuthenticated) {
      window.location.href = "/api/login";
      return;
    }
    joinMutation.mutate(bookingId);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-open-sessions-title">Open Group Sessions</h1>
        <p className="text-muted-foreground mt-1">Browse and join semi-private training sessions with other athletes</p>
      </div>

      {!sessions || sessions.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No open group sessions available right now</p>
          <p className="text-sm text-muted-foreground mt-1">Check back later or browse coaches for 1-on-1 sessions</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <Card key={session.id} className="p-5" data-testid={`card-open-session-${session.id}`}>
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-sm">{session.service?.name || "Group Session"}</h3>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {session.participantCount}/{session.maxParticipants} spots filled
                    </Badge>
                  </div>
                  <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-xs">
                    Open
                  </Badge>
                </div>

                {session.groupDescription && (
                  <p className="text-sm leading-relaxed" data-testid={`text-group-desc-${session.id}`}>
                    {session.groupDescription}
                  </p>
                )}

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(parseISO(session.startAt as unknown as string), "EEEE, MMM d, yyyy")}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {format(parseISO(session.startAt as unknown as string), "h:mm a")} —{" "}
                    {format(parseISO(session.endAt as unknown as string), "h:mm a")}
                  </div>
                </div>

                {session.coach?.user && (
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={session.coach.photoUrl || session.coach.user.profileImageUrl || undefined} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {(session.coach.user.firstName?.[0] || "").toUpperCase()}
                        {(session.coach.user.lastName?.[0] || "").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">
                      Coach {session.coach.user.firstName} {session.coach.user.lastName}
                    </span>
                  </div>
                )}

                {session.service && (
                  <p className="text-sm font-medium text-primary" data-testid={`text-session-price-${session.id}`}>
                    ${(session.service.priceCents / 100).toFixed(2)} per person
                  </p>
                )}

                <ParticipantsList bookingId={session.id} />

                <Button
                  className="w-full"
                  onClick={() => handleJoin(session.id)}
                  disabled={joinMutation.isPending}
                  data-testid={`button-join-session-${session.id}`}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  {joinMutation.isPending ? "Joining..." : "Join Session"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
