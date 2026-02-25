import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Image, Link2, Type, Palette, ExternalLink } from "lucide-react";
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
  const [primaryColor, setPrimaryColor] = useState("#3b82f6");
  const [secondaryColor, setSecondaryColor] = useState("#1e40af");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name || "");
      setSlug(org.slug || "");
      setLogoUrl(org.logoUrl || "");
      setTagline(org.tagline || "");
      setTagline2(org.tagline2 || "");
      setPrimaryColor(org.primaryColor || "#3b82f6");
      setSecondaryColor(org.secondaryColor || "#1e40af");
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
      toast({ title: "Invalid URL", description: "Please enter a valid URL extension.", variant: "destructive" });
      return null;
    }

    return {
      name,
      slug: cleanSlug,
      logoUrl: logoUrl || null,
      tagline,
      tagline2,
      primaryColor,
      secondaryColor,
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
          <Palette className="h-5 w-5" />
          Theme Colors
        </h2>
        <Card className="p-4 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label>Primary Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => { setPrimaryColor(e.target.value); markChanged(); }}
                  className="w-12 h-12 rounded-lg border cursor-pointer"
                  data-testid="input-primary-color"
                />
                <div className="space-y-1">
                  <Input
                    value={primaryColor}
                    onChange={(e) => { setPrimaryColor(e.target.value); markChanged(); }}
                    placeholder="#3b82f6"
                    className="w-28 font-mono text-sm"
                    data-testid="input-primary-color-hex"
                  />
                  <p className="text-xs text-muted-foreground">Buttons & accents</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label>Secondary Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => { setSecondaryColor(e.target.value); markChanged(); }}
                  className="w-12 h-12 rounded-lg border cursor-pointer"
                  data-testid="input-secondary-color"
                />
                <div className="space-y-1">
                  <Input
                    value={secondaryColor}
                    onChange={(e) => { setSecondaryColor(e.target.value); markChanged(); }}
                    placeholder="#1e40af"
                    className="w-28 font-mono text-sm"
                    data-testid="input-secondary-color-hex"
                  />
                  <p className="text-xs text-muted-foreground">Gradients & hover</p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Preview</Label>
            <div
              className="rounded-lg p-6 text-white text-center"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
              }}
              data-testid="div-color-preview"
            >
              <p className="text-lg font-bold">{name || "Your Business Name"}</p>
              <p className="text-sm opacity-90">{tagline || "Your tagline here"}</p>
              {tagline2 && <p className="text-xs opacity-75 mt-1">{tagline2}</p>}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
