import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Key, Eye, EyeOff, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { SiStripe } from "react-icons/si";

export default function AdminStripePage() {
  const { toast } = useToast();

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: org, isLoading } = useQuery<{
    stripePublishableKey?: string | null;
    stripeConnected?: boolean;
  }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (org) {
      setPublishableKey(org.stripePublishableKey || "");
      setSecretKey("");
      setHasChanges(false);
    }
  }, [org]);

  const markChanged = () => setHasChanges(true);

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, string | null>) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Stripe settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
      setHasChanges(false);
      setSecretKey("");
      setShowSecret(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!publishableKey.startsWith("pk_")) {
      toast({ title: "Invalid Key", description: "Publishable key should start with pk_", variant: "destructive" });
      return;
    }
    if (secretKey && !secretKey.startsWith("sk_") && !secretKey.startsWith("rk_")) {
      toast({ title: "Invalid Key", description: "Secret key should start with sk_ or rk_", variant: "destructive" });
      return;
    }

    const payload: Record<string, string | null> = {
      stripePublishableKey: publishableKey,
    };
    if (secretKey) {
      payload.stripeSecretKey = secretKey;
    }
    updateMutation.mutate(payload);
  };

  const handleDisconnect = () => {
    updateMutation.mutate({
      stripeSecretKey: "",
      stripePublishableKey: "",
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Stripe</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isConnected = org?.stripeConnected;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-stripe-title">
            <SiStripe className="h-6 w-6 text-[#635bff]" />
            Stripe
          </h1>
          <p className="text-sm text-muted-foreground">Connect your Stripe account to handle billing</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || !hasChanges}
          data-testid="button-save-stripe"
        >
          <Save className="h-4 w-4 mr-2" />
          {updateMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      <Separator />

      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium">Connection Status</span>
          </div>
          {isConnected ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid="badge-stripe-connected">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground" data-testid="badge-stripe-disconnected">
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Not Connected
            </Badge>
          )}
        </div>
        {isConnected && (
          <p className="text-xs text-muted-foreground">
            Your Stripe account is connected and ready to process payments.
          </p>
        )}
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Keys
        </h2>
        <Card className="p-4 space-y-4">
          <div className="bg-muted/50 border rounded-lg p-3 text-sm text-muted-foreground space-y-1">
            <p>
              Find your API keys in your{" "}
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
                data-testid="link-stripe-dashboard"
              >
                Stripe Dashboard
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <p>Use your <strong>live</strong> keys for production or <strong>test</strong> keys while setting up.</p>
          </div>

          <div className="space-y-2">
            <Label>Publishable Key</Label>
            <Input
              value={publishableKey}
              onChange={(e) => { setPublishableKey(e.target.value); markChanged(); }}
              placeholder="pk_live_... or pk_test_..."
              className="font-mono text-sm"
              data-testid="input-stripe-publishable-key"
            />
          </div>

          <div className="space-y-2">
            <Label>Secret Key</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={secretKey}
                onChange={(e) => { setSecretKey(e.target.value); markChanged(); }}
                placeholder={isConnected ? "••••••••  (leave blank to keep current)" : "sk_live_..., sk_test_..., or rk_live_..."}
                className="font-mono text-sm pr-10"
                data-testid="input-stripe-secret-key"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-secret"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your secret key is encrypted and never displayed after saving.
            </p>
          </div>
        </Card>
      </section>

      {isConnected && (
        <>
          <Separator />
          <section className="space-y-4">
            <Card className="p-4 border-destructive/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Disconnect Stripe</p>
                  <p className="text-xs text-muted-foreground">Remove your Stripe keys from this organization.</p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={updateMutation.isPending}
                  data-testid="button-disconnect-stripe"
                >
                  Disconnect
                </Button>
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
