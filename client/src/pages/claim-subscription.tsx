import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Link2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import { useToast } from "@/hooks/use-toast";

type ClaimInfo = {
  planId: string;
  planName: string;
  orgName: string;
  orgPrimaryColor: string | null;
  maskedEmail: string;
  alreadyLinked: boolean;
};

export default function ClaimSubscriptionPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const stripeSubId = params.get("sub") || "";
  const planId = params.get("planId") || "";

  const [tab, setTab] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [done, setDone] = useState(false);

  const { data: info, isLoading, error } = useQuery<ClaimInfo>({
    queryKey: ["/api/public/claim-subscription-info", stripeSubId, planId],
    queryFn: async () => {
      const res = await fetch(`/api/public/claim-subscription-info?sub=${encodeURIComponent(stripeSubId)}&planId=${encodeURIComponent(planId)}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Not found"); }
      return res.json();
    },
    enabled: !!stripeSubId && !!planId,
    retry: false,
  });

  const accentColor = info?.orgPrimaryColor || "#16a34a";

  // Register new account + claim
  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/register-and-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName, stripeSubscriptionId: stripeSubId, planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Registration failed");
      return data;
    },
    onSuccess: (data) => {
      if (data.token) setAuthToken(data.token);
      setDone(true);
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  // Login + claim
  const loginAndClaimMutation = useMutation({
    mutationFn: async () => {
      // First log in
      const loginRes = await fetch("/api/client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginData.message || "Login failed");
      if (loginData.token) setAuthToken(loginData.token);
      // Then claim
      const claimRes = await apiRequest("POST", "/api/wallet/claim-subscription", {
        stripeSubscriptionId: stripeSubId,
        planId,
      });
      const claimData = await claimRes.json();
      if (!claimRes.ok) throw new Error(claimData.message || "Failed to link subscription");
      return claimData;
    },
    onSuccess: () => setDone(true),
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  if (!stripeSubId || !planId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <XCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold" data-testid="text-invalid-link">Invalid Link</h2>
          <p className="text-muted-foreground">This link is missing required information. Please use the link from your email.</p>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-home">Go Home</Button>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-claim" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <XCircle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold" data-testid="text-sub-not-found">Subscription Not Found</h2>
          <p className="text-muted-foreground">{(error as Error)?.message || "This subscription link is invalid or has expired."}</p>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-home-error">Go Home</Button>
        </Card>
      </div>
    );
  }

  if (info.alreadyLinked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
          <h2 className="text-xl font-bold" data-testid="text-already-linked">Subscription Already Connected</h2>
          <p className="text-muted-foreground">This subscription is already linked to a platform account. Log in to access your dashboard.</p>
          <Button onClick={() => setLocation("/login")} style={{ backgroundColor: accentColor }} data-testid="button-go-to-login">Log In</Button>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" data-testid="icon-claim-success" />
          <h2 className="text-xl font-bold" data-testid="text-claim-success">You're all set!</h2>
          <p className="text-muted-foreground">
            Your <strong>{info.planName}</strong> subscription at <strong>{info.orgName}</strong> has been connected to your account.
          </p>
          <Button onClick={() => setLocation("/")} style={{ backgroundColor: accentColor }} data-testid="button-go-to-dashboard">Go to Dashboard</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground" data-testid="text-org-name">{info.orgName}</p>
          <h1 className="text-2xl font-bold" data-testid="text-claim-title">Connect Your Subscription</h1>
        </div>

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold" data-testid="text-plan-name">{info.planName}</p>
              <p className="text-sm text-muted-foreground">Active Stripe subscription</p>
            </div>
            <Badge variant="secondary" className="text-green-600 bg-green-50 border-green-200" data-testid="badge-active">Active</Badge>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
            <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Your subscription billing email ends in <strong>{info.maskedEmail}</strong>
            </p>
          </div>
          <p className="text-sm text-muted-foreground border-t pt-3">
            Create a free account (or log in) to connect your existing subscription. No new payment needed.
          </p>
        </Card>

        {/* Tabs */}
        <div className="flex rounded-lg border overflow-hidden">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "signup" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setTab("signup")}
            data-testid="tab-create-account"
          >
            Create Account
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "login" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setTab("login")}
            data-testid="tab-log-in"
          >
            I Have an Account
          </button>
        </div>

        {tab === "signup" ? (
          <Card className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" data-testid="input-first-name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" data-testid="input-last-name" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" data-testid="input-email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" data-testid="input-password" />
            </div>
            <Button
              className="w-full"
              onClick={() => registerMutation.mutate()}
              disabled={registerMutation.isPending || !email || !password || !firstName || !lastName}
              style={{ backgroundColor: accentColor }}
              data-testid="button-create-and-claim"
            >
              {registerMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating account...</> : "Create Account & Connect Subscription"}
            </Button>
          </Card>
        ) : (
          <Card className="p-6 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="loginEmail">Email</Label>
              <Input id="loginEmail" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="jane@example.com" data-testid="input-login-email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loginPassword">Password</Label>
              <Input id="loginPassword" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Your password" data-testid="input-login-password" />
            </div>
            <Button
              className="w-full"
              onClick={() => loginAndClaimMutation.mutate()}
              disabled={loginAndClaimMutation.isPending || !loginEmail || !loginPassword}
              style={{ backgroundColor: accentColor }}
              data-testid="button-login-and-claim"
            >
              {loginAndClaimMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connecting...</> : "Log In & Connect Subscription"}
            </Button>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Your subscription is verified through Stripe. Your payment info is never stored on our servers.
        </p>
      </div>
    </div>
  );
}
