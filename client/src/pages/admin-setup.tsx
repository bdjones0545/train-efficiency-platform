import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ChevronRight, Image, Link2, Type, Globe, Key, Eye, EyeOff,
  CheckCircle2, ArrowRight, Paintbrush, Settings, CreditCard,
} from "lucide-react";
import { SiInstagram, SiFacebook, SiStripe } from "react-icons/si";
import type { Organization } from "@shared/schema";

type Step = 1 | 2 | 3;

export default function AdminSetupPage() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<Step>(1);

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: org } = useQuery<Organization & { stripeConnected?: boolean }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [tagline2, setTagline2] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");

  const [serviceName, setServiceName] = useState("");
  const [serviceDesc, setServiceDesc] = useState("");
  const [serviceDuration, setServiceDuration] = useState("60");
  const [servicePrice, setServicePrice] = useState("50");

  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const [brandingInitialized, setBrandingInitialized] = useState(false);

  if (org && !brandingInitialized) {
    setName(org.name || "");
    setLogoUrl(org.logoUrl || "");
    setTagline(org.tagline || "");
    setTagline2(org.tagline2 || "");
    setWebsiteUrl(org.websiteUrl || "");
    setInstagramUrl(org.instagramUrl || "");
    setFacebookUrl(org.facebookUrl || "");
    setBrandingInitialized(true);
  }

  const updateOrgMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createServiceMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/admin/services", data);
      return res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSaveBranding = () => {
    updateOrgMutation.mutate(
      {
        name,
        logoUrl: logoUrl || null,
        tagline,
        tagline2,
        websiteUrl: websiteUrl || null,
        instagramUrl: instagramUrl || null,
        facebookUrl: facebookUrl || null,
      },
      {
        onSuccess: () => {
          toast({ title: "Branding saved!" });
          setCurrentStep(2);
        },
      }
    );
  };

  const handleSaveService = () => {
    if (!serviceName.trim()) {
      toast({ title: "Please enter a service name", variant: "destructive" });
      return;
    }
    createServiceMutation.mutate(
      {
        name: serviceName.trim(),
        description: serviceDesc.trim() || serviceName.trim(),
        durationMin: parseInt(serviceDuration) || 60,
        priceCents: Math.round((parseFloat(servicePrice) || 50) * 100),
        active: true,
        sessionType: "1_ON_1",
      },
      {
        onSuccess: () => {
          toast({ title: "Training option created!" });
          setCurrentStep(3);
        },
      }
    );
  };

  const handleSaveStripe = () => {
    if (stripePublishableKey && !stripePublishableKey.startsWith("pk_")) {
      toast({ title: "Publishable key should start with pk_", variant: "destructive" });
      return;
    }
    if (stripeSecretKey && !stripeSecretKey.startsWith("sk_")) {
      toast({ title: "Secret key should start with sk_", variant: "destructive" });
      return;
    }
    if (!stripePublishableKey || !stripeSecretKey) {
      window.location.href = "/coach";
      return;
    }
    updateOrgMutation.mutate(
      {
        stripePublishableKey,
        stripeSecretKey,
      },
      {
        onSuccess: () => {
          toast({ title: "Stripe connected! Taking you to your dashboard..." });
          setTimeout(() => { window.location.href = "/coach"; }, 1000);
        },
      }
    );
  };

  const goToDashboard = () => {
    window.location.href = "/coach";
  };

  const steps = [
    { num: 1, label: "Branding", icon: Paintbrush },
    { num: 2, label: "Options", icon: Settings },
    { num: 3, label: "Stripe", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-background flex items-start justify-center pt-12 px-4">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" data-testid="text-setup-title">Set Up Your Platform</h1>
          <p className="text-sm text-muted-foreground">Let's get your business ready for clients</p>
        </div>

        <div className="flex items-center justify-center gap-2">
          {steps.map((step, i) => (
            <div key={step.num} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  currentStep === step.num
                    ? "bg-primary text-primary-foreground"
                    : currentStep > step.num
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {currentStep > step.num ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <step.icon className="h-3.5 w-3.5" />
                )}
                {step.label}
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {currentStep === 1 && (
          <Card className="p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Paintbrush className="h-5 w-5" />
                Customize Your Brand
              </h2>
              <p className="text-sm text-muted-foreground">Set up how your platform looks to clients</p>
            </div>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Business Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" data-testid="input-setup-name" />
              </div>
              <div className="space-y-2">
                <Label>Logo URL</Label>
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" data-testid="input-setup-logo" />
                {logoUrl && (
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg border flex items-center justify-center overflow-hidden bg-muted">
                      <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                    <span className="text-xs text-muted-foreground">Preview</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tagline 1</Label>
                  <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Your main slogan" data-testid="input-setup-tagline1" />
                </div>
                <div className="space-y-2">
                  <Label>Tagline 2</Label>
                  <Input value={tagline2} onChange={(e) => setTagline2(e.target.value)} placeholder="Supporting text" data-testid="input-setup-tagline2" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Website</Label>
                <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://yoursite.com" data-testid="input-setup-website" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5"><SiInstagram className="h-3.5 w-3.5" /> Instagram</Label>
                  <Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/..." data-testid="input-setup-instagram" />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5"><SiFacebook className="h-3.5 w-3.5" /> Facebook</Label>
                  <Input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} placeholder="https://facebook.com/..." data-testid="input-setup-facebook" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" onClick={() => setCurrentStep(2)} data-testid="button-setup-skip-1">
                Set up later
              </Button>
              <Button onClick={handleSaveBranding} disabled={updateOrgMutation.isPending} data-testid="button-setup-save-1">
                {updateOrgMutation.isPending ? "Saving..." : "Save & Continue"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {currentStep === 2 && (
          <Card className="p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Create a Training Option
              </h2>
              <p className="text-sm text-muted-foreground">Add at least one service your clients can book. You can add more later.</p>
            </div>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Service Name</Label>
                <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="e.g. Personal Training, Speed Session" data-testid="input-setup-service-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={serviceDesc} onChange={(e) => setServiceDesc(e.target.value)} placeholder="Brief description of this service" data-testid="input-setup-service-desc" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Duration (minutes)</Label>
                  <Input type="number" value={serviceDuration} onChange={(e) => setServiceDuration(e.target.value)} min="15" max="240" data-testid="input-setup-service-duration" />
                </div>
                <div className="space-y-2">
                  <Label>Price ($)</Label>
                  <Input type="number" value={servicePrice} onChange={(e) => setServicePrice(e.target.value)} min="0" step="0.01" data-testid="input-setup-service-price" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" onClick={() => setCurrentStep(3)} data-testid="button-setup-skip-2">
                Set up later
              </Button>
              <Button onClick={handleSaveService} disabled={createServiceMutation.isPending} data-testid="button-setup-save-2">
                {createServiceMutation.isPending ? "Creating..." : "Create & Continue"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {currentStep === 3 && (
          <Card className="p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <SiStripe className="h-5 w-5 text-[#635bff]" />
                Connect Stripe
              </h2>
              <p className="text-sm text-muted-foreground">Connect your Stripe account so clients can add funds to their wallet</p>
            </div>
            <Separator />
            <div className="bg-muted/50 border rounded-lg p-3 text-sm text-muted-foreground">
              <p>
                Find your API keys in your{" "}
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Stripe Dashboard
                </a>
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Publishable Key</Label>
                <Input value={stripePublishableKey} onChange={(e) => setStripePublishableKey(e.target.value)} placeholder="pk_live_... or pk_test_..." className="font-mono text-sm" data-testid="input-setup-stripe-pk" />
              </div>
              <div className="space-y-2">
                <Label>Secret Key</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? "text" : "password"}
                    value={stripeSecretKey}
                    onChange={(e) => setStripeSecretKey(e.target.value)}
                    placeholder="sk_live_... or sk_test_..."
                    className="font-mono text-sm pr-10"
                    data-testid="input-setup-stripe-sk"
                  />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" data-testid="button-setup-toggle-secret">
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" onClick={goToDashboard} data-testid="button-setup-skip-3">
                Set up later
              </Button>
              <Button onClick={handleSaveStripe} disabled={updateOrgMutation.isPending} data-testid="button-setup-save-3">
                {updateOrgMutation.isPending ? "Connecting..." : stripePublishableKey && stripeSecretKey ? "Connect & Finish" : "Finish Setup"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          You can always change these settings later from your Configuration menu.
        </p>
      </div>
    </div>
  );
}
