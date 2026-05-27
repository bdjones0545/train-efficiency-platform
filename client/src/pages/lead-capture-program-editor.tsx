import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation, useSearch } from "wouter";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Save, Eye, Copy, ExternalLink, BarChart2, Settings2, Image, Star,
  Users, Zap, Layout, BookOpen, Calendar, Palette, Loader2, Plus, Trash2,
  GripVertical, ChevronUp, ChevronDown, Check, AlertTriangle, Globe, Link2,
  TrendingUp, Target, Lightbulb, Smartphone, Monitor, RefreshCw,
  X, Award, Shield, Flame, Dumbbell, BriefcaseBusiness, GitBranch,
  Workflow, Bell, Bot, FileCheck, DollarSign, ClipboardList,
  Upload, Video, Film, ImagePlus, ChevronDown as ChevronDownIcon, Library, UserCircle2,
  Rocket, FlaskConical, CheckCircle2, XCircle, AlertCircle, Clock, Wrench, PlayCircle
} from "lucide-react";
import { getAuthHeaders } from "@/lib/authToken";
import { LeadCaptureLaserEffects, getDefaultLaserPreset } from "@/components/lead-capture-laser-effects";

// ─── Types ───────────────────────────────────────────────────────────────────

type FunnelType = "athlete_application" | "team_training" | "employment_opportunity";

type CheckStatus = "passed" | "warning" | "failed" | "skipped";
type HealthBadge = "ready" | "needs_attention" | "blocked";

interface PreflightCheck {
  id: string;
  label: string;
  description: string;
  status: CheckStatus;
  detail?: string;
  autoFixable: boolean;
  fixLabel?: string;
}

interface PreflightResult {
  programId: string;
  orgId: string;
  healthBadge: HealthBadge;
  checks: PreflightCheck[];
  passedCount: number;
  warningCount: number;
  failedCount: number;
  canLaunch: boolean;
  canLaunchWithWarnings: boolean;
  ranAt: string;
  durationMs: number;
  dryRunResult?: {
    routeResolves: boolean;
    pipelineWouldRun: boolean;
    gmailDraftWouldQueue: boolean;
    pipelineStageWouldInit: boolean;
    noRealRecordsCommitted: boolean;
    simulatedScore?: number;
    simulatedTemperature?: string;
    simulatedDraftSubject?: string;
    errors: string[];
  };
}

interface Testimonial {
  id: string;
  name: string;
  role: string;
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
  type: "text" | "select" | "textarea" | "checkbox";
  options?: string[];
  custom?: boolean;
  placeholder?: string;
}

interface ExtendedConfig {
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
  laserEffectsEnabled?: boolean;
  laserIntensity?: "subtle" | "standard" | "high";
  laserPreset?: "performance-orange" | "team-cyan" | "career-purple" | "elite-green";
  laserCardsEnabled?: boolean;
  heroImageFit?: "cover" | "contain" | "fill";
  heroImagePosition?: string;
  mobileHeroImagePosition?: string;
}

