import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { LeadCaptureLaserEffects, LaserBorderSweep, LaserUrgencyGlow, getDefaultLaserPreset } from "@/components/lead-capture-laser-effects";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight,
  ChevronLeft,
  Trophy,
  Zap,
  Target,
  Users,
  Star,
  CheckCircle2,
  ArrowRight,
  Flame,
  Shield,
  Clock,
  Loader2,
} from "lucide-react";

function useUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source") || undefined,
    utmMedium: params.get("utm_medium") || undefined,
    utmCampaign: params.get("utm_campaign") || undefined,
    utmContent: params.get("utm_content") || undefined,
    utmTerm: params.get("utm_term") || undefined,
  };
}

const GOAL_OPTIONS = [
  "Increase Speed & Explosiveness",
  "Build Strength & Power",
  "Improve Agility & Footwork",
  "Injury Prevention & Recovery",
  "College Recruiting Prep",
  "Off-Season Development",
  "In-Season Performance",
  "Weight Management",
  "Mental Toughness",
  "Sport-Specific Skills",
];

const EXPERIENCE_OPTIONS = ["Beginner (0-1 years)", "Intermediate (1-3 years)", "Advanced (3-5 years)", "Elite (5+ years)"];
const TRAINING_STATUS_OPTIONS = ["Not currently training", "Training occasionally", "Training 1-2x per week", "Training 3-4x per week", "Training 5+ days per week"];
const COMMITMENT_OPTIONS = ["Just exploring", "Interested but unsure", "Ready to start this month", "Ready to start immediately"];
const GRADE_OPTIONS = ["6th", "7th", "8th", "9th", "10th", "11th", "12th", "College Freshman", "College Sophomore", "College Junior", "College Senior", "Post-Grad"];

type FormData = {
  athleteName: string;
  parentName: string;
  email: string;
  phone: string;
  age: string;
  grade: string;
  sport: string;
  position: string;
  school: string;
  goals: string[];
  experienceLevel: string;
  currentTrainingStatus: string;
  commitmentLevel: string;
  notes: string;
};

const EMPTY_FORM: FormData = {
  athleteName: "", parentName: "", email: "", phone: "",
  age: "", grade: "", sport: "", position: "", school: "",
  goals: [], experienceLevel: "", currentTrainingStatus: "", commitmentLevel: "", notes: "",
};

type ExtendedConfig = {
  urgencyBadge?: string;
  heroAlignment?: "left" | "center" | "right";
  overlayStrength?: number;
  videoBackgroundUrl?: string;
  accentColor?: string;
  gradientPreset?: string;
  buttonStyle?: "solid" | "outline" | "gradient";
  darkIntensity?: string;
  typographyPreset?: string;
  whoCards?: { id: string; title: string; description: string; icon: string }[];
  formFields?: any[];
  bookingButtonText?: string;
  bookingRedirectOnSubmit?: boolean;
  laserEffectsEnabled?: boolean;
  laserIntensity?: "subtle" | "standard" | "high";
  laserPreset?: "performance-orange" | "team-cyan" | "career-purple" | "elite-green";
  heroImageFit?: "cover" | "contain" | "fill";
  heroImagePosition?: string;
  mobileHeroImagePosition?: string;
};

type ProgramData = {
  org: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null };
  program: { id: string; name: string; slug: string; type: string };
  config: {
    headline: string | null;
    subheadline: string | null;
    ctaText: string | null;
    heroImageUrl: string | null;
    benefits: any[] | null;
    socialProof: any[] | null;
    whoIsThisFor: string | null;
    metaPixelId: string | null;
    googleAdsConversionId: string | null;
    googleAdsConversionLabel: string | null;
    bookingUrl: string | null;
    bookingType: string | null;
    funnelType: string | null;
    extendedConfig: ExtendedConfig | null;
  } | null;
};

