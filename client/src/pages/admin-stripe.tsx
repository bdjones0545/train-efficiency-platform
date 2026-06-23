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
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { Save, Key, Eye, EyeOff, CheckCircle2, XCircle, ExternalLink, RefreshCw, ShieldCheck, AlertTriangle, Wrench, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { SiStripe } from "react-icons/si";

type AuditPayment = {
  stripePaymentIntentId: string;
  chargeId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  stripeCustomerId: string | null;
  amountCents: number;
  currency: string;
  createdAt: number;
  matchedUserId: string | null;
  matchedUserEmail: string | null;
  hasLedgerEntry: boolean;
  ledgerTxId: string | null;
};

type AuditOrg = {
  orgId: string | null;
  orgName: string;
  stripeAccountType: "platform" | "org";
  totalPayments: number;
  creditedPayments: number;
  missingCredits: number;
  unmatchedPayments: number;
  totalMissingCents: number;
  payments: AuditPayment[];
};

type AuditResult = {
  orgs: AuditOrg[];
  summary: {
    totalOrgs: number;
    healthyOrgs: number;
    orgsWithMissingCredits: number;
    totalPayments: number;
    totalCredited: number;
    totalMissing: number;
    totalMissingCents: number;
    totalUnmatched: number;
  };
};

type RepairResult = {
  dryRun: boolean;
  repaired: Array<{
    orgId: string | null;
    orgName: string;
    stripePaymentIntentId: string;
    userId: string;
    userEmail: string | null;
    amountCents: number;
    currency: string;
    action: "credited" | "skipped" | "no_user_match";
  }>;
  summary: { total: number; credited: number; skipped: number; noMatch: number };
};

function StripeWalletSyncPanel() {
  const { toast } = useToast();
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [days, setDays] = useState("90");

  const auditMutation = useMutation({
    mutationFn: async () => {
      return authenticatedFetch<AuditResult>(`/api/admin/platform-stripe-wallet-sync-audit?days=${days}`);
    },
    onSuccess: (data) => {
      setAuditResult(data);
      setRepairResult(null);
      const missing = data.summary.totalMissing;
      toast({
        title: missing === 0 ? "All payments credited" : `${missing} missing credit${missing !== 1 ? "s" : ""} found`,
        description: `Scanned ${data.summary.totalPayments} payments across ${data.summary.totalOrgs} Stripe account${data.summary.totalOrgs !== 1 ? "s" : ""}`,
        variant: missing === 0 ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Audit failed", description: err.message, variant: "destructive" }),
  });

  const repairMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("POST", "/api/admin/platform-stripe-wallet-sync-repair", { dryRun, days: parseInt(days) });
      return res.json() as Promise<RepairResult>;
    },
    onSuccess: (data) => {
      setRepairResult(data);
      const credited = data.summary.credited;
      if (data.dryRun) {
        toast({ title: `Dry run complete — ${credited} credit${credited !== 1 ? "s" : ""} would be applied` });
      } else {
        toast({
          title: credited > 0 ? `${credited} wallet credit${credited !== 1 ? "s" : ""} applied` : "No missing credits found",
          variant: credited > 0 ? "default" : "default",
        });
        auditMutation.mutate();
      }
    },
    onError: (err: Error) => toast({ title: "Repair failed", description: err.message, variant: "destructive" }),
  });

  const toggleOrg = (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      next.has(orgId) ? next.delete(orgId) : next.add(orgId);
      return next;
    });
  };

  const summary = auditResult?.summary;
  const isRunning = auditMutation.isPending || repairMutation.isPending;

  return (
    <section className="space-y-4" data-testid="section-wallet-sync-health">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Stripe Wallet Sync Health
        </h2>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Last</Label>
          <Input
            type="number"
            value={days}
            onChange={e => setDays(e.target.value)}
            className="w-16 h-8 text-sm"
            min="1"
            max="365"
            data-testid="input-audit-days"
          />
          <Label className="text-xs text-muted-foreground">days</Label>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-healthy-orgs">{summary.healthyOrgs}</p>
            <p className="text-xs text-muted-foreground">Healthy Orgs</p>
          </Card>
          <Card className="p-3 text-center">
            <p className={`text-2xl font-bold ${summary.orgsWithMissingCredits > 0 ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-orgs-missing">{summary.orgsWithMissingCredits}</p>
            <p className="text-xs text-muted-foreground">Orgs w/ Missing Credits</p>
          </Card>
          <Card className="p-3 text-center">
            <p className={`text-2xl font-bold ${summary.totalUnmatched > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`} data-testid="text-unmatched">{summary.totalUnmatched}</p>
            <p className="text-xs text-muted-foreground">Unmatched Payments</p>
          </Card>
          <Card className="p-3 text-center">
            <p className={`text-2xl font-bold ${summary.totalMissingCents > 0 ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-missing-amount">${(summary.totalMissingCents / 100).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Unreconciled Amount</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => auditMutation.mutate()}
          disabled={isRunning}
          data-testid="button-run-audit"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${auditMutation.isPending ? "animate-spin" : ""}`} />
          {auditMutation.isPending ? "Auditing…" : "Run Dry Audit"}
        </Button>
        <Button
          variant="outline"
          onClick={() => repairMutation.mutate(true)}
          disabled={isRunning}
          data-testid="button-dry-repair"
        >
          <Wrench className="h-4 w-4 mr-2" />
          {repairMutation.isPending && repairResult === null ? "Running…" : "Dry Run Repair"}
        </Button>
        <Button
          onClick={() => repairMutation.mutate(false)}
          disabled={isRunning}
          data-testid="button-repair"
        >
          <Wrench className="h-4 w-4 mr-2" />
          {repairMutation.isPending ? "Repairing…" : "Repair Missing Credits"}
        </Button>
      </div>

      {auditResult && (
        <div className="space-y-3">
          {auditResult.orgs.map((org, i) => {
            const key = org.orgId || "platform";
            const isExpanded = expandedOrgs.has(key);
            const isHealthy = org.missingCredits === 0 && org.unmatchedPayments === 0;
            return (
              <Card key={key} className="overflow-hidden" data-testid={`card-org-sync-${key}`}>
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/40 transition-colors text-left"
                  onClick={() => toggleOrg(key)}
                  data-testid={`button-expand-org-${key}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{org.orgName}</p>
                      <p className="text-xs text-muted-foreground">{org.totalPayments} payments</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {isHealthy ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Healthy
                      </Badge>
                    ) : (
                      <>
                        {org.missingCredits > 0 && (
                          <Badge variant="destructive" className="text-xs" data-testid={`badge-missing-${key}`}>
                            {org.missingCredits} missing
                          </Badge>
                        )}
                        {org.unmatchedPayments > 0 && (
                          <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs" data-testid={`badge-unmatched-${key}`}>
                            {org.unmatchedPayments} unmatched
                          </Badge>
                        )}
                      </>
                    )}
                    {org.totalMissingCents > 0 && (
                      <span className="text-xs font-semibold text-destructive">${(org.totalMissingCents / 100).toFixed(2)}</span>
                    )}
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t divide-y">
                    {org.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No payments found</p>
                    ) : (
                      org.payments.map(p => (
                        <div key={p.stripePaymentIntentId} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-testid={`row-payment-${p.stripePaymentIntentId}`}>
                          <div className="min-w-0">
                            <p className="text-xs font-mono text-muted-foreground truncate">{p.stripePaymentIntentId}</p>
                            <p className="text-sm font-medium">
                              {p.customerEmail || p.customerName || <span className="text-muted-foreground italic">Unknown customer</span>}
                            </p>
                            {p.matchedUserId && p.matchedUserEmail !== p.customerEmail && (
                              <p className="text-xs text-muted-foreground">→ matched: {p.matchedUserEmail}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold">${(p.amountCents / 100).toFixed(2)}</span>
                            {p.hasLedgerEntry ? (
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">Credited</Badge>
                            ) : p.matchedUserId ? (
                              <Badge variant="destructive" className="text-xs">Missing</Badge>
                            ) : (
                              <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">No Match</Badge>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {repairResult && (
        <Card className="p-4 space-y-3" data-testid="card-repair-result">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{repairResult.dryRun ? "Dry Run Results" : "Repair Results"}</h3>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-xs">{repairResult.summary.credited} {repairResult.dryRun ? "would credit" : "credited"}</Badge>
              <Badge variant="secondary" className="text-xs">{repairResult.summary.skipped} skipped</Badge>
              {repairResult.summary.noMatch > 0 && <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">{repairResult.summary.noMatch} no match</Badge>}
            </div>
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {repairResult.repaired.filter(r => r.action !== "skipped").map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                <span className="truncate text-muted-foreground font-mono">{r.stripePaymentIntentId}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs">{r.userEmail || r.userId || "—"}</span>
                  <span className="font-semibold">${(r.amountCents / 100).toFixed(2)}</span>
                  {r.action === "credited" ? (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">{repairResult.dryRun ? "Would Credit" : "Credited"}</Badge>
                  ) : (
                    <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">No Match</Badge>
                  )}
                </div>
              </div>
            ))}
            {repairResult.repaired.filter(r => r.action !== "skipped").length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">All payments already credited — nothing to repair.</p>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}

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

      <Separator />

      <StripeWalletSyncPanel />
    </div>
  );
}
