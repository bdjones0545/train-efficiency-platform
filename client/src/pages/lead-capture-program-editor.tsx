import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Eye, Copy, ExternalLink, BarChart2, Settings2, Image, Star,
  Users, Zap, Layout, BookOpen, Calendar, Palette, Loader2, Plus, Trash2,
  GripVertical, ChevronUp, ChevronDown, Check, AlertTriangle, Globe, Link2,
  TrendingUp, Target, Lightbulb, Smartphone, Monitor, RefreshCw, Upload,
  X, Award, Shield, Flame, Dumbbell
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Testimonial {
  id: string;
  athleteName: string;
  sport: string;
  quote: string;
  rating: number;
  photoUrl: string;
  featured: boolean;
}

interface WhoCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  order: number;
}

interface BenefitCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  accentColor: string;
}

interface FormField {
  id: string;
  label: string;
  enabled: boolean;
  required: boolean;
  type: "text" | "select" | "checkbox";
  options?: string[];
  custom?: boolean;
}

interface ExtendedConfig {
  testimonials?: Testimonial[];
  whoCards?: WhoCard[];
  urgencyBadge?: string;
  heroAlignment?: "left" | "center" | "right";
  overlayStrength?: number;
  videoBackgroundUrl?: string;
  accentColor?: string;
  gradientPreset?: string;
  buttonStyle?: "solid" | "outline" | "gradient";
  darkIntensity?: "light" | "medium" | "dark" | "ultra";
  typographyPreset?: "athletic" | "modern" | "bold" | "clean";
  bookingButtonText?: string;
  bookingRedirectOnSubmit?: boolean;
  formFields?: FormField[];
  aiRecs?: string[];
}

interface LeadCaptureConfig {
  id: string;
  programId: string;
  headline: string;
  subheadline: string;
  ctaText: string;
  heroImageUrl: string | null;
  benefits: BenefitCard[];
  socialProof: Testimonial[];
  whoIsThisFor: string;
  metaPixelId: string | null;
  googleAdsConversionId: string | null;
  googleAdsConversionLabel: string | null;
  bookingUrl: string | null;
  bookingType: string;
  estimatedAthleteValueCents: number;
  extendedConfig: ExtendedConfig;
}

interface ProgramStats {
  total: number;
  highIntent: number;
  conversionRate: number;
  lastSubmission: string | null;
}

