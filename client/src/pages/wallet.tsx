import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import {
  Wallet,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  CreditCard,
  RefreshCw,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import type { OrganizationSubscriptionPlan } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  PortalPageHero,
  PortalFadeUp,
  PortalSectionReveal,
  WalletGlowCard,
  BookingCTAWrap,
  PremiumCard,
} from "@/components/ClientPortalMotion";

interface WalletTransaction {
  id: string;
  userId: string;
  type: "CREDIT" | "DEBIT";
  amountCents: number;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  stripeSessionId: string | null;
  createdAt: string;
}

interface WalletData {
  balanceCents: number;
  transactions: WalletTransaction[];
}

interface UserSubscriptionWithPlan {
  id: string;
  planId: string;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  sessionsRemaining: number | null;
  cancelAtPeriodEnd: boolean | null;
  createdAt: string;
  plan: {
    name: string;
    description: string | null;
    amountCents: number;
    interval: string;
    intervalCount: number | null;
    cancellationPolicy: string | null;
    sessionsPerWeek: number | null;
  };
}

const PRESET_AMOUNTS = [2500, 5000, 10000, 20000, 50000];

export default function WalletPage() {
  const { toast } = useToast();
  const [customAmount, setCustomAmount] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [cancelDialogSub, setCancelDialogSub] =
    useState<UserSubscriptionWithPlan | null>(null);

  const { data: wallet, isLoading } = useQuery<WalletData>({
    queryKey: ["/api/wallet"],
  });

  const { data: subscriptionPlans } = useQuery<OrganizationSubscriptionPlan[]>({
    queryKey: ["/api/wallet/subscription-plans"],
  });

  const { data: mySubscriptions } = useQuery<UserSubscriptionWithPlan[]>({
    queryKey: ["/api/wallet/my-subscriptions"],
  });

  const subscribeMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest("POST", "/api/wallet/subscribe", { planId });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/wallet/subscriptions/${subscriptionId}/cancel`,
        {}
      );
      return res.json();
    },
    onSuccess: (data: { policy: string }) => {
      const msg =
        data.policy === "immediate"
          ? "Your subscription has been canceled immediately."
          : "Your subscription will be canceled at the end of the current billing period. You keep access until then.";
      toast({ title: "Subscription Canceled", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/my-subscriptions"] });
      setCancelDialogSub(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setCancelDialogSub(null);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/wallet/subscriptions/${subscriptionId}/reactivate`,
        {}
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Subscription Reactivated",
        description: "Your subscription will continue renewing automatically.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/my-subscriptions"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const subSessionId = params.get("sub_session_id");

    if (params.get("success") === "true" && sessionId) {
      apiRequest("GET", `/api/wallet/verify-session?sessionId=${sessionId}`)
        .then((r) => r.json())
        .then((data) => {
          queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
          if (data.credited) {
            toast({
              title: "Payment Successful",
              description: data.alreadyProcessed
                ? "Funds were already added."
                : "Your funds have been added to your account.",
            });
          } else {
            toast({
              title: "Payment Processing",
              description: "Your payment is being processed. Funds will appear shortly.",
            });
          }
          window.history.replaceState({}, "", "/wallet");
        })
        .catch(() => {
          toast({
            title: "Payment Received",
            description: "Your funds should appear shortly.",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/wallet"] });
          window.history.replaceState({}, "", "/wallet");
        });
    } else if (params.get("subscription_success") === "true" && subSessionId) {
      apiRequest("POST", "/api/wallet/verify-subscription", { sessionId: subSessionId })
        .then((r) => r.json())
        .then(() => {
          toast({
            title: "Subscription Active",
            description: "Your subscription has been set up successfully!",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/wallet/my-subscriptions"] });
          queryClient.invalidateQueries({ queryKey: ["/api/wallet/subscription-plans"] });
          window.history.replaceState({}, "", "/wallet");
        })
        .catch(() => {
          toast({
            title: "Subscription Active",
            description: "Your subscription has been set up successfully!",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/wallet/my-subscriptions"] });
          window.history.replaceState({}, "", "/wallet");
        });
    } else if (params.get("subscription_success") === "true") {
      toast({
        title: "Subscription Active",
        description: "Your subscription has been set up successfully!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/my-subscriptions"] });
      window.history.replaceState({}, "", "/wallet");
    } else if (params.get("canceled") === "true") {
      toast({
        title: "Payment Canceled",
        description: "No charges were made.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/wallet");
    }
  }, [toast]);

  const checkoutMutation = useMutation({
    mutationFn: async (amountCents: number) => {
      const res = await apiRequest("POST", "/api/wallet/checkout", { amountCents });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddFunds = () => {
    let amount = selectedAmount;
    if (!amount && customAmount) {
      const parsed = parseFloat(customAmount);
      if (isNaN(parsed) || parsed < 1) {
        toast({
          title: "Invalid Amount",
          description: "Minimum deposit is $1.00",
          variant: "destructive",
        });
        return;
      }
      if (parsed > 1000) {
        toast({
          title: "Invalid Amount",
          description: "Maximum deposit is $1,000.00",
          variant: "destructive",
        });
        return;
      }
      amount = Math.round(parsed * 100);
    }

    if (!amount) {
      toast({
        title: "Select Amount",
        description: "Please select or enter an amount to add.",
        variant: "destructive",
      });
      return;
    }

    checkoutMutation.mutate(amount);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const balance = wallet?.balanceCents || 0;
  const transactions = wallet?.transactions || [];

  const activeSubs =
    mySubscriptions?.filter(
      (s) => s.status === "active" || s.status === "trialing"
    ) || [];
  const subscribedPlanIds = new Set(activeSubs.map((s) => s.planId));

  const getStatusBadge = (sub: UserSubscriptionWithPlan) => {
    if (sub.cancelAtPeriodEnd) {
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate">
          <Clock className="h-3 w-3 mr-1" />
          Cancels at period end
        </Badge>
      );
    }
    if (sub.status === "active") {
      return (
        <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 no-default-hover-elevate no-default-active-elevate">
          <CheckCircle className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    }
    if (sub.status === "trialing") {
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 no-default-hover-elevate no-default-active-elevate">
          <Clock className="h-3 w-3 mr-1" />
          Trial
        </Badge>
      );
    }
    if (sub.status === "canceled") {
      return (
        <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 no-default-hover-elevate no-default-active-elevate">
          <XCircle className="h-3 w-3 mr-1" />
          Canceled
        </Badge>
      );
    }
    if (sub.status === "past_due") {
      return (
        <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 no-default-hover-elevate no-default-active-elevate">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Past Due
        </Badge>
      );
    }
    return (
      <Badge
        variant="secondary"
        className="no-default-hover-elevate no-default-active-elevate"
      >
        {sub.status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <PortalPageHero className="rounded-xl px-5 py-6 border border-border/40 bg-card/50">
        <PortalFadeUp>
          <h1
            className="text-2xl font-serif font-bold"
            data-testid="text-wallet-title"
          >
            My Wallet
          </h1>
          <p className="text-muted-foreground mt-1">
            Add funds to your account to pay for training sessions
          </p>
        </PortalFadeUp>
      </PortalPageHero>

      {/* ── Balance Card ── */}
      <WalletGlowCard className="rounded-lg border border-border bg-card">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="h-6 w-6 text-primary" />
            <h2 className="text-lg font-semibold">Account Balance</h2>
          </div>
          <p
            className={`text-4xl font-bold ${
              balance < 0
                ? "text-red-600 dark:text-red-400"
                : "text-primary"
            }`}
            data-testid="text-wallet-balance"
          >
            {balance < 0
              ? `-$${(Math.abs(balance) / 100).toFixed(2)}`
              : `$${(balance / 100).toFixed(2)}`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {balance < 0
              ? "You have an outstanding balance. Please add funds to cover it."
              : "Available for session payments"}
          </p>
        </div>
      </WalletGlowCard>

      {/* ── My Subscriptions ── */}
      {mySubscriptions && mySubscriptions.length > 0 && (
        <PortalSectionReveal delay={0.05}>
          <PremiumCard className="rounded-lg border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">My Subscriptions</h2>
            </div>
            <div className="space-y-3">
              {mySubscriptions.map((sub) => {
                const isActive =
                  sub.status === "active" || sub.status === "trialing";
                const periodEnd = sub.currentPeriodEnd
                  ? format(parseISO(sub.currentPeriodEnd), "MMM d, yyyy")
                  : null;
                return (
                  <div
                    key={sub.id}
                    className="p-4 rounded-lg border border-border space-y-3"
                    data-testid={`card-my-subscription-${sub.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p
                          className="font-medium"
                          data-testid={`text-sub-name-${sub.id}`}
                        >
                          {sub.plan.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          ${(sub.plan.amountCents / 100).toFixed(2)} /{" "}
                          {sub.plan.interval}
                        </p>
                      </div>
                      {getStatusBadge(sub)}
                    </div>

                    {isActive && (
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {sub.sessionsRemaining !== null &&
                          sub.sessionsRemaining !== undefined && (
                            <div className="rounded-md bg-muted/50 px-3 py-2">
                              <p className="text-xs text-muted-foreground">
                                Sessions remaining
                              </p>
                              <p
                                className="font-semibold"
                                data-testid={`text-sessions-remaining-${sub.id}`}
                              >
                                {sub.sessionsRemaining}
                              </p>
                            </div>
                          )}
                        {periodEnd && (
                          <div className="rounded-md bg-muted/50 px-3 py-2">
                            <p className="text-xs text-muted-foreground">
                              {sub.cancelAtPeriodEnd
                                ? "Access until"
                                : "Next billing"}
                            </p>
                            <p
                              className="font-semibold"
                              data-testid={`text-period-end-${sub.id}`}
                            >
                              {periodEnd}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {isActive && !sub.cancelAtPeriodEnd && (
                      <div className="pt-1 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 w-full justify-start"
                          onClick={() => setCancelDialogSub(sub)}
                          data-testid={`button-cancel-sub-${sub.id}`}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-2" />
                          Cancel at end of term
                        </Button>
                      </div>
                    )}

                    {isActive && sub.cancelAtPeriodEnd && (
                      <div className="pt-1 border-t flex items-center justify-between gap-2">
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Cancels{periodEnd ? ` on ${periodEnd}` : " at period end"} —
                          no further charges
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => reactivateMutation.mutate(sub.id)}
                          disabled={reactivateMutation.isPending}
                          data-testid={`button-reactivate-sub-${sub.id}`}
                        >
                          {reactivateMutation.isPending ? "..." : "Keep Subscription"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </PremiumCard>
        </PortalSectionReveal>
      )}

      {/* ── Add Funds ── */}
      <PortalSectionReveal delay={0.08}>
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Plus className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Add Funds</h2>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {PRESET_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                variant={selectedAmount === amount ? "default" : "outline"}
                className={`toggle-elevate ${
                  selectedAmount === amount ? "toggle-elevated" : ""
                }`}
                onClick={() => {
                  setSelectedAmount(selectedAmount === amount ? null : amount);
                  setCustomAmount("");
                }}
                data-testid={`button-amount-${amount}`}
              >
                ${(amount / 100).toFixed(0)}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Custom:
            </span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                type="number"
                min="1"
                max="1000"
                step="0.01"
                placeholder="Enter amount"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                }}
                className="pl-7"
                data-testid="input-custom-amount"
              />
            </div>
          </div>

          <BookingCTAWrap>
            <Button
              className="w-full"
              onClick={handleAddFunds}
              disabled={
                checkoutMutation.isPending || (!selectedAmount && !customAmount)
              }
              data-testid="button-add-funds"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {checkoutMutation.isPending
                ? "Redirecting to payment..."
                : "Add Funds via Stripe"}
            </Button>
          </BookingCTAWrap>
        </Card>
      </PortalSectionReveal>

      {/* ── Subscription Plans ── */}
      {subscriptionPlans && subscriptionPlans.length > 0 && (
        <PortalSectionReveal delay={0.1}>
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg font-semibold">Subscription Plans</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Subscribe to a recurring plan for regular training sessions.
            </p>
            <div className="space-y-3">
              {subscriptionPlans.map((plan) => {
                const isSubscribed = subscribedPlanIds.has(plan.id);
                return (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border hover:border-amber-500/30 transition-colors"
                    data-testid={`card-plan-${plan.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="font-medium"
                        data-testid={`text-plan-name-${plan.id}`}
                      >
                        {plan.name}
                      </p>
                      {plan.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {plan.description}
                        </p>
                      )}
                      <Badge
                        className="mt-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate"
                        data-testid={`badge-plan-price-${plan.id}`}
                      >
                        ${(plan.amountCents / 100).toFixed(2)}/{plan.interval}
                        {(plan.intervalCount || 1) > 1
                          ? ` (every ${plan.intervalCount} ${plan.interval}s)`
                          : ""}
                      </Badge>
                    </div>
                    {isSubscribed ? (
                      <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 no-default-hover-elevate no-default-active-elevate shrink-0">
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        Subscribed
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        className="shrink-0 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                        onClick={() => subscribeMutation.mutate(plan.id)}
                        disabled={subscribeMutation.isPending}
                        data-testid={`button-subscribe-${plan.id}`}
                      >
                        <CreditCard className="h-4 w-4 mr-1.5" />
                        {subscribeMutation.isPending ? "Redirecting..." : "Subscribe"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </PortalSectionReveal>
      )}

      {/* ── Transaction History ── */}
      <PortalSectionReveal delay={0.12}>
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Transaction History</h2>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No transactions yet. Add funds to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0"
                  data-testid={`row-transaction-${tx.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {tx.type === "CREDIT" ? (
                      <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                        <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                        <ArrowUpRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {tx.description ||
                          (tx.type === "CREDIT" ? "Funds Added" : "Session Payment")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx.createdAt
                          ? format(parseISO(tx.createdAt), "MMM d, yyyy h:mm a")
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className={
                      tx.type === "CREDIT"
                        ? "bg-green-500/15 text-green-700 dark:text-green-400 no-default-hover-elevate no-default-active-elevate"
                        : "bg-red-500/15 text-red-700 dark:text-red-400 no-default-hover-elevate no-default-active-elevate"
                    }
                  >
                    {tx.type === "CREDIT" ? "+" : "-"}$
                    {(tx.amountCents / 100).toFixed(2)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </PortalSectionReveal>

      <AlertDialog
        open={!!cancelDialogSub}
        onOpenChange={(open) => {
          if (!open) setCancelDialogSub(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelDialogSub?.plan.cancellationPolicy === "immediate" ? (
                <>
                  Your subscription to{" "}
                  <strong>{cancelDialogSub?.plan.name}</strong> will be canceled
                  immediately and you will lose access right away.
                </>
              ) : (
                <>
                  Your subscription to{" "}
                  <strong>{cancelDialogSub?.plan.name}</strong> will remain active
                  until the end of your current billing period
                  {cancelDialogSub?.currentPeriodEnd && (
                    <>
                      {" "}
                      (
                      {format(
                        parseISO(cancelDialogSub.currentPeriodEnd),
                        "MMM d, yyyy"
                      )}
                      )
                    </>
                  )}
                  . You will not be charged again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog-keep">
              Keep Subscription
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                cancelDialogSub && cancelMutation.mutate(cancelDialogSub.id)
              }
              disabled={cancelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-cancel-dialog-confirm"
            >
              {cancelMutation.isPending ? "Canceling..." : "Cancel Subscription"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