interface LeadCaptureConfig {
  id: string;
  programId: string;
  funnelType: FunnelType;
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

// ─── Funnel Type Configs ──────────────────────────────────────────────────────

const FUNNEL_CONFIGS: Record<FunnelType, {
  label: string;
  badgeLabel: string;
  icon: React.ReactNode;
  accent: string;          // Tailwind text color
  accentBg: string;        // Tailwind bg (light)
  accentBorder: string;    // Tailwind border
  accentHex: string;       // CSS hex for color picker
  gradientPreset: string;
  defaultHeadline: string;
  defaultSubheadline: string;
  defaultCtaText: string;
  defaultUrgencyBadge: string;
  defaultFormFields: FormField[];
  defaultBenefits: BenefitCard[];
  defaultWhoCards: WhoCard[];
  automations: { icon: React.ReactNode; title: string; desc: string }[];
  aiRecs: string[];
  analyticsLabel: string;
  testimonialRoleLabel: string;
}> = {
  athlete_application: {
    label: "Athlete Application",
    badgeLabel: "B2C",
    icon: <Dumbbell className="h-4 w-4" />,
    accent: "text-orange-400",
    accentBg: "bg-orange-500/10",
    accentBorder: "border-orange-500/20",
    accentHex: "#f97316",
    gradientPreset: "orange-dark",
    defaultHeadline: "Train Like an Elite Athlete",
    defaultSubheadline: "Apply now and take the first step toward your athletic potential.",
    defaultCtaText: "Apply Now",
    defaultUrgencyBadge: "Summer Enrollment Open — Limited Spots",
    defaultBenefits: [
      { id: "b1", title: "Elite Coaching", description: "Work with proven D1-level coaches", icon: "Award", accentColor: "#f97316" },
      { id: "b2", title: "Proven Results", description: "Athletes averaging 12% performance gains", icon: "TrendingUp", accentColor: "#f97316" },
      { id: "b3", title: "Sport-Specific Training", description: "Programs tailored to your sport and position", icon: "Target", accentColor: "#f97316" },
    ],
    defaultWhoCards: [
      { id: "w1", title: "High School Athletes", description: "Serious about earning a college scholarship", icon: "Flame" },
      { id: "w2", title: "College Athletes", description: "Looking to perform at the highest level", icon: "Award" },
      { id: "w3", title: "Youth Athletes (13+)", description: "Building the right foundation early", icon: "Zap" },
    ],
    defaultFormFields: [
      { id: "athleteName", label: "Athlete Name", enabled: true, required: true, type: "text", placeholder: "Marcus Thompson" },
      { id: "parentName", label: "Parent / Guardian Name", enabled: true, required: false, type: "text", placeholder: "Sarah Thompson" },
      { id: "email", label: "Email Address", enabled: true, required: true, type: "text", placeholder: "marcus@email.com" },
      { id: "phone", label: "Phone Number", enabled: true, required: false, type: "text", placeholder: "(555) 123-4567" },
      { id: "age", label: "Age", enabled: true, required: false, type: "text", placeholder: "16" },
      { id: "grade", label: "Grade / Year", enabled: true, required: false, type: "text", placeholder: "11th Grade" },
      { id: "sport", label: "Primary Sport", enabled: true, required: false, type: "text", placeholder: "Football, Basketball, Track..." },
      { id: "position", label: "Position", enabled: false, required: false, type: "text", placeholder: "Running Back" },
      { id: "school", label: "School / Team", enabled: true, required: false, type: "text", placeholder: "Lincoln High School" },
      { id: "experienceLevel", label: "Experience Level", enabled: true, required: false, type: "select", options: ["Beginner", "Intermediate", "Advanced", "Elite"] },
      { id: "commitmentLevel", label: "Commitment Level", enabled: true, required: false, type: "select", options: ["1-2x/week", "3-4x/week", "5+/week", "Full Program"] },
      { id: "goals", label: "Athletic Goals", enabled: true, required: false, type: "checkbox", options: ["Speed", "Strength", "Agility", "Endurance", "Injury Prevention"] },
      { id: "notes", label: "Additional Notes", enabled: true, required: false, type: "textarea", placeholder: "Anything else we should know..." },
    ],
    automations: [
      { icon: <Bot className="h-4 w-4" />, title: "AI Qualification Scoring", desc: "Every submission is scored 0–100 for intent, commitment, and fit. High scorers (≥70) are flagged automatically." },
      { icon: <Bell className="h-4 w-4" />, title: "Instant Admin Notification", desc: "Email sent to your admin inbox the moment an application lands with the AI score and key highlights." },
      { icon: <Workflow className="h-4 w-4" />, title: "Follow-Up Sequences", desc: "Automated 1hr, 24hr, 3-day, and 7-day follow-up emails triggered per lead based on intent score." },
      { icon: <GitBranch className="h-4 w-4" />, title: "Abandonment Recovery", desc: "Partial captures (Step 1 only) trigger a 30-min and 24-hr recovery sequence to bring leads back." },
    ],
    aiRecs: [
      "Shorter forms (+3 fewer fields) show 22% higher completion rates for B2C athlete funnels.",
      "Football athletes convert 31% better from Instagram vs other paid channels.",
      "Programs with urgency badges see 9% lift in same-session applications.",
      "Adding a parent testimonial alongside the athlete's increases trust score by ~18 points.",
      "Your hero CTA could use stronger action language — 'Claim Your Spot' outperforms 'Apply Now' by 7%.",
    ],
    analyticsLabel: "Athlete Applications",
    testimonialRoleLabel: "Sport / Position",
  },

  team_training: {
    label: "Team Training",
    badgeLabel: "B2B",
    icon: <Users className="h-4 w-4" />,
    accent: "text-cyan-400",
    accentBg: "bg-cyan-500/10",
    accentBorder: "border-cyan-500/20",
    accentHex: "#06b6d4",
    gradientPreset: "blue-dark",
    defaultHeadline: "Elevate Your Team's Performance",
    defaultSubheadline: "Partner with proven strength & conditioning professionals to transform your program.",
    defaultCtaText: "Request a Consultation",
    defaultUrgencyBadge: "Now Accepting School Partnerships — Q3 2026",
    defaultBenefits: [
      { id: "b1", title: "Turnkey Programs", description: "Full S&C program design delivered to your facility", icon: "Zap", accentColor: "#06b6d4" },
      { id: "b2", title: "Proven Track Record", description: "Teams see measurable athletic improvement in 8 weeks", icon: "TrendingUp", accentColor: "#06b6d4" },
      { id: "b3", title: "Budget-Flexible Options", description: "Scalable pricing for programs of all sizes", icon: "Shield", accentColor: "#06b6d4" },
    ],
    defaultWhoCards: [
      { id: "w1", title: "High School Athletic Directors", description: "Building a competitive strength program from scratch", icon: "Award" },
      { id: "w2", title: "Club & Travel Teams", description: "Seeking a competitive edge over rival programs", icon: "Target" },
      { id: "w3", title: "College Programs (NAIA/JUCO)", description: "Need professional S&C without a full-time hire", icon: "Users" },
    ],
    defaultFormFields: [
      { id: "orgName", label: "Organization / School Name", enabled: true, required: true, type: "text", placeholder: "Lincoln High School" },
      { id: "contactName", label: "Contact Name", enabled: true, required: true, type: "text", placeholder: "Coach Johnson" },
      { id: "role", label: "Role / Title", enabled: true, required: true, type: "text", placeholder: "Athletic Director" },
      { id: "email", label: "Email Address", enabled: true, required: true, type: "text", placeholder: "johnson@lincoln.edu" },
      { id: "phone", label: "Phone Number", enabled: true, required: true, type: "text", placeholder: "(555) 123-4567" },
      { id: "sport", label: "Primary Sport(s)", enabled: true, required: false, type: "text", placeholder: "Football, Basketball, Track" },
      { id: "teamSize", label: "Team Size", enabled: true, required: false, type: "select", options: ["1–10 athletes", "11–25 athletes", "26–50 athletes", "51–100 athletes", "100+ athletes"] },
      { id: "ageGroup", label: "Age Group", enabled: true, required: false, type: "select", options: ["Youth (under 13)", "High School (13–18)", "College (18–22)", "Adult / Professional"] },
      { id: "trainingGoals", label: "Training Goals", enabled: true, required: false, type: "checkbox", options: ["Speed & Agility", "Strength & Power", "Injury Prevention", "In-Season Maintenance", "Off-Season Development"] },
      { id: "currentSetup", label: "Current Training Setup", enabled: true, required: false, type: "select", options: ["No formal S&C program", "Coach-led (non-specialist)", "Part-time S&C coach", "Full-time S&C staff"] },
      { id: "budgetRange", label: "Budget Range", enabled: true, required: false, type: "select", options: ["Under $5K/year", "$5K–$15K/year", "$15K–$30K/year", "$30K+ / year", "Prefer to discuss"] },
      { id: "timeline", label: "Preferred Start Timeline", enabled: true, required: false, type: "select", options: ["ASAP (within 30 days)", "Next quarter", "Start of new season", "Just exploring"] },
      { id: "notes", label: "Additional Information", enabled: true, required: false, type: "textarea", placeholder: "Tell us about your program, current challenges, or any specific needs..." },
    ],
    automations: [
      { icon: <GitBranch className="h-4 w-4" />, title: "Auto-Create Pipeline Deal", desc: "Every B2B submission automatically creates a deal in your team training pipeline with estimated contract value." },
      { icon: <Bot className="h-4 w-4" />, title: "B2B Lead Classification", desc: "AI scores leads on organization size, budget signals, and timeline urgency to surface highest-value opportunities first." },
      { icon: <Bell className="h-4 w-4" />, title: "Priority Admin Notification", desc: "Instant notification to your sales/admin contact with lead grade, org size, and recommended first move." },
      { icon: <Workflow className="h-4 w-4" />, title: "B2B Follow-Up Sequence", desc: "Customized multi-touch follow-up for school/org decision-makers with longer consideration cycles (day 1, 3, 7, 14)." },
    ],
    aiRecs: [
      "Decision-maker titles in your form ('Athletic Director', 'Head Coach') increase reply rates by 34% in B2B follow-up.",
      "Including budget range as optional (not required) reduces drop-off by 28% while still capturing 71% of responses.",
      "B2B funnels with social proof from named schools/organizations see 41% better conversion vs generic testimonials.",
      "Team size data helps AI score deal value — enable this field for better pipeline accuracy.",
      "Funnels mentioning 'partnership' vs 'services' in the headline convert 19% better in school/AD audiences.",
    ],
    analyticsLabel: "B2B Inquiries",
    testimonialRoleLabel: "Organization / Role",
  },

  employment_opportunity: {
    label: "Employment Opportunity",
    badgeLabel: "HIRING",
    icon: <BriefcaseBusiness className="h-4 w-4" />,
    accent: "text-purple-400",
    accentBg: "bg-purple-500/10",
    accentBorder: "border-purple-500/20",
    accentHex: "#a855f7",
    gradientPreset: "purple-dark",
    defaultHeadline: "Join Our Coaching Staff",
    defaultSubheadline: "We're building a team of elite strength & conditioning coaches. If you're serious about developing athletes, we want to talk.",
    defaultCtaText: "Apply to Coach",
    defaultUrgencyBadge: "Now Hiring — Full-Time & Part-Time Positions",
    defaultBenefits: [
      { id: "b1", title: "Competitive Compensation", description: "Performance-based pay with platform revenue share", icon: "DollarSign", accentColor: "#a855f7" },
      { id: "b2", title: "Athlete Pipeline", description: "Access to a built-in roster of motivated athletes", icon: "Users", accentColor: "#a855f7" },
      { id: "b3", title: "Scheduling Freedom", description: "Set your own availability and session cadence", icon: "Shield", accentColor: "#a855f7" },
    ],
    defaultWhoCards: [
      { id: "w1", title: "Certified S&C Coaches", description: "NSCA, CSCCa, or equivalent credentials", icon: "Award" },
      { id: "w2", title: "Former Collegiate Athletes", description: "Who bring sport-specific expertise and credibility", icon: "Flame" },
      { id: "w3", title: "Personal Trainers", description: "Looking to specialize in athletic performance", icon: "Target" },
    ],
    defaultFormFields: [
      { id: "name", label: "Full Name", enabled: true, required: true, type: "text", placeholder: "Alex Rivera" },
      { id: "email", label: "Email Address", enabled: true, required: true, type: "text", placeholder: "alex@email.com" },
      { id: "phone", label: "Phone Number", enabled: true, required: false, type: "text", placeholder: "(555) 123-4567" },
      { id: "certifications", label: "Certifications", enabled: true, required: false, type: "checkbox", options: ["CSCS (NSCA)", "CSCCA", "CPT (NASM/ACE/ACSM)", "CrossFit L1/L2", "USA Weightlifting", "Other"] },
      { id: "yearsExperience", label: "Years of Coaching Experience", enabled: true, required: false, type: "select", options: ["Less than 1 year", "1–3 years", "3–5 years", "5–10 years", "10+ years"] },
      { id: "sportsWorked", label: "Sports Worked With", enabled: true, required: false, type: "text", placeholder: "Football, Basketball, Track, Soccer..." },
      { id: "desiredRole", label: "Desired Role", enabled: true, required: false, type: "select", options: ["Full-Time Head Coach", "Part-Time Coach", "Sport-Specific Specialist", "Remote / Online Coach", "Open to Discussion"] },
      { id: "portfolioLinks", label: "Portfolio / Social Links", enabled: true, required: false, type: "text", placeholder: "Instagram, LinkedIn, website..." },
      { id: "availability", label: "Availability", enabled: true, required: false, type: "select", options: ["Mornings (6am–12pm)", "Afternoons (12pm–5pm)", "Evenings (5pm–9pm)", "Flexible / All hours"] },
      { id: "resumeNote", label: "Resume / Bio (link or paste)", enabled: true, required: false, type: "textarea", placeholder: "Paste a brief bio or link to your resume/LinkedIn..." },
      { id: "whyJoin", label: "Why do you want to join?", enabled: true, required: false, type: "textarea", placeholder: "Tell us what excites you about this opportunity and what you'd bring to our program..." },
    ],
    automations: [
      { icon: <ClipboardList className="h-4 w-4" />, title: "Hiring Pipeline Candidate", desc: "Every application creates a candidate record in your hiring pipeline with status tracking from Applied → Interview → Offer → Hired." },
      { icon: <Bot className="h-4 w-4" />, title: "AI Candidate Scoring", desc: "AI evaluates certifications, experience, sport alignment, and response quality to score and rank applicants automatically." },
      { icon: <Bell className="h-4 w-4" />, title: "Admin Notification", desc: "Instant alert to your hiring manager with AI score, certification highlights, and recommended interview questions." },
      { icon: <Workflow className="h-4 w-4" />, title: "Interview Workflow", desc: "Automated follow-up sequence guides candidates through next steps: screening call → practical demo → offer." },
    ],
    aiRecs: [
      "Applicants who mention sport-specific experience get 44% higher interview rates — ask for it explicitly.",
      "Keeping the application under 8 fields increases completed submissions by 31% for competitive coaching roles.",
      "Video intro links in the 'portfolio' field help you evaluate communication and presence before the first call.",
      "Funnels with real coach testimonials ('I 4x'd my income in 6 months') convert 37% better for recruitment.",
      "Offer specific role titles in the 'desired role' field to set proper expectations and reduce mismatch drop-off.",
    ],
    analyticsLabel: "Applications Received",
    testimonialRoleLabel: "Current Role / Certification",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const ICON_OPTIONS = [
  { value: "Zap", label: "⚡ Lightning" },
  { value: "Target", label: "🎯 Target" },
  { value: "Award", label: "🏆 Award" },
  { value: "Shield", label: "🛡 Shield" },
  { value: "Flame", label: "🔥 Fire" },
  { value: "Dumbbell", label: "💪 Dumbbell" },
  { value: "TrendingUp", label: "📈 Trending" },
  { value: "Users", label: "👥 Team" },
  { value: "DollarSign", label: "💲 Dollar" },
  { value: "Star", label: "⭐ Star" },
];

const GRADIENT_PRESETS = [
  { value: "orange-dark", label: "Orange Fire", preview: "from-orange-600 to-orange-900" },
  { value: "gold-black", label: "Gold & Black", preview: "from-yellow-500 to-gray-900" },
  { value: "blue-dark", label: "Blue Elite", preview: "from-blue-600 to-gray-900" },
  { value: "cyan-dark", label: "Cyan Pro", preview: "from-cyan-600 to-gray-900" },
  { value: "purple-dark", label: "Purple Pro", preview: "from-purple-600 to-gray-900" },
  { value: "green-dark", label: "Green Hustle", preview: "from-green-600 to-gray-900" },
  { value: "red-dark", label: "Red Power", preview: "from-red-600 to-gray-900" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-2 ${accent} rounded-xl min-w-[90px] border`}>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, accent }: { icon: React.ReactNode; title: string; subtitle?: string; accent: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className={`p-2 ${accent} rounded-lg mt-0.5`}>{icon}</div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── OrgMedia type (local) ───────────────────────────────────────────────────

interface OrgMediaItem {
  id: string;
  mediaType: "image" | "video";
  section: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
}

// ─── MediaUploadZone ──────────────────────────────────────────────────────────

interface MediaUploadZoneProps {
  label: string;
  accept: "image" | "video";
  value: string;
  onChange: (url: string) => void;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  maxSizeMB?: number;
}

function MediaUploadZone({
  label,
  accept,
  value,
  onChange,
  accentColor,
  accentBg,
  accentBorder,
  maxSizeMB,
}: MediaUploadZoneProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [showManualUrl, setShowManualUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const isImage = accept === "image";
  const defaultMaxMB = isImage ? 10 : 200;
  const maxMB = maxSizeMB ?? defaultMaxMB;

  const { data: mediaData } = useQuery<{ media: OrgMediaItem[]; grouped: Record<string, OrgMediaItem[]> }>({
    queryKey: ["/api/org/media"],
    enabled: showPicker,
  });

  const pickerItems = (mediaData?.media || []).filter(m =>
    isImage ? m.mediaType === "image" : m.mediaType === "video"
  );

  const handleFile = useCallback(async (file: File) => {
    const isFileImage = file.type.startsWith("image/");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const videoExts = ["mp4", "mov", "webm", "m4v", "mpeg", "mpg", "avi"];
    const isFileVideo = file.type.startsWith("video/") || videoExts.includes(ext);

    if (isImage && !isFileImage) {
      toast({ title: "Images only", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (!isImage && !isFileVideo) {
      toast({ title: "Videos only", description: "Please select a video file (mp4, mov, webm).", variant: "destructive" });
      return;
    }
    if (file.size > maxMB * 1024 * 1024) {
      toast({ title: "File too large", description: `Max size is ${maxMB}MB.`, variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("section", "hero");

    try {
      setUploadProgress(40);
      const res = await fetch("/api/org/media", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      setUploadProgress(80);

      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        let errMsg = "Upload failed";
        if (contentType.includes("application/json")) {
          const err = await res.json().catch(() => null);
          errMsg = err?.message || errMsg;
        } else if (res.status === 413) {
          errMsg = `File too large. Max is ${maxMB}MB.`;
        }
        toast({ title: "Upload failed", description: errMsg, variant: "destructive" });
        return;
      }

      const data = await res.json();
      const url = data?.media?.url || data?.url || "";
      if (url) {
        onChange(url);
        queryClient.invalidateQueries({ queryKey: ["/api/org/media"] });
        toast({ title: "Uploaded!", description: `${label} set successfully.` });
      } else {
        toast({ title: "Upload error", description: "Could not read URL from response.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Upload failed. Check your connection.", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [isImage, maxMB, label, onChange, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleApplyManualUrl = () => {
    if (manualUrl.trim()) {
      onChange(manualUrl.trim());
      setManualUrl("");
      setShowManualUrl(false);
      toast({ title: `${label} updated`, description: "URL applied." });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-white/80">{label}</Label>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] text-white/50 hover:text-red-400 hover:bg-red-500/10"
            onClick={() => onChange("")}
            data-testid={`button-remove-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <X className="h-3 w-3 mr-1" /> Remove
          </Button>
        )}
      </div>

      {/* Current media preview */}
      {value && (
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/30">
          {isImage ? (
            <div className="aspect-video">
              <img
                src={value}
                alt={label}
                className="w-full h-full object-cover"
                data-testid={`preview-${label.toLowerCase().replace(/\s+/g, "-")}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <Badge className="bg-black/70 text-white/80 border-white/20 text-[10px]">
                  <Image className="h-2.5 w-2.5 mr-1" /> Hero Image Set
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] bg-black/50 text-white/80 hover:bg-black/70 border border-white/20"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-replace-hero-image"
                >
                  Replace
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3">
              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <Film className="h-5 w-5 text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">Video background set</p>
                <p className="text-[10px] text-white/50 truncate">{value}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[10px] bg-white/10 text-white/80 hover:bg-white/20 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-replace-hero-video"
              >
                Replace
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="space-y-1.5 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/60 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading…
            </span>
            <span className="text-[10px] text-white/60">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-1.5 bg-white/10" />
        </div>
      )}

      {/* Drop zone (shown when no value or uploading) */}
      {!value && !uploading && (
        <div
          className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer
            ${dragOver
              ? `${accentBorder} bg-orange-500/10`
              : "border-white/15 bg-white/5 hover:bg-white/8 hover:border-white/25"
            }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid={`dropzone-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <div className="flex flex-col items-center justify-center py-7 px-4 text-center gap-2">
            <div className={`p-3 rounded-full ${accentBg} border ${accentBorder}`}>
              {isImage ? (
                <ImagePlus className={`h-5 w-5 ${accentColor}`} />
              ) : (
                <Video className={`h-5 w-5 ${accentColor}`} />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white/80">
                {dragOver ? "Drop to upload" : `Upload ${label}`}
              </p>
              <p className="text-[11px] text-white/40 mt-0.5">
                {isImage
                  ? `Drag & drop or click — JPG, PNG, WebP up to ${maxMB}MB`
                  : `Drag & drop or click — MP4, MOV, WebM up to ${maxMB}MB`
                }
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className={`mt-1 border ${accentBorder} ${accentColor} bg-transparent hover:${accentBg} text-xs`}
              onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              data-testid={`button-upload-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {isImage ? "Upload Image" : "Upload Video"}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={isImage ? "image/*" : "video/*"}
        className="hidden"
        onChange={handleInputChange}
        data-testid={`file-input-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />

      {/* Action row — Choose from library + replace when value exists */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-[11px] text-white/60 hover:text-white/90 hover:bg-white/10 gap-1.5"
          onClick={() => setShowPicker(true)}
          data-testid={`button-pick-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <Library className="h-3.5 w-3.5" />
          Choose from media library
        </Button>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-[11px] text-white/60 hover:text-white/90 hover:bg-white/10 gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            data-testid={`button-upload-replace-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload new
          </Button>
        )}
      </div>

      {/* Video performance tip */}
      {!isImage && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-300/90 leading-relaxed">
            Short, compressed looping videos (10–30s, under 20MB) perform best for hero backgrounds.
          </p>
        </div>
      )}

      {/* Advanced: paste URL */}
      <div className="border-t border-white/8 pt-2">
        <button
          className="flex items-center gap-1.5 text-[11px] text-white/35 hover:text-white/60 transition-colors"
          onClick={() => setShowManualUrl(v => !v)}
          data-testid={`button-toggle-manual-url-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <ChevronDownIcon className={`h-3 w-3 transition-transform ${showManualUrl ? "rotate-180" : ""}`} />
          Advanced: paste URL manually
        </button>
        {showManualUrl && (
          <div className="mt-2 flex gap-2">
            <Input
              value={manualUrl}
              onChange={e => setManualUrl(e.target.value)}
              placeholder="https://..."
              className="h-8 text-xs bg-white/5 border-white/15 text-white placeholder:text-white/30 flex-1"
              onKeyDown={e => e.key === "Enter" && handleApplyManualUrl()}
              data-testid={`input-manual-url-${label.toLowerCase().replace(/\s+/g, "-")}`}
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleApplyManualUrl}
              disabled={!manualUrl.trim()}
              data-testid={`button-apply-manual-url-${label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Media library picker dialog */}
      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent className="bg-gray-900/95 border-white/15 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Library className="h-4 w-4 text-orange-400" />
              Choose {isImage ? "Image" : "Video"} from Media Library
            </DialogTitle>
          </DialogHeader>
          {pickerItems.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <div className="flex justify-center">
                {isImage ? <Image className="h-10 w-10 text-white/20" /> : <Film className="h-10 w-10 text-white/20" />}
              </div>
              <p className="text-sm text-white/50">No {isImage ? "images" : "videos"} uploaded yet.</p>
              <p className="text-xs text-white/30">Upload media in the Media Library to use them here.</p>
            </div>
          ) : (
            <div className={isImage ? "grid grid-cols-3 gap-3" : "space-y-2"}>
              {pickerItems.map(item => (
                <button
                  key={item.id}
                  className={`group relative rounded-lg overflow-hidden border transition-all hover:border-orange-500/60
                    ${value === item.url ? "border-orange-500 ring-2 ring-orange-500/40" : "border-white/10"}`}
                  onClick={() => { onChange(item.url); setShowPicker(false); toast({ title: `${label} selected` }); }}
                  data-testid={`picker-item-${item.id}`}
                >
                  {isImage ? (
                    <div className="aspect-video bg-black/50">
                      <img src={item.url} alt={item.caption || ""} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      {value === item.url && (
                        <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                          <Check className="h-6 w-6 text-orange-400" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10">
                      <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center shrink-0">
                        <Film className="h-4 w-4 text-orange-400" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-medium text-white truncate">{item.caption || "Video"}</p>
                        <p className="text-[10px] text-white/40 truncate">{item.url}</p>
                      </div>
                      {value === item.url && <Check className="h-4 w-4 text-orange-400 shrink-0" />}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="pt-2 border-t border-white/10 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white/70 hover:bg-white/10"
              onClick={() => setShowPicker(false)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadCaptureProgramEditorPage() {
  const { programId } = useParams<{ programId: string }>();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [unsaved, setUnsaved] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── funnel type (from URL param first, then from saved config)
  const urlFunnelType = new URLSearchParams(searchStr).get("funnelType") as FunnelType | null;
  const validFunnelTypes: FunnelType[] = ["athlete_application", "team_training", "employment_opportunity"];
  const safeUrlFunnelType: FunnelType = validFunnelTypes.includes(urlFunnelType as FunnelType)
    ? (urlFunnelType as FunnelType)
    : "athlete_application";
  const [funnelType, setFunnelType] = useState<FunnelType>(safeUrlFunnelType);
  const ft = FUNNEL_CONFIGS[funnelType] ?? FUNNEL_CONFIGS["athlete_application"];

  // ── form state
  const [headline, setHeadline] = useState(ft.defaultHeadline);
  const [subheadline, setSubheadline] = useState(ft.defaultSubheadline);
  const [ctaText, setCtaText] = useState(ft.defaultCtaText);
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [urgencyBadge, setUrgencyBadge] = useState("");
  const [heroAlignment, setHeroAlignment] = useState<"left" | "center" | "right">("center");
  const [overlayStrength, setOverlayStrength] = useState(60);
  const [videoBackgroundUrl, setVideoBackgroundUrl] = useState("");

  const [benefits, setBenefits] = useState<BenefitCard[]>(ft.defaultBenefits);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [whoCards, setWhoCards] = useState<WhoCard[]>(ft.defaultWhoCards);
  const [formFields, setFormFields] = useState<FormField[]>(ft.defaultFormFields);

  const [bookingUrl, setBookingUrl] = useState("");
  const [bookingType, setBookingType] = useState("none");
  const [bookingButtonText, setBookingButtonText] = useState(
    funnelType === "team_training" ? "Book a Discovery Call" :
    funnelType === "employment_opportunity" ? "Schedule Your Interview" :
    "Book Your Evaluation"
  );
  const [bookingRedirectOnSubmit, setBookingRedirectOnSubmit] = useState(false);

  const [accentColor, setAccentColor] = useState(ft.accentHex);
  const [gradientPreset, setGradientPreset] = useState(ft.gradientPreset);
  const [buttonStyle, setButtonStyle] = useState<"solid" | "outline" | "gradient">("solid");
  const [darkIntensity, setDarkIntensity] = useState<"light" | "medium" | "dark" | "ultra">("dark");
  const [typographyPreset, setTypographyPreset] = useState<"athletic" | "modern" | "bold" | "clean">("athletic");
  const [laserEffectsEnabled, setLaserEffectsEnabled] = useState(true);
  const [laserIntensity, setLaserIntensity] = useState<"subtle" | "standard" | "high">("standard");
  const [laserPreset, setLaserPreset] = useState<"performance-orange" | "team-cyan" | "career-purple" | "elite-green">("performance-orange");
  const [laserCardsEnabled, setLaserCardsEnabled] = useState(true);
  const [heroImageFit, setHeroImageFit] = useState<"cover" | "contain" | "fill">("cover");
  const [heroImagePosition, setHeroImagePosition] = useState("center center");
  const [mobileHeroImagePosition, setMobileHeroImagePosition] = useState("");

  const [metaPixelId, setMetaPixelId] = useState("");
  const [googleAdsConversionId, setGoogleAdsConversionId] = useState("");
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState("");
  const [estimatedValueCents, setEstimatedValueCents] = useState(0);
  const [showInOrgMenu, setShowInOrgMenu] = useState(true);
  const [navLabel, setNavLabel] = useState("");
  const [navOrder, setNavOrder] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // ── preflight state
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);

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

  const { data: lastPreflightData } = useQuery<{ last: { ranAt: string; healthBadge: HealthBadge; passedCount: number; warningCount: number; failedCount: number } | null }>({
    queryKey: [`/api/lead-capture/programs/${programId}/preflight`],
    enabled: !!programId,
  });

  // ── preflight mutations
  const runPreflightMutation = useMutation({
    mutationFn: ({ runDryRun }: { runDryRun: boolean }) =>
      apiRequest("POST", `/api/lead-capture/programs/${programId}/preflight/run`, { runDryRun }),
    onSuccess: (data: any) => {
      setPreflightResult(data);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/preflight`] });
      toast({ title: runPreflightMutation.variables?.runDryRun ? "Dry-run complete" : "Preflight complete", description: `Health: ${data.healthBadge?.replace("_", " ")} — ${data.passedCount} passed, ${data.warningCount} warnings, ${data.failedCount} failed` });
    },
    onError: () => toast({ title: "Preflight failed", description: "Could not run preflight checks.", variant: "destructive" }),
  });

  const fixPreflightMutation = useMutation({
    mutationFn: (checksToFix: string[]) =>
      apiRequest("POST", `/api/lead-capture/programs/${programId}/preflight/fix`, { checksToFix }),
    onSuccess: (data: any) => {
      setPreflightResult(data.freshPreflight);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/preflight`] });
      const fixed = data.fixResult?.fixed ?? [];
      toast({ title: "Auto-fix applied", description: fixed.length > 0 ? fixed.join(" · ") : "No changes were needed." });
    },
    onError: () => toast({ title: "Auto-fix failed", variant: "destructive" }),
  });

  const activeHealth: HealthBadge | null = preflightResult?.healthBadge ?? lastPreflightData?.last?.healthBadge ?? null;
  const fixableChecks = (preflightResult?.checks ?? []).filter(c => c.autoFixable && (c.status === "failed" || c.status === "warning")).map(c => c.id);

  // ── load config into state when it arrives (only once)
  useEffect(() => {
    if (!config || initialized) return;
    setInitialized(true);
    const rawType = config.funnelType || urlFunnelType || "athlete_application";
    const resolvedType: FunnelType = validFunnelTypes.includes(rawType as FunnelType)
      ? (rawType as FunnelType)
      : "athlete_application";
    setFunnelType(resolvedType);
    const newFt = FUNNEL_CONFIGS[resolvedType] ?? FUNNEL_CONFIGS["athlete_application"];
    setHeadline(config.headline || newFt.defaultHeadline);
    setSubheadline(config.subheadline || newFt.defaultSubheadline);
    setCtaText(config.ctaText || newFt.defaultCtaText);
    setHeroImageUrl(config.heroImageUrl || "");
    setBenefits((config.benefits as any)?.length > 0 ? config.benefits as any : newFt.defaultBenefits);
    setTestimonials((config.socialProof as any) || []);
    setBookingUrl(config.bookingUrl || "");
    setBookingType(config.bookingType || "none");
    setMetaPixelId(config.metaPixelId || "");
    setGoogleAdsConversionId(config.googleAdsConversionId || "");
    setGoogleAdsConversionLabel(config.googleAdsConversionLabel || "");
    setEstimatedValueCents(config.estimatedAthleteValueCents || 0);
    setShowInOrgMenu((config as any).showInOrgMenu !== false);
    setNavLabel((config as any).navLabel || "");
    setNavOrder((config as any).navOrder ?? 0);
    const ext = config.extendedConfig || {};
    setUrgencyBadge(ext.urgencyBadge || "");
    setHeroAlignment(ext.heroAlignment || "center");
    setOverlayStrength(ext.overlayStrength ?? 60);
    setVideoBackgroundUrl(ext.videoBackgroundUrl || "");
    setAccentColor(ext.accentColor || newFt.accentHex);
    setGradientPreset(ext.gradientPreset || newFt.gradientPreset);
    setButtonStyle(ext.buttonStyle || "solid");
    setDarkIntensity(ext.darkIntensity || "dark");
    setTypographyPreset(ext.typographyPreset || "athletic");
    setBookingButtonText(ext.bookingButtonText || (resolvedType === "team_training" ? "Book a Discovery Call" : resolvedType === "employment_opportunity" ? "Schedule Your Interview" : "Book Your Evaluation"));
    setBookingRedirectOnSubmit(ext.bookingRedirectOnSubmit ?? false);
    setLaserEffectsEnabled(ext.laserEffectsEnabled ?? true);
    setLaserIntensity(ext.laserIntensity || "standard");
    setLaserPreset(ext.laserPreset || (resolvedType === "team_training" ? "team-cyan" : resolvedType === "employment_opportunity" ? "career-purple" : "performance-orange"));
    setLaserCardsEnabled(ext.laserCardsEnabled ?? true);
    setHeroImageFit(ext.heroImageFit || "cover");
    setHeroImagePosition(ext.heroImagePosition || "center center");
    setMobileHeroImagePosition(ext.mobileHeroImagePosition || "");
    setWhoCards(ext.whoCards?.length > 0 ? ext.whoCards : newFt.defaultWhoCards);
    if (ext.formFields && ext.formFields.length > 0) {
      setFormFields(ext.formFields);
    } else {
      setFormFields(newFt.defaultFormFields);
    }
  }, [config, initialized, urlFunnelType]);

  // ── autosave
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
        funnelType,
        headline, subheadline, ctaText,
        heroImageUrl: heroImageUrl || null,
        benefits, socialProof: testimonials,
        bookingUrl: bookingUrl || null, bookingType,
        metaPixelId: metaPixelId || null,
        googleAdsConversionId: googleAdsConversionId || null,
        googleAdsConversionLabel: googleAdsConversionLabel || null,
        estimatedAthleteValueCents: estimatedValueCents,
        showInOrgMenu,
        navLabel: navLabel || null,
        navOrder,
        extendedConfig: {
          urgencyBadge, heroAlignment, overlayStrength, videoBackgroundUrl,
          accentColor, gradientPreset, buttonStyle, darkIntensity, typographyPreset,
          bookingButtonText, bookingRedirectOnSubmit, whoCards, formFields,
          laserEffectsEnabled, laserIntensity, laserPreset, laserCardsEnabled,
          heroImageFit, heroImagePosition,
          mobileHeroImagePosition: mobileHeroImagePosition || undefined,
        },
      };
      return apiRequest("PUT", `/api/lead-capture/programs/${programId}/config`, body);
    },
    onSuccess: (_, mode) => {
      setUnsaved(false);
      queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/config`] });
      // Also bust the public landing page cache so changes show immediately
      if (orgData?.slug && program?.slug) {
        queryClient.invalidateQueries({ queryKey: [`/api/public/lead-capture/${orgData.slug}/${program.slug}`] });
      }
      if (mode !== "autosave") {
        toast({ title: "Saved", description: "Funnel configuration updated." });
      }
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save changes.", variant: "destructive" });
    },
  });

  // ── computed
  const publicUrl = orgData?.slug && program?.slug
    ? `${window.location.origin}/apply/${orgData.slug}/${program.slug}`
    : null;
  const lastSub = stats?.lastSubmission ? new Date(stats.lastSubmission).toLocaleDateString() : "Never";
  const bookingRate = stats && stats.total > 0 ? Math.round(((stats as any).booked ?? 0) / stats.total * 100) : 0;

  // ── benefit helpers
  const addBenefit = () => setBenefits(p => [...p, { id: uid(), title: "", description: "", icon: "Zap", accentColor: ft.accentHex }]);
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
  const addTestimonial = () => setTestimonials(p => [...p, { id: uid(), name: "", role: "", quote: "", rating: 5, photoUrl: "", featured: false }]);
  const updateTestimonial = (id: string, key: keyof Testimonial, val: any) =>
    setTestimonials(p => p.map(t => t.id === id ? { ...t, [key]: val } : t));
  const removeTestimonial = (id: string) => setTestimonials(p => p.filter(t => t.id !== id));

  // ── who card helpers
  const addWhoCard = () => setWhoCards(p => [...p, { id: uid(), title: "", description: "", icon: "Target" }]);
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

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className={`h-8 w-8 animate-spin ${ft.accent}`} />
      </div>
    );
  }

  const accentStatBg = `${ft.accentBg} ${ft.accentBorder} border`;
  const accentIconBg = ft.accentBg;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sticky save bar ── */}
      <div className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 py-3 max-w-7xl mx-auto">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/configuration")} data-testid="button-back-to-config">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Badge className={`${ft.accentBg} ${ft.accent} ${ft.accentBorder} border shrink-0 gap-1`}>
              {ft.icon} {ft.badgeLabel}
            </Badge>
            <span className="font-semibold text-foreground truncate text-sm">{program?.name || "Funnel Editor"}</span>
            <span className={`text-xs ${ft.accent} hidden sm:inline`}>— {ft.label}</span>
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
              className={`text-white ${funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600"}`}
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
        {/* ── Stats bar ── */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Total Leads", value: stats?.total ?? "—" },
              { label: "High-Intent", value: stats?.highIntent ?? "—" },
              { label: "Conversion", value: stats ? `${stats.conversionRate}%` : "—" },
              { label: "Booking Rate", value: `${bookingRate}%` },
              { label: "Last Lead", value: lastSub },
            ].map(s => (
              <StatPill key={s.label} label={s.label} value={s.value} accent={accentStatBg} />
            ))}
          </div>
          {publicUrl && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Link copied!" }); }} data-testid="button-copy-link">
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => setActiveTab("analytics")} data-testid="button-open-analytics">
                <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
              </Button>
            </div>
          )}
        </div>

        {publicUrl && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border/50 rounded-lg text-xs text-muted-foreground font-mono">
            <Globe className={`h-3.5 w-3.5 ${ft.accent} shrink-0`} />
            <span className="truncate">{publicUrl}</span>
          </div>
        )}

        {/* ── Funnel type indicator ── */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${ft.accentBg} border ${ft.accentBorder}`}>
          <div className={`p-2 rounded-lg ${ft.accentBg}`}>{ft.icon}</div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${ft.accent}`}>{ft.label} Funnel</p>
            <p className="text-xs text-muted-foreground">
              {funnelType === "athlete_application" && "Captures individual athlete applications with AI scoring and multi-touch follow-up sequences."}
              {funnelType === "team_training" && "Generates B2B school/org leads with automatic pipeline deal creation and decision-maker classification."}
              {funnelType === "employment_opportunity" && "Recruits coaches and staff with AI candidate scoring, hiring pipeline, and interview workflow."}
            </p>
          </div>
          <Badge className={`${ft.accentBg} ${ft.accent} border ${ft.accentBorder} text-xs`}>{ft.badgeLabel}</Badge>
          {activeHealth && (
            <Badge
              data-testid="badge-launch-health"
              className={`text-xs border ${
                activeHealth === "ready"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : activeHealth === "needs_attention"
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "bg-red-500/15 text-red-400 border-red-500/30"
              }`}
            >
              {activeHealth === "ready" && <CheckCircle2 className="h-3 w-3 mr-1" />}
              {activeHealth === "needs_attention" && <AlertCircle className="h-3 w-3 mr-1" />}
              {activeHealth === "blocked" && <XCircle className="h-3 w-3 mr-1" />}
              {activeHealth === "ready" ? "Ready to Launch" : activeHealth === "needs_attention" ? "Needs Attention" : "Blocked"}
            </Badge>
          )}
        </div>

        {/* ── Main tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 mb-6">
            {[
              { value: "overview", label: "Overview", icon: <Layout className="h-3.5 w-3.5" /> },
              { value: "hero", label: "Hero", icon: <Image className="h-3.5 w-3.5" /> },
              { value: "content", label: "Content", icon: <BookOpen className="h-3.5 w-3.5" /> },
              { value: "testimonials", label: "Testimonials", icon: <Star className="h-3.5 w-3.5" /> },
              { value: "form", label: "Form Fields", icon: <Settings2 className="h-3.5 w-3.5" /> },
              { value: "booking", label: "Booking", icon: <Calendar className="h-3.5 w-3.5" /> },
              { value: "automations", label: "Automations", icon: <Workflow className="h-3.5 w-3.5" /> },
              { value: "branding", label: "Branding", icon: <Palette className="h-3.5 w-3.5" /> },
              { value: "analytics", label: "Analytics", icon: <BarChart2 className="h-3.5 w-3.5" /> },
              { value: "ai", label: "AI Tips", icon: <Lightbulb className="h-3.5 w-3.5" /> },
              { value: "launch", label: "Launch Readiness", icon: <Shield className="h-3.5 w-3.5" /> },
            ].map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={`flex items-center gap-1.5 text-xs data-[state=active]:text-white ${
                  activeTab === tab.value
                    ? funnelType === "team_training"
                      ? "data-[state=active]:bg-cyan-600"
                      : funnelType === "employment_opportunity"
                      ? "data-[state=active]:bg-purple-600"
                      : "data-[state=active]:bg-orange-500"
                    : ""
                }`}
                data-testid={`tab-${tab.value}`}
              >
                {tab.icon} {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className={`p-6 space-y-5 ${ft.accentBorder} border`}>
                <SectionHeader icon={<Globe className="h-4 w-4" />} title="Public URL" subtitle="Share this link in your ads, bio, or outreach." accent={accentIconBg} />
                {publicUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border/50">
                      <Link2 className={`h-4 w-4 ${ft.accent} shrink-0`} />
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
                  <p className="text-sm text-muted-foreground">URL appears once organization is configured.</p>
                )}
              </Card>

              <Card className="p-6 space-y-4 border-border/50">
                <SectionHeader icon={<TrendingUp className="h-4 w-4" />} title="Quick Stats" accent={accentIconBg} />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: ft.analyticsLabel, value: stats?.total ?? 0 },
                    { label: "High-Intent", value: stats?.highIntent ?? 0 },
                    { label: "Conversion Rate", value: `${stats?.conversionRate ?? 0}%` },
                    { label: "Booking Rate", value: `${bookingRate}%` },
                  ].map(s => (
                    <div key={s.label} className="p-3 bg-muted/30 rounded-lg">
                      <p className={`text-xl font-bold ${ft.accent}`}>{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Org Menu Visibility */}
            <Card className={`p-6 space-y-4 ${ft.accentBorder} border`}>
              <SectionHeader icon={<Globe className="h-4 w-4" />} title="Public Org Menu" subtitle="Control whether this funnel appears in your public organization portal." accent={accentIconBg} />
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border border-border/40">
                <div>
                  <p className="text-sm font-semibold">Show in org portal menu</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Members will see this funnel listed under the {funnelType === "team_training" ? "Team Training" : funnelType === "employment_opportunity" ? "Careers" : "Athlete Programs"} section of the org portal.</p>
                </div>
                <Switch
                  checked={showInOrgMenu}
                  onCheckedChange={v => { setShowInOrgMenu(v); markUnsaved(); }}
                  data-testid="switch-show-in-org-menu"
                />
              </div>
              {showInOrgMenu && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custom Menu Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      value={navLabel}
                      onChange={e => { setNavLabel(e.target.value); markUnsaved(); }}
                      placeholder={program?.name || "e.g. Summer Athlete Application"}
                      data-testid="input-nav-label"
                    />
                    <p className="text-[10px] text-muted-foreground">Overrides the program name in the org menu. Leave blank to use the program name.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Menu Order <span className="text-muted-foreground font-normal">(lower = first)</span></Label>
                    <Input
                      type="number"
                      value={navOrder}
                      onChange={e => { setNavOrder(Number(e.target.value)); markUnsaved(); }}
                      placeholder="0"
                      className="max-w-[120px]"
                      data-testid="input-nav-order"
                    />
                  </div>
                </div>
              )}
              {publicUrl && showInOrgMenu && (
                <div className={`flex items-center gap-2 px-3 py-2 ${ft.accentBg} border ${ft.accentBorder} rounded-lg text-xs`}>
                  <Globe className={`h-3.5 w-3.5 ${ft.accent} shrink-0`} />
                  <span className="text-muted-foreground">Public funnel URL:</span>
                  <span className={`font-mono ${ft.accent} truncate`}>{publicUrl}</span>
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-4">
              <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Tracking Pixels" subtitle="Connect advertising pixels for conversion tracking." accent={accentIconBg} />
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
                <Label className="text-xs">
                  {funnelType === "team_training" ? "Estimated Contract Value (per conversion, in dollars)" :
                   funnelType === "employment_opportunity" ? "Estimated Hiring Value (fully-loaded cost, in dollars)" :
                   "Estimated Athlete Value (per conversion, in dollars)"}
                </Label>
                <Input
                  type="number"
                  value={estimatedValueCents / 100}
                  onChange={e => { setEstimatedValueCents(Math.round(parseFloat(e.target.value || "0") * 100)); markUnsaved(); }}
                  placeholder={funnelType === "team_training" ? "15000" : funnelType === "employment_opportunity" ? "8000" : "2400"}
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
                  <SectionHeader icon={<Image className="h-4 w-4" />} title="Hero Content" subtitle="The first thing visitors see when they land on your funnel." accent={accentIconBg} />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Headline</Label>
                    <Input value={headline} onChange={e => { setHeadline(e.target.value); markUnsaved(); }} placeholder={ft.defaultHeadline} data-testid="input-headline" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Subheadline</Label>
                    <Textarea value={subheadline} onChange={e => { setSubheadline(e.target.value); markUnsaved(); }} placeholder={ft.defaultSubheadline} rows={2} data-testid="input-subheadline" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CTA Button Text</Label>
                    <Input value={ctaText} onChange={e => { setCtaText(e.target.value); markUnsaved(); }} placeholder={ft.defaultCtaText} data-testid="input-cta-text" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Urgency Badge (optional)</Label>
                    <Input value={urgencyBadge} onChange={e => { setUrgencyBadge(e.target.value); markUnsaved(); }} placeholder={ft.defaultUrgencyBadge} data-testid="input-urgency-badge" />
                    <p className="text-[10px] text-muted-foreground">Shown as a glowing badge above the headline.</p>
                  </div>
                </Card>

                <Card className="p-6 space-y-5 bg-gray-950/60 border-white/10 backdrop-blur-sm">
                  <SectionHeader
                    icon={<Image className="h-4 w-4" />}
                    title="Hero Media"
                    subtitle="Upload a background image or video for your hero section."
                    accent={accentIconBg}
                  />

                  {/* Hero Image Upload */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/8 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <ImagePlus className={`h-4 w-4 ${ft.accent}`} />
                      <span className="text-sm font-semibold text-white/90">Hero Image</span>
                      <Badge className={`ml-auto text-[10px] ${ft.accentBg} ${ft.accent} border ${ft.accentBorder}`}>
                        Recommended
                      </Badge>
                    </div>
                    <MediaUploadZone
                      label="Hero Image"
                      accept="image"
                      value={heroImageUrl}
                      onChange={url => { setHeroImageUrl(url); markUnsaved(); }}
                      accentColor={ft.accent}
                      accentBg={ft.accentBg}
                      accentBorder={ft.accentBorder}
                      maxSizeMB={10}
                    />
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/8" />
                    <span className="text-[10px] text-white/25 uppercase tracking-widest">or add video</span>
                    <div className="flex-1 h-px bg-white/8" />
                  </div>

                  {/* Video Background Upload */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/8 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Video className={`h-4 w-4 ${ft.accent}`} />
                      <span className="text-sm font-semibold text-white/90">Video Background</span>
                      <Badge className="ml-auto text-[10px] bg-white/5 text-white/40 border-white/10">
                        Optional
                      </Badge>
                    </div>
                    <MediaUploadZone
                      label="Video Background"
                      accept="video"
                      value={videoBackgroundUrl}
                      onChange={url => { setVideoBackgroundUrl(url); markUnsaved(); }}
                      accentColor={ft.accent}
                      accentBg={ft.accentBg}
                      accentBorder={ft.accentBorder}
                      maxSizeMB={200}
                    />
                  </div>
                </Card>
              </div>

              <div className="space-y-5">
                <Card className="p-6 space-y-4">
                  <SectionHeader icon={<Layout className="h-4 w-4" />} title="Layout & Style" accent={accentIconBg} />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Text Alignment</Label>
                    <div className="flex gap-2">
                      {(["left", "center", "right"] as const).map(a => (
                        <Button key={a} size="sm" variant={heroAlignment === a ? "default" : "outline"}
                          onClick={() => { setHeroAlignment(a); markUnsaved(); }}
                          className={heroAlignment === a ? (funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600") : ""}
                          data-testid={`button-align-${a}`}>
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Background Overlay: {overlayStrength}%</Label>
                    <input type="range" min={0} max={100} value={overlayStrength}
                      onChange={e => { setOverlayStrength(Number(e.target.value)); markUnsaved(); }}
                      className={`w-full ${funnelType === "team_training" ? "accent-cyan-500" : funnelType === "employment_opportunity" ? "accent-purple-500" : "accent-orange-500"}`}
                      data-testid="range-overlay-strength" />
                  </div>

                  {/* Image fit & focal point — only relevant when a hero image is set */}
                  {heroImageUrl && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Image Fit</Label>
                        <div className="flex gap-2">
                          {(["cover", "contain", "fill"] as const).map(f => (
                            <Button key={f} size="sm" variant={heroImageFit === f ? "default" : "outline"}
                              onClick={() => { setHeroImageFit(f); markUnsaved(); }}
                              className={`capitalize ${heroImageFit === f ? (funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600") : ""}`}
                              data-testid={`button-image-fit-${f}`}>
                              {f}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground">Cover: fills frame (recommended). Contain: shows full image. Fill: stretches to fit.</p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Focal Point — Desktop</Label>
                        <p className="text-[10px] text-muted-foreground -mt-1">Click the area of the image that should stay visible when cropped.</p>
                        <div className="inline-grid grid-cols-3 gap-1 p-1 bg-muted/40 rounded-lg border border-border/40" data-testid="grid-focal-point">
                          {[
                            ["top left","top center","top right"],
                            ["center left","center center","center right"],
                            ["bottom left","bottom center","bottom right"],
                          ].map((row, ri) => row.map((pos, ci) => (
                            <button
                              key={pos}
                              onClick={() => { setHeroImagePosition(pos); markUnsaved(); }}
                              title={pos}
                              className={`w-8 h-8 rounded flex items-center justify-center transition-all ${heroImagePosition === pos ? `${ft.accentBg} border ${ft.accentBorder}` : "hover:bg-muted/60"}`}
                              data-testid={`button-focal-${pos.replace(/ /g, "-")}`}
                            >
                              <div className={`w-2 h-2 rounded-full ${heroImagePosition === pos ? ft.accent.replace("text-", "bg-") : "bg-muted-foreground/40"}`} />
                            </button>
                          )))}
                        </div>
                        <p className={`text-[10px] font-medium ${ft.accent}`}>Current: {heroImagePosition}</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Mobile Focal Point Override</Label>
                          {mobileHeroImagePosition && (
                            <button onClick={() => { setMobileHeroImagePosition(""); markUnsaved(); }} className="text-[10px] text-muted-foreground hover:text-foreground underline" data-testid="button-clear-mobile-focal">Clear</button>
                          )}
                        </div>
                        <div className="inline-grid grid-cols-3 gap-1 p-1 bg-muted/40 rounded-lg border border-border/40" data-testid="grid-mobile-focal-point">
                          {[
                            ["top left","top center","top right"],
                            ["center left","center center","center right"],
                            ["bottom left","bottom center","bottom right"],
                          ].map((row) => row.map((pos) => {
                            const active = mobileHeroImagePosition === pos;
                            return (
                              <button
                                key={pos}
                                onClick={() => { setMobileHeroImagePosition(active ? "" : pos); markUnsaved(); }}
                                title={pos}
                                className={`w-8 h-8 rounded flex items-center justify-center transition-all ${active ? `${ft.accentBg} border ${ft.accentBorder}` : "hover:bg-muted/60"}`}
                                data-testid={`button-mobile-focal-${pos.replace(/ /g, "-")}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${active ? ft.accent.replace("text-", "bg-") : "bg-muted-foreground/30"}`} />
                              </button>
                            );
                          }))}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{mobileHeroImagePosition ? `Mobile focal: ${mobileHeroImagePosition}` : "Using desktop focal point on mobile"}</p>
                      </div>
                    </>
                  )}
                </Card>

                {/* Live mini preview */}
                <Card className={`p-4 border ${ft.accentBorder} overflow-hidden`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-semibold ${ft.accent} uppercase tracking-wider`}>Live Preview</span>
                    <div className="flex gap-1">
                      {(["desktop", "mobile"] as const).map(d => (
                        <Button key={d} size="sm" variant={previewDevice === d ? "default" : "ghost"}
                          className={`h-6 px-2 text-[10px] ${previewDevice === d ? (funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600") : ""}`}
                          onClick={() => setPreviewDevice(d)} data-testid={`button-preview-${d}`}>
                          {d === "desktop" ? <Monitor className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className={`mx-auto rounded-lg overflow-hidden border border-border/50 transition-all ${previewDevice === "mobile" ? "max-w-[280px]" : "w-full"}`}>
                    <div className="relative flex flex-col items-center justify-center p-6 text-center min-h-[180px]"
                      style={{ background: heroImageUrl ? undefined : "linear-gradient(135deg, #1a1a2e, #0f0f0f)" }}>
                      {heroImageUrl && (
                        <img
                          src={heroImageUrl}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full"
                          style={{
                            objectFit: heroImageFit,
                            objectPosition: previewDevice === "mobile" && mobileHeroImagePosition
                              ? mobileHeroImagePosition
                              : heroImagePosition,
                          }}
                        />
                      )}
                      <div className="absolute inset-0 bg-black" style={{ opacity: overlayStrength / 100 }} />
                      {/* Laser effects live preview */}
                      <LeadCaptureLaserEffects
                        enabled={laserEffectsEnabled}
                        intensity={laserIntensity}
                        preset={laserPreset}
                        variant="hero"
                      />
                      <div className={`relative z-10 w-full ${heroAlignment === "left" ? "text-left" : heroAlignment === "right" ? "text-right" : "text-center"}`}>
                        {urgencyBadge && (
                          <span className={`inline-block px-2 py-0.5 text-white text-[9px] rounded-full mb-2 font-semibold ${funnelType === "team_training" ? "bg-cyan-600/90" : funnelType === "employment_opportunity" ? "bg-purple-600/90" : "bg-orange-500/90"}`}>{urgencyBadge}</span>
                        )}
                        <h2 className="text-sm font-bold text-white leading-tight">{headline || ft.defaultHeadline}</h2>
                        <p className="text-[9px] text-white/70 mt-1 leading-relaxed">{subheadline || ft.defaultSubheadline}</p>
                        <button className={`mt-3 px-3 py-1 text-white rounded text-[9px] font-semibold ${funnelType === "team_training" ? "bg-cyan-600" : funnelType === "employment_opportunity" ? "bg-purple-600" : "bg-orange-500"}`}>
                          {ctaText || ft.defaultCtaText}
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
                <SectionHeader icon={<Zap className="h-4 w-4" />} title="Benefits" subtitle="Why visitors should choose you — displayed as cards on the landing page." accent={accentIconBg} />
                <Button size="sm" variant="outline" onClick={() => { addBenefit(); markUnsaved(); }} data-testid="button-add-benefit">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Benefit
                </Button>
              </div>
              <div className="space-y-3">
                {benefits.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">No benefits yet. Add your first one above.</div>
                )}
                {benefits.map((b, idx) => (
                  <div key={b.id} className="flex gap-3 p-4 bg-muted/30 rounded-lg border border-border/40" data-testid={`card-benefit-${b.id}`}>
                    <div className="flex flex-col gap-1 justify-center">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { moveBenefit(b.id, -1); markUnsaved(); }} disabled={idx === 0} data-testid={`button-benefit-up-${b.id}`}><ChevronUp className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { moveBenefit(b.id, 1); markUnsaved(); }} disabled={idx === benefits.length - 1} data-testid={`button-benefit-down-${b.id}`}><ChevronDown className="h-3 w-3" /></Button>
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input value={b.title} onChange={e => { updateBenefit(b.id, "title", e.target.value); markUnsaved(); }} placeholder="Benefit title" data-testid={`input-benefit-title-${b.id}`} />
                      <Input value={b.description} onChange={e => { updateBenefit(b.id, "description", e.target.value); markUnsaved(); }} placeholder="Short description" data-testid={`input-benefit-desc-${b.id}`} />
                      <Select value={b.icon} onValueChange={v => { updateBenefit(b.id, "icon", v); markUnsaved(); }}>
                        <SelectTrigger data-testid={`select-benefit-icon-${b.id}`}><SelectValue placeholder="Icon" /></SelectTrigger>
                        <SelectContent>{ICON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="color" value={b.accentColor} onChange={e => { updateBenefit(b.id, "accentColor", e.target.value); markUnsaved(); }} className="h-7 w-7 rounded border-0 cursor-pointer bg-transparent" title="Accent color" data-testid={`color-benefit-${b.id}`} />
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => { removeBenefit(b.id); markUnsaved(); }} data-testid={`button-remove-benefit-${b.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Who This Is For */}
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Users className="h-4 w-4" />} title={funnelType === "employment_opportunity" ? "Ideal Candidates" : "Who This Is For"} subtitle="Help visitors self-qualify with targeted cards." accent={accentIconBg} />
                <Button size="sm" variant="outline" onClick={() => { addWhoCard(); markUnsaved(); }} data-testid="button-add-who-card">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Card
                </Button>
              </div>
              <div className="space-y-3">
                {whoCards.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">No cards yet.</div>
                )}
                {whoCards.map(c => (
                  <div key={c.id} className="flex gap-3 p-4 bg-muted/30 rounded-lg border border-border/40" data-testid={`card-who-${c.id}`}>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input value={c.title} onChange={e => { updateWhoCard(c.id, "title", e.target.value); markUnsaved(); }} placeholder="e.g. High School Athletes" data-testid={`input-who-title-${c.id}`} />
                      <Input value={c.description} onChange={e => { updateWhoCard(c.id, "description", e.target.value); markUnsaved(); }} placeholder="Short description..." data-testid={`input-who-desc-${c.id}`} />
                      <Select value={c.icon} onValueChange={v => { updateWhoCard(c.id, "icon", v); markUnsaved(); }}>
                        <SelectTrigger data-testid={`select-who-icon-${c.id}`}><SelectValue placeholder="Icon" /></SelectTrigger>
                        <SelectContent>{ICON_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0 self-center" onClick={() => { removeWhoCard(c.id); markUnsaved(); }} data-testid={`button-remove-who-${c.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── TESTIMONIALS TAB ── */}
          <TabsContent value="testimonials" className="space-y-6">
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader
                  icon={<Star className="h-4 w-4" />}
                  title={funnelType === "team_training" ? "Partner Testimonials" : funnelType === "employment_opportunity" ? "Coach/Staff Testimonials" : "Athlete Testimonials"}
                  subtitle="Social proof that builds trust and drives conversions."
                  accent={accentIconBg}
                />
                <Button size="sm" variant="outline" onClick={() => { addTestimonial(); markUnsaved(); }} data-testid="button-add-testimonial">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Testimonial
                </Button>
              </div>
              <div className="space-y-4">
                {testimonials.length === 0 && (
                  <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    No testimonials yet. {funnelType === "team_training" ? "Add a school or organization testimonial." : funnelType === "employment_opportunity" ? "Add a coach success story." : "Add your first athlete story."}
                  </div>
                )}
                {testimonials.map(t => (
                  <div key={t.id} className="p-5 bg-muted/30 rounded-xl border border-border/40 space-y-4" data-testid={`card-testimonial-${t.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {t.photoUrl ? (
                          <img src={t.photoUrl} alt={t.name} className={`h-10 w-10 rounded-full object-cover border-2 ${ft.accentBorder}`} />
                        ) : (
                          <div className={`h-10 w-10 rounded-full ${ft.accentBg} flex items-center justify-center ${ft.accent} font-bold text-sm`}>
                            {t.name ? t.name[0] : "?"}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-sm">{t.name || "Name"}</p>
                          <p className="text-xs text-muted-foreground">{t.role || ft.testimonialRoleLabel}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Featured</span>
                          <Switch checked={t.featured} onCheckedChange={v => { updateTestimonial(t.id, "featured", v); markUnsaved(); }} data-testid={`switch-testimonial-featured-${t.id}`} />
                        </div>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 w-7 p-0" onClick={() => { removeTestimonial(t.id); markUnsaved(); }} data-testid={`button-remove-testimonial-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input value={t.name} onChange={e => { updateTestimonial(t.id, "name", e.target.value); markUnsaved(); }} placeholder={funnelType === "team_training" ? "Coach Johnson" : funnelType === "employment_opportunity" ? "Alex Rivera" : "Marcus Thompson"} data-testid={`input-testimonial-name-${t.id}`} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{ft.testimonialRoleLabel}</Label>
                        <Input value={t.role} onChange={e => { updateTestimonial(t.id, "role", e.target.value); markUnsaved(); }} placeholder={funnelType === "team_training" ? "Athletic Director, Lincoln High" : funnelType === "employment_opportunity" ? "CSCS Coach, 5 years" : "Running Back, Class of 2025"} data-testid={`input-testimonial-role-${t.id}`} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Testimonial Quote</Label>
                      <Textarea value={t.quote} onChange={e => { updateTestimonial(t.id, "quote", e.target.value); markUnsaved(); }} placeholder="Compelling quote here..." rows={3} data-testid={`input-testimonial-quote-${t.id}`} />
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <UserCircle2 className={`h-3.5 w-3.5 ${ft.accent}`} />
                          <span className="text-xs font-medium">Photo (optional)</span>
                          <Badge className={`ml-auto text-[10px] ${ft.accentBg} ${ft.accent} border ${ft.accentBorder}`}>Avatar</Badge>
                        </div>
                        <MediaUploadZone
                          label="Testimonial Photo"
                          accept="image"
                          value={t.photoUrl}
                          onChange={url => { updateTestimonial(t.id, "photoUrl", url); markUnsaved(); }}
                          accentColor={ft.accent}
                          accentBg={ft.accentBg}
                          accentBorder={ft.accentBorder}
                          maxSizeMB={5}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Rating</Label>
                        <div className="flex gap-1 mt-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button key={n} onClick={() => { updateTestimonial(t.id, "rating", n); markUnsaved(); }} data-testid={`button-rating-${n}-${t.id}`}>
                              <Star className={`h-5 w-5 ${n <= t.rating ? `${ft.accent} fill-current` : "text-muted-foreground"}`} />
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

          {/* ── FORM FIELDS TAB ── */}
          <TabsContent value="form" className="space-y-6">
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Form Fields" subtitle="Control which fields visitors see and which are required." accent={accentIconBg} />
                <Button size="sm" variant="outline" onClick={() => { addCustomField(); markUnsaved(); }} data-testid="button-add-custom-field">
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Custom Question
                </Button>
              </div>
              <div className={`px-3 py-2 rounded-lg ${ft.accentBg} border ${ft.accentBorder} mb-2`}>
                <p className={`text-xs ${ft.accent} font-medium`}>{ft.label} funnel — {formFields.filter(f => f.enabled).length} fields enabled, {formFields.filter(f => f.required).length} required</p>
              </div>
              <div className="space-y-2">
                {formFields.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/30" data-testid={`row-form-field-${f.id}`}>
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {f.custom ? (
                        <Input value={f.label} onChange={e => { updateCustomField(f.id, e.target.value); markUnsaved(); }} placeholder="Question label..." className="h-7 text-sm" data-testid={`input-custom-field-label-${f.id}`} />
                      ) : (
                        <div>
                          <span className="text-sm font-medium truncate">{f.label}</span>
                          {f.type === "select" && <span className="ml-2 text-[10px] text-muted-foreground">dropdown</span>}
                          {f.type === "checkbox" && <span className="ml-2 text-[10px] text-muted-foreground">multi-select</span>}
                          {f.type === "textarea" && <span className="ml-2 text-[10px] text-muted-foreground">long text</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Enabled</span>
                        <Switch checked={f.enabled} onCheckedChange={() => { toggleField(f.id, "enabled"); markUnsaved(); }} data-testid={`switch-field-enabled-${f.id}`} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Required</span>
                        <Switch checked={f.required} disabled={!f.enabled} onCheckedChange={() => { toggleField(f.id, "required"); markUnsaved(); }} data-testid={`switch-field-required-${f.id}`} />
                      </div>
                      {f.custom && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-6 w-6 p-0" onClick={() => { removeCustomField(f.id); markUnsaved(); }} data-testid={`button-remove-field-${f.id}`}><X className="h-3 w-3" /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Tip: Fewer required fields generally increases form completion rates by 15–30%.</p>
            </Card>
          </TabsContent>

          {/* ── BOOKING TAB ── */}
          <TabsContent value="booking" className="space-y-6">
            <Card className="p-6 space-y-5">
              <SectionHeader
                icon={<Calendar className="h-4 w-4" />}
                title={funnelType === "team_training" ? "Discovery Call Configuration" : funnelType === "employment_opportunity" ? "Interview Scheduling" : "Booking Configuration"}
                subtitle={funnelType === "team_training" ? "Direct qualified B2B leads to book a discovery call immediately after inquiring." : funnelType === "employment_opportunity" ? "Send candidates to a screening call or interview booking link." : "Direct high-intent athletes to book a session immediately after applying."}
                accent={accentIconBg}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">Mode</Label>
                <Select value={bookingType} onValueChange={v => { setBookingType(v); markUnsaved(); }}>
                  <SelectTrigger data-testid="select-booking-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Disabled — No booking CTA</SelectItem>
                    <SelectItem value="external">External Link (Calendly, Cal.com, etc.)</SelectItem>
                    <SelectItem value="internal">Internal Scheduling</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bookingType !== "none" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{funnelType === "team_training" ? "Discovery Call URL" : funnelType === "employment_opportunity" ? "Interview Booking URL" : "Booking URL"}</Label>
                    <Input value={bookingUrl} onChange={e => { setBookingUrl(e.target.value); markUnsaved(); }} placeholder="https://calendly.com/your-link" data-testid="input-booking-url" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Button Text</Label>
                    <Input value={bookingButtonText} onChange={e => { setBookingButtonText(e.target.value); markUnsaved(); }} placeholder={funnelType === "team_training" ? "Book a Discovery Call" : funnelType === "employment_opportunity" ? "Schedule Your Interview" : "Book Your Free Evaluation"} data-testid="input-booking-button-text" />
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg">
                    <Switch checked={bookingRedirectOnSubmit} onCheckedChange={v => { setBookingRedirectOnSubmit(v); markUnsaved(); }} data-testid="switch-booking-redirect" />
                    <div>
                      <p className="text-sm font-medium">Immediate redirect after submission</p>
                      <p className="text-xs text-muted-foreground">Auto-redirect to the booking page when the form is submitted.</p>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* ── AUTOMATIONS TAB ── */}
          <TabsContent value="automations" className="space-y-6">
            <Card className="p-6 space-y-5">
              <SectionHeader icon={<Workflow className="h-4 w-4" />} title="Built-In Automations" subtitle={`These automations run automatically for every ${ft.label.toLowerCase()} submission. No configuration required.`} accent={accentIconBg} />
              <div className="space-y-3">
                {ft.automations.map((a, i) => (
                  <div key={i} className={`flex gap-4 p-4 rounded-xl ${ft.accentBg} border ${ft.accentBorder}`} data-testid={`automation-${i}`}>
                    <div className={`p-2.5 rounded-lg ${ft.accentBg} border ${ft.accentBorder} ${ft.accent} shrink-0 h-fit`}>
                      {a.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{a.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.desc}</p>
                    </div>
                    <div className="ml-auto shrink-0">
                      <Badge className={`${ft.accentBg} ${ft.accent} border ${ft.accentBorder} text-[10px]`}>Active</Badge>
                    </div>
                  </div>
                ))}
              </div>
              {funnelType === "team_training" && (
                <div className="p-4 bg-muted/30 rounded-xl border border-border/40">
                  <p className="text-xs font-semibold mb-2">Pipeline Integration</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">Every Team Training submission creates a deal in your Team Training pipeline. Deal value is estimated from the team size and budget range fields — edit those fields in the Form tab to improve accuracy.</p>
                </div>
              )}
              {funnelType === "employment_opportunity" && (
                <div className="p-4 bg-muted/30 rounded-xl border border-border/40">
                  <p className="text-xs font-semibold mb-2">Hiring Pipeline</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">Each application creates a candidate record with status: Applied → Screening → Interview → Offer → Hired. AI scores candidates based on certifications, experience match, and response quality.</p>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── BRANDING TAB ── */}
          <TabsContent value="branding" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6 space-y-5">
                <SectionHeader icon={<Palette className="h-4 w-4" />} title="Colors & Style" accent={accentIconBg} />
                <div className="space-y-1.5">
                  <Label className="text-xs">Accent Color</Label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={accentColor} onChange={e => { setAccentColor(e.target.value); markUnsaved(); }} className="h-10 w-16 rounded-lg border border-border cursor-pointer bg-transparent" data-testid="color-accent" />
                    <Input value={accentColor} onChange={e => { setAccentColor(e.target.value); markUnsaved(); }} className="font-mono" data-testid="input-accent-color" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Recommended: {ft.accentHex} ({ft.label} default)</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Gradient Preset</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {GRADIENT_PRESETS.map(g => (
                      <button key={g.value} onClick={() => { setGradientPreset(g.value); markUnsaved(); }}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${gradientPreset === g.value ? `${ft.accentBorder} ring-1` : "border-border/50 hover:border-border"}`}
                        data-testid={`button-gradient-${g.value}`}>
                        <div className={`h-6 w-10 rounded bg-gradient-to-r ${g.preview} shrink-0`} />
                        <span className="text-xs font-medium">{g.label}</span>
                        {gradientPreset === g.value && <Check className={`h-3.5 w-3.5 ${ft.accent} ml-auto`} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Button Style</Label>
                  <div className="flex gap-2">
                    {(["solid", "outline", "gradient"] as const).map(s => (
                      <Button key={s} size="sm" variant={buttonStyle === s ? "default" : "outline"}
                        onClick={() => { setButtonStyle(s); markUnsaved(); }}
                        className={`capitalize ${buttonStyle === s ? (funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600") : ""}`}
                        data-testid={`button-style-${s}`}>{s}</Button>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="p-6 space-y-5">
                <SectionHeader icon={<Settings2 className="h-4 w-4" />} title="Typography & Intensity" accent={accentIconBg} />
                <div className="space-y-2">
                  <Label className="text-xs">Typography Preset</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "athletic", label: "Athletic", desc: "Bold, powerful" },
                      { value: "modern", label: "Modern", desc: "Clean & sharp" },
                      { value: "bold", label: "Bold", desc: "Maximum impact" },
                      { value: "clean", label: "Clean", desc: "Minimal & precise" },
                    ] as const).map(t => (
                      <button key={t.value} onClick={() => { setTypographyPreset(t.value); markUnsaved(); }}
                        className={`p-3 rounded-lg border text-left transition-all ${typographyPreset === t.value ? `${ft.accentBorder} ${ft.accentBg}` : "border-border/50 hover:border-border"}`}
                        data-testid={`button-typography-${t.value}`}>
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
                      <button key={d.value} onClick={() => { setDarkIntensity(d.value); markUnsaved(); }}
                        className={`p-3 rounded-lg border text-left transition-all ${darkIntensity === d.value ? `${ft.accentBorder} ${ft.accentBg}` : "border-border/50 hover:border-border"}`}
                        data-testid={`button-dark-${d.value}`}>
                        <p className="text-xs font-semibold">{d.label}</p>
                        <p className="text-[10px] text-muted-foreground">{d.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
            {/* Laser Effects Card */}
            <Card className="p-6 space-y-5">
              <SectionHeader icon={<Zap className="h-4 w-4" />} title="Laser Effects" subtitle="Dynamic visual system for hero sections and success screens." accent={accentIconBg} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable Laser Effects</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Subtle animated beams and scanning lines behind the hero content.</p>
                </div>
                <Switch
                  checked={laserEffectsEnabled}
                  onCheckedChange={v => { setLaserEffectsEnabled(v); markUnsaved(); }}
                  data-testid="switch-laser-enabled"
                />
              </div>
              {laserEffectsEnabled && (
                <div className="space-y-5 pt-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Apply to Cards</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Subtle glow and border sweep on section cards.</p>
                    </div>
                    <Switch
                      checked={laserCardsEnabled}
                      onCheckedChange={v => { setLaserCardsEnabled(v); markUnsaved(); }}
                      data-testid="switch-laser-cards-enabled"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Intensity</Label>
                    <div className="flex gap-2">
                      {([
                        { value: "subtle", label: "Subtle", desc: "Minimal glow" },
                        { value: "standard", label: "Standard", desc: "Balanced" },
                        { value: "high", label: "High", desc: "Bold beams" },
                      ] as const).map(i => (
                        <button
                          key={i.value}
                          onClick={() => { setLaserIntensity(i.value); markUnsaved(); }}
                          className={`flex-1 p-3 rounded-lg border text-left transition-all ${laserIntensity === i.value ? `${ft.accentBorder} ${ft.accentBg}` : "border-border/50 hover:border-border"}`}
                          data-testid={`button-laser-intensity-${i.value}`}
                        >
                          <p className="text-xs font-semibold">{i.label}</p>
                          <p className="text-[10px] text-muted-foreground">{i.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Color Preset</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: "performance-orange", label: "Performance Orange", color: "#f97316", desc: "Athlete funnels" },
                        { value: "team-cyan",          label: "Team Cyan",          color: "#06b6d4", desc: "Team training" },
                        { value: "career-purple",      label: "Career Purple",      color: "#a855f7", desc: "Employment" },
                        { value: "elite-green",        label: "Elite Green",        color: "#22c55e", desc: "Premium feel" },
                      ] as const).map(p => (
                        <button
                          key={p.value}
                          onClick={() => { setLaserPreset(p.value); markUnsaved(); }}
                          className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${laserPreset === p.value ? `${ft.accentBorder} ring-1` : "border-border/50 hover:border-border"}`}
                          data-testid={`button-laser-preset-${p.value}`}
                        >
                          <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: p.color, boxShadow: `0 0 6px ${p.color}80` }} />
                          <div>
                            <p className="text-xs font-semibold leading-none">{p.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</p>
                          </div>
                          {laserPreset === p.value && <Check className={`h-3.5 w-3.5 ${ft.accent} ml-auto`} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={`px-4 py-3 rounded-lg ${ft.accentBg} border ${ft.accentBorder}`}>
                    <p className={`text-xs ${ft.accent} font-medium`}>Effects applied to: hero background, urgency badge glow, and success screen verification sweep.</p>
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── ANALYTICS TAB ── */}
          <TabsContent value="analytics" className="space-y-6">
            <Card className="p-6 space-y-5">
              <SectionHeader icon={<BarChart2 className="h-4 w-4" />} title="Funnel Visualization" subtitle="How visitors move through your funnel." accent={accentIconBg} />
              {funnel ? (
                <div className="space-y-3">
                  {[
                    { label: "Page Views", value: funnel.pageViews ?? 0, pct: 100 },
                    { label: "Step 1 Starts", value: funnel.step1Starts ?? 0, pct: (funnel.pageViews ?? 0) > 0 ? Math.round((funnel.step1Starts ?? 0) / (funnel.pageViews ?? 1) * 100) : 0 },
                    { label: "Partial Captures", value: funnel.partialCaptures ?? 0, pct: (funnel.pageViews ?? 0) > 0 ? Math.round((funnel.partialCaptures ?? 0) / (funnel.pageViews ?? 1) * 100) : 0 },
                    { label: ft.analyticsLabel, value: funnel.completions ?? 0, pct: (funnel.pageViews ?? 0) > 0 ? Math.round((funnel.completions ?? 0) / (funnel.pageViews ?? 1) * 100) : 0 },
                  ].map(step => (
                    <div key={step.label} className="space-y-1" data-testid={`funnel-step-${step.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{step.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-bold">{step.value.toLocaleString()}</span>
                          <Badge variant="outline" className="text-xs">{step.pct}%</Badge>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${funnelType === "team_training" ? "bg-cyan-500" : funnelType === "employment_opportunity" ? "bg-purple-500" : "bg-orange-500"}`} style={{ width: `${step.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-sm text-muted-foreground">Analytics appear once visitors start viewing your funnel.</div>
              )}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Completion Rate", value: funnel ? `${funnel.completionRate}%` : "—", desc: "Views → Completions" },
                { label: "High-Intent Rate", value: stats && stats.total > 0 ? `${Math.round(stats.highIntent / stats.total * 100)}%` : "—", desc: "Score ≥70 / total" },
                { label: "Abandonment Rate", value: funnel && funnel.step1Starts > 0 ? `${Math.round((funnel.step1Starts - funnel.completions) / funnel.step1Starts * 100)}%` : "—", desc: "Started but didn't finish" },
              ].map(m => (
                <Card key={m.label} className="p-4 space-y-2">
                  <p className={`text-xs uppercase tracking-wider font-semibold ${ft.accent}`}>{m.label}</p>
                  <p className="text-2xl font-bold" data-testid={`metric-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>{m.value}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </Card>
              ))}
            </div>

            {publicUrl && (
              <Card className={`p-4 ${ft.accentBorder} border ${ft.accentBg}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">UTM Tracking</p>
                    <p className="text-xs text-muted-foreground">Append UTM params to track traffic sources accurately.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${publicUrl}?utm_source=instagram&utm_medium=social&utm_campaign=summer`); toast({ title: "UTM link copied!" }); }} data-testid="button-copy-utm">
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
                <SectionHeader icon={<Lightbulb className="h-4 w-4" />} title={`AI Recommendations — ${ft.label}`} subtitle="Personalized suggestions to improve funnel performance." accent={accentIconBg} />
                <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: [`/api/lead-capture/programs/${programId}/stats`] })} data-testid="button-refresh-ai-recs">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                </Button>
              </div>
              <div className="space-y-3">
                {ft.aiRecs.map((rec, i) => (
                  <div key={i} className={`flex gap-3 p-4 ${ft.accentBg} border ${ft.accentBorder} rounded-xl`} data-testid={`ai-rec-${i}`}>
                    <div className={`p-1.5 ${ft.accentBg} border ${ft.accentBorder} rounded-lg ${ft.accent} shrink-0 h-fit`}>
                      <Lightbulb className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{rec}</p>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-muted/30 rounded-xl border border-border/40">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Recommendations are based on your program's conversion data, funnel type benchmarks, and channel performance patterns. More accurate suggestions appear as the funnel collects more data.
                </p>
              </div>
            </Card>
          </TabsContent>

          {/* ── LAUNCH READINESS TAB ── */}
          <TabsContent value="launch" className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Shield className={`h-5 w-5 ${ft.accent}`} /> Campaign Launch Preflight
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Verify the full lead→agent→pipeline architecture is ready before going live.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runPreflightMutation.isPending}
                  onClick={() => runPreflightMutation.mutate({ runDryRun: true })}
                  data-testid="button-preflight-dry-run"
                >
                  {runPreflightMutation.isPending && runPreflightMutation.variables?.runDryRun
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
                  Test Lead Flow
                </Button>
                <Button
                  size="sm"
                  disabled={runPreflightMutation.isPending}
                  onClick={() => runPreflightMutation.mutate({ runDryRun: false })}
                  className={funnelType === "team_training" ? "bg-cyan-600 hover:bg-cyan-700" : funnelType === "employment_opportunity" ? "bg-purple-600 hover:bg-purple-700" : "bg-orange-500 hover:bg-orange-600"}
                  data-testid="button-preflight-run"
                >
                  {runPreflightMutation.isPending && !runPreflightMutation.variables?.runDryRun
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                  Run Preflight
                </Button>
              </div>
            </div>

            {/* Health summary banner */}
            {preflightResult ? (
              <Card className={`p-4 border ${
                preflightResult.healthBadge === "ready"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : preflightResult.healthBadge === "needs_attention"
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-red-500/30 bg-red-500/5"
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {preflightResult.healthBadge === "ready" && <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0" />}
                    {preflightResult.healthBadge === "needs_attention" && <AlertCircle className="h-8 w-8 text-amber-400 shrink-0" />}
                    {preflightResult.healthBadge === "blocked" && <XCircle className="h-8 w-8 text-red-400 shrink-0" />}
                    <div>
                      <p className={`font-bold text-base ${
                        preflightResult.healthBadge === "ready" ? "text-emerald-400"
                        : preflightResult.healthBadge === "needs_attention" ? "text-amber-400"
                        : "text-red-400"
                      }`}>
                        {preflightResult.healthBadge === "ready" ? "All systems ready — safe to launch"
                          : preflightResult.healthBadge === "needs_attention" ? "Launch possible — some warnings to review"
                          : "Launch blocked — critical issues detected"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Ran {new Date(preflightResult.ranAt).toLocaleString()} · {preflightResult.durationMs}ms
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <CheckCircle2 className="h-4 w-4" /> {preflightResult.passedCount}
                    </span>
                    <span className="flex items-center gap-1 text-amber-400 font-semibold">
                      <AlertCircle className="h-4 w-4" /> {preflightResult.warningCount}
                    </span>
                    <span className="flex items-center gap-1 text-red-400 font-semibold">
                      <XCircle className="h-4 w-4" /> {preflightResult.failedCount}
                    </span>
                  </div>
                </div>
              </Card>
            ) : lastPreflightData?.last ? (
              <Card className="p-4 border border-border/50 bg-muted/20">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>
                    Last preflight: <strong>{lastPreflightData.last.healthBadge?.replace("_", " ")}</strong> ·
                    {" "}{lastPreflightData.last.passedCount} passed, {lastPreflightData.last.warningCount} warnings, {lastPreflightData.last.failedCount} failed ·
                    {" "}{new Date(lastPreflightData.last.ranAt).toLocaleString()}
                  </span>
                  <Button size="sm" variant="ghost" className="ml-auto text-xs h-7 px-2" onClick={() => runPreflightMutation.mutate({ runDryRun: false })} data-testid="button-rerun-preflight">
                    Re-run
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-6 border border-dashed border-border/50 bg-muted/10">
                <div className="flex flex-col items-center gap-3 text-center py-4">
                  <div className={`p-3 rounded-full ${ft.accentBg} border ${ft.accentBorder}`}>
                    <Rocket className={`h-6 w-6 ${ft.accent}`} />
                  </div>
                  <div>
                    <p className="font-semibold">No preflight run yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click "Run Preflight" to verify all 17 checks across your lead capture, pipeline, and agent configuration before launching.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Check grid */}
            {preflightResult && preflightResult.checks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Check Results</p>
                  {fixableChecks.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fixPreflightMutation.isPending}
                      onClick={() => fixPreflightMutation.mutate(fixableChecks)}
                      className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs h-7"
                      data-testid="button-preflight-autofix"
                    >
                      {fixPreflightMutation.isPending
                        ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        : <Wrench className="h-3 w-3 mr-1.5" />}
                      Auto-Fix {fixableChecks.length} Issue{fixableChecks.length !== 1 ? "s" : ""}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {preflightResult.checks.map(chk => (
                    <div
                      key={chk.id}
                      data-testid={`preflight-check-${chk.id}`}
                      className={`flex gap-3 p-4 rounded-xl border transition-all ${
                        chk.status === "passed" ? "border-emerald-500/20 bg-emerald-500/5"
                        : chk.status === "warning" ? "border-amber-500/25 bg-amber-500/5"
                        : chk.status === "failed" ? "border-red-500/25 bg-red-500/5"
                        : "border-border/40 bg-muted/10 opacity-60"
                      }`}
                    >
                      <div className="shrink-0 mt-0.5">
                        {chk.status === "passed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                        {chk.status === "warning" && <AlertCircle className="h-4 w-4 text-amber-400" />}
                        {chk.status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
                        {chk.status === "skipped" && <Clock className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{chk.label}</p>
                          {chk.autoFixable && (chk.status === "failed" || chk.status === "warning") && (
                            <Badge className="text-[10px] h-4 px-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              <Wrench className="h-2.5 w-2.5 mr-0.5" /> Auto-fixable
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{chk.description}</p>
                        {chk.detail && (
                          <p className={`text-xs mt-1.5 font-mono leading-relaxed ${
                            chk.status === "failed" ? "text-red-300"
                            : chk.status === "warning" ? "text-amber-300"
                            : "text-emerald-300"
                          }`}>{chk.detail}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dry-run results */}
            {preflightResult?.dryRunResult && (
              <Card className="p-5 space-y-4 border border-border/50">
                <div className="flex items-center gap-2">
                  <FlaskConical className={`h-4 w-4 ${ft.accent}`} />
                  <p className="font-semibold text-sm">Dry-Run Simulation Results</p>
                  <Badge className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/30 ml-auto">No real records written</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Route Resolves", ok: preflightResult.dryRunResult.routeResolves },
                    { label: "Pipeline Would Run", ok: preflightResult.dryRunResult.pipelineWouldRun },
                    { label: "Gmail Draft Would Queue", ok: preflightResult.dryRunResult.gmailDraftWouldQueue },
                    { label: "Stage Would Init", ok: preflightResult.dryRunResult.pipelineStageWouldInit },
                    { label: "No Real Records Committed", ok: preflightResult.dryRunResult.noRealRecordsCommitted },
                  ].map(item => (
                    <div key={item.label} className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
                      item.ok ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300" : "border-red-500/25 bg-red-500/8 text-red-300"
                    }`}>
                      {item.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                      <span className="text-xs font-medium">{item.label}</span>
                    </div>
                  ))}
                </div>
                {(preflightResult.dryRunResult.simulatedScore !== undefined || preflightResult.dryRunResult.simulatedDraftSubject) && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                    {preflightResult.dryRunResult.simulatedScore !== undefined && (
                      <div className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Simulated Lead Score</p>
                        <p className="text-xl font-bold">{preflightResult.dryRunResult.simulatedScore}</p>
                      </div>
                    )}
                    {preflightResult.dryRunResult.simulatedTemperature && (
                      <div className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Temperature</p>
                        <p className="text-xl font-bold capitalize">{preflightResult.dryRunResult.simulatedTemperature}</p>
                      </div>
                    )}
                    {preflightResult.dryRunResult.simulatedDraftSubject && (
                      <div className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-1 sm:col-span-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Draft Email Subject</p>
                        <p className="text-xs font-medium leading-snug">{preflightResult.dryRunResult.simulatedDraftSubject}</p>
                      </div>
                    )}
                  </div>
                )}
                {preflightResult.dryRunResult.errors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Simulation Errors</p>
                    {preflightResult.dryRunResult.errors.map((err, i) => (
                      <div key={i} className="flex gap-2 p-2.5 rounded-lg border border-red-500/25 bg-red-500/8">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-300 font-mono">{err}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* About panel */}
            <Card className="p-4 border border-border/40 bg-muted/10">
              <div className="flex gap-3">
                <Shield className={`h-4 w-4 ${ft.accent} shrink-0 mt-0.5`} />
                <div className="space-y-1">
                  <p className="text-xs font-semibold">What Preflight Checks</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    17 checks spanning: lead capture route health, form fields, pipeline configuration, LIP integration,
                    Gmail agent setup, AI provider connectivity, email DNS/SPF, Stripe payment links, autonomy policy,
                    duplicate suppression, and a full end-to-end dry-run simulation. No real records are created during dry-run mode.
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
