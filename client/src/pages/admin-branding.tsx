import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Image, Link2, Type, ExternalLink, Globe } from "lucide-react";
import { SiInstagram, SiFacebook } from "react-icons/si";
import type { Organization } from "@shared/schema";

export default function AdminBrandingPage() {
  const { toast } = useToast();

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;

  const { data: org, isLoading } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [tagline2, setTagline2] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name || "");
      setSlug(org.slug || "");
      setLogoUrl(org.logoUrl || "");
      setTagline(org.tagline || "");
      setTagline2(org.tagline2 || "");
      setWebsiteUrl(org.websiteUrl || "");
      setInstagramUrl(org.instagramUrl || "");
      setFacebookUrl(org.facebookUrl || "");
      setHasChanges(false);
    }
  }, [org]);

  const markChanged = () => setHasChanges(true);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Organization>) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
      setHasChanges(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getSavePayload = () => {
    const cleanSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!cleanSlug) {
      toast({ title: "URL slug is required", description: "Please enter a URL slug for your organization (e.g. 'my-gym').", variant: "destructive" });
      return null;
    }

    if (logoUrl && !logoUrl.match(/^https?:\/\/.+/i)) {
      toast({ title: "Invalid logo URL", description: "Logo URL must start with http:// or https://", variant: "destructive" });
      return null;
    }

    return {
      name,
      slug: cleanSlug,
      logoUrl: logoUrl || null,
      tagline,
      tagline2,
      websiteUrl: websiteUrl || null,
      instagramUrl: instagramUrl || null,
      facebookUrl: facebookUrl || null,
    };
  };

  const handleSave = () => {
    const payload = getSavePayload();
    if (!payload) return;
    updateMutation.mutate(payload as Partial<Organization>, {
      onSuccess: () => {
        toast({ title: "Branding updated successfully" });
      },
    });
  };

  const handlePreview = () => {
    const payload = getSavePayload();
    if (!payload) return;
    const previewWindow = window.open("", "_blank");
    updateMutation.mutate(payload as Partial<Organization>, {
      onSuccess: () => {
        toast({ title: "Changes saved" });
        if (previewWindow) {
          previewWindow.location.href = `/org/${payload.slug}`;
        }
      },
      onError: () => {
        if (previewWindow) previewWindow.close();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Branding</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-branding-title">Branding</h1>
          <p className="text-sm text-muted-foreground">Customize your organization's look and feel</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={updateMutation.isPending}
            data-testid="button-preview-landing"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges}
            data-testid="button-save-branding"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Type className="h-5 w-5" />
          Organization Name
        </h2>
        <Card className="p-4">
          <div className="space-y-2">
            <Label>Business Name</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); markChanged(); }}
              placeholder="Your business name"
              data-testid="input-org-name"
            />
          </div>
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Image className="h-5 w-5" />
          Logo
        </h2>
        <Card className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => { setLogoUrl(e.target.value); markChanged(); }}
              placeholder="https://example.com/your-logo.png"
              data-testid="input-logo-url"
            />
            <p className="text-xs text-muted-foreground">
              Paste a direct link to your logo image. Recommended size: 200x200px or larger.
            </p>
          </div>
          {logoUrl && (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg border flex items-center justify-center overflow-hidden bg-muted">
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  data-testid="img-logo-preview"
                />
              </div>
              <span className="text-sm text-muted-foreground">Preview</span>
            </div>
          )}
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          URL Extension
        </h2>
        <Card className="p-4 space-y-2">
          <Label>Landing Page URL</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">/org/</span>
            <Input
              value={slug}
              onChange={(e) => { setSlug(e.target.value); markChanged(); }}
              placeholder="your-business-name"
              data-testid="input-slug"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This is the URL where clients will find your landing page. Only lowercase letters, numbers, and hyphens.
          </p>
          {slug && (
            <p className="text-sm font-medium" data-testid="text-slug-preview">
              Your page: /org/{slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}
            </p>
          )}
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Type className="h-5 w-5" />
          Taglines
        </h2>
        <Card className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Tagline 1 (Main)</Label>
            <Input
              value={tagline}
              onChange={(e) => { setTagline(e.target.value); markChanged(); }}
              placeholder="Your primary tagline or slogan"
              data-testid="input-tagline-1"
            />
            <p className="text-xs text-muted-foreground">
              Displayed prominently on your landing page hero section.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Tagline 2 (Secondary)</Label>
            <Input
              value={tagline2}
              onChange={(e) => { setTagline2(e.target.value); markChanged(); }}
              placeholder="A supporting description or subtitle"
              data-testid="input-tagline-2"
            />
            <p className="text-xs text-muted-foreground">
              Displayed below the main tagline for additional context.
            </p>
          </div>
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Social Links
        </h2>
        <Card className="p-4 space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Website
            </Label>
            <Input
              value={websiteUrl}
              onChange={(e) => { setWebsiteUrl(e.target.value); markChanged(); }}
              placeholder="https://yourwebsite.com"
              data-testid="input-website-url"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <SiInstagram className="h-4 w-4" />
              Instagram
            </Label>
            <Input
              value={instagramUrl}
              onChange={(e) => { setInstagramUrl(e.target.value); markChanged(); }}
              placeholder="https://instagram.com/yourbusiness"
              data-testid="input-instagram-url"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <SiFacebook className="h-4 w-4" />
              Facebook
            </Label>
            <Input
              value={facebookUrl}
              onChange={(e) => { setFacebookUrl(e.target.value); markChanged(); }}
              placeholder="https://facebook.com/yourbusiness"
              data-testid="input-facebook-url"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            These links will appear on your landing page so visitors can find you on the web.
          </p>
        </Card>
      </section>

    </div>
  );
}
