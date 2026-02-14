import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Calendar, Clock, X, Users } from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { AddSessionDialog } from "@/components/add-session-dialog";
import type { BookingWithDetails, ParticipantWithUser } from "@/lib/types";
import type { UserProfile } from "@shared/schema";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  CONFIRMED: "bg-green-500/15 text-green-700 dark:text-green-400",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  NO_SHOW: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

export default function MyBookingsPage() {
  const { toast } = useToast();
  const { data: bookings, isLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/bookings"],
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";

  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status: "CANCELLED" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const upcoming = bookings?.filter(
    (b) => ["CONFIRMED", "PENDING"].includes(b.status) && !isPast(parseISO(b.startAt as unknown as string))
  ) || [];

  const past = bookings?.filter(
    (b) => !["CONFIRMED", "PENDING"].includes(b.status) || isPast(parseISO(b.startAt as unknown as string))
  ) || [];

  const renderBooking = (booking: BookingWithDetails, showCancel = false) => (
    <Card key={booking.id} className="p-4" data-testid={`card-booking-${booking.id}`}>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{booking.service?.name || "Session"}</h3>
            <Badge className={`text-xs ${statusColors[booking.status] || ""}`}>
              {booking.status}
            </Badge>
            {booking.maxParticipants && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                Group
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "EEEE, MMM d, yyyy")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "h:mm a")} —{" "}
            {format(parseISO(booking.endAt as unknown as string), "h:mm a")}
          </div>
          {booking.coach?.user && (
            <p className="text-sm text-muted-foreground">
              Coach: {booking.coach.user.firstName} {booking.coach.user.lastName}
            </p>
          )}
          {booking.maxParticipants && booking.groupDescription && (
            <p className="text-sm text-muted-foreground">{booking.groupDescription}</p>
          )}
        </div>
        {showCancel && booking.status === "CONFIRMED" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancelMutation.mutate(booking.id)}
            disabled={cancelMutation.isPending}
            data-testid={`button-cancel-booking-${booking.id}`}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-bookings-title">My Bookings</h1>
          <p className="text-muted-foreground mt-1">Manage your training sessions</p>
        </div>
        {isCoach && <AddSessionDialog />}
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming" data-testid="tab-upcoming">
            Upcoming ({upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="past" data-testid="tab-past">
            Past ({past.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="space-y-3 mt-4">
          {upcoming.length === 0 ? (
            <Card className="p-8 text-center">
              <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No upcoming sessions</p>
              <Button variant="outline" className="mt-3" onClick={() => window.location.href = "/coaches"}>
                Browse Coaches
              </Button>
            </Card>
          ) : (
            upcoming.map((b) => renderBooking(b, true))
          )}
        </TabsContent>
        <TabsContent value="past" className="space-y-3 mt-4">
          {past.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No past sessions</p>
            </Card>
          ) : (
            past.map((b) => renderBooking(b))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