interface FunnelData {
  pageViews: number;
  step1Starts: number;
  partialCaptures: number;
  completions: number;
  completionRate: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const ICON_OPTIONS = [
  { value: "Zap", label: "⚡ Lightning", icon: <Zap className="h-4 w-4" /> },
  { value: "Target", label: "🎯 Target", icon: <Target className="h-4 w-4" /> },
  { value: "Award", label: "🏆 Award", icon: <Award className="h-4 w-4" /> },
  { value: "Shield", label: "🛡 Shield", icon: <Shield className="h-4 w-4" /> },
  { value: "Flame", label: "🔥 Fire", icon: <Flame className="h-4 w-4" /> },
  { value: "Dumbbell", label: "💪 Dumbbell", icon: <Dumbbell className="h-4 w-4" /> },
  { value: "TrendingUp", label: "📈 Trending", icon: <TrendingUp className="h-4 w-4" /> },
  { value: "Users", label: "👥 Team", icon: <Users className="h-4 w-4" /> },
];

const GRADIENT_PRESETS = [
  { value: "orange-dark", label: "Orange Fire", preview: "from-orange-600 to-orange-900" },
  { value: "gold-black", label: "Gold & Black", preview: "from-yellow-500 to-gray-900" },
  { value: "red-dark", label: "Red Power", preview: "from-red-600 to-gray-900" },
  { value: "blue-dark", label: "Blue Elite", preview: "from-blue-600 to-gray-900" },
  { value: "purple-dark", label: "Purple Champion", preview: "from-purple-600 to-gray-900" },
  { value: "green-dark", label: "Green Hustle", preview: "from-green-600 to-gray-900" },
];

const DEFAULT_FORM_FIELDS: FormField[] = [
  { id: "athleteName", label: "Athlete Name", enabled: true, required: true, type: "text" },
  { id: "parentName", label: "Parent / Guardian Name", enabled: true, required: false, type: "text" },
  { id: "email", label: "Email Address", enabled: true, required: true, type: "text" },
  { id: "phone", label: "Phone Number", enabled: true, required: false, type: "text" },
  { id: "age", label: "Age", enabled: true, required: false, type: "text" },
  { id: "grade", label: "Grade / Year", enabled: true, required: false, type: "text" },
  { id: "sport", label: "Primary Sport", enabled: true, required: false, type: "text" },
  { id: "position", label: "Position", enabled: false, required: false, type: "text" },
  { id: "school", label: "School / Team", enabled: true, required: false, type: "text" },
  { id: "experienceLevel", label: "Experience Level", enabled: true, required: false, type: "select", options: ["Beginner", "Intermediate", "Advanced", "Elite"] },
  { id: "commitmentLevel", label: "Commitment Level", enabled: true, required: false, type: "select", options: ["1-2x/week", "3-4x/week", "5+/week", "Full Program"] },
  { id: "goals", label: "Athletic Goals", enabled: true, required: false, type: "checkbox", options: ["Speed", "Strength", "Agility", "Endurance", "Injury Prevention"] },
  { id: "notes", label: "Additional Notes", enabled: true, required: false, type: "text" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-xl min-w-[90px]">
      <span className="text-lg font-bold text-orange-400">{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
      {sub && <span className="text-[10px] text-muted-foreground/60">{sub}</span>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400 mt-0.5">{icon}</div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadCaptureProgramEditorPage() {
  const { programId } = useParams<{ programId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [unsaved, setUnsaved] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── form state
  const [headline, setHeadline] = useState("Train Like an Elite Athlete");
  const [subheadline, setSubheadline] = useState("Apply now and take the first step toward your athletic potential.");
  const [ctaText, setCtaText] = useState("Apply Now");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [urgencyBadge, setUrgencyBadge] = useState("");
  const [heroAlignment, setHeroAlignment] = useState<"left" | "center" | "right">("center");
  const [overlayStrength, setOverlayStrength] = useState(60);
  const [videoBackgroundUrl, setVideoBackgroundUrl] = useState("");

  const [benefits, setBenefits] = useState<BenefitCard[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [whoCards, setWhoCards] = useState<WhoCard[]>([]);
  const [formFields, setFormFields] = useState<FormField[]>(DEFAULT_FORM_FIELDS);

  const [bookingUrl, setBookingUrl] = useState("");
  const [bookingType, setBookingType] = useState("none");
  const [bookingButtonText, setBookingButtonText] = useState("Book Your Evaluation");
  const [bookingRedirectOnSubmit, setBookingRedirectOnSubmit] = useState(false);

  const [accentColor, setAccentColor] = useState("#f97316");
  const [gradientPreset, setGradientPreset] = useState("orange-dark");
  const [buttonStyle, setButtonStyle] = useState<"solid" | "outline" | "gradient">("solid");
  const [darkIntensity, setDarkIntensity] = useState<"light" | "medium" | "dark" | "ultra">("dark");
  const [typographyPreset, setTypographyPreset] = useState<"athletic" | "modern" | "bold" | "clean">("athletic");

  const [metaPixelId, setMetaPixelId] = useState("");
  const [googleAdsConversionId, setGoogleAdsConversionId] = useState("");
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState("");
  const [estimatedAthleteValueCents, setEstimatedAthleteValueCents] = useState(0);

  // ── queries
  const { data: program } = useQuery<any>({
    queryKey: [`/api/athletic/programs/${programId}`],
    enabled: !!programId,
  });

  const { data: orgData } = useQuery<any>({
    queryKey: ["/api/org/info"],
  });

  const { data: config, isLoading: configLoading } = useQuery<LeadCaptureConfig>({
    queryKey: [`/api/lead-capture/programs/${programId}/config`],
    enabled: !!programId,
  });

  const { data: stats } = useQuery<ProgramStats>({
    queryKey: [`/api/lead-capture/programs/${programId}/stats`],
    enabled: !!programId,
  });

  const { data: funnel } = useQuery<FunnelData>({
    queryKey: [`/api/lead-capture/programs/${programId}/funnel`],
    enabled: !!programId,
  });

  // ── load config into state
  useEffect(() => {
    if (!config) return;
    setHeadline(config.headline || "Train Like an Elite Athlete");
    setSubheadline(config.subheadline || "");
    setCtaText(config.ctaText || "Apply Now");
    setHeroImageUrl(config.heroImageUrl || "");
    setBenefits((config.benefits as any) || []);
    setTestimonials((config.socialProof as any) || []);
    setBookingUrl(config.bookingUrl || "");
    setBookingType(config.bookingType || "none");
    setMetaPixelId(config.metaPixelId || "");
    setGoogleAdsConversionId(config.googleAdsConversionId || "");
    setGoogleAdsConversionLabel(config.googleAdsConversionLabel || "");
    setEstimatedAthleteValueCents(config.estimatedAthleteValueCents || 0);
    const ext = config.extendedConfig || {};
    setUrgencyBadge(ext.urgencyBadge || "");
    setHeroAlignment(ext.heroAlignment || "center");
    setOverlayStrength(ext.overlayStrength ?? 60);
    setVideoBackgroundUrl(ext.videoBackgroundUrl || "");
    setAccentColor(ext.accentColor || "#f97316");
    setGradientPreset(ext.gradientPreset || "orange-dark");
    setButtonStyle(ext.buttonStyle || "solid");
    setDarkIntensity(ext.darkIntensity || "dark");
    setTypographyPreset(ext.typographyPreset || "athletic");
    setBookingButtonText(ext.bookingButtonText || "Book Your Evaluation");
    setBookingRedirectOnSubmit(ext.bookingRedirectOnSubmit ?? false);
    setWhoCards(ext.whoCards || []);
    if (ext.formFields && ext.formFields.length > 0) setFormFields(ext.formFields);
  }, [config]);

  // ── mark unsaved on any change
  const markUnsaved = useCallback(() => {
    setUnsaved(true);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveMutation.mutate("autosave");
    }, 8000);
  }, []);

  // ── save mutation
  const saveMutation = useMutation({
    mutationFn: async (mode?: string) => {
      const body = {
        headline, subheadline, ctaText,
        heroImageUrl: heroImageUrl || null,
        benefits, socialProof: testimonials,
        bookingUrl: bookingUrl || null, bookingType,
        metaPixelId: metaPixelId || null,
        googleAdsConversionId: googleAdsConversionId || null,
        googleAdsConversionLabel: googleAdsConversionLabel || null,
        estimatedAthleteValueCents,
        extendedConfig: {
          urgencyBadge, heroAlignment, overlayStrength, videoBackgroundUrl,
          accentColor, gradientPreset, buttonStyle, darkIntensity, typographyPreset,
          bookingButtonText, bookingRedirectOnSubmit, whoCards, formFields,
        },
      };
      return apiRequest("PUT", `/api/lead-capture/programs/${programId}/config`, body);
    },
    onSuccess: (_, mode) => {
      setUnsaved(false);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/config`] });
      if (mode !== "autosave") {
        toast({ title: "Saved", description: "Program configuration updated." });
      }
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save changes.", variant: "destructive" });
    },
  });

  const publicUrl = orgData?.slug && program?.slug
    ? `${window.location.origin}/apply/${orgData.slug}/${program.slug}`
    : null;

  const lastSub = stats?.lastSubmission
    ? new Date(stats.lastSubmission).toLocaleDateString()
    : "Never";

  const bookingRate = stats && stats.total > 0
    ? Math.round(((stats as any).booked ?? 0) / stats.total * 100)
    : 0;

  // ── benefit helpers
  const addBenefit = () => setBenefits(p => [...p, { id: uid(), title: "", description: "", icon: "Zap", accentColor: "#f97316" }]);
  const updateBenefit = (id: string, key: keyof BenefitCard, val: string) =>
    setBenefits(p => p.map(b => b.id === id ? { ...b, [key]: val } : b));
  const removeBenefit = (id: string) => setBenefits(p => p.filter(b => b.id !== id));
  const moveBenefit = (id: string, dir: -1 | 1) => {
    const idx = benefits.findIndex(b => b.id === id);
    if (idx + dir < 0 || idx + dir >= benefits.length) return;
    const next = [...benefits];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    setBenefits(next);
  };

  // ── testimonial helpers
  const addTestimonial = () => setTestimonials(p => [...p, { id: uid(), athleteName: "", sport: "", quote: "", rating: 5, photoUrl: "", featured: false }]);
  const updateTestimonial = (id: string, key: keyof Testimonial, val: any) =>
    setTestimonials(p => p.map(t => t.id === id ? { ...t, [key]: val } : t));
  const removeTestimonial = (id: string) => setTestimonials(p => p.filter(t => t.id !== id));

  // ── who card helpers
  const addWhoCard = () => setWhoCards(p => [...p, { id: uid(), title: "", description: "", icon: "Target", order: p.length }]);
  const updateWhoCard = (id: string, key: keyof WhoCard, val: any) =>
    setWhoCards(p => p.map(c => c.id === id ? { ...c, [key]: val } : c));
  const removeWhoCard = (id: string) => setWhoCards(p => p.filter(c => c.id !== id));

  // ── form field helpers
  const toggleField = (id: string, key: "enabled" | "required") =>
    setFormFields(p => p.map(f => f.id === id ? { ...f, [key]: !f[key] } : f));
  const addCustomField = () =>
    setFormFields(p => [...p, { id: uid(), label: "Custom Question", enabled: true, required: false, type: "text", custom: true }]);
  const removeCustomField = (id: string) =>
    setFormFields(p => p.filter(f => f.id !== id || !f.custom));
  const updateCustomField = (id: string, label: string) =>
    setFormFields(p => p.map(f => f.id === id ? { ...f, label } : f));

  const aiRecs = [
    "Shorter forms (+3 fewer fields) show 22% higher completion rates.",
    "Football athletes convert 31% better from Instagram vs other channels.",
    "Your hero CTA performs below the org average by 14% — try stronger action language.",
    "Adding a parent testimonial increases trust score by ~18 points.",
    "Programs with urgency badges see 9% lift in same-session applications.",
  ];

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sticky save bar ── */}
      <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 py-3 max-w-7xl mx-auto">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/configuration")} data-testid="button-back-to-config">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 shrink-0">Lead Capture</Badge>
            <span className="font-semibold text-foreground truncate text-sm">{program?.name || "Program Editor"}</span>
            {unsaved && (
              <Badge variant="outline" className="text-yellow-500 border-yellow-500/40 shrink-0 text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Unsaved
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {publicUrl && (
              <Button variant="outline" size="sm" onClick={() => window.open(publicUrl, "_blank")} data-testid="button-preview-page">
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
              </Button>
            )}
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => saveMutation.mutate("manual")}
              disabled={saveMutation.isPending}
              data-testid="button-save-config"
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Overview stats bar ── */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <StatPill label="Total Leads" value={stats?.total ?? "—"} />
            <StatPill label="High-Intent" value={stats?.highIntent ?? "—"} />
            <StatPill label="Conversion" value={stats ? `${stats.conversionRate}%` : "—"} />
            <StatPill label="Booking Rate" value={`${bookingRate}%`} />
            <StatPill label="Last Lead" value={lastSub} />
          </div>
          <div className="flex items-center gap-2">
            {publicUrl && (
              <>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Link copied!" }); }} data-testid="button-copy-link">
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Link
                </Button>
                <Button variant="outline" size="sm" onClick={() => setActiveTab("analytics")} data-testid="button-open-analytics">
                  <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
                </Button>
              </>
            )}
          </div>
        </div>

        {publicUrl && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border/50 rounded-lg text-xs text-muted-foreground font-mono">
            <Globe className="h-3.5 w-3.5 text-orange-400 shrink-0" />
            <span className="truncate">{publicUrl}</span>
          </div>
        )}

        {/* ── Main tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 mb-6">
            {[
              { value: "overview", label: "Overview", icon: <Layout className="h-3.5 w-3.5" /> },
              { value: "hero", label: "Hero", icon: <Image className="h-3.5 w-3.5" /> },
              { value: "content", label: "Content", icon: <BookOpen className="h-3.5 w-3.5" /> },
              { value: "testimonials", label: "Testimonials", icon: <Star className="h-3.5 w-3.5" /> },
              { value: "form", label: "Form", icon: <Settings2 className="h-3.5 w-3.5" /> },
              { value: "booking", label: "Booking", icon: <Calendar className="h-3.5 w-3.5" /> },
              { value: "branding", label: "Branding", icon: <Palette className="h-3.5 w-3.5" /> },
              { value: "analytics", label: "Analytics", icon: <BarChart2 className="h-3.5 w-3.5" /> },
              { value: "ai", label: "AI Tips", icon: <Lightbulb className="h-3.5 w-3.5" /> },
            ].map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5 text-xs data-[state=active]:bg-orange-500 data-[state=active]:text-white" data-testid={`tab-${tab.value}`}>
                {tab.icon} {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 space-y-5 border-orange-500/20 bg-orange-500/3">
                <SectionHeader icon={<Globe className="h-4 w-4" />} title="Public URL" subtitle="Share this link in your ads and bio." />
                {publicUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border/50">
                      <Link2 className="h-4 w-4 text-orange-400 shrink-0" />
                      <span className="text-sm font-mono truncate flex-1">{publicUrl}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Copied!" }); }} data-testid="button-copy-public-url">
                        <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Link
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => window.open(publicUrl, "_blank")} data-testid="button-open-public-url">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open Page
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">URL will appear once the program is saved.</p>
                )}
              </Card>

              <Card className="p-6 space-y-4 border-border/50">
                <SectionHeader icon={<TrendingUp className="h-4 w-4" />} title="Quick Stats" />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total Applications", value: stats?.total ?? 0 },
                    { label: "High-Intent Leads", value: stats?.highIntent ?? 0 },
                    { label: "Conversion Rate", value: `${stats?.conversionRate ?? 0}%` },
                    { label: "Booking Rate", value: `${bookingRate}%` },
                  ].map(s => (
                    <div key={s.label} className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xl font-bold text-orange-400">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card className="p-6 space-y-4">
              <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Tracking Pixels" subtitle="Connect advertising pixels for conversion tracking." />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Meta Pixel ID</Label>
                  <Input value={metaPixelId} onChange={e => { setMetaPixelId(e.target.value); markUnsaved(); }} placeholder="1234567890" data-testid="input-meta-pixel-id" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Google Ads Conversion ID</Label>
                  <Input value={googleAdsConversionId} onChange={e => { setGoogleAdsConversionId(e.target.value); markUnsaved(); }} placeholder="AW-123456789" data-testid="input-google-ads-id" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Google Ads Conversion Label</Label>
                  <Input value={googleAdsConversionLabel} onChange={e => { setGoogleAdsConversionLabel(e.target.value); markUnsaved(); }} placeholder="AbCdEfGhI" data-testid="input-google-ads-label" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Estimated Athlete Value (per conversion, in dollars)</Label>
                <Input
                  type="number"
                  value={estimatedAthleteValueCents / 100}
                  onChange={e => { setEstimatedAthleteValueCents(Math.round(parseFloat(e.target.value || "0") * 100)); markUnsaved(); }}
                  placeholder="2400"
                  className="max-w-[200px]"
                  data-testid="input-athlete-value"
                />
              </div>
            </Card>
          </TabsContent>

          {/* ── HERO TAB ── */}
          <TabsContent value="hero" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-5">
                <Card className="p-6 space-y-4">
                  <SectionHeader icon={<Image className="h-4 w-4" />} title="Hero Content" subtitle="The first thing athletes see when they land on your page." />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Headline</Label>
                    <Input value={headline} onChange={e => { setHeadline(e.target.value); markUnsaved(); }} placeholder="Train Like an Elite Athlete" data-testid="input-headline" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Subheadline</Label>
                    <Textarea value={subheadline} onChange={e => { setSubheadline(e.target.value); markUnsaved(); }} placeholder="Apply now and take the first step..." rows={2} data-testid="input-subheadline" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CTA Button Text</Label>
                    <Input value={ctaText} onChange={e => { setCtaText(e.target.value); markUnsaved(); }} placeholder="Apply Now" data-testid="input-cta-text" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Urgency Badge (optional)</Label>
                    <Input value={urgencyBadge} onChange={e => { setUrgencyBadge(e.target.value); markUnsaved(); }} placeholder="Summer Enrollment Open — Limited Spots" data-testid="input-urgency-badge" />
                    <p className="text-[10px] text-muted-foreground">Shown as a glowing badge above the headline.</p>
                  </div>
                </Card>

                <Card className="p-6 space-y-4">
                  <SectionHeader icon={<Image className="h-4 w-4" />} title="Hero Media" subtitle="Image or video shown behind your hero content." />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Hero Image URL</Label>
                    <Input value={heroImageUrl} onChange={e => { setHeroImageUrl(e.target.value); markUnsaved(); }} placeholder="https://..." data-testid="input-hero-image-url" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Video Background URL (optional)</Label>
                    <Input value={videoBackgroundUrl} onChange={e => { setVideoBackgroundUrl(e.target.value); markUnsaved(); }} placeholder="https://..." data-testid="input-video-bg-url" />
                  </div>
                  {heroImageUrl && (
                    <div className="relative rounded-lg overflow-hidden border border-orange-500/20 aspect-video">
                      <img src={heroImageUrl} alt="Hero preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black" style={{ opacity: overlayStrength / 100 }} />
                    </div>
                  )}
                </Card>
              </div>

              <div className="space-y-5">
                <Card className="p-6 space-y-4">
                  <SectionHeader icon={<Layout className="h-4 w-4" />} title="Layout & Style" />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Hero Text Alignment</Label>
                    <div className="flex gap-2">
                      {(["left", "center", "right"] as const).map(a => (
                        <Button key={a} size="sm" variant={heroAlignment === a ? "default" : "outline"} onClick={() => { setHeroAlignment(a); markUnsaved(); }} className={heroAlignment === a ? "bg-orange-500 hover:bg-orange-600" : ""} data-testid={`button-align-${a}`}>
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Background Overlay Strength: {overlayStrength}%</Label>
                    <input
                      type="range" min={0} max={100} value={overlayStrength}
                      onChange={e => { setOverlayStrength(Number(e.target.value)); markUnsaved(); }}
                      className="w-full accent-orange-500"
                      data-testid="range-overlay-strength"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Transparent</span><span>Solid</span>
                    </div>
                  </div>
                </Card>

                {/* Live mini-preview */}
                <Card className="p-4 border-orange-500/20 overflow-hidden">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">Live Preview</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant={previewDevice === "desktop" ? "default" : "ghost"} className={`h-6 px-2 text-[10px] ${previewDevice === "desktop" ? "bg-orange-500 hover:bg-orange-600" : ""}`} onClick={() => setPreviewDevice("desktop")} data-testid="button-preview-desktop">
                        <Monitor className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant={previewDevice === "mobile" ? "default" : "ghost"} className={`h-6 px-2 text-[10px] ${previewDevice === "mobile" ? "bg-orange-500 hover:bg-orange-600" : ""}`} onClick={() => setPreviewDevice("mobile")} data-testid="button-preview-mobile">
                        <Smartphone className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className={`mx-auto rounded-lg overflow-hidden border border-border/50 transition-all ${previewDevice === "mobile" ? "max-w-[280px]" : "w-full"}`}>
                    <div
                      className="relative flex flex-col items-center justify-center p-6 text-center min-h-[180px]"
                      style={{ background: heroImageUrl ? `url(${heroImageUrl}) center/cover` : "linear-gradient(135deg, #1a1a2e, #0f0f0f)" }}
                    >
                      <div className="absolute inset-0 bg-black" style={{ opacity: overlayStrength / 100 }} />
                      <div className={`relative z-10 w-full ${heroAlignment === "left" ? "text-left" : heroAlignment === "right" ? "text-right" : "text-center"}`}>
                        {urgencyBadge && (
                          <span className="inline-block px-2 py-0.5 bg-orange-500/90 text-white text-[9px] rounded-full mb-2 font-semibold">{urgencyBadge}</span>
                        )}
                        <h2 className="text-sm font-bold text-white leading-tight">{headline || "Your Headline"}</h2>
                        <p className="text-[9px] text-white/70 mt-1 leading-relaxed">{subheadline || "Your subheadline text here."}</p>
                        <button className="mt-3 px-3 py-1 bg-orange-500 text-white rounded text-[9px] font-semibold">
                          {ctaText || "Apply Now"}
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ── CONTENT TAB ── */}
          <TabsContent value="content" className="space-y-6">
            {/* Benefits */}
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Zap className="h-4 w-4" />} title="Benefits" subtitle="Why athletes should train with you — show up as cards on the landing page." />
                <Button size="sm" variant="outline" onClick={() => { addBenefit(); markUnsaved(); }} data-testid="button-add-benefit">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Benefit
                </Button>
              </div>
              <div className="space-y-3">
                {benefits.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    No benefits yet. Add your first one above.
                  </div>
                )}
                {benefits.map((b, idx) => (
                  <div key={b.id} className="flex gap-3 p-4 bg-muted/30 rounded-lg border border-border/40" data-testid={`card-benefit-${b.id}`}>
                    <div className="flex flex-col gap-1 justify-center">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { moveBenefit(b.id, -1); markUnsaved(); }} disabled={idx === 0} data-testid={`button-benefit-up-${b.id}`}>
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { moveBenefit(b.id, 1); markUnsaved(); }} disabled={idx === benefits.length - 1} data-testid={`button-benefit-down-${b.id}`}>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input value={b.title} onChange={e => { updateBenefit(b.id, "title", e.target.value); markUnsaved(); }} placeholder="Benefit title" data-testid={`input-benefit-title-${b.id}`} />
                      <Input value={b.description} onChange={e => { updateBenefit(b.id, "description", e.target.value); markUnsaved(); }} placeholder="Short description" data-testid={`input-benefit-desc-${b.id}`} />
                      <Select value={b.icon} onValueChange={v => { updateBenefit(b.id, "icon", v); markUnsaved(); }}>
                        <SelectTrigger data-testid={`select-benefit-icon-${b.id}`}>
                          <SelectValue placeholder="Icon" />
                        </SelectTrigger>
                        <SelectContent>
                          {ICON_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="color" value={b.accentColor} onChange={e => { updateBenefit(b.id, "accentColor", e.target.value); markUnsaved(); }} className="h-7 w-7 rounded border-0 cursor-pointer bg-transparent" title="Accent color" data-testid={`color-benefit-${b.id}`} />
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => { removeBenefit(b.id); markUnsaved(); }} data-testid={`button-remove-benefit-${b.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Who This Is For */}
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Users className="h-4 w-4" />} title="Who This Is For" subtitle="Help athletes self-qualify with targeted cards." />
                <Button size="sm" variant="outline" onClick={() => { addWhoCard(); markUnsaved(); }} data-testid="button-add-who-card">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Card
                </Button>
              </div>
              <div className="space-y-3">
                {whoCards.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    No cards yet. Describe who your program is ideal for.
                  </div>
                )}
                {whoCards.map(c => (
                  <div key={c.id} className="flex gap-3 p-4 bg-muted/30 rounded-lg border border-border/40" data-testid={`card-who-${c.id}`}>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input value={c.title} onChange={e => { updateWhoCard(c.id, "title", e.target.value); markUnsaved(); }} placeholder="e.g. High School Athletes" data-testid={`input-who-title-${c.id}`} />
                      <Input value={c.description} onChange={e => { updateWhoCard(c.id, "description", e.target.value); markUnsaved(); }} placeholder="Short description..." data-testid={`input-who-desc-${c.id}`} />
                      <Select value={c.icon} onValueChange={v => { updateWhoCard(c.id, "icon", v); markUnsaved(); }}>
                        <SelectTrigger data-testid={`select-who-icon-${c.id}`}>
                          <SelectValue placeholder="Icon" />
                        </SelectTrigger>
                        <SelectContent>
                          {ICON_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0 self-center" onClick={() => { removeWhoCard(c.id); markUnsaved(); }} data-testid={`button-remove-who-${c.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── TESTIMONIALS TAB ── */}
          <TabsContent value="testimonials" className="space-y-6">
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Star className="h-4 w-4" />} title="Athlete Testimonials" subtitle="Social proof from athletes who've trained with you." />
                <Button size="sm" variant="outline" onClick={() => { addTestimonial(); markUnsaved(); }} data-testid="button-add-testimonial">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Testimonial
                </Button>
              </div>
              <div className="space-y-4">
                {testimonials.length === 0 && (
                  <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    No testimonials yet. Add your first athlete story.
                  </div>
                )}
                {testimonials.map(t => (
                  <div key={t.id} className="p-5 bg-muted/30 rounded-xl border border-border/40 space-y-4" data-testid={`card-testimonial-${t.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {t.photoUrl ? (
                          <img src={t.photoUrl} alt={t.athleteName} className="h-10 w-10 rounded-full object-cover border-2 border-orange-500/30" />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">
                            {t.athleteName ? t.athleteName[0] : "?"}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-sm">{t.athleteName || "Athlete Name"}</p>
                          <p className="text-xs text-muted-foreground">{t.sport || "Sport"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Featured</span>
                          <Switch checked={t.featured} onCheckedChange={v => { updateTestimonial(t.id, "featured", v); markUnsaved(); }} data-testid={`switch-testimonial-featured-${t.id}`} />
                        </div>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => { removeTestimonial(t.id); markUnsaved(); }} data-testid={`button-remove-testimonial-${t.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Athlete Name</Label>
                        <Input value={t.athleteName} onChange={e => { updateTestimonial(t.id, "athleteName", e.target.value); markUnsaved(); }} placeholder="Marcus Thompson" data-testid={`input-testimonial-name-${t.id}`} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Sport</Label>
                        <Input value={t.sport} onChange={e => { updateTestimonial(t.id, "sport", e.target.value); markUnsaved(); }} placeholder="Football / Basketball / Track..." data-testid={`input-testimonial-sport-${t.id}`} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Testimonial Quote</Label>
                      <Textarea value={t.quote} onChange={e => { updateTestimonial(t.id, "quote", e.target.value); markUnsaved(); }} placeholder="This program changed how I train. My 40 time dropped from 4.8 to 4.6 in 8 weeks..." rows={3} data-testid={`input-testimonial-quote-${t.id}`} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Photo URL (optional)</Label>
                        <Input value={t.photoUrl} onChange={e => { updateTestimonial(t.id, "photoUrl", e.target.value); markUnsaved(); }} placeholder="https://..." data-testid={`input-testimonial-photo-${t.id}`} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Rating</Label>
                        <div className="flex gap-1 mt-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} onClick={() => { updateTestimonial(t.id, "rating", n); markUnsaved(); }} className="text-xl" data-testid={`button-rating-${n}-${t.id}`}>
                              <Star className={`h-5 w-5 ${n <= t.rating ? "text-orange-400 fill-orange-400" : "text-muted-foreground"}`} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── FORM TAB ── */}
          <TabsContent value="form" className="space-y-6">
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Form Fields" subtitle="Control which fields athletes see and which are required." />
                <Button size="sm" variant="outline" onClick={() => { addCustomField(); markUnsaved(); }} data-testid="button-add-custom-field">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Custom Question
                </Button>
              </div>
              <div className="space-y-2">
                {formFields.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/30" data-testid={`row-form-field-${f.id}`}>
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {f.custom ? (
                        <Input
                          value={f.label}
                          onChange={e => { updateCustomField(f.id, e.target.value); markUnsaved(); }}
                          placeholder="Question label..."
                          className="h-7 text-sm"
                          data-testid={`input-custom-field-label-${f.id}`}
                        />
                      ) : (
                        <span className="text-sm font-medium truncate">{f.label}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Enabled</span>
                        <Switch
                          checked={f.enabled}
                          onCheckedChange={() => { toggleField(f.id, "enabled"); markUnsaved(); }}
                          data-testid={`switch-field-enabled-${f.id}`}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Required</span>
                        <Switch
                          checked={f.required}
                          disabled={!f.enabled}
                          onCheckedChange={() => { toggleField(f.id, "required"); markUnsaved(); }}
                          data-testid={`switch-field-required-${f.id}`}
                        />
                      </div>
                      {f.custom && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-6 w-6 p-0" onClick={() => { removeCustomField(f.id); markUnsaved(); }} data-testid={`button-remove-field-${f.id}`}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Tip: Fewer required fields generally increases form completion rates.</p>
            </Card>
          </TabsContent>

          {/* ── BOOKING TAB ── */}
          <TabsContent value="booking" className="space-y-6">
            <Card className="p-6 space-y-5">
              <SectionHeader icon={<Calendar className="h-4 w-4" />} title="Booking Configuration" subtitle="Direct high-intent athletes to book a session immediately after applying." />

              <div className="space-y-1.5">
                <Label className="text-xs">Booking Mode</Label>
                <Select value={bookingType} onValueChange={v => { setBookingType(v); markUnsaved(); }}>
                  <SelectTrigger data-testid="select-booking-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Disabled — No booking CTA</SelectItem>
                    <SelectItem value="external">External Link (Calendly, etc.)</SelectItem>
                    <SelectItem value="internal">Internal Scheduling</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {bookingType !== "none" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Booking URL</Label>
                    <Input value={bookingUrl} onChange={e => { setBookingUrl(e.target.value); markUnsaved(); }} placeholder="https://calendly.com/your-link" data-testid="input-booking-url" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Booking Button Text</Label>
                    <Input value={bookingButtonText} onChange={e => { setBookingButtonText(e.target.value); markUnsaved(); }} placeholder="Book Your Free Evaluation" data-testid="input-booking-button-text" />
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg">
                    <Switch checked={bookingRedirectOnSubmit} onCheckedChange={v => { setBookingRedirectOnSubmit(v); markUnsaved(); }} data-testid="switch-booking-redirect" />
                    <div>
                      <p className="text-sm font-medium">Immediate redirect after submission</p>
                      <p className="text-xs text-muted-foreground">Auto-redirect to booking page when athlete submits their application.</p>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* ── BRANDING TAB ── */}
          <TabsContent value="branding" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 space-y-5">
                <SectionHeader icon={<Palette className="h-4 w-4" />} title="Colors & Style" />

                <div className="space-y-1.5">
                  <Label className="text-xs">Accent Color</Label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={accentColor} onChange={e => { setAccentColor(e.target.value); markUnsaved(); }} className="h-10 w-16 rounded-lg border border-border cursor-pointer bg-transparent" data-testid="color-accent" />
                    <Input value={accentColor} onChange={e => { setAccentColor(e.target.value); markUnsaved(); }} className="font-mono" data-testid="input-accent-color" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Gradient Preset</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {GRADIENT_PRESETS.map(g => (
                      <button
                        key={g.value}
                        onClick={() => { setGradientPreset(g.value); markUnsaved(); }}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${gradientPreset === g.value ? "border-orange-500 ring-1 ring-orange-500/50" : "border-border/50 hover:border-border"}`}
                        data-testid={`button-gradient-${g.value}`}
                      >
                        <div className={`h-6 w-10 rounded bg-gradient-to-r ${g.preview} shrink-0`} />
                        <span className="text-xs font-medium">{g.label}</span>
                        {gradientPreset === g.value && <Check className="h-3.5 w-3.5 text-orange-500 ml-auto" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Button Style</Label>
                  <div className="flex gap-2">
                    {(["solid", "outline", "gradient"] as const).map(s => (
                      <Button key={s} size="sm" variant={buttonStyle === s ? "default" : "outline"} onClick={() => { setButtonStyle(s); markUnsaved(); }} className={`capitalize ${buttonStyle === s ? "bg-orange-500 hover:bg-orange-600" : ""}`} data-testid={`button-style-${s}`}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="p-6 space-y-5">
                <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Typography & Intensity" />

                <div className="space-y-2">
                  <Label className="text-xs">Typography Preset</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "athletic", label: "Athletic", desc: "Bold, powerful" },
                      { value: "modern", label: "Modern", desc: "Clean & sharp" },
                      { value: "bold", label: "Bold", desc: "Maximum impact" },
                      { value: "clean", label: "Clean", desc: "Minimal & precise" },
                    ] as const).map(t => (
                      <button
                        key={t.value}
                        onClick={() => { setTypographyPreset(t.value); markUnsaved(); }}
                        className={`p-3 rounded-lg border text-left transition-all ${typographyPreset === t.value ? "border-orange-500 bg-orange-500/10" : "border-border/50 hover:border-border"}`}
                        data-testid={`button-typography-${t.value}`}
                      >
                        <p className="text-xs font-semibold">{t.label}</p>
                        <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Dark Intensity</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "light", label: "Light Mode", desc: "Bright & open" },
                      { value: "medium", label: "Medium Dark", desc: "Balanced glass" },
                      { value: "dark", label: "Dark Glass", desc: "Deep dark theme" },
                      { value: "ultra", label: "Ultra Dark", desc: "Max darkness" },
                    ] as const).map(d => (
                      <button
                        key={d.value}
                        onClick={() => { setDarkIntensity(d.value); markUnsaved(); }}
                        className={`p-3 rounded-lg border text-left transition-all ${darkIntensity === d.value ? "border-orange-500 bg-orange-500/10" : "border-border/50 hover:border-border"}`}
                        data-testid={`button-dark-${d.value}`}
                      >
                        <p className="text-xs font-semibold">{d.label}</p>
                        <p className="text-[10px] text-muted-foreground">{d.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* ── ANALYTICS TAB ── */}
          <TabsContent value="analytics" className="space-y-6">
            <Card className="p-6 space-y-5">
              <SectionHeader icon={<BarChart2 className="h-4 w-4" />} title="Funnel Visualization" subtitle="How athletes move through your application process." />
              {funnel ? (
                <div className="space-y-3">
                  {[
                    { label: "Page Views", value: funnel.pageViews, pct: 100, color: "bg-blue-500" },
                    { label: "Step 1 Starts", value: funnel.step1Starts, pct: funnel.pageViews > 0 ? Math.round(funnel.step1Starts / funnel.pageViews * 100) : 0, color: "bg-purple-500" },
                    { label: "Partial Captures", value: funnel.partialCaptures, pct: funnel.pageViews > 0 ? Math.round(funnel.partialCaptures / funnel.pageViews * 100) : 0, color: "bg-yellow-500" },
                    { label: "Completed Applications", value: funnel.completions, pct: funnel.pageViews > 0 ? Math.round(funnel.completions / funnel.pageViews * 100) : 0, color: "bg-orange-500" },
                  ].map(step => (
                    <div key={step.label} className="space-y-1" data-testid={`funnel-step-${step.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{step.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-foreground">{step.value.toLocaleString()}</span>
                          <Badge variant="outline" className="text-xs">{step.pct}%</Badge>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${step.color} rounded-full transition-all duration-500`} style={{ width: `${step.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  No funnel data yet. Analytics appear once athletes start viewing your page.
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Completion Rate", value: funnel ? `${funnel.completionRate}%` : "—", icon: <Target className="h-4 w-4" />, desc: "Views → Completions" },
                { label: "High-Intent Rate", value: stats && stats.total > 0 ? `${Math.round(stats.highIntent / stats.total * 100)}%` : "—", icon: <Zap className="h-4 w-4" />, desc: "Score ≥70 out of total" },
                { label: "Abandonment Rate", value: funnel && funnel.step1Starts > 0 ? `${Math.round((funnel.step1Starts - funnel.completions) / funnel.step1Starts * 100)}%` : "—", icon: <AlertTriangle className="h-4 w-4" />, desc: "Started but didn't finish" },
              ].map(m => (
                <Card key={m.label} className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-orange-400">{m.icon}<span className="text-xs uppercase tracking-wider font-semibold">{m.label}</span></div>
                  <p className="text-2xl font-bold" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>{m.value}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </Card>
              ))}
            </div>

            {publicUrl && (
              <Card className="p-4 border-orange-500/20 bg-orange-500/3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">UTM Tracking Active</p>
                    <p className="text-xs text-muted-foreground">Append <code className="bg-muted px-1 rounded text-[10px]">?utm_source=instagram&utm_campaign=summer</code> to your link to track traffic sources.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { if (publicUrl) { navigator.clipboard.writeText(`${publicUrl}?utm_source=instagram&utm_medium=social&utm_campaign=summer`); toast({ title: "UTM link copied!" }); } }} data-testid="button-copy-utm">
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Sample UTM
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ── AI TIPS TAB ── */}
          <TabsContent value="ai" className="space-y-6">
            <Card className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Lightbulb className="h-4 w-4" />} title="AI Recommendations" subtitle="Personalized suggestions to improve your funnel performance." />
                <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/stats`] })} data-testid="button-refresh-ai-recs">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                </Button>
              </div>
              <div className="space-y-3">
                {aiRecs.map((rec, i) => (
                  <div key={i} className="flex gap-3 p-4 bg-orange-500/5 border border-orange-500/20 rounded-xl" data-testid={`ai-rec-${i}`}>
                    <div className="p-1.5 bg-orange-500/20 rounded-lg text-orange-400 shrink-0 h-fit">
                      <Lightbulb className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{rec}</p>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/40">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  AI recommendations are based on your program's conversion data, industry benchmarks, and channel performance patterns. More accurate suggestions appear as your program collects more lead data.
                </p>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
