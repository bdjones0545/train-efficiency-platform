import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, CheckCircle, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type PublicPlan = {
  id: string;
  name: string;
  description: string | null;
  amountCents: number;
  interval: string;
  intervalCount: number | null;
  organizationId: string;
  organizationName: string;
  orgPrimaryColor: string | null;
};

function formatPrice(amountCents: number, interval: string, intervalCount: number | null) {
  const dollars = (amountCents / 100).toFixed(2);
  const count = intervalCount ?? 1;
  if (count === 1) return `$${dollars} / ${interval}`;
  return `$${dollars} every ${count} ${interval}s`;
}

export default function SubscribePage() {
  const { planId } = useParams<{ planId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const searchParams = new URLSearchParams(window.location.search);
  const status = searchParams.get("status");

  const { data: plan, isLoading, error } = useQuery<PublicPlan>({
    queryKey: ["/api/public/subscription-plans", planId],
    queryFn: async () => {
      const res = await fetch(`/api/public/subscription-plans/${planId}`);
      if (!res.ok) throw new Error("Plan not found");
      return res.json();
    },
    enabled: !!planId,
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/public/subscription-plans/${planId}/checkout`, {});
      const data = await res.json();
      if (!data.url) throw new Error("No checkout URL returned");
      return data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const accentColor = plan?.orgPrimaryColor || "#16a34a";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-subscribe" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <XCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold" data-testid="text-plan-not-found">Plan Not Found</h2>
          <p className="text-muted-foreground">This subscription plan is no longer available or the link has expired.</p>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-home">Go Home</Button>
        </Card>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" data-testid="icon-success" />
          <h2 className="text-xl font-bold" data-testid="text-subscription-success">You're subscribed!</h2>
          <p className="text-muted-foreground">
            Welcome to <strong>{plan.name}</strong> at <strong>{plan.organizationName}</strong>. Your subscription is now active.
          </p>
          <Button onClick={() => setLocation("/")} data-testid="button-go-to-dashboard">
            Go to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  if (status === "canceled") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <XCircle className="h-12 w-12 text-muted-foreground mx-auto" data-testid="icon-canceled" />
          <h2 className="text-xl font-bold" data-testid="text-subscription-canceled">Checkout Canceled</h2>
          <p className="text-muted-foreground">You can try again anytime.</p>
          <Button onClick={() => setLocation(`/subscribe/${planId}`)} variant="outline" data-testid="button-try-again">
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground" data-testid="text-org-name">{plan.organizationName}</p>
          <h1 className="text-2xl font-bold" data-testid="text-plan-name">{plan.name}</h1>
        </div>

        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Subscription Plan</p>
              <p className="font-semibold text-lg" data-testid="text-plan-price">
                {formatPrice(plan.amountCents, plan.interval, plan.intervalCount)}
              </p>
            </div>
            <Badge variant="secondary" data-testid="badge-plan-interval">{plan.interval}ly</Badge>
          </div>

          {plan.description && (
            <p className="text-sm text-muted-foreground border-t pt-4" data-testid="text-plan-description">{plan.description}</p>
          )}

          <div className="border-t pt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              You'll be redirected to a secure checkout page powered by Stripe to complete your subscription.
            </p>
            <Button
              className="w-full"
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              data-testid="button-subscribe-now"
              style={{ backgroundColor: accentColor }}
            >
              {checkoutMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Subscribe Now
                </>
              )}
            </Button>
          </div>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Secure checkout powered by Stripe. Your payment info is never stored on our servers.
        </p>
      </div>
    </div>
  );
}
