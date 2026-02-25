import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar, Clock, Filter, Mail, MapPin, Trash2, Users, UserPlus, UserMinus, Plus, X } from "lucide-react";
import { useState } from "react";
import { format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import type { OpenSession, ParticipantWithUser } from "@/lib/types";
import type { UserProfile } from "@shared/schema";
import { AddSessionDialog } from "@/components/add-session-dialog";

function SessionCard({ session, userId, isAuthenticated, isOwner }: { session: OpenSession; userId?: string; isAuthenticated: boolean; isOwner: boolean }) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [joinParticipantNames, setJoinParticipantNames] = useState<string[]>([""]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/coach/bookings/${session.id}`);
    },
    onSuccess: () => {
      toast({ title: "Session Deleted", description: "The group session has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: participants, isLoading: participantsLoading } = useQuery<ParticipantWithUser[]>({
    queryKey: ["/api/bookings", session.id, "participants"],
  });

  const hasJoined = !!(userId && participants?.some((p) => p.userId === userId));

  const joinMutation = useMutation({
    mutationFn: async (data?: { participantNames?: string[] }) => {
      const res = await apiRequest("POST", `/api/bookings/${session.id}/join`, data || {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Registered", description: "You've been added to this session." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session.id, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      setShowJoinDialog(false);
      setJoinParticipantNames([""]);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Please log in", description: "You need to be logged in to join.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/bookings/${session.id}/leave`);
    },
    onSuccess: () => {
      toast({ title: "Unregistered", description: "You've been removed from this session." });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", session.id, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const spotsRemaining = (session.maxParticipants || 6) - (session.participantCount || 0);

  const handleAction = () => {
    if (!isAuthenticated) {
      window.location.href = "/";
      return;
    }
    if (hasJoined) {
      leaveMutation.mutate();
    } else {
      setShowJoinDialog(true);
    }
  };

  const handleJoinConfirm = () => {
    const filledNames = joinParticipantNames.filter(n => n.trim());
    joinMutation.mutate(filledNames.length > 0 ? { participantNames: filledNames } : undefined);
  };

  const addJoinParticipant = () => {
    if (joinParticipantNames.length < spotsRemaining) {
      setJoinParticipantNames([...joinParticipantNames, ""]);
    }
  };

  const removeJoinParticipant = (index: number) => {
    setJoinParticipantNames(joinParticipantNames.filter((_, i) => i !== index));
  };

  const updateJoinParticipant = (index: number, value: string) => {
    const updated = [...joinParticipantNames];
    updated[index] = value;
    setJoinParticipantNames(updated);
  };

  const isPending = joinMutation.isPending || leaveMutation.isPending;

  return (
    <Card className="p-5" data-testid={`card-open-session-${session.id}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm">{session.service?.name || "Group Session"}</h3>
            <Badge variant="secondary" className="mt-1 text-xs">
              <Users className="h-3 w-3 mr-1" />
              {session.participantCount}/{session.maxParticipants} spots filled
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            {isOwner && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-session-${session.id}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            {hasJoined ? (
              <Badge className="bg-primary/15 text-primary text-xs" data-testid={`badge-joined-${session.id}`}>
                Registered
              </Badge>
            ) : (
              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-xs">
                Open
              </Badge>
            )}
          </div>
        </div>

        {session.groupDescription && (
          <p className="text-sm leading-relaxed" data-testid={`text-group-desc-${session.id}`}>
            {session.groupDescription}
          </p>
        )}

        {(session.ageRange || session.skillLevel) && (
          <div className="flex flex-wrap gap-2">
            {session.ageRange && (
              <Badge variant="outline" className="text-xs" data-testid={`badge-age-range-${session.id}`}>
                Ages: {session.ageRange}
              </Badge>
            )}
            {session.skillLevel && (
              <Badge variant="outline" className="text-xs" data-testid={`badge-skill-level-${session.id}`}>
                {session.skillLevel}
              </Badge>
            )}
          </div>
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

        {session.location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`text-session-location-${session.id}`}>
            <MapPin className="h-3.5 w-3.5" />
            {session.location}
          </div>
        )}

        {session.service && (
          <p className="text-sm font-medium text-primary" data-testid={`text-session-price-${session.id}`}>
            {session.service.name.toLowerCase().includes("team training") ? "Quoted Price" : session.service.priceCents === 0 ? "FREE" : `$${(session.service.priceCents / 100).toFixed(2)} per person`}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" data-testid={`participants-list-${session.id}`}>
          {participantsLoading ? (
            <Skeleton className="h-4 w-32" />
          ) : !participants || participants.length === 0 ? (
            <p className="text-xs text-muted-foreground">No athletes registered yet</p>
          ) : (
            participants.map((p: any) => (
              <Badge key={p.id} variant="secondary" className="text-xs" data-testid={`badge-participant-${p.id}`}>
                {p.participantName || `${p.user.firstName} ${p.user.lastName}`}
              </Badge>
            ))
          )}
        </div>

        {hasJoined ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleAction}
            disabled={isPending}
            data-testid={`button-leave-session-${session.id}`}
          >
            <UserMinus className="h-4 w-4 mr-1" />
            {isPending ? "Unregistering..." : "Unregister"}
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={handleAction}
            disabled={isPending}
            data-testid={`button-join-session-${session.id}`}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            {!isAuthenticated ? "Sign Up to Join" : isPending ? "Joining..." : "Join Session"}
          </Button>
        )}
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Group Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this group session? All registered participants will be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-session">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-session"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join Group Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add the names of athletes you're registering for this session. You can register multiple participants (e.g., your kids).
            </p>
            <div className="space-y-2">
              <Label data-testid="label-join-participants">Participant Names</Label>
              {joinParticipantNames.map((name, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder={`Participant ${index + 1} name`}
                    value={name}
                    onChange={(e) => updateJoinParticipant(index, e.target.value)}
                    data-testid={`input-join-participant-${index}`}
                  />
                  {joinParticipantNames.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeJoinParticipant(index)}
                      data-testid={`button-remove-join-participant-${index}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {joinParticipantNames.length < spotsRemaining && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addJoinParticipant}
                  data-testid="button-add-join-participant"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Another Participant
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {spotsRemaining} spot{spotsRemaining !== 1 ? "s" : ""} remaining
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowJoinDialog(false)} data-testid="button-cancel-join">
              Cancel
            </Button>
            <Button
              onClick={handleJoinConfirm}
              disabled={joinMutation.isPending}
              data-testid="button-confirm-join"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              {joinMutation.isPending ? "Joining..." : "Join Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function OpenSessionsPage() {
  const { user, isAuthenticated } = useAuth();
  const [timeFilter, setTimeFilter] = useState("all");
  const [skillFilter, setSkillFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState("all");

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";

  const { data: sessions, isLoading } = useQuery<OpenSession[]>({
    queryKey: ["/api/sessions/open"],
  });

  const ageOptions = Array.from(new Set(
    (sessions || []).map(s => s.ageRange).filter((a): a is string => !!a && a.trim() !== "")
  )).sort();

  const filteredSessions = (sessions || []).filter((session) => {
    if (timeFilter !== "all") {
      const sessionDate = parseISO(session.startAt as unknown as string);
      const now = new Date();
      if (timeFilter === "today") {
        if (!isWithinInterval(sessionDate, { start: startOfDay(now), end: endOfDay(now) })) return false;
      } else if (timeFilter === "week") {
        if (!isWithinInterval(sessionDate, { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) })) return false;
      } else if (timeFilter === "month") {
        if (!isWithinInterval(sessionDate, { start: startOfMonth(now), end: endOfMonth(now) })) return false;
      }
    }
    if (skillFilter !== "all" && session.skillLevel !== skillFilter) return false;
    if (ageFilter !== "all" && session.ageRange !== ageFilter) return false;
    return true;
  });

  const hasActiveFilters = timeFilter !== "all" || skillFilter !== "all" || ageFilter !== "all";

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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-open-sessions-title">Open Group Sessions</h1>
          <p className="text-muted-foreground mt-1">Browse and join semi-private training sessions with other athletes</p>
        </div>
        {isCoach && <AddSessionDialog />}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Time Period</Label>
          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="w-[130px] h-9" data-testid="filter-time-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Upcoming</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Skill Level</Label>
          <Select value={skillFilter} onValueChange={setSkillFilter}>
            <SelectTrigger className="w-[130px] h-9" data-testid="filter-skill-level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="Beginner">Beginner</SelectItem>
              <SelectItem value="Intermediate">Intermediate</SelectItem>
              <SelectItem value="Advanced">Advanced</SelectItem>
              <SelectItem value="All Levels">All Levels</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {ageOptions.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Age Range</Label>
            <Select value={ageFilter} onValueChange={setAgeFilter}>
              <SelectTrigger className="w-[130px] h-9" data-testid="filter-age-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ages</SelectItem>
                {ageOptions.map((age) => (
                  <SelectItem key={age} value={age}>{age}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => { setTimeFilter("all"); setSkillFilter("all"); setAgeFilter("all"); }}
            data-testid="button-clear-filters"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {filteredSessions.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          {hasActiveFilters ? (
            <>
              <p className="text-muted-foreground">No sessions match your filters</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters to see more sessions</p>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">No open group sessions available right now</p>
              <p className="text-sm text-muted-foreground mt-1">Check back later or browse coaches for 1-on-1 sessions</p>
            </>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              userId={user?.id}
              isAuthenticated={isAuthenticated}
              isOwner={isCoach && session.coach?.userId === user?.id}
            />
          ))}
        </div>
      )}

      {!isCoach && (
        <Card className="p-6 text-center space-y-3" data-testid="card-group-inquiry">
          <Users className="h-7 w-7 mx-auto text-primary" />
          <h3 className="font-semibold">Want to Start a Group Session?</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Gather your teammates, training partners, or friends and train together at a lower per-person cost. Reach out to get started.
          </p>
          <Button
            asChild
            data-testid="button-inquire-group"
          >
            <a href="mailto:Bryan.jones@efficiencystrengthtraining.com?subject=Group%20Training%20Inquiry&body=Hi%2C%20I%27m%20interested%20in%20starting%20a%20group%20training%20session.%20Please%20let%20me%20know%20about%20availability%20and%20pricing.">
              <Mail className="h-4 w-4 mr-2" />
              Inquire About Group Training
            </a>
          </Button>
        </Card>
      )}
    </div>
  );
}
