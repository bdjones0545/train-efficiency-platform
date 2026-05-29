import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, Image, Link2, Type, ExternalLink, Globe, Mail, Share2 } from "lucide-react";
import { SiInstagram, SiFacebook, SiYoutube, SiTiktok } from "react-icons/si";
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [linktreeUrl, setLinktreeUrl] = useState("");
  const [emailPrimaryColor, setEmailPrimaryColor] = useState("");
  const [emailSecondaryColor, setEmailSecondaryColor] = useState("");
  const [socialPreviewImageUrl, setSocialPreviewImageUrl] = useState("");
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
      setYoutubeUrl(org.youtubeUrl || "");
      setTiktokUrl(org.tiktokUrl || "");
      setLinktreeUrl(org.linktreeUrl || "");
      setEmailPrimaryColor(org.emailPrimaryColor || "");
      setEmailSecondaryColor(org.emailSecondaryColor || "");
      setSocialPreviewImageUrl((org as any).socialPreviewImageUrl || "");
      setHasChanges(false);
    }
  }, [org]);

  const markChanged = () => setHasChanges(true);

  const normalizeUrl = (value: string): string => {
    if (!value || !value.trim()) return value;
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

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
      youtubeUrl: youtubeUrl || null,
      tiktokUrl: tiktokUrl || null,
      linktreeUrl: linktreeUrl || null,
      emailPrimaryColor: emailPrimaryColor || null,
      emailSecondaryColor: emailSecondaryColor || null,
      socialPreviewImageUrl: socialPreviewImageUrl || null,
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
      <div className="w-full min-w-0 overflow-x-hidden px-4 sm:px-6 py-6 space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Branding</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-x-hidden px-4 sm:px-6 py-6 pb-24 space-y-6 max-w-2xl">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-branding-title">Branding</h1>
          <p className="text-sm text-muted-foreground">Customize your organization's look and feel</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={updateMutation.isPending}
            className="w-full sm:w-auto"
            data-testid="button-preview-landing"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending || !hasChanges}
            className="w-full sm:w-auto"
            data-testid="button-save-branding"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── Identity ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Type className="h-5 w-5 shrink-0" />
          Identity
        </h2>
        <Card className="p-4 w-full">
          <div className="space-y-2">
            <Label>Business Name</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); markChanged(); }}
              placeholder="Your business name"
              className="w-full min-w-0"
              data-testid="input-org-name"
            />
          </div>
        </Card>
      </section>

      <Separator />

      {/* ── Logo ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Image className="h-5 w-5 shrink-0" />
          Logo
        </h2>
        <Card className="p-4 space-y-4 w-full">
          <div className="space-y-2">
            <Label>Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => { setLogoUrl(e.target.value); markChanged(); }}
              placeholder="https://example.com/your-logo.png"
              className="w-full min-w-0"
              data-testid="input-logo-url"
            />
            <p className="text-xs text-muted-foreground">
              Paste a direct link to your logo image. Recommended size: 200×200px or larger.
            </p>
          </div>
          {logoUrl && (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 shrink-0 rounded-lg border flex items-center justify-center overflow-hidden bg-muted">
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

      {/* ── Social Preview ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Share2 className="h-5 w-5 shrink-0" />
          Social Preview
        </h2>
        <Card className="p-4 space-y-4 w-full">
          <p className="text-sm text-muted-foreground">
            When your landing page is shared on iMessage, Facebook, LinkedIn, or X, this image appears in the link preview card. For best results, use a 1200×630px image.
          </p>
          <div className="space-y-2">
            <Label>Social Preview Image URL</Label>
            <Input
              value={socialPreviewImageUrl}
              onChange={(e) => { setSocialPreviewImageUrl(e.target.value); markChanged(); }}
              placeholder="https://example.com/your-preview-image.png"
              className="w-full min-w-0"
              data-testid="input-social-preview-image-url"
            />
            <p className="text-xs text-muted-foreground">
              Must be a full URL starting with https://. Falls back to your logo, then the default TrainEfficiency preview.
            </p>
          </div>
          {socialPreviewImageUrl && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <div className="rounded-lg border overflow-hidden w-full max-w-sm">
                <img
                  src={socialPreviewImageUrl}
                  alt="Social preview"
                  className="w-full h-auto object-cover"
                  style={{ aspectRatio: "1200/630" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  data-testid="img-social-preview"
                />
              </div>
            </div>
          )}
        </Card>
      </section>

      <Separator />

      {/* ── URL ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Link2 className="h-5 w-5 shrink-0" />
          URL
        </h2>
        <Card className="p-4 space-y-2 w-full">
          <Label>Landing Page URL</Label>
          <div className="flex items-center gap-2 w-full min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">/org/</span>
            <Input
              value={slug}
              onChange={(e) => { setSlug(e.target.value); markChanged(); }}
              placeholder="your-business-name"
              className="flex-1 min-w-0 w-full"
              data-testid="input-slug"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This is the URL where clients will find your landing page. Only lowercase letters, numbers, and hyphens.
          </p>
          {slug && (
            <p className="text-sm font-medium break-all" data-testid="text-slug-preview">
              Your page: /org/{slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}
            </p>
          )}
        </Card>
      </section>

      <Separator />

      {/* ── Taglines ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Type className="h-5 w-5 shrink-0" />
          Taglines
        </h2>
        <Card className="p-4 space-y-4 w-full">
          <div className="space-y-2">
            <Label>Tagline 1 (Main)</Label>
            <Input
              value={tagline}
              onChange={(e) => { setTagline(e.target.value); markChanged(); }}
              placeholder="Your primary tagline or slogan"
              className="w-full min-w-0"
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
              className="w-full min-w-0"
              data-testid="input-tagline-2"
            />
            <p className="text-xs text-muted-foreground">
              Displayed below the main tagline for additional context.
            </p>
          </div>
        </Card>
      </section>

      <Separator />

      {/* ── Social Links ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 shrink-0" />
            Social Links
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add the links visitors should see on your landing page.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "Website", icon: <Globe className="h-3.5 w-3.5 shrink-0" />, value: websiteUrl, setter: setWebsiteUrl, placeholder: "https://yourwebsite.com", testId: "input-website-url" },
            { label: "Instagram", icon: <SiInstagram className="h-3.5 w-3.5 shrink-0" />, value: instagramUrl, setter: setInstagramUrl, placeholder: "instagram.com/yourhandle", testId: "input-instagram-url" },
            { label: "Facebook", icon: <SiFacebook className="h-3.5 w-3.5 shrink-0" />, value: facebookUrl, setter: setFacebookUrl, placeholder: "facebook.com/yourpage", testId: "input-facebook-url" },
            { label: "YouTube", icon: <SiYoutube className="h-3.5 w-3.5 shrink-0" />, value: youtubeUrl, setter: setYoutubeUrl, placeholder: "youtube.com/@yourchannel", testId: "input-youtube-url" },
            { label: "TikTok", icon: <SiTiktok className="h-3.5 w-3.5 shrink-0" />, value: tiktokUrl, setter: setTiktokUrl, placeholder: "tiktok.com/@yourhandle", testId: "input-tiktok-url" },
            { label: "Linktree", icon: <ExternalLink className="h-3.5 w-3.5 shrink-0" />, value: linktreeUrl, setter: setLinktreeUrl, placeholder: "linktr.ee/yourhandle", testId: "input-linktree-url" },
          ].map(({ label, icon, value, setter, placeholder, testId }) => (
            <Card key={label} className="p-3 space-y-2 w-full min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {icon}
                {label}
              </div>
              <Input
                value={value}
                onChange={(e) => { setter(e.target.value); markChanged(); }}
                onBlur={(e) => { const n = normalizeUrl(e.target.value); if (n !== e.target.value) { setter(n); markChanged(); } }}
                placeholder={placeholder}
                className="h-8 text-xs w-full min-w-0"
                data-testid={testId}
              />
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── Email Colors ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Mail className="h-5 w-5 shrink-0" />
          Email Colors
        </h2>
        <Card className="p-4 space-y-4 w-full">
          <p className="text-sm text-muted-foreground">
            Customize the colors used in emails sent to your clients and teams. The primary color is used for the email header and buttons. The secondary color is used for detail box backgrounds.
          </p>

          <div className="space-y-2">
            <Label>Primary Color (Header &amp; Buttons)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={emailPrimaryColor || "#16a34a"}
                onChange={(e) => { setEmailPrimaryColor(e.target.value); markChanged(); }}
                className="w-10 h-10 shrink-0 rounded border cursor-pointer bg-transparent"
                data-testid="input-email-primary-color-picker"
              />
              <Input
                value={emailPrimaryColor}
                onChange={(e) => { setEmailPrimaryColor(e.target.value); markChanged(); }}
                placeholder="#16a34a"
                className="flex-1 min-w-0 max-w-[180px]"
                data-testid="input-email-primary-color"
              />
              {emailPrimaryColor && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEmailPrimaryColor(""); markChanged(); }}
                  data-testid="button-reset-email-primary"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Secondary Color (Detail Backgrounds)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={emailSecondaryColor || "#1a1a1a"}
                onChange={(e) => { setEmailSecondaryColor(e.target.value); markChanged(); }}
                className="w-10 h-10 shrink-0 rounded border cursor-pointer bg-transparent"
                data-testid="input-email-secondary-color-picker"
              />
              <Input
                value={emailSecondaryColor}
                onChange={(e) => { setEmailSecondaryColor(e.target.value); markChanged(); }}
                placeholder="#1a1a1a"
                className="flex-1 min-w-0 max-w-[180px]"
                data-testid="input-email-secondary-color"
              />
              {emailSecondaryColor && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEmailSecondaryColor(""); markChanged(); }}
                  data-testid="button-reset-email-secondary"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-lg overflow-hidden border" data-testid="email-color-preview">
            <div style={{ background: emailPrimaryColor || "#16a34a", padding: "16px 24px" }}>
              <p className="text-white font-semibold text-sm">Email Header Preview</p>
            </div>
            <div style={{ background: "#111", padding: "16px 24px" }}>
              <p className="text-sm text-gray-300 mb-2">Sample email body text goes here.</p>
              <div style={{ background: emailSecondaryColor || "#1a1a1a", borderLeft: `4px solid ${emailPrimaryColor || "#16a34a"}`, borderRadius: "6px", padding: "12px 16px" }}>
                <p className="text-sm text-gray-300"><strong>Detail:</strong> Example content</p>
                <p className="text-sm text-gray-300"><strong>Amount:</strong> $150.00</p>
              </div>
              <div style={{ marginTop: "12px", textAlign: "center" as const }}>
                <span style={{ display: "inline-block", background: emailPrimaryColor || "#16a34a", color: "#fff", padding: "8px 24px", borderRadius: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Sample Button
                </span>
              </div>
            </div>
          </div>
        </Card>
      </section>

    </div>
  );
}