function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = ((step - 1) / (total - 1)) * 100;
  return (
    <div className="w-full">
      <div className="flex justify-between mb-2">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all duration-300 ${
              i + 1 < step
                ? "bg-orange-500 text-white scale-90"
                : i + 1 === step
                ? "bg-orange-500 text-white ring-4 ring-orange-500/30 scale-110"
                : "bg-white/10 text-white/40"
            }`}
            data-testid={`step-indicator-${i + 1}`}
          >
            {i + 1 < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </div>
        ))}
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`relative overflow-hidden group bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 md:p-8 shadow-2xl ${className}`} style={style}>
      {children}
    </div>
  );
}

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function LeadCaptureLanding() {
  const { orgSlug, programSlug } = useParams<{ orgSlug: string; programSlug: string }>();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    submissionId: string; orgSlug: string; orgName: string; orgId: string;
    programId: string; programName: string; athleteName: string; email: string;
    bookingUrl: string | null; bookingType: string;
  } | null>(null);
  const [abandonedId, setAbandonedId] = useState<string | null>(null);
  const [formInView, setFormInView] = useState(false);
  const partialSavedRef = useRef(false);
  const sessionIdRef = useRef(generateSessionId());
  const utm = useUtmParams();

  // Hide sticky CTA once the form section scrolls into view
  useEffect(() => {
    const el = document.getElementById("apply-form");
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFormInView(entry.isIntersecting),
      { threshold: 0.08 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const TOTAL_STEPS = 5;

  const { data, isLoading, isError } = useQuery<ProgramData>({
    queryKey: [`/api/public/lead-capture/${orgSlug}/${programSlug}`],
    enabled: !!orgSlug && !!programSlug,
  });

  // Track funnel event silently
  const trackFunnelEvent = (eventType: string) => {
    if (!orgSlug || !programSlug) return;
    fetch(`/api/public/lead-capture/${orgSlug}/${programSlug}/funnel-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        sessionId: sessionIdRef.current,
        utmSource: utm.utmSource || null,
        utmMedium: utm.utmMedium || null,
        utmCampaign: utm.utmCampaign || null,
      }),
    }).catch(() => {});
  };

  // Fire page_view once program data is loaded
  useEffect(() => {
    if (data) trackFunnelEvent("page_view");
  }, [data?.program?.id]);

  // Inject Meta Pixel if configured
  useEffect(() => {
    if (!data?.config?.metaPixelId) return;
    const pixelId = data.config.metaPixelId;
    if (document.getElementById("meta-pixel-script")) return;
    const script = document.createElement("script");
    script.id = "meta-pixel-script";
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init','${pixelId}');fbq('track','PageView');
    `;
    document.head.appendChild(script);
  }, [data?.config?.metaPixelId]);

  // Inject Google Ads tracking if configured
  useEffect(() => {
    if (!data?.config?.googleAdsConversionId) return;
    const convId = data.config.googleAdsConversionId;
    if (document.getElementById("gtag-script")) return;
    const gtagScript = document.createElement("script");
    gtagScript.id = "gtag-script";
    gtagScript.async = true;
    gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${convId}`;
    document.head.appendChild(gtagScript);
    const inlineScript = document.createElement("script");
    inlineScript.innerHTML = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${convId}');`;
    document.head.appendChild(inlineScript);
  }, [data?.config?.googleAdsConversionId]);

  const partialMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/public/lead-capture/${orgSlug}/${programSlug}/partial`, {
        athleteName: form.athleteName,
        email: form.email,
        phone: form.phone || undefined,
        ...utm,
      }).then((r) => r.json()),
    onSuccess: (res) => {
      if (res.abandonedId) setAbandonedId(res.abandonedId);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/public/lead-capture/${orgSlug}/${programSlug}/submit`, {
        ...form,
        ...utm,
        abandonedId: abandonedId || undefined,
      }).then((r) => r.json()),
    onSuccess: (res: any) => {
      setSubmitted(true);
      setSubmitResult(res);
      setStep(TOTAL_STEPS);
      // Store for post-auth linking
      try {
        sessionStorage.setItem("pending_funnel_link", JSON.stringify({
          submissionId: res.submissionId,
          orgSlug: res.orgSlug,
          orgId: res.orgId,
          programId: res.programId,
          athleteName: res.athleteName,
          email: res.email,
          bookingUrl: res.bookingUrl,
          bookingType: res.bookingType,
        }));
      } catch (_) {}
      // Fire Meta Pixel conversion event
      if (data?.config?.metaPixelId && (window as any).fbq) {
        (window as any).fbq("track", "Lead");
      }
      // Fire Google Ads conversion
      if (data?.config?.googleAdsConversionId && data?.config?.googleAdsConversionLabel && (window as any).gtag) {
        (window as any).gtag("event", "conversion", {
          send_to: `${data.config.googleAdsConversionId}/${data.config.googleAdsConversionLabel}`,
        });
      }
    },
    onError: () => {
      toast({ title: "Submission failed", description: "Please check your info and try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const set = (field: keyof FormData, value: string) => setForm((f) => ({ ...f, [field]: value }));
  const toggleGoal = (g: string) =>
    setForm((f) => ({
      ...f,
      goals: f.goals.includes(g) ? f.goals.filter((x) => x !== g) : [...f.goals, g],
    }));

  const canNext = () => {
    if (step === 1) return form.athleteName.trim() && form.email.trim();
    if (step === 2) return true;
    if (step === 3) return form.goals.length > 0;
    if (step === 4) return !!form.commitmentLevel;
    return true;
  };

  const goNext = () => {
    if (!canNext()) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    // Fire funnel step event
    trackFunnelEvent(`step_${step}`);
    // Save partial capture after completing Step 1 (fire once)
    if (step === 1 && !partialSavedRef.current && form.athleteName.trim() && form.email.trim()) {
      partialSavedRef.current = true;
      partialMutation.mutate();
    }
    if (step === 4) {
      submitMutation.mutate();
      return;
    }
    setAnimDir("forward");
    setStep((s) => s + 1);
  };

  const goBack = () => {
    setAnimDir("back");
    setStep((s) => Math.max(1, s - 1));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-orange-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-white/60 text-sm">Loading application...</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
            <Shield className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-white text-xl font-bold">Program Not Found</h2>
          <p className="text-white/50 text-sm">This application link may have expired or been removed.</p>
        </div>
      </div>
    );
  }

  const { org, program, config } = data;

  // ── ExtendedConfig fields ─────────────────────────────────────────────────
  const ext: ExtendedConfig = config?.extendedConfig || {};
  const funnelType = config?.funnelType || "athlete_application";
  const urgencyBadge = ext.urgencyBadge || "";
  const heroAlignment = ext.heroAlignment || "center";
  const laserEnabled = ext.laserEffectsEnabled ?? true;
  const laserIntensity = ext.laserIntensity || "standard";
  const laserPreset = ext.laserPreset || getDefaultLaserPreset(funnelType);
  const laserCardsEnabled = ext.laserCardsEnabled ?? true;
  const laserCardsActive = laserEnabled && laserCardsEnabled;
  const heroImageFit = ext.heroImageFit || "cover";
  const heroImagePosition = ext.heroImagePosition || "center center";
  const mobileHeroImagePosition = ext.mobileHeroImagePosition || "";
  const overlayStrength = ext.overlayStrength ?? 60;
  const videoBackgroundUrl = ext.videoBackgroundUrl || "";
  const accentColor = ext.accentColor || (
    funnelType === "team_training" ? "#06b6d4" :
    funnelType === "employment_opportunity" ? "#a855f7" :
    "#f97316"
  );
  const buttonStyle = ext.buttonStyle || "solid";
  const whoCards = ext.whoCards || [];
  const savedBookingUrl = config?.bookingUrl || "";
  const savedBookingType = config?.bookingType || "none";
  const bookingButtonText = ext.bookingButtonText || (
    funnelType === "team_training" ? "Book a Discovery Call" :
    funnelType === "employment_opportunity" ? "Schedule Your Interview" :
    "Book Your Evaluation"
  );

  // Funnel-type headline/subhead/cta defaults
  const defaultHeadline =
    funnelType === "team_training" ? "Elevate Your Team's Performance" :
    funnelType === "employment_opportunity" ? "Join Our Coaching Staff" :
    "Train Like an Elite Athlete";
  const defaultSubheadline =
    funnelType === "team_training" ? "Partner with proven strength & conditioning professionals to transform your program." :
    funnelType === "employment_opportunity" ? "We're building a team of elite strength & conditioning coaches." :
    "Apply now and take the first step toward your athletic potential.";
  const defaultCtaText =
    funnelType === "team_training" ? "Request a Consultation" :
    funnelType === "employment_opportunity" ? "Apply to Coach" :
    "Apply Now";

  const headline = config?.headline || defaultHeadline;
  const subheadline = config?.subheadline || defaultSubheadline;
  const ctaText = config?.ctaText || defaultCtaText;

  // ── Benefits — fix desc/description field name mismatch ───────────────────
  const defaultBenefitsForType =
    funnelType === "team_training" ? [
      { title: "Turnkey Programs", desc: "Full S&C program design delivered to your facility." },
      { title: "Proven Track Record", desc: "Teams see measurable athletic improvement in 8 weeks." },
      { title: "Budget-Flexible Options", desc: "Scalable pricing for programs of all sizes." },
      { title: "Expert Staffing", desc: "Certified S&C professionals who know your sport." },
    ] : funnelType === "employment_opportunity" ? [
      { title: "Competitive Compensation", desc: "Performance-based pay with platform revenue share." },
      { title: "Athlete Pipeline", desc: "Access to a built-in roster of motivated athletes." },
      { title: "Scheduling Freedom", desc: "Set your own availability and session cadence." },
      { title: "Growth Opportunity", desc: "Expand your coaching career with a proven platform." },
    ] : [
      { title: "Elite Coaching", desc: "Train with certified S&C specialists who've developed champions." },
      { title: "Proven Results", desc: "Athletes see measurable performance gains in 4-6 weeks." },
      { title: "Sport-Specific Programming", desc: "Every session is designed around your specific sport demands." },
      { title: "Athlete-First Culture", desc: "A community built on discipline, accountability, and growth." },
    ];

  const benefits: { icon?: string; title: string; desc: string }[] =
    Array.isArray(config?.benefits) && config.benefits.length > 0
      ? config.benefits.map((b: any) => ({
          icon: b.icon,
          title: b.title || "",
          desc: b.desc || b.description || "",
        }))
      : defaultBenefitsForType;

  // ── Social proof — handle both "role" (editor) and "sport" (legacy) ───────
  const defaultSocialProofForType =
    funnelType === "team_training" ? [
      { quote: "Our athletes' performance metrics improved across the board within one semester.", name: "Coach Johnson", sport: "Athletic Director, Lincoln High" },
      { quote: "Best investment our program has made. The S&C coaching is elite-level.", name: "Director Williams", sport: "Club Director, Metro FC" },
      { quote: "We finally have a real strength program our coaches trust.", name: "Coach Rivera", sport: "Head Coach, Westfield HS" },
    ] : funnelType === "employment_opportunity" ? [
      { quote: "This platform gave me the infrastructure to grow my coaching business without the admin overhead.", name: "Alex M.", sport: "CSCS Coach" },
      { quote: "I 4x'd my income in 6 months. The athlete pipeline is real.", name: "Jordan T.", sport: "Performance Coach" },
      { quote: "Best coaching opportunity I've found — full schedule, great athletes, flexible hours.", name: "Taylor R.", sport: "S&C Specialist" },
    ] : [
      { quote: "This program changed my game completely. I added 15 yards to my 40 time in 8 weeks.", name: "Marcus T.", sport: "Football" },
      { quote: "Best investment I've made in my athletic career. The coaches actually care.", name: "Jaylen R.", sport: "Basketball" },
      { quote: "My confidence on the field is through the roof. I got recruited after training here.", name: "Sofia M.", sport: "Soccer" },
    ];

  const socialProof: { quote: string; name: string; sport?: string }[] =
    Array.isArray(config?.socialProof) && config.socialProof.length > 0
      ? config.socialProof.map((s: any) => ({
          quote: s.quote || "",
          name: s.name || "",
          sport: s.sport || s.role || "",
        }))
      : defaultSocialProofForType;

  const whoIsThisFor = config?.whoIsThisFor || "";

  // ── Gradient background ────────────────────────────────────────────────────
  const gradientPreset = ext.gradientPreset || (
    funnelType === "team_training" ? "blue-dark" :
    funnelType === "employment_opportunity" ? "purple-dark" :
    "orange-dark"
  );
  const gradientBg: Record<string, string> = {
    "orange-dark": "linear-gradient(135deg, #9a3412 0%, #0f0f0f 100%)",
    "gold-black": "linear-gradient(135deg, #a16207 0%, #111 100%)",
    "blue-dark": "linear-gradient(135deg, #1e40af 0%, #0f0f0f 100%)",
    "cyan-dark": "linear-gradient(135deg, #0e7490 0%, #0f0f0f 100%)",
    "purple-dark": "linear-gradient(135deg, #7e22ce 0%, #0f0f0f 100%)",
    "green-dark": "linear-gradient(135deg, #15803d 0%, #0f0f0f 100%)",
    "red-dark": "linear-gradient(135deg, #991b1b 0%, #0f0f0f 100%)",
  };
  const heroBg = gradientBg[gradientPreset] || gradientBg["orange-dark"];

  // ── Accent-color inline style helpers ─────────────────────────────────────
  const accentStyle = { color: accentColor };
  const accentBgStyle = { backgroundColor: accentColor };
  const accentBgAlphaStyle = { backgroundColor: `${accentColor}22` };

  const ctaBtnStyle: React.CSSProperties =
    buttonStyle === "outline"
      ? { border: `2px solid ${accentColor}`, color: accentColor, background: "transparent" }
      : buttonStyle === "gradient"
      ? { background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }
      : { background: accentColor };

  const defaultBenefitIcons = [<Zap key={0} />, <Target key={1} />, <Trophy key={2} />, <Shield key={3} />, <Flame key={4} />, <Star key={5} />];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── HERO ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
        {/* Background layer — z:1, always below laser (z:3) */}
        {videoBackgroundUrl ? (
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            <video
              src={videoBackgroundUrl}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              data-testid="video-hero-bg"
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: overlayStrength / 100 }} />
          </div>
        ) : config?.heroImageUrl ? (
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            {/* Mobile focal point override via injected CSS */}
            {mobileHeroImagePosition && mobileHeroImagePosition !== heroImagePosition && (
              <style>{`@media (max-width: 768px) { .hero-bg-img { object-position: ${mobileHeroImagePosition} !important; } }`}</style>
            )}
            <img
              src={config.heroImageUrl}
              alt=""
              aria-hidden="true"
              className="hero-bg-img absolute inset-0 w-full h-full"
              style={{
                objectFit: heroImageFit,
                objectPosition: heroImagePosition,
              }}
              data-testid="img-hero-bg"
            />
            <div className="absolute inset-0 bg-black" style={{ opacity: overlayStrength / 100 }} />
          </div>
        ) : (
          <div className="absolute inset-0 overflow-hidden" style={{ background: heroBg, zIndex: 1 }}>
            <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[120px] translate-x-1/3 -translate-y-1/3" style={{ backgroundColor: `${accentColor}18` }} />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-[100px] -translate-x-1/3 translate-y-1/3" style={{ backgroundColor: `${accentColor}12` }} />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px]" />
          </div>
        )}

        {/* Laser Effects — z:3, above background (z:1), below content (z:10) */}
        <LeadCaptureLaserEffects
          enabled={laserEnabled}
          intensity={laserIntensity}
          preset={laserPreset}
          accentColor={accentColor}
          variant="hero"
        />

        <div
          className={`relative z-10 max-w-4xl mx-auto px-6 py-20 flex flex-col gap-8
            ${heroAlignment === "left" ? "items-start text-left" : heroAlignment === "right" ? "items-end text-right" : "items-center text-center"}`}
        >
          {org.logoUrl && (
            <img src={org.logoUrl} alt={org.name} className="h-16 w-auto object-contain rounded-xl" data-testid="img-org-logo" />
          )}
          {!org.logoUrl && (
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 border" style={{ ...accentBgAlphaStyle, borderColor: `${accentColor}4d` }}>
              <Flame className="h-4 w-4" style={accentStyle} />
              <span className="text-sm font-semibold tracking-wide uppercase" style={accentStyle}>{org.name}</span>
            </div>
          )}

          {/* Urgency badge */}
          {urgencyBadge && (
            <div className="relative inline-flex" data-testid="badge-urgency">
              <LaserUrgencyGlow
                enabled={laserEnabled}
                intensity={laserIntensity}
                preset={laserPreset}
                accentColor={accentColor}
              />
              <div
                className="relative inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-white text-sm font-semibold animate-pulse"
                style={{ ...accentBgStyle, boxShadow: `0 0 20px ${accentColor}60` }}
              >
                <Flame className="h-4 w-4" />
                {urgencyBadge}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h1
              className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-none"
              data-testid="text-hero-headline"
              style={{
                background: `linear-gradient(135deg, #fff 0%, ${accentColor}cc 50%, ${accentColor} 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {headline}
            </h1>
            <p
              className={`text-lg md:text-xl text-white/70 max-w-2xl leading-relaxed ${heroAlignment === "center" ? "mx-auto" : ""}`}
              data-testid="text-hero-subheadline"
            >
              {subheadline}
            </p>
          </div>

          <div className={`flex flex-col sm:flex-row items-center gap-4 ${heroAlignment === "center" ? "justify-center" : heroAlignment === "right" ? "justify-end" : ""}`}>
            <button
              onClick={() => document.getElementById("apply-form")?.scrollIntoView({ behavior: "smooth" })}
              className="group flex items-center gap-3 text-white font-bold px-8 py-4 rounded-2xl text-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl"
              style={{ ...ctaBtnStyle, boxShadow: `0 0 0 0 ${accentColor}00` }}
              data-testid="button-hero-cta"
            >
              {ctaText}
              <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Clock className="h-4 w-4" />
              <span>Takes 3 minutes</span>
            </div>
          </div>

          <div className={`flex flex-wrap items-center gap-6 pt-4 ${heroAlignment === "center" ? "justify-center" : heroAlignment === "right" ? "justify-end" : ""}`}>
            {["Free Application", "No Commitment Required", "Response in 24hrs"].map((t) => (
              <div key={t} className="flex items-center gap-1.5 text-white/50 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-white/20 flex items-start justify-center pt-1.5">
            <div className="w-1 h-2 bg-white/40 rounded-full animate-pulse" />
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ── */}
      <section className="py-20 px-6 bg-zinc-900/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge
              className="mb-4 text-xs tracking-widest uppercase border"
              style={{ ...accentBgAlphaStyle, color: accentColor, borderColor: `${accentColor}4d` }}
            >
              {funnelType === "team_training" ? "Partner Results" : funnelType === "employment_opportunity" ? "Coach Stories" : "Athlete Results"}
            </Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              {funnelType === "team_training" ? "What Programs Are Saying" : funnelType === "employment_opportunity" ? "From Our Coaching Team" : "What Athletes Are Saying"}
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {socialProof.map((sp, i) => (
              <div
                key={i}
                className="relative overflow-hidden group bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 space-y-4 transition-colors"
                style={{ ["--hover-border" as any]: `${accentColor}4d` }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = `${accentColor}4d`)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                data-testid={`card-social-proof-${i}`}
              >
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} cornerPosition="top-right" sweepDuration={11} sweepDelay={i * 1.5} />
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-white/80 text-sm leading-relaxed italic">"{sp.quote}"</p>
                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs" style={{ ...accentBgAlphaStyle, color: accentColor }}>
                    {sp.name[0]}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{sp.name}</p>
                    {sp.sport && <p className="text-white/40 text-xs">{sp.sport}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENEFITS ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <Badge
              className="mb-4 text-xs tracking-widest uppercase border"
              style={{ ...accentBgAlphaStyle, color: accentColor, borderColor: `${accentColor}4d` }}
            >
              {funnelType === "team_training" ? "The Partnership" : funnelType === "employment_opportunity" ? "The Opportunity" : "The Program"}
            </Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              {funnelType === "team_training" ? `Why Programs Partner With ${org.name}` : funnelType === "employment_opportunity" ? `Why Coaches Join ${org.name}` : `Why Athletes Choose ${org.name}`}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {benefits.map((b, i) => (
              <div
                key={i}
                className="relative overflow-hidden group flex items-start gap-4 bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:bg-white/8 transition-all duration-300"
                onMouseEnter={e => (e.currentTarget.style.borderColor = `${accentColor}4d`)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                data-testid={`card-benefit-${i}`}
              >
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} cornerPosition="top-left" sweepDuration={9} sweepDelay={i * 1.2} />
                <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors" style={{ ...accentBgAlphaStyle, color: accentColor }}>
                  {defaultBenefitIcons[i % defaultBenefitIcons.length]}
                </div>
                <div>
                  <h3 className="text-white font-bold mb-1">{b.title}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IS THIS FOR ── */}
      {(whoIsThisFor || whoCards.length > 0) ? (
        <section className="py-20 px-6" style={{ background: `linear-gradient(to right, ${accentColor}18, transparent, ${accentColor}10)` }}>
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <Badge className="text-xs tracking-widest uppercase border" style={{ ...accentBgAlphaStyle, color: accentColor, borderColor: `${accentColor}4d` }}>Is This For You?</Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">Who This Program Is For</h2>
            {whoIsThisFor && <div className="text-white/70 text-lg leading-relaxed whitespace-pre-line">{whoIsThisFor}</div>}
            {whoCards.length > 0 && (
              <div className="grid sm:grid-cols-3 gap-4 text-left mt-4">
                {whoCards.map((card) => (
                  <div key={card.id} className="relative overflow-hidden group rounded-xl border p-4 bg-white/5" style={{ borderColor: `${accentColor}30` }}>
                    <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} cornerPosition="top-left" sweepDuration={12} sweepDelay={0} />
                    <p className="font-bold text-white text-sm mb-1">{card.title}</p>
                    <p className="text-white/55 text-xs leading-relaxed">{card.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="py-20 px-6" style={{ background: `linear-gradient(to right, ${accentColor}18, transparent, ${accentColor}10)` }}>
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <Badge className="mb-4 text-xs tracking-widest uppercase border" style={{ ...accentBgAlphaStyle, color: accentColor, borderColor: `${accentColor}4d` }}>Is This For You?</Badge>
              <h2 className="text-3xl md:text-4xl font-black text-white">
                {funnelType === "team_training" ? "Built For Competitive Programs" : funnelType === "employment_opportunity" ? "Built For Elite Coaches" : "Built For Serious Athletes"}
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {(funnelType === "team_training" ? [
                "High school and club athletic programs",
                "ADs looking for professional S&C infrastructure",
                "Programs that want measurable athlete improvement",
                "Teams seeking a budget-flexible coaching solution",
                "Organizations without a full-time S&C hire",
                "Any sport — football, basketball, soccer, track, and more",
              ] : funnelType === "employment_opportunity" ? [
                "Certified S&C coaches (CSCS, CSCCA, CPT)",
                "Former collegiate athletes with sport-specific expertise",
                "Coaches looking to grow a performance coaching business",
                "Trainers ready to specialize in athletic performance",
                "Coaches who want flexibility and a steady client pipeline",
                "Full-time or part-time — we fit your schedule",
              ] : [
                "Athletes serious about next-level performance",
                "Student-athletes pursuing college recruitment",
                "Competitors who want an edge in their sport",
                "Athletes recovering and building back stronger",
                "Athletes ready to commit to the process",
                "Any age level — youth through college",
              ]).map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-white/80">
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={accentStyle} />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── MULTI-STEP FORM ── */}
      <section id="apply-form" className="relative py-20 px-6 bg-zinc-900/70" style={{ paddingBottom: "max(80px, calc(80px + env(safe-area-inset-bottom)))" }}>
        {laserCardsActive && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ background: `radial-gradient(ellipse at 50% 0%, ${accentColor}0c 0%, transparent 55%)`, zIndex: 0 }} />
        )}
        <div className="relative max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <Badge className="mb-4 text-xs tracking-widest uppercase border" style={{ ...accentBgAlphaStyle, color: accentColor, borderColor: `${accentColor}4d` }}>
              {funnelType === "team_training" ? "Consultation Request" : funnelType === "employment_opportunity" ? "Coach Application" : "Application"}
            </Badge>
            <h2 className="text-3xl md:text-4xl font-black text-white">
              {submitted ? "Application Complete" : `Apply to ${program.name}`}
            </h2>
            {!submitted && (
              <p className="text-white/60 mt-3 text-sm">Step {Math.min(step, 4)} of 4 — takes about 3 minutes</p>
            )}
          </div>

          {!submitted && step < 5 && (
            <div className="mb-8">
              <ProgressBar step={step} total={4} />
            </div>
          )}

          <div
            key={step}
            style={{ animation: `${animDir === "forward" ? "slideInRight" : "slideInLeft"} 0.3s ease-out` }}
          >
            {/* STEP 1 */}
            {step === 1 && (
              <StepCard>
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} sweepDuration={8} sweepDelay={0} />
                <div className="space-y-2 mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Users className="h-5 w-5 text-orange-400" />
                    Let's start with you
                  </h3>
                  <p className="text-white/50 text-sm">Tell us who's applying</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Athlete Name <span className="text-orange-400">*</span></Label>
                    <Input
                      placeholder="First and Last Name"
                      value={form.athleteName}
                      onChange={(e) => set("athleteName", e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                      data-testid="input-athlete-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Parent / Guardian Name <span className="text-white/30">(optional)</span></Label>
                    <Input
                      placeholder="Parent or Guardian"
                      value={form.parentName}
                      onChange={(e) => set("parentName", e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                      data-testid="input-parent-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Email Address <span className="text-orange-400">*</span></Label>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Phone Number <span className="text-white/30">(optional)</span></Label>
                    <Input
                      type="tel"
                      placeholder="(555) 000-0000"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                      data-testid="input-phone"
                    />
                  </div>
                </div>
              </StepCard>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <StepCard>
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} sweepDuration={9} sweepDelay={0.5} />
                <div className="space-y-2 mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-orange-400" />
                    Your athletic profile
                  </h3>
                  <p className="text-white/50 text-sm">Help us understand your background</p>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-white/70 text-sm">Age</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 16"
                        min={8}
                        max={30}
                        value={form.age}
                        onChange={(e) => set("age", e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                        data-testid="input-age"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-white/70 text-sm">Grade</Label>
                      <Select value={form.grade} onValueChange={(v) => set("grade", v)}>
                        <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 rounded-xl" data-testid="select-grade">
                          <SelectValue placeholder="Select grade" />
                        </SelectTrigger>
                        <SelectContent>
                          {GRADE_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-white/70 text-sm">Primary Sport</Label>
                      <Input
                        placeholder="e.g. Football"
                        value={form.sport}
                        onChange={(e) => set("sport", e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                        data-testid="input-sport"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-white/70 text-sm">Position</Label>
                      <Input
                        placeholder="e.g. Wide Receiver"
                        value={form.position}
                        onChange={(e) => set("position", e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                        data-testid="input-position"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">School / Team</Label>
                    <Input
                      placeholder="e.g. Lincoln High School"
                      value={form.school}
                      onChange={(e) => set("school", e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 h-12 rounded-xl"
                      data-testid="input-school"
                    />
                  </div>
                </div>
              </StepCard>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <StepCard>
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} sweepDuration={10} sweepDelay={1} />
                <div className="space-y-2 mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Target className="h-5 w-5 text-orange-400" />
                    Your goals & experience
                  </h3>
                  <p className="text-white/50 text-sm">What are you working toward?</p>
                </div>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-white/70 text-sm">Training Goals <span className="text-orange-400">*</span> <span className="text-white/30">(select all that apply)</span></Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {GOAL_OPTIONS.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => toggleGoal(g)}
                          className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm text-left transition-all duration-200 border ${
                            form.goals.includes(g)
                              ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                              : "bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white/80"
                          }`}
                          data-testid={`button-goal-${g.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${
                            form.goals.includes(g) ? "bg-orange-500 border-orange-500" : "border-white/20"
                          }`}>
                            {form.goals.includes(g) && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </div>
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Experience Level</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {EXPERIENCE_OPTIONS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => set("experienceLevel", e)}
                          className={`px-4 py-3 rounded-xl text-sm text-left border transition-all ${
                            form.experienceLevel === e
                              ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                              : "bg-white/5 border-white/10 text-white/60 hover:border-white/20"
                          }`}
                          data-testid={`button-experience-${e.split(" ")[0].toLowerCase()}`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Current Training Status</Label>
                    <Select value={form.currentTrainingStatus} onValueChange={(v) => set("currentTrainingStatus", v)}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 rounded-xl" data-testid="select-training-status">
                        <SelectValue placeholder="Select current training" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAINING_STATUS_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </StepCard>
            )}

            {/* STEP 4 */}
            {step === 4 && (
              <StepCard>
                <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} sweepDuration={11} sweepDelay={1.5} />
                <div className="space-y-2 mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Flame className="h-5 w-5 text-orange-400" />
                    Almost done
                  </h3>
                  <p className="text-white/50 text-sm">Tell us where you're at mentally</p>
                </div>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-white/70 text-sm">How ready are you? <span className="text-orange-400">*</span></Label>
                    <div className="space-y-2">
                      {COMMITMENT_OPTIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => set("commitmentLevel", c)}
                          className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl text-sm text-left border transition-all ${
                            form.commitmentLevel === c
                              ? "bg-orange-500/20 border-orange-500/50 text-orange-200"
                              : "bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:bg-white/8"
                          }`}
                          data-testid={`button-commitment-${c.split(" ")[0].toLowerCase()}`}
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            form.commitmentLevel === c ? "border-orange-500 bg-orange-500" : "border-white/20"
                          }`}>
                            {form.commitmentLevel === c && <div className="w-2 h-2 rounded-full bg-white" />}
                          </div>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Anything else you want us to know? <span className="text-white/30">(optional)</span></Label>
                    <Textarea
                      placeholder="Injuries, specific goals, questions, or anything on your mind..."
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      rows={4}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-orange-500/50 rounded-xl resize-none"
                      data-testid="textarea-notes"
                    />
                  </div>
                </div>
              </StepCard>
            )}

            {/* SUCCESS — Premium Onboarding Conversion Flow */}
            {(step === 5 || submitted) && (
              <div className="space-y-5" style={{ animation: "slideInRight 0.4s ease-out" }}>
                {/* Confirmation badge */}
                <div className="flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 bg-orange-500/15 border border-orange-500/30 rounded-full px-5 py-2">
                    <CheckCircle2 className="h-4 w-4 text-orange-400 fill-orange-400/20" />
                    <span className="text-orange-300 text-sm font-semibold tracking-wide">Application Received</span>
                  </div>
                </div>

                {/* Hero confirmation */}
                <StepCard className="text-center !pb-8" style={{ position: "relative", overflow: "hidden" }}>
                  <LeadCaptureLaserEffects
                    enabled={laserEnabled}
                    intensity={laserIntensity}
                    preset={laserPreset}
                    accentColor={accentColor}
                    variant="success"
                  />
                  <div className="space-y-4 py-4 relative z-10">
                    <div className="relative inline-flex mx-auto">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center shadow-2xl shadow-orange-500/40">
                        <CheckCircle2 className="h-10 w-10 text-white" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/40">
                        <Star className="h-3.5 w-3.5 text-white fill-white" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-2xl md:text-3xl font-black text-white mb-2" data-testid="text-success-headline">
                        You're In, {(submitResult?.athleteName || form.athleteName).split(" ")[0]}!
                      </h3>
                      <p className="text-white/60 text-sm leading-relaxed max-w-xs mx-auto">
                        Your application to <strong className="text-orange-400">{submitResult?.programName || program.name}</strong> is being reviewed by the coaching staff.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-6 pt-2">
                      {[
                        { icon: <CheckCircle2 className="h-4 w-4" />, label: "Received" },
                        { icon: <Clock className="h-4 w-4" />, label: "24hr Review" },
                        { icon: <Zap className="h-4 w-4" />, label: "Start Training" },
                      ].map((item, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5 text-center">
                          <div className="w-9 h-9 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
                            {item.icon}
                          </div>
                          <p className="text-white/50 text-[11px] leading-tight">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </StepCard>

                {/* Onboarding conversion CTA */}
                <div className="relative overflow-hidden group rounded-2xl border border-green-500/20 bg-gradient-to-br from-green-950/60 via-zinc-900/80 to-zinc-950/90 backdrop-blur-xl p-6 md:p-8">
                  <LaserBorderSweep enabled={laserCardsActive} intensity={laserIntensity} preset={laserPreset} accentColor={accentColor} cornerPosition="top-right" sweepDuration={12} sweepDelay={2} />
                  {/* Glow */}
                  <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-green-500/8 blur-3xl pointer-events-none" />
                  <div className="relative space-y-5">
                    {/* Onboarding progress steps */}
                    <div className="flex items-center gap-0 mb-2">
                      {[
                        { num: 1, label: "Applied", done: true },
                        { num: 2, label: "Create Account", done: false, active: true },
                        { num: 3, label: "Book Session", done: false },
                      ].map((s, i) => (
                        <div key={s.num} className="flex items-center flex-1">
                          <div className="flex flex-col items-center flex-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                              s.done
                                ? "bg-green-500 text-white shadow-lg shadow-green-500/40"
                                : s.active
                                ? "bg-white/10 border-2 border-green-500 text-green-400 ring-4 ring-green-500/20"
                                : "bg-white/5 border border-white/15 text-white/25"
                            }`}>
                              {s.done ? <CheckCircle2 className="h-4 w-4" /> : s.num}
                            </div>
                            <span className={`text-[10px] mt-1.5 font-medium tracking-wide ${
                              s.done ? "text-green-400" : s.active ? "text-white/80" : "text-white/25"
                            }`}>{s.label}</span>
                          </div>
                          {i < 2 && (
                            <div className={`h-px flex-1 mb-5 mx-1 ${s.done ? "bg-green-500/50" : "bg-white/10"}`} />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Headline */}
                    <div className="space-y-1.5">
                      <h4 className="text-xl font-black text-white">Ready To Get Started?</h4>
                      <p className="text-white/55 text-sm leading-relaxed">
                        Create your athlete account to track your application, access training resources, and lock in your evaluation session.
                      </p>
                    </div>

                    {/* Account benefits */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {[
                        { icon: <Users className="h-3.5 w-3.5" />, text: "Track your application status" },
                        { icon: <Zap className="h-3.5 w-3.5" />, text: "Access the athlete dashboard" },
                        { icon: <Trophy className="h-3.5 w-3.5" />, text: "Book your evaluation session" },
                        { icon: <Shield className="h-3.5 w-3.5" />, text: "Secure, private athlete profile" },
                      ].map((b, i) => (
                        <div key={i} className="flex items-center gap-2 text-white/60 text-xs">
                          <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center text-green-400 flex-shrink-0">
                            {b.icon}
                          </div>
                          {b.text}
                        </div>
                      ))}
                    </div>

                    {/* Primary CTA */}
                    <a
                      href={`/api/auth/login?returnTo=/org/${submitResult?.orgSlug || org.slug}`}
                      className="group w-full flex items-center justify-center gap-3 bg-gradient-to-r from-green-500 to-emerald-400 hover:from-green-400 hover:to-emerald-300 text-white font-bold py-4 px-6 rounded-2xl text-base transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-green-500/25"
                      data-testid="button-create-account"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      Create Account & Schedule
                      <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                    </a>

                    {/* Direct booking shortcut (if available) */}
                    {(submitResult?.bookingUrl || (data as any)?.config?.bookingUrl) && (
                      <a
                        href={submitResult?.bookingUrl || (data as any).config.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 border border-green-500/25 text-green-400 hover:bg-green-500/10 font-semibold py-3.5 px-6 rounded-2xl text-sm transition-all duration-200"
                        data-testid="button-book-direct"
                      >
                        <Clock className="h-4 w-4" />
                        Book Evaluation Directly (No Account Needed)
                      </a>
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/8" />
                      <span className="text-white/25 text-xs">or</span>
                      <div className="flex-1 h-px bg-white/8" />
                    </div>

                    {/* Secondary CTAs */}
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <a
                        href={`/org/${submitResult?.orgSlug || org.slug}`}
                        className="flex-1 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-orange-500/30 text-white/70 hover:text-white font-semibold py-3.5 rounded-xl text-sm transition-all duration-200"
                        data-testid="button-browse-training"
                      >
                        Browse Training Options
                      </a>
                      <a
                        href={`/org/${submitResult?.orgSlug || org.slug}`}
                        className="flex-1 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 text-white/50 hover:text-white/70 font-medium py-3.5 rounded-xl text-sm transition-all duration-200"
                        data-testid="link-back-to-org"
                      >
                        Return to {submitResult?.orgName || org.name}
                      </a>
                    </div>

                    {/* Continue as guest */}
                    <p className="text-center text-white/25 text-xs">
                      Already have an account?{" "}
                      <a
                        href={`/api/auth/login?returnTo=/org/${submitResult?.orgSlug || org.slug}`}
                        className="text-white/40 hover:text-white/60 underline underline-offset-2 transition-colors"
                        data-testid="link-sign-in"
                      >
                        Sign in
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          {step < 5 && !submitted && (
            <div className="flex items-center gap-3 mt-6">
              {step > 1 && (
                <Button
                  variant="outline"
                  onClick={goBack}
                  className="flex-1 border-white/10 text-white/70 hover:bg-white/5 hover:text-white h-14 rounded-xl text-base"
                  data-testid="button-prev-step"
                >
                  <ChevronLeft className="h-5 w-5 mr-1" />
                  Back
                </Button>
              )}
              <button
                onClick={goNext}
                disabled={submitMutation.isPending}
                className="flex-1 flex items-center justify-center gap-3 disabled:opacity-50 text-white font-bold h-14 rounded-xl text-base transition-all duration-300 hover:scale-[1.02] hover:shadow-xl"
                style={{ ...ctaBtnStyle }}
                data-testid="button-next-step"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Submitting...
                  </>
                ) : step === 4 ? (
                  <>
                    {funnelType === "team_training" ? "Request Consultation" : funnelType === "employment_opportunity" ? "Submit Application" : "Submit Application"}
                    <CheckCircle2 className="h-5 w-5" />
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── STICKY CTA (mobile only) ──
           Pre-form:  visible when form section is NOT in viewport
           Mid-form:  hidden — inline Continue/Submit buttons take over
           Success:   shows primary post-submission action
      */}
      {(() => {
        // A step > 1 means user has advanced through the form (form always in view)
        const isFormActive = (formInView || step > 1) && !submitted;
        const showPreForm  = !isFormActive && !submitted;
        const showSuccess  = submitted;
        const visible      = showPreForm || showSuccess;

        const successHref = submitResult?.bookingUrl
          ? submitResult.bookingUrl
          : `/api/auth/login?returnTo=/org/${submitResult?.orgSlug || orgSlug}`;
        const successLabel = submitResult?.bookingUrl
          ? (funnelType === "team_training" ? "Book Consultation" : "Book Your Evaluation")
          : "Create Account & Schedule";

        return (
          <div
            className={`fixed bottom-0 left-0 right-0 z-50 md:hidden transition-all duration-300 ease-in-out ${
              visible ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-full opacity-0 pointer-events-none"
            }`}
            style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
            aria-hidden={!visible}
          >
            <div className="px-4 pt-3 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent">
              {showSuccess ? (
                <a
                  href={successHref}
                  target={submitResult?.bookingUrl ? "_blank" : undefined}
                  rel={submitResult?.bookingUrl ? "noopener noreferrer" : undefined}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-400 text-white font-bold py-4 rounded-2xl text-base shadow-2xl"
                  style={{ boxShadow: "0 8px 32px rgba(34,197,94,0.35)" }}
                  data-testid="button-sticky-success-cta"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  {successLabel}
                  <ArrowRight className="h-5 w-5" />
                </a>
              ) : (
                <button
                  onClick={() => document.getElementById("apply-form")?.scrollIntoView({ behavior: "smooth" })}
                  className="w-full flex items-center justify-center gap-2 text-white font-bold py-4 rounded-2xl text-base shadow-2xl"
                  style={{ ...ctaBtnStyle, boxShadow: `0 8px 32px ${accentColor}40` }}
                  data-testid="button-sticky-cta"
                >
                  {ctaText}
                  <ArrowRight className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── FOOTER ── */}
      <footer className="py-8 px-6 border-t border-white/5 bg-zinc-950">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-sm">&copy; {new Date().getFullYear()} {org.name}. All rights reserved.</p>
          <div className="flex items-center gap-1.5 text-white/20 text-xs">
            <Shield className="h-3 w-3" />
            <span>Your information is secure and never shared</span>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
