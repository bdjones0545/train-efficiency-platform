import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format, parseISO, isToday, isFuture } from "date-fns";
import type { BookingWithDetails } from "@/lib/types";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  CONFIRMED: "bg-green-500/15 text-green-700 dark:text-green-400",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
  COMPLETED: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  NO_SHOW: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

export default function CoachDashboardPage() {
  const { toast } = useToast();

  const { data: bookings, isLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/coach/bookings"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
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

  const todaySessions = bookings?.filter(
    (b) => isToday(parseISO(b.startAt as unknown as string)) && ["CONFIRMED", "PENDING"].includes(b.status)
  ) || [];

  const upcomingSessions = bookings?.filter(
    (b) => isFuture(parseISO(b.startAt as unknown as string)) && !isToday(parseISO(b.startAt as unknown as string)) && ["CONFIRMED", "PENDING"].includes(b.status)
  ) || [];

  const recentSessions = bookings?.filter(
    (b) => ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(b.status)
  ).slice(0, 10) || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const renderBookingCard = (booking: BookingWithDetails, showActions = false) => (
    <Card key={booking.id} className="p-4" data-testid={`card-coach-booking-${booking.id}`}>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">{booking.service?.name || "Session"}</h3>
            <Badge className={`text-xs ${statusColors[booking.status]}`}>
              {booking.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "EEE, MMM d")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "h:mm a")} — {format(parseISO(booking.endAt as unknown as string), "h:mm a")}
          </div>
          {booking.client && (
            <p className="text-sm text-muted-foreground">
              Client: {booking.client.firstName} {booking.client.lastName}
            </p>
          )}
        </div>
        {showActions && booking.status === "CONFIRMED" && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate({ bookingId: booking.id, status: "COMPLETED" })}
              disabled={updateStatusMutation.isPending}
              data-testid={`button-complete-${booking.id}`}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Complete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate({ bookingId: booking.id, status: "NO_SHOW" })}
              disabled={updateStatusMutation.isPending}
              data-testid={`button-noshow-${booking.id}`}
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              No-Show
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateStatusMutation.mutate({ bookingId: booking.id, status: "CANCELLED" })}
              disabled={updateStatusMutation.isPending}
              data-testid={`button-cancel-${booking.id}`}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-coach-dashboard-title">Coach Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage your sessions and schedule</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-primary" data-testid="text-today-count">{todaySessions.length}</p>
          <p className="text-sm text-muted-foreground">Today's Sessions</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold" data-testid="text-upcoming-count">{upcomingSessions.length}</p>
          <p className="text-sm text-muted-foreground">Upcoming</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold" data-testid="text-completed-count">
            {bookings?.filter((b) => b.status === "COMPLETED").length || 0}
          </p>
          <p className="text-sm text-muted-foreground">Completed</p>
        </Card>
      </div>

      {todaySessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Today's Sessions</h2>
          {todaySessions.map((b) => renderBookingCard(b, true))}
        </div>
      )}

      {upcomingSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Upcoming Sessions</h2>
          {upcomingSessions.map((b) => renderBookingCard(b, true))}
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Recent Sessions</h2>
          {recentSessions.map((b) => renderBookingCard(b))}
        </div>
      )}

      {!todaySessions.length && !upcomingSessions.length && (
        <Card className="p-8 text-center">
          <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No sessions scheduled</p>
        </Card>
      )}
    </div>
  );
}
