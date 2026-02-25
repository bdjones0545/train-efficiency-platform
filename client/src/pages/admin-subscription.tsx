import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Sparkles,
  Shield,
  Users,
  Calendar,
  BarChart3,
  Zap,
} from "lucide-react";

interface SubscriptionStatus {
  status: string;
  isPlatformOrg: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isActive: boolean;
  stripeSubscriptionId?: string;
}

export default function AdminSubscriptionPage() {
  const { toast } = useToast();
  const [location] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  const { data: verifyResult } = useQuery({
    queryKey: ["/api/subscription/verify-session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/subscription/verify-session?session_id=${sessionId}`);
      if (!res.ok) throw new Error("Failed to verify");
      return res.json();
    },
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (verifyResult?.success) {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      toast({ title: "Subscription activated!", description: "Your free trial has started." });
      window.history.replaceState({}, "", "/admin/subscription");
    }
  }, [verifyResult]);

  const { data: subscription, isLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/create-checkout");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/cancel");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription canceled", description: "Access continues until the end of your billing period." });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/reactivate");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription reactivated!" });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (subscription?.isPlatformOrg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-subscription-title">
            <CreditCard className="h-6 w-6" />
            Subscription
          </h1>
          <p className="text-sm text-muted-foreground">Platform organization — no subscription required</p>
        </div>
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <p className="font-semibold" data-testid="text-platform-org">Platform Owner</p>
              <p className="text-sm text-muted-foreground">
                Your organization has full access as the platform owner.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const isActive = subscription?.isActive;
  const isTrial = subscription?.status === "trialing";
  const isCanceled = subscription?.status === "canceled";
  const isPastDue = subscription?.status === "past_due";
  const hasNoSub = !subscription?.status || subscription?.status === "none";

  const trialEnd = subscription?.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

  const features = [
    { icon: Users, label: "Unlimited coaches & clients" },
    { icon: Calendar, label: "Full scheduling platform" },
    { icon: BarChart3, label: "Business analytics & reporting" },
    { icon: Zap, label: "AI scheduling assistant" },
    { icon: CreditCard, label: "Stripe payment integration" },
    { icon: Sparkles, label: "Custom branding & landing page" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-subscription-title">
          <CreditCard className="h-6 w-6" />
          Subscription
        </h1>
        <p className="text-sm text-muted-foreground">Manage your organization's subscription plan</p>
      </div>

      <Separator />

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isActive ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"}`}>
              {isActive ? (
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              ) : isCanceled ? (
                <XCircle className="h-6 w-6 text-red-500" />
              ) : isPastDue ? (
                <AlertTriangle className="h-6 w-6 text-yellow-500" />
              ) : (
                <Clock className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="font-semibold text-lg" data-testid="text-subscription-status">
                {isTrial ? "Free Trial" : isActive ? "Active" : isCanceled ? "Canceled" : isPastDue ? "Past Due" : "No Subscription"}
              </p>
              <p className="text-sm text-muted-foreground">
                {isTrial && trialEnd
                  ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining — trial ends ${trialEnd.toLocaleDateString()}`
                  : isActive && periodEnd
                  ? `Renews ${periodEnd.toLocaleDateString()}`
                  : isCanceled
                  ? "Your subscription has ended"
                  : isPastDue
                  ? "Payment failed — please update your payment method"
                  : "Start your free trial to access all features"}
              </p>
            </div>
          </div>
          {isActive && (
            <Badge
              className={
                isTrial
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }
              data-testid="badge-subscription-status"
            >
              {isTrial ? "Trial" : "Active"}
            </Badge>
          )}
        </div>

        {isActive && (
          <div className="bg-muted/50 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Train Efficiency Platform</p>
                <p className="text-sm text-muted-foreground">
                  $49.99/month {isTrial ? "— starts after trial" : ""}
                </p>
              </div>
              <p className="text-2xl font-bold" data-testid="text-subscription-price">$49.99<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            </div>
          </div>
        )}
      </Card>

      {hasNoSub || isCanceled ? (
        <Card className="p-6 space-y-6">
          <div className="text-center space-y-2">
            <Sparkles className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-xl font-bold" data-testid="text-start-trial">
              {isCanceled ? "Resubscribe to Train Efficiency" : "Start Your Free 3-Day Trial"}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              {isCanceled
                ? "Get back to running your coaching business with full platform access."
                : "Try everything free for 3 days. No charge until your trial ends. Cancel anytime."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm p-2 rounded-lg bg-muted/50">
                <f.icon className="h-4 w-4 text-primary shrink-0" />
                <span>{f.label}</span>
              </div>
            ))}
          </div>

          <div className="text-center space-y-3">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold" data-testid="text-price-display">$49.99</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <p className="text-xs text-muted-foreground">3-day free trial included</p>
            <Button
              size="lg"
              className="w-full max-w-sm"
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              data-testid="button-start-trial"
            >
              {checkoutMutation.isPending ? "Redirecting to Stripe..." : isCanceled ? "Resubscribe — $49.99/mo" : "Start Free Trial"}
            </Button>
            <p className="text-xs text-muted-foreground">
              You will be redirected to Stripe to enter your payment details.
              {!isCanceled && " You won't be charged until your 3-day trial ends."}
            </p>
          </div>
        </Card>
      ) : null}

      {isActive && !isTrial && (
        <>
          <Separator />
          <Card className="p-4 border-destructive/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Cancel Subscription</p>
                <p className="text-xs text-muted-foreground">
                  You'll keep access until {periodEnd?.toLocaleDateString() || "the end of your billing period"}.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-subscription"
              >
                {cancelMutation.isPending ? "Canceling..." : "Cancel Subscription"}
              </Button>
            </div>
          </Card>
        </>
      )}

      {isTrial && (
        <Card className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-sm">Trial Information</p>
              <p className="text-xs text-muted-foreground">
                Your 3-day free trial gives you full access to everything. After the trial, you'll be charged
                $49.99/month. You can cancel anytime before the trial ends to avoid being charged.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
