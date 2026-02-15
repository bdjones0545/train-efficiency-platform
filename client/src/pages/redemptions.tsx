import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { DollarSign, Calendar, Clock, CheckCircle, Banknote } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { BookingWithDetails, RedemptionWithDetails, CashoutWithDetails } from "@/lib/types";

const payoutColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  SENT: "bg-green-500/15 text-green-700 dark:text-green-400",
  FAILED: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const cashoutStatusColors: Record<string, string> = {
  REQUESTED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  PAID: "bg-green-500/15 text-green-700 dark:text-green-400",
  DENIED: "bg-red-500/15 text-red-700 dark:text-red-400",
};

export default function RedemptionsPage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const isOwner = user?.id === "42755213";

  const { data: completedBookings, isLoading: bookingsLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/coach/bookings/completed"],
  });

  const { data: redemptions, isLoading: redemptionsLoading } = useQuery<RedemptionWithDetails[]>({
    queryKey: ["/api/coach/redemptions"],
  });

  const { data: cashoutsList } = useQuery<CashoutWithDetails[]>({
    queryKey: ["/api/coach/cashouts"],
    enabled: !isOwner,
  });

  const redeemMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("POST", "/api/redemptions", { bookingId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session Redeemed", description: "Payout is pending." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings/completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/redemptions"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cashoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cashouts", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cash Out Requested", description: "Bryan has been notified and will process your payout." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/cashouts"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const redeemedBookingIds = new Set(redemptions?.map((r) => r.bookingId) || []);
  const unredeemed = completedBookings?.filter((b) => !redeemedBookingIds.has(b.id)) || [];
  const isLoading = bookingsLoading || redemptionsLoading;

  const totalRedeemed = redemptions?.reduce((sum, r) => sum + r.amountCents, 0) || 0;
  const pendingPayout = redemptions?.filter((r) => r.payoutStatus === "PENDING").reduce((sum, r) => sum + r.amountCents, 0) || 0;
  const totalCashedOut = cashoutsList?.reduce((sum, c) => sum + c.amountCents, 0) || 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid sm:grid-cols-2 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-redemptions-title">Redemptions</h1>
        <p className="text-muted-foreground mt-1">Redeem completed sessions for payout</p>
      </div>

      <div className={`grid gap-4 ${isOwner ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-primary" data-testid="text-total-redeemed">
            ${(totalRedeemed / 100).toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground">Total Redeemed</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold" data-testid="text-pending-payout">
            ${(pendingPayout / 100).toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground">Available to Cash Out</p>
        </Card>
        {!isOwner && (
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-cashed-out">
              ${(totalCashedOut / 100).toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">Total Cashed Out</p>
          </Card>
        )}
      </div>

      {!isOwner && pendingPayout > 0 && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="font-semibold">Ready to Cash Out</h3>
              <p className="text-sm text-muted-foreground">
                You have ${(pendingPayout / 100).toFixed(2)} available. Cash out to request your payout from Bryan.
              </p>
            </div>
            <Button
              onClick={() => cashoutMutation.mutate()}
              disabled={cashoutMutation.isPending}
              data-testid="button-cash-out"
            >
              <Banknote className="h-4 w-4 mr-1" />
              {cashoutMutation.isPending ? "Requesting..." : `Cash Out $${(pendingPayout / 100).toFixed(2)}`}
            </Button>
          </div>
        </Card>
      )}

      {unredeemed.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Ready to Redeem</h2>
          {unredeemed.map((booking) => (
            <Card key={booking.id} className="p-4" data-testid={`card-unredeemed-${booking.id}`}>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <h3 className="font-semibold text-sm">{booking.service?.name || "Session"}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(parseISO(booking.startAt as unknown as string), "EEE, MMM d, yyyy")}
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
                  {booking.service && (
                    <p className="text-sm font-medium">
                      {booking.service.name.toLowerCase().includes("team training") ? "Quoted Price" : booking.service.priceCents === 0 ? "FREE" : `$${(booking.service.priceCents / 100).toFixed(2)}`}
                    </p>
                  )}
                </div>
                <Button
                  onClick={() => redeemMutation.mutate(booking.id)}
                  disabled={redeemMutation.isPending}
                  data-testid={`button-redeem-${booking.id}`}
                >
                  <DollarSign className="h-4 w-4 mr-1" />
                  Redeem
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {redemptions && redemptions.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Redemption History</h2>
          {redemptions.map((redemption) => (
            <Card key={redemption.id} className="p-4" data-testid={`card-redemption-${redemption.id}`}>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="font-semibold text-sm">
                      ${(redemption.amountCents / 100).toFixed(2)}
                    </span>
                    <Badge className={`text-xs ${payoutColors[redemption.payoutStatus]}`}>
                      {redemption.payoutStatus}
                    </Badge>
                  </div>
                  {redemption.redeemedAt && (
                    <p className="text-sm text-muted-foreground">
                      Redeemed: {format(parseISO(redemption.redeemedAt as unknown as string), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isOwner && cashoutsList && cashoutsList.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Cash Out History</h2>
          {cashoutsList.map((cashout) => (
            <Card key={cashout.id} className="p-4" data-testid={`card-cashout-${cashout.id}`}>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Banknote className="h-4 w-4 text-green-600" />
                    <span className="font-semibold text-sm">
                      ${(cashout.amountCents / 100).toFixed(2)}
                    </span>
                    <Badge className={`text-xs ${cashoutStatusColors[cashout.status]}`}>
                      {cashout.status}
                    </Badge>
                  </div>
                  {cashout.requestedAt && (
                    <p className="text-sm text-muted-foreground">
                      Requested: {format(parseISO(cashout.requestedAt as unknown as string), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                  {cashout.processedAt && (
                    <p className="text-sm text-muted-foreground">
                      Processed: {format(parseISO(cashout.processedAt as unknown as string), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {unredeemed.length === 0 && (!redemptions || redemptions.length === 0) && (
        <Card className="p-8 text-center">
          <DollarSign className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No sessions to redeem yet</p>
        </Card>
      )}
    </div>
  );
}
